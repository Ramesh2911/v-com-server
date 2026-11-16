const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requestUpload, classifyFileType, toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');
const { getPagination } = require('../../utils/pagination');

router.use(authMiddleware);

/* ================= booking status mapping (doc values <-> DB enum) ================= */
const TO_DOC_STATUS = {
  pending_review: 'upcoming',
  assigned: 'upcoming',
  quoted: 'upcoming',
  approved: 'upcoming',
  scheduled: 'upcoming',
  in_progress: 'in_progress',
  completed: 'completed',
  closed: 'completed',
  cancelled: 'cancelled',
};
const FROM_DOC_STATUS = {
  upcoming: ['pending_review', 'assigned', 'quoted', 'approved', 'scheduled'],
  in_progress: ['in_progress'],
  completed: ['completed', 'closed'],
  cancelled: ['cancelled'],
};
const DB_STATUSES = new Set(Object.keys(TO_DOC_STATUS));
const mapStatus = (s) => TO_DOC_STATUS[s] || s;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const scheduledAt = (d, t) => {
  if (!d || !t) return null;
  const iso = `${String(d).slice(0, 10)}T${t}:00Z`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
};
const num = (v) => (v == null ? 0 : Number(v));
const fmtPhone = (p) => {
  if (!p) return null;
  const s = String(p).trim();
  return /^\d{10}$/.test(s) ? `+91 ${s}` : s;
};

const REQUEST_SELECT = `
  SELECT r.*,
         m.name AS module_name, m.code AS module_code,
         c.name AS category_name, c.image AS category_image, c.price AS category_price,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         v.business_name AS vendor_business_name, v.rating AS vendor_rating,
         vu.name AS vendor_contact_name, vu.phone AS vendor_contact_phone, vu.avatar AS vendor_avatar
    FROM requests r
    JOIN service_modules m ON m.id = r.module_id
    LEFT JOIN service_categories c ON c.id = r.category_id
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN vendors v ON v.id = r.assigned_vendor_id
    LEFT JOIN users vu ON vu.id = v.user_id`;

async function withAttachments(requests) {
  if (!requests.length) return requests;
  const ids = requests.map((r) => r.id);
  const [files] = await pool.query(`SELECT * FROM request_attachments WHERE request_id IN (?)`, [ids]);
  return requests.map((r) => ({
    ...r,
    attachments: files
      .filter((f) => f.request_id === r.id)
      .map((f) => ({ id: f.id, file_type: f.file_type, original_name: f.original_name, url: toPublicUrl(f.file_path) })),
  }));
}

async function notifyMany(ids, payload) {
  for (const id of ids) {
    await notify({ ...payload, userId: id });
  }
}

/* ================= shared response blocks (doc shape) ================= */

const serviceBlock = (row, { withPrice = false } = {}) => {
  if (!row.category_id) return null;
  const block = {
    id: row.category_id,
    name: row.category_name,
    category: row.module_name,
    image_url: toPublicUrl(row.category_image),
  };
  if (withPrice) block.base_price = row.category_price != null ? num(row.category_price) : null;
  return block;
};

const addressListBlock = (a) =>
  a && { line1: a.line1, city: a.city, state: a.state || null, pincode: a.pincode || null };

const addressDetailBlock = (a) =>
  a && {
    id: a.id,
    line1: a.line1,
    line2: a.line2 || null,
    landmark: a.landmark || null,
    city: a.city,
    state: a.state || null,
    pincode: a.pincode || null,
    latitude: a.latitude != null ? Number(a.latitude) : null,
    longitude: a.longitude != null ? Number(a.longitude) : null,
  };

const paymentListBlock = (total) => ({ total_amount: num(total), paid: false, method: null });

const paymentDetailBlock = (total) => ({
  subtotal: num(total),
  visiting_fee: 0,
  tax: 0,
  discount: 0,
  coupon_code: null,
  coupon_discount: 0,
  total_amount: num(total),
  paid: false,
  method: null,
  payment_id: null,
});

