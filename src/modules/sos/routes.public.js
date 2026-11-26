const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const pool = require('../../config/db');
const env = require('../../config');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { optionalAuth } = require('../../middlewares/auth');
const { writeAudit } = require('../../utils/audit');
const { notify, staffWithPermission } = require('../../utils/notify');
const { generateTicketNo } = require('../../utils/ticketNo');
const { sosPhotoUpload, uploadSosPhoto } = require('../../middlewares/upload');
const {
  PHONE_RE,
  normalizePhone,
  assertValidPhone,
  createOtp,
  verifyOtp,
  signVerifyToken,
  readVerifyToken,
} = require('../auth/otp.service');
const { SOS_CATEGORIES, byId } = require('./categories.const');
const { serializeTicket, serializeHistoryItem, serializeResponder, upperStatus } = require('./serialize');

const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.sms.limits.sendPerMinuteIp,
  standardHeaders: true,
  legacyHeaders: false,
});
const otpVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const dispatchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

const SOS_PURPOSE = 'sos';
const SOS_TOKEN_TTL = '15m';

// ---------- helpers ----------

const findOrCreateSosUser = async (phone, name) => {
  const [[existing]] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
  if (existing) return existing.id;
  const [[roleRow]] = await pool.query(`SELECT id FROM roles WHERE slug = 'customer' AND status = 1`);
  if (!roleRow) throw ApiError.internal('Customer role not configured');
  const hash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  const [result] = await pool.query(
    `INSERT INTO users (name, phone, password_hash, user_type, role_id, status)
     VALUES (?, ?, ?, 'customer', ?, 'active')`,
    [name || 'SOS Caller', phone, hash, roleRow.id]
  );
  return result.insertId;
};

// pick active responder: exact category first, then general (NULL category); nearest when coords known
const pickResponder = async (categoryId, lat, lng) => {
  const [rows] = await pool.query(
    `SELECT * FROM sos_responders
      WHERE status = 'active' AND (category_id = ? OR category_id IS NULL)
      ORDER BY (category_id = ?) DESC, id ASC`,
    [categoryId, categoryId]
  );
  if (!rows.length) return null;
  if (lat == null || lng == null) return rows[0];
  let best = rows[0];
  let bestD = Infinity;
  const { haversineKm } = require('./serialize');
  for (const r of rows) {
    const d = haversineKm(lat, lng, r.latitude, r.longitude);
    if (d != null && d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
};

const loadTicketByNo = async (ticketNo) => {
  const [rows] = await pool.query(
    `SELECT s.*, u.name AS customer_name, u.phone AS customer_phone
       FROM sos_tickets s
       LEFT JOIN users u ON u.id = s.customer_id
      WHERE s.ticket_no = ?`,
    [ticketNo]
  );
  return rows[0] || null;
};

const attachResponder = async (ticket) => {
  if (!ticket) return ticket;
  if (ticket.responder_id) {
    const [rr] = await pool.query('SELECT * FROM sos_responders WHERE id = ?', [ticket.responder_id]);
    ticket._responder = serializeResponder(rr[0] || null, { lat: ticket.latitude, lng: ticket.longitude });
  } else if (ticket.assigned_to) {
    const [ur] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [ticket.assigned_to]);
    if (ur[0]) {
      ticket._responder = {
        unit_name: ur[0].name,
        contact_no: ur[0].phone || null,
        vehicle_no: null,
        driver_name: ur[0].name,
        estimated_eta: '10 mins',
      };
    }
  } else {
    ticket._responder = null;
  }
  return ticket;
};

const notifyStaff = async (ticketNo, sosId, description, priority) => {
  const staff = await staffWithPermission('sos.manage');
  for (const sid of staff) {
    await notify({
      userId: sid,
      event: 'sos_created',
      type: 'sos',
      title: `SOS Alert ${ticketNo}`,
      body: String(description || '').slice(0, 120),
      data: { ticket_no: ticketNo, sos_id: sosId, priority },
    });
  }
};

// ---------- 1. GET /categories ----------

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    sendSuccess(res, SOS_CATEGORIES, 'Emergency categories fetched successfully');
  })
);

// ---------- 2. POST /send-otp ----------

router.post(
  '/send-otp',
  otpSendLimiter,
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    assertValidPhone(phone);
    await createOtp(phone, SOS_PURPOSE);

    const isMock = !['msg91', 'twilio'].includes(env.sms.provider);
    sendSuccess(
      res,
      {
        phone,
        otp_length: 4,
        resend_in_seconds: 30,
        ...(isMock ? { default_test_otp: '1234' } : {}),
      },
      `OTP sent successfully to +91 ${phone}`
    );
  })
);

// ---------- 3. POST /verify-otp ----------

