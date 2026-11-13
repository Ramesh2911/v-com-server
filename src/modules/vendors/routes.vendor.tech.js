const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { kycUpload, uploadKycFiles } = require('../../middlewares/upload');

router.use(authMiddleware);

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('You are not an approved vendor account'));
  next();
};

const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'late'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const trimOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

const assertTechnician = async (technicianId, vendorId) => {
  const [[row]] = await pool.query('SELECT id FROM technicians WHERE id = ? AND vendor_id = ?', [
    technicianId,
    vendorId,
  ]);
  if (!row) throw ApiError.notFound('Technician not found');
  return row;
};

const assertFutureDate = (date) => {
  if (!DATE_RE.test(date)) throw ApiError.badRequest('attendance_date must be YYYY-MM-DD');
  if (date > new Date().toISOString().slice(0, 10)) throw ApiError.badRequest('Attendance date cannot be in the future');
};

// ======================= TECHNICIANS =======================
const parseServiceIds = async (raw) => {
  let ids = raw;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch (_) { ids = ids.split(','); }
  }
  if (!Array.isArray(ids) || !ids.length) throw ApiError.badRequest('service_ids must be a non-empty array');
  ids = ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) throw ApiError.badRequest('service_ids must contain valid category ids');
  const [rows] = await pool.query('SELECT id FROM service_categories WHERE id IN (?)', [ids]);
  if (rows.length !== ids.length) throw ApiError.badRequest('One or more service_ids are invalid');
  return ids;
};

const TECH_FILES = [
  ['profile_photo', 'Profile photo'],
  ['aadhar_front', 'Aadhaar front'],
  ['aadhar_back', 'Aadhaar back'],
];

const saveTechnicianServices = async (technicianId, ids) => {
  await pool.query('DELETE FROM technician_services WHERE technician_id = ?', [technicianId]);
  for (const cid of ids) {
    await pool.query('INSERT IGNORE INTO technician_services (technician_id, category_id) VALUES (?, ?)', [
      technicianId, cid,
    ]);
  }
};

const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

router.post(
  '/technicians',
  requireVendor,
  kycUpload.any(),
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const body = req.body || {};
    const files = req.files || [];
    const name = String(body.name || '').trim();
    if (!name) throw ApiError.badRequest('Technician name is required');
    const phone = trimOrNull(body.phone);
    if (phone && !/^[6-9]\d{9}$|^\+?\d{8,15}$/.test(phone)) throw ApiError.badRequest('Invalid phone number');

    // spec mode: multipart files OR aadhaar_number/service_ids present → strict app contract
    const specMode = files.length > 0 || body.aadhaar_number !== undefined || body.service_ids !== undefined;
    let email = null;
    let aadhaar = null;
    let photo = null;
    let aadharFront = null;
    let aadharBack = null;
    let serviceIds = [];

    if (specMode) {
      if (!phone) throw ApiError.badRequest('phone is required');
      aadhaar = trimOrNull(body.aadhaar_number);
      if (!aadhaar || !/^\d{12}$/.test(aadhaar)) throw ApiError.badRequest('aadhaar_number must be 12 digits');
      if (body.email && String(body.email).trim()) {
        email = String(body.email).trim().toLowerCase();
        if (!validEmail(email)) throw ApiError.badRequest('Invalid email address');
      }
      serviceIds = await parseServiceIds(body.service_ids);
      for (const [field, label] of TECH_FILES) {
        if (!files.find((f) => f.fieldname === field)) throw ApiError.badRequest(`${label} is required`);
      }
      const docs = await uploadKycFiles(files);
      photo = docs.profile_photo || null;
      aadharFront = docs.aadhar_front || null;
      aadharBack = docs.aadhar_back || null;
    }

    const conn = await pool.getConnection();
    let techId;
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO technicians (vendor_id, name, phone, email, aadhaar_number, photo, skill, address, id_proof, notes, status, is_online)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vendorId, name, phone, email, aadhaar, photo,
          trimOrNull(body.skill), trimOrNull(body.address), trimOrNull(body.id_proof), trimOrNull(body.notes),
          body.status === 'inactive' ? 'inactive' : 'active',
          typeof body.is_online === 'boolean' ? (body.is_online ? 1 : 0) : 1,
        ]
      );
      techId = result.insertId;
      for (const cid of serviceIds) {
        await conn.query('INSERT IGNORE INTO technician_services (technician_id, category_id) VALUES (?, ?)', [techId, cid]);
      }
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      conn.release();
      throw err;
    }
    conn.release();

    await writeAudit({
      actor: req.user,
      action: 'technician.create',
      entity: 'technicians',
      entityId: techId,
      details: { name },
      req,
    });
    sendSuccess(res, { id: techId, name, phone, status: 'active' }, 'Technician created successfully', 201);
  })
);