const buildTimeline = (row, history) => {
  const hs = history || [];
  const firstAt = (statuses) => {
    const h = hs.find((x) => statuses.includes(x.status));
    return h ? h.created_at : null;
  };
  const st = row.status;
  const partnerDone = ['assigned', 'quoted', 'approved', 'scheduled', 'in_progress', 'completed', 'closed'].includes(st) || !!row.assigned_vendor_id;
  const inProgDone = ['in_progress', 'completed', 'closed'].includes(st);
  const completedDone = ['completed', 'closed'].includes(st);
  return [
    { step: 'confirmed', label: 'Confirmed', done: true, timestamp: row.created_at },
    { step: 'partner_assigned', label: 'Partner Assigned', done: partnerDone, timestamp: firstAt(['assigned']) },
    { step: 'in_progress', label: 'In Progress', done: inProgDone, timestamp: firstAt(['in_progress']) },
    {
      step: 'completed',
      label: 'Completed',
      done: completedDone,
      timestamp: completedDone ? row.closed_at || firstAt(['completed', 'closed']) : null,
    },
  ];
};

const loadAddress = async (addressId, fallbackRow) => {
  if (addressId) {
    const [rows] = await pool.query('SELECT * FROM addresses WHERE id = ?', [addressId]);
    if (rows.length) return rows[0];
  }
  if (fallbackRow && fallbackRow.site_location) {
    return {
      id: null,
      line1: fallbackRow.site_location,
      line2: null,
      landmark: null,
      city: fallbackRow.city || null,
      state: null,
      pincode: null,
      latitude: fallbackRow.latitude,
      longitude: fallbackRow.longitude,
    };
  }
  return null;
};

const loadProvider = async (vendorId) => {
  if (!vendorId) return null;
  const [rows] = await pool.query(
    `SELECT v.id, v.business_name, v.rating, vu.name AS contact_name, vu.phone, vu.avatar
       FROM vendors v LEFT JOIN users vu ON vu.id = v.user_id WHERE v.id = ?`,
    [vendorId]
  );
  if (!rows.length) return null;
  const v = rows[0];
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM jobs j JOIN requests r ON r.id = j.request_id
      WHERE r.assigned_vendor_id = ? AND j.stage = 'completed'`,
    [vendorId]
  );
  return {
    id: v.id,
    name: v.contact_name || v.business_name,
    phone: fmtPhone(v.phone),
    avatar: toPublicUrl(v.avatar),
    rating: v.rating != null ? Number(v.rating) : null,
    total_jobs: Number(n) || 0,
  };
};

/* ================= 1. CREATE — booking contract + legacy fallback ================= */

const createLegacy = asyncHandler(async (req, res) => {
  const { module_id, category_id, title, description, site_location, city, latitude, longitude, quantity, specifications, priority = 'normal' } = req.body;
  const [[mod]] = await pool.query('SELECT id, code, name FROM service_modules WHERE id = ? AND status = 1', [module_id]);
  if (!mod) throw ApiError.badRequest('Invalid service module');
  if (!title || !title.trim()) throw ApiError.badRequest('Title is required');

  const ticketNo = await generateTicketNo(pool, 'request');
  const [result] = await pool.query(
    `INSERT INTO requests (ticket_no, customer_id, module_id, category_id, title, description, site_location, city,
      latitude, longitude, quantity, specifications, priority, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')`,
    [ticketNo, req.user.id, module_id, category_id || null, title.trim(), description || null,
     site_location || null, city || null, latitude || null, longitude || null,
     quantity || null, specifications || null, priority]
  );
  const requestId = result.insertId;

  for (const file of req.files || []) {
    await pool.query(
      `INSERT INTO request_attachments (request_id, file_path, file_type, original_name) VALUES (?, ?, ?, ?)`,
      [requestId, `requests/${file.filename}`, classifyFileType(file.mimetype), file.originalname]
    );
  }
  await pool.query(
    `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', 'Request submitted', ?)`,
    [requestId, req.user.id]
  );

  const staff = await staffWithPermission('requests.manage');
  await notifyMany(staff, {
    event: 'request_created',
    type: 'request',
    title: `New request ${ticketNo}`,
    body: `A new ${mod.name} request has been submitted.`,
    data: { ticket_no: ticketNo, module: mod.name, request_id: requestId },
  });

  sendSuccess(res, { id: requestId, ticket_no: ticketNo }, 'Request submitted successfully', 201);
});