router.post(
  '/verify-otp',
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const otp = String(req.body.otp || req.body.code || '').trim();
    assertValidPhone(phone);
    if (!/^\d{4}$/.test(otp)) throw ApiError.badRequest('OTP must be a 4-digit code');

    await verifyOtp(phone, otp, SOS_PURPOSE);
    const verification_token = signVerifyToken(phone, SOS_PURPOSE, SOS_TOKEN_TTL);
    sendSuccess(res, { is_verified: true, phone, verification_token }, 'OTP verified successfully');
  })
);

// ---------- 4. POST /dispatch (multipart, auth optional) ----------

router.post(
  '/dispatch',
  dispatchLimiter,
  optionalAuth,
  sosPhotoUpload.single('photo'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};

    // category
    const categoryId = Number(b.category_id);
    const category = byId(categoryId);
    if (!category) throw ApiError.badRequest('Invalid category_id');

    // photo (required)
    if (!req.file) throw ApiError.badRequest('Photo is required');
    const photoUrl = await uploadSosPhoto(req.file);

    // requester phone (required)
    const phone = normalizePhone(b.requester_phone);
    assertValidPhone(phone);

    // location (required)
    const requesterLocation = String(b.requester_location || '').trim();
    if (!requesterLocation) throw ApiError.badRequest('requester_location is required');

    // is_for_other (required boolean-ish)
    if (b.is_for_other === undefined || b.is_for_other === null || b.is_for_other === '') {
      throw ApiError.badRequest('is_for_other is required (true/false)');
    }
    const isForOther = ['true', '1', 1, true].includes(
      typeof b.is_for_other === 'string' ? b.is_for_other.toLowerCase() : b.is_for_other
    );

    // conditional patient fields
    let otherName = null;
    let relationship = null;
    let otherPhone = null;
    if (isForOther) {
      otherName = String(b.other_person_name || '').trim();
      relationship = String(b.relationship || '').trim();
      if (!otherName) throw ApiError.badRequest('other_person_name is required when is_for_other=true');
      if (!relationship) throw ApiError.badRequest('relationship is required when is_for_other=true');
      if (b.other_person_phone) {
        otherPhone = normalizePhone(b.other_person_phone);
        if (!PHONE_RE.test(otherPhone)) throw ApiError.badRequest('Invalid other_person_phone');
      }
    }

    // description (required)
    const description = String(b.description || '').trim();
    if (!description) throw ApiError.badRequest('description is required');

    // verification token (required) — bind to requester phone
    const token = String(b.verification_token || '').trim();
    if (!token) throw ApiError.badRequest('verification_token is required');
    const decoded = readVerifyToken(token, SOS_PURPOSE);
    if (decoded.phone !== phone) throw ApiError.badRequest('verification_token does not match requester_phone');

    // coords optional
    const latitude = b.latitude !== undefined && b.latitude !== '' && b.latitude !== null ? Number(b.latitude) : null;
    const longitude = b.longitude !== undefined && b.longitude !== '' && b.longitude !== null ? Number(b.longitude) : null;
    if (latitude != null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      throw ApiError.badRequest('Invalid latitude');
    }
    if (longitude != null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      throw ApiError.badRequest('Invalid longitude');
    }

    const specialInstructions = String(b.special_instructions || '').trim() || null;
    const patientLocation = String(b.patient_location || '').trim() || null;

    // customer: logged-in user or phone-based guest
    let customerId;
    if (req.user && req.user.id) {
      customerId = req.user.id;
    } else {
      customerId = await findOrCreateSosUser(phone, isForOther ? otherName : null);
    }

    // assign responder before insert (need id)
    const responder = await pickResponder(categoryId, latitude, longitude);

    const ticketNo = await generateTicketNo(pool, 'sos');
    const priority = 'critical';
    const status = 'dispatched';

    const [result] = await pool.query(
      `INSERT INTO sos_tickets
        (ticket_no, customer_id, description, latitude, longitude, address, priority, status,
         category_id, photo_url, requester_phone, requester_location, is_for_other,
         other_person_name, relationship, other_person_phone, patient_location,
         special_instructions, verification_phone, responder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ticketNo,
        customerId,
        description,
        latitude,
        longitude,
        requesterLocation,
        priority,
        status,
        categoryId,
        photoUrl,
        phone,
        requesterLocation,
        isForOther ? 1 : 0,
        otherName,
        relationship,
        otherPhone,
        patientLocation,
        specialInstructions,
        phone,
        responder ? responder.id : null,
      ]
    );

    await pool.query(
      `INSERT INTO sos_status_history (sos_id, status, note, changed_by) VALUES (?, ?, ?, NULL)`,
      [result.insertId, status, 'Emergency SOS dispatched via public API']
    );

    await notifyStaff(ticketNo, result.insertId, description, priority);
    await writeAudit({
      actor: req.user || null,
      action: 'sos.dispatch',
      entity: 'sos_tickets',
      entityId: result.insertId,
      details: { ticket_no: ticketNo, category: category.code, phone },
      req,
    });

    const ticket = await loadTicketByNo(ticketNo);
    await attachResponder(ticket);

    const payload = serializeTicket(ticket);
    // doc shape: name includes relationship suffix
    if (isForOther && otherName) {
      payload.patient.name = relationship ? `${otherName} (${relationship})` : otherName;
    }

    sendSuccess(res, payload, 'Emergency SOS Dispatched Successfully', 201);
  })
);

// ---------- 5. GET /track/:ticket_no ----------

router.get(
  '/track/:ticket_no',
  asyncHandler(async (req, res) => {
    const ticket = await loadTicketByNo(req.params.ticket_no);
    if (!ticket) throw ApiError.notFound('SOS ticket not found');
    await attachResponder(ticket);

    const [history] = await pool.query(
      `SELECT h.status, h.note, h.created_at, u.name AS changed_by_name
         FROM sos_status_history h
         LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.sos_id = ? ORDER BY h.created_at ASC`,
      [ticket.id]
    );

    const payload = serializeTicket(ticket);
    payload.history = history.map((h) => ({
      status: upperStatus(h.status),
      note: h.note,
      changed_by_name: h.changed_by_name || null,
      created_at: h.created_at,
    }));

    sendSuccess(res, payload, 'SOS ticket tracked successfully');
  })
);

// ---------- 6. POST /cancel/:ticket_no ----------

router.post(
  '/cancel/:ticket_no',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const ticket = await loadTicketByNo(req.params.ticket_no);
    if (!ticket) throw ApiError.notFound('SOS ticket not found');

    // ownership: logged-in owner OR matching phone in body
    if (req.user && req.user.id) {
      if (ticket.customer_id !== req.user.id) throw ApiError.forbidden('You can only cancel your own SOS ticket');
    } else {
      const phone = normalizePhone(req.body.phone);
      if (!PHONE_RE.test(phone)) {
        throw ApiError.badRequest('phone is required to cancel without login');
      }
      if (phone !== ticket.requester_phone && phone !== ticket.verification_phone && phone !== ticket.customer_phone) {
        throw ApiError.forbidden('Phone does not match this SOS ticket');
      }
    }

    const CANCELLABLE = ['open', 'acknowledged', 'dispatched', 'in_progress'];
    if (!CANCELLABLE.includes(ticket.status)) {
      throw ApiError.conflict(`Ticket cannot be cancelled in status "${upperStatus(ticket.status)}"`);
    }

    await pool.query(`UPDATE sos_tickets SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, [ticket.id]);
    await pool.query(
      `INSERT INTO sos_status_history (sos_id, status, note, changed_by) VALUES (?, 'cancelled', ?, ?)`,
      [ticket.id, 'Cancelled by requester', req.user ? req.user.id : null]
    );

    await notify({
      userId: ticket.customer_id,
      event: 'sos_status_updated',
      type: 'sos',
      title: `SOS ${ticket.ticket_no} — CANCELLED`,
      data: { ticket_no: ticket.ticket_no, status: 'cancelled' },
    });
    await writeAudit({
      actor: req.user || null,
      action: 'sos.cancel',
      entity: 'sos_tickets',
      entityId: ticket.id,
      details: { ticket_no: ticket.ticket_no },
      req,
    });

    const updated = await loadTicketByNo(ticket.ticket_no);
    sendSuccess(res, serializeTicket(updated), 'SOS ticket cancelled successfully');
  })
);

// ---------- 7. GET /history ----------

router.get(
  '/history',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);

    let where;
    let params;
    if (req.user && req.user.id) {
      where = 'WHERE s.customer_id = ?';
      params = [req.user.id];
    } else {
      const phone = normalizePhone(req.query.phone);
      if (!PHONE_RE.test(phone)) {
        throw ApiError.badRequest('Provide a valid phone query param or login token');
      }
      where = 'WHERE (s.requester_phone = ? OR s.verification_phone = ?)';
      params = [phone, phone];
    }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sos_tickets s ${where}`, params);
    const [rows] = await pool.query(
      `SELECT s.*, COALESCE(u.name, '') AS customer_name
         FROM sos_tickets s
         LEFT JOIN users u ON u.id = s.customer_id
        ${where}
        ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    sendPaginated(res, {
      items: rows.map((r) => serializeHistoryItem(r)),
      total,
      page,
      limit,
      message: 'SOS history fetched successfully',
    });
  })
);

module.exports = router;