router.get(
  '/technicians',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    let where = 'WHERE t.vendor_id = ?';
    const params = [vendorId];
    const status = req.query.status || 'all';
    if (status === 'active') where += " AND t.status = 'active'";
    else if (status === 'inactive') where += " AND t.status = 'inactive'";
    else if (status === 'on_duty') {
      where += ` AND EXISTS (SELECT 1 FROM technician_attendance a
                 WHERE a.technician_id = t.id AND a.attendance_date = CURDATE() AND a.status = 'present')`;
    } else if (status === 'offline') where += ' AND t.is_online = 0';
    else if (status !== 'all') throw ApiError.badRequest('status must be one of: all, active, on_duty, offline, inactive');
    if (req.query.search) {
      where += ' AND (t.name LIKE ? OR t.phone LIKE ? OR t.skill LIKE ? OR t.email LIKE ?)';
      const s = `%${req.query.search}%`;
      params.push(s, s, s, s);
    }
    const [rows] = await pool.query(
      `SELECT t.id, t.name, t.phone, t.email, t.photo, t.is_online, t.status, t.skill, t.address,
              t.id_proof, t.notes, t.aadhaar_number, t.created_at,
              (SELECT a.status FROM technician_attendance a
                WHERE a.technician_id = t.id AND a.attendance_date = CURDATE()) AS today_status,
              (SELECT COUNT(*) FROM technician_attendance a
                WHERE a.technician_id = t.id AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                  AND a.status = 'present') AS present_30d,
              (SELECT COUNT(*) FROM request_technicians rt
                 JOIN jobs j ON j.request_id = rt.request_id
                WHERE rt.technician_id = t.id AND j.stage = 'completed') AS completed_jobs,
              (SELECT j.job_no FROM request_technicians rt
                 JOIN jobs j ON j.request_id = rt.request_id
                WHERE rt.technician_id = t.id
                  AND j.stage IN ('accepted','scheduled','in_progress','awaiting_approval')
                ORDER BY j.updated_at DESC LIMIT 1) AS active_job_id
         FROM technicians t ${where}
        ORDER BY (t.status = 'active') DESC, t.name`,
      params
    );
    let svcRows = [];
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      [svcRows] = await pool.query(
        `SELECT ts.technician_id, c.name FROM technician_services ts
           JOIN service_categories c ON c.id = ts.category_id
          WHERE ts.technician_id IN (?)`,
        [ids]
      );
    }
    sendSuccess(
      res,
      rows.map((r) => ({
        ...r,
        is_online: !!r.is_online,
        rating: null, // technician-level reviews not in schema yet
        completed_jobs: Number(r.completed_jobs),
        services: svcRows.filter((s) => s.technician_id === r.id).map((s) => s.name),
      }))
    );
  })
);