const createBooking = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { service_id, address_id, scheduled_date, scheduled_time } = b;
  if (service_id == null || address_id == null || !scheduled_date || !scheduled_time) {
    throw ApiError.badRequest('service_id, address_id, scheduled_date and scheduled_time are required');
  }
  if (!DATE_RE.test(String(scheduled_date)) || Number.isNaN(new Date(`${scheduled_date}T00:00:00Z`).getTime())) {
    throw ApiError.badRequest('scheduled_date must be YYYY-MM-DD');
  }
  if (!TIME_RE.test(String(scheduled_time))) {
    throw ApiError.badRequest('scheduled_time must be HH:mm (24hr)');
  }

  const [[svc]] = await pool.query(
    `SELECT c.id, c.name, c.price, c.module_id, m.name AS module_name
       FROM service_categories c JOIN service_modules m ON m.id = c.module_id
      WHERE c.id = ? AND c.status = 1`,
    [service_id]
  );
  if (!svc) throw ApiError.notFound('Service not found');

  const [[addr]] = await pool.query(
    'SELECT * FROM addresses WHERE id = ? AND user_id = ? AND status = 1',
    [address_id, req.user.id]
  );
  if (!addr) throw ApiError.notFound('Address not found');

  const ticketNo = await generateTicketNo(pool, 'request');
  const [result] = await pool.query(
    `INSERT INTO requests (ticket_no, customer_id, module_id, category_id, title, site_location, city,
       latitude, longitude, priority, source, scheduled_date, scheduled_time, address_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 'app', ?, ?, ?)`,
    [ticketNo, req.user.id, svc.module_id, svc.id, svc.name, addr.line1, addr.city,
     addr.latitude, addr.longitude, scheduled_date, scheduled_time, addr.id]
  );
  const id = result.insertId;
  const bookingRef = `BK-${new Date().getFullYear()}-${id}`;
  await pool.query('UPDATE requests SET booking_ref = ? WHERE id = ?', [bookingRef, id]);
  await pool.query(
    `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', 'Booking created', ?)`,
    [id, req.user.id]
  );

  const staff = await staffWithPermission('requests.manage');
  await notifyMany(staff, {
    event: 'request_created',
    type: 'request',
    title: `New booking ${bookingRef}`,
    body: `A new ${svc.name} booking has been submitted.`,
    data: { booking_ref: bookingRef, request_id: id },
  });

  const [[row]] = await pool.query('SELECT * FROM requests WHERE id = ?', [id]);
  sendSuccess(
    res,
    {
      id,
      booking_ref: bookingRef,
      ticket_no: ticketNo,
      status: 'upcoming',
      scheduled_at: scheduledAt(scheduled_date, scheduled_time),
      service: { id: svc.id, name: svc.name, category: svc.module_name },
      address: { id: addr.id, line1: addr.line1, city: addr.city },
      created_at: row.created_at,
    },
    'Booking created successfully',
    201
  );
});

router.post(
  '/requests',
  requestUpload.array('attachments', 8),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const bookingMode = ['service_id', 'address_id', 'scheduled_date', 'scheduled_time'].some(
      (k) => b[k] !== undefined && b[k] !== ''
    );
    if (bookingMode) return createBooking(req, res);
    return createLegacy(req, res);
  })
);

/* ================= 2. LIST — doc shape (items + pagination) ================= */

router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const params = [req.user.id];
    let where = 'WHERE r.customer_id = ?';
    if (req.query.status) {
      const s = String(req.query.status);
      if (FROM_DOC_STATUS[s]) {
        const list = FROM_DOC_STATUS[s];
        where += ` AND r.status IN (${list.map(() => '?').join(',')})`;
        params.push(...list);
      } else if (DB_STATUSES.has(s)) {
        where += ' AND r.status = ?';
        params.push(s);
      } else {
        throw ApiError.badRequest('Invalid status');
      }
    }
    if (req.query.module_id) {
      where += ' AND r.module_id = ?';
      params.push(req.query.module_id);
    }
    if (req.query.search) {
      where += ' AND (r.title LIKE ? OR r.ticket_no LIKE ?)';
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM requests r ${where}`, params);
    const [rows] = await pool.query(
      `${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const addrIds = [...new Set(rows.map((r) => r.address_id).filter(Boolean))];
    const addrMap = {};
    if (addrIds.length) {
      const [addrs] = await pool.query('SELECT * FROM addresses WHERE id IN (?)', [addrIds]);
      for (const a of addrs) addrMap[a.id] = a;
    }

    const items = rows.map((r) => ({
      id: r.id,
      booking_ref: r.booking_ref || r.ticket_no,
      status: mapStatus(r.status),
      scheduled_at: scheduledAt(r.scheduled_date, r.scheduled_time),
      service: serviceBlock(r),
      address:
        addrMap[r.address_id] ||
        (r.site_location
          ? { line1: r.site_location, city: r.city, state: null, pincode: null }
          : null),
      payment: paymentListBlock(r.estimated_amount != null ? r.estimated_amount : r.category_price),
    }));
    // normalize address fields for list shape
    for (const it of items) {
      if (it.address && it.address.id != null) it.address = addressListBlock(it.address);
    }

    sendSuccess(
      res,
      {
        items,
        pagination: {
          current_page: page,
          total_pages: Math.max(1, Math.ceil(total / limit)),
          total_items: total,
          per_page: limit,
        },
      },
      'Requests fetched successfully'
    );
  })
);