router.put(
  '/technicians/:id',
  requireVendor,
  kycUpload.any(),
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const technicianId = Number(req.params.id);
    await assertTechnician(technicianId, vendorId);
    const body = req.body || {};
    const files = req.files || [];
    const name = String(body.name || '').trim();
    if (!name) throw ApiError.badRequest('Technician name is required');
    const phone = trimOrNull(body.phone);
    if (phone && !/^[6-9]\d{9}$|^\+?\d{8,15}$/.test(phone)) throw ApiError.badRequest('Invalid phone number');

    let email = null;
    if (body.email !== undefined && body.email !== null && String(body.email).trim()) {
      email = String(body.email).trim().toLowerCase();
      if (!validEmail(email)) throw ApiError.badRequest('Invalid email address');
    }
    let aadhaar = null;
    if (body.aadhaar_number !== undefined && body.aadhaar_number !== null && String(body.aadhaar_number).trim()) {
      aadhaar = String(body.aadhaar_number).trim();
      if (!/^\d{12}$/.test(aadhaar)) throw ApiError.badRequest('aadhaar_number must be 12 digits');
    }

    let docs = {};
    if (files.length) {
      const allowed = TECH_FILES.map(([f]) => f);
      const unknown = files.find((f) => !allowed.includes(f.fieldname));
      if (unknown) throw ApiError.badRequest(`Unknown file field: ${unknown.fieldname}`);
      docs = await uploadKycFiles(files);
    }

    let serviceIds = null;
    if (body.service_ids !== undefined && body.service_ids !== null && body.service_ids !== '') {
      serviceIds = await parseServiceIds(body.service_ids);
    }

    await pool.query(
      `UPDATE technicians SET name = ?, phone = ?, email = COALESCE(?, email),
              aadhaar_number = COALESCE(?, aadhaar_number),
              photo = COALESCE(?, photo), aadhar_front = COALESCE(?, aadhar_front),
              aadhar_back = COALESCE(?, aadhar_back),
              skill = ?, address = COALESCE(?, address), id_proof = COALESCE(?, id_proof),
              notes = COALESCE(?, notes), status = ?,
              is_online = COALESCE(?, is_online)
        WHERE id = ? AND vendor_id = ?`,
      [
        name, phone, email, aadhaar,
        docs.profile_photo || null, docs.aadhar_front || null, docs.aadhar_back || null,
        trimOrNull(body.skill), trimOrNull(body.address), trimOrNull(body.id_proof), trimOrNull(body.notes),
        body.status === 'inactive' ? 'inactive' : 'active',
        typeof body.is_online === 'boolean' ? (body.is_online ? 1 : 0) : null,
        technicianId, vendorId,
      ]
    );
    if (serviceIds) await saveTechnicianServices(technicianId, serviceIds);
    await writeAudit({
      actor: req.user,
      action: 'technician.update',
      entity: 'technicians',
      entityId: technicianId,
      req,
    });
    sendSuccess(res, null, 'Technician updated');
  })
);

router.delete(
  '/technicians/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    await assertTechnician(Number(req.params.id), vendorId);
    await pool.query('DELETE FROM technicians WHERE id = ? AND vendor_id = ?', [Number(req.params.id), vendorId]);
    await writeAudit({
      actor: req.user,
      action: 'technician.delete',
      entity: 'technicians',
      entityId: Number(req.params.id),
      req,
    });
    sendSuccess(res, null, 'Technician removed');
  })
);

// ======================= ATTENDANCE =======================
router.post(
  '/technician-attendance',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const date = String(req.body.attendance_date || req.body.date || '').trim();
    assertFutureDate(date);

    // bulk: { attendance_date, entries: [{technician_id, status, notes}] }
    if (Array.isArray(req.body.entries)) {
      const entries = req.body.entries;
      if (!entries.length) throw ApiError.badRequest('entries cannot be empty');
      if (entries.length > 200) throw ApiError.badRequest('Too many entries (max 200)');
      for (const e of entries) {
        const id = Number(e.technician_id);
        if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Each entry needs technician_id');
        await assertTechnician(id, vendorId);
        const status = e.status || 'present';
        if (!ATTENDANCE_STATUSES.includes(status)) {
          throw ApiError.badRequest(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`);
        }
        await pool.query(
          `INSERT INTO technician_attendance (technician_id, attendance_date, status, notes, marked_by)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), marked_by = VALUES(marked_by)`,
          [id, date, status, trimOrNull(e.notes), req.user.id]
        );
      }
      await writeAudit({
        actor: req.user,
        action: 'technician.attendance',
        entity: 'technician_attendance',
        details: { attendance_date: date, count: entries.length },
        req,
      });
      return sendSuccess(res, null, `Attendance saved for ${entries.length} technician(s)`);
    }

    // single: { technician_id, attendance_date, status?, notes? }
    const technicianId = Number(req.body.technician_id);
    if (!Number.isInteger(technicianId) || technicianId < 1) {
      throw ApiError.badRequest('technician_id is required');
    }
    await assertTechnician(technicianId, vendorId);
    const status = req.body.status || 'present';
    if (!ATTENDANCE_STATUSES.includes(status)) {
      throw ApiError.badRequest(`status must be one of: ${ATTENDANCE_STATUSES.join(', ')}`);
    }
    await pool.query(
      `INSERT INTO technician_attendance (technician_id, attendance_date, status, notes, marked_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), marked_by = VALUES(marked_by)`,
      [technicianId, date, status, trimOrNull(req.body.notes), req.user.id]
    );
    await writeAudit({
      actor: req.user,
      action: 'technician.attendance',
      entity: 'technician_attendance',
      entityId: technicianId,
      details: { attendance_date: date, status },
      req,
    });
    sendSuccess(res, null, 'Attendance saved');
  })
);

router.get(
  '/technician-attendance',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE t.vendor_id = ?';
    const params = [vendorId];
    if (req.query.month) {
      if (!MONTH_RE.test(req.query.month)) throw ApiError.badRequest('month must be YYYY-MM');
      where += ' AND DATE_FORMAT(a.attendance_date, "%Y-%m") = ?';
      params.push(req.query.month);
    } else if (req.query.date) {
      assertFutureDate(String(req.query.date));
      where += ' AND a.attendance_date = ?';
      params.push(req.query.date);
    } else {
      where += ' AND a.attendance_date = CURDATE()';
    }
    if (req.query.technician_id) {
      where += ' AND a.technician_id = ?';
      params.push(Number(req.query.technician_id));
    }
    if (req.query.status) {
      if (!ATTENDANCE_STATUSES.includes(req.query.status)) throw ApiError.badRequest('Invalid status');
      where += ' AND a.status = ?';
      params.push(req.query.status);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM technician_attendance a
         JOIN technicians t ON t.id = a.technician_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT a.id, a.technician_id, a.attendance_date, a.status, a.notes, a.marked_by,
              t.name AS technician_name, t.skill
         FROM technician_attendance a
         JOIN technicians t ON t.id = a.technician_id
        ${where}
        ORDER BY a.attendance_date DESC, t.name
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/technician-attendance/summary',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const month = req.query.month && MONTH_RE.test(req.query.month) ? req.query.month : null;
    if (req.query.month && !month) throw ApiError.badRequest('month must be YYYY-MM');
    const [rows] = await pool.query(
      `SELECT t.id AS technician_id, t.name, t.skill, t.status,
              SUM(a.status = 'present') AS present,
              SUM(a.status = 'absent') AS absent,
              SUM(a.status = 'half_day') AS half_days,
              SUM(a.status = 'late') AS late
         FROM technicians t
         LEFT JOIN technician_attendance a ON a.technician_id = t.id
           AND (? IS NULL OR DATE_FORMAT(a.attendance_date, '%Y-%m') = ?)
        WHERE t.vendor_id = ?
        GROUP BY t.id ORDER BY t.name`,
      [month, month, vendorId]
    );
    sendSuccess(res, rows);
  })
);

module.exports = router;