/* ================= 3. DETAIL — doc shape + legacy blocks ================= */

router.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${REQUEST_SELECT} WHERE r.id = ? AND r.customer_id = ?`, [req.params.id, req.user.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    const row = rows[0];

    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM request_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.request_id = ? ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    const [quotations] = await pool.query(
      `SELECT q.id, q.ticket_no, q.total_amount, q.status, q.created_at, v.business_name AS vendor_name
         FROM quotations q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.request_id = ? ORDER BY q.created_at DESC`,
      [req.params.id]
    );
    const [reqRow] = await withAttachments([row]);
    const [reviews] = await pool.query(
      `SELECT id, service_rating, service_comment, status, created_at, updated_at
         FROM service_reviews WHERE request_id = ? AND customer_id = ?`,
      [req.params.id, req.user.id]
    );
    const [jobRows] = await pool.query(
      `SELECT job_no, stage, sub_status, customer_otp, schedule_date, amount
         FROM jobs WHERE request_id = ? ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );
    const j = jobRows[0] || null;
    const job = j
      ? {
          id: j.job_no,
          stage: j.stage,
          sub_status: j.sub_status || 'assigned',
          customer_otp: j.customer_otp || null,
          schedule_date: j.schedule_date,
          amount: j.amount != null ? Number(j.amount) : null,
        }
      : null;

    const addr = await loadAddress(row.address_id, row);
    const provider = await loadProvider(row.assigned_vendor_id);
    const priceTotal = row.estimated_amount != null ? row.estimated_amount : row.category_price;

    sendSuccess(res, {
      // ---- doc booking detail ----
      id: row.id,
      booking_ref: row.booking_ref || row.ticket_no,
      status: mapStatus(row.status),
      scheduled_at: scheduledAt(row.scheduled_date, row.scheduled_time),
      created_at: row.created_at,
      updated_at: row.updated_at,
      service: serviceBlock(row, { withPrice: true }),
      address: addressDetailBlock(addr),
      provider,
      payment: paymentDetailBlock(priceTotal),
      timeline: buildTimeline(row, history),
      review: reviews[0] || null,
      // ---- legacy / app extras ----
      ticket_no: row.ticket_no,
      title: row.title,
      description: row.description,
      priority: row.priority,
      module: { id: row.module_id, name: row.module_name, code: row.module_code },
      category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
      status_raw: row.status,
      history,
      quotations,
      attachments: reqRow.attachments,
      job,
    });
  })
);

/* ================= 4. CANCEL — PATCH (doc) + POST (compat) ================= */

const cancelHandler = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, status FROM requests WHERE id = ? AND customer_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw ApiError.notFound('Request not found');
  const st = rows[0].status;
  if (st === 'in_progress') {
    throw ApiError.badRequest('Cannot cancel a booking that is already in progress');
  }
  if (['completed', 'closed', 'cancelled'].includes(st)) {
    throw ApiError.badRequest('Request can no longer be cancelled');
  }
  const reason = req.body && req.body.reason ? String(req.body.reason).trim() : null;
  await pool.query(`UPDATE requests SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
  const note = reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer';
  const [h] = await pool.query(
    `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'cancelled', ?, ?)`,
    [req.params.id, note, req.user.id]
  );
  const [[{ cancelled_at }]] = await pool.query(
    'SELECT created_at AS cancelled_at FROM request_status_history WHERE id = ?',
    [h.insertId]
  );
  sendSuccess(
    res,
    { id: Number(req.params.id), status: 'cancelled', cancelled_at, refund_status: 'initiated' },
    'Booking cancelled successfully'
  );
});

router.patch('/requests/:id/cancel', cancelHandler);
router.post('/requests/:id/cancel', cancelHandler); // backward compatibility

module.exports = router;
