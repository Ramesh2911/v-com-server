const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');

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
router.post(
  '/technicians',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const name = String(req.body.name || '').trim();
    if (!name) throw ApiError.badRequest('Technician name is required');
    const phone = trimOrNull(req.body.phone);
    if (phone && !/^[6-9]\d{9}$|^\+?\d{8,15}$/.test(phone)) throw ApiError.badRequest('Invalid phone number');
    const [result] = await pool.query(
      `INSERT INTO technicians (vendor_id, name, phone, skill, address, id_proof, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vendorId,
        name,
        phone,
        trimOrNull(req.body.skill),
        trimOrNull(req.body.address),
        trimOrNull(req.body.id_proof),
        trimOrNull(req.body.notes),
        req.body.status === 'inactive' ? 'inactive' : 'active',
      ]
    );
    await writeAudit({
      actor: req.user,
      action: 'technician.create',
      entity: 'technicians',
      entityId: result.insertId,
      details: { name },
      req,
    });
    sendSuccess(res, { id: result.insertId }, 'Technician added', 201);
  })
);

router.get(
  '/technicians',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    let where = 'WHERE t.vendor_id = ?';
    const params = [vendorId];
    if (req.query.status === 'active' || req.query.status === 'inactive') {
      where += ' AND t.status = ?';
      params.push(req.query.status);
    }
    if (req.query.search) {
      where += ' AND (t.name LIKE ? OR t.phone LIKE ? OR t.skill LIKE ?)';
      const s = `%${req.query.search}%`;
      params.push(s, s, s);
    }
    const [rows] = await pool.query(
      `SELECT t.*,
              (SELECT a.status FROM technician_attendance a
                WHERE a.technician_id = t.id AND a.attendance_date = CURDATE()) AS today_status,
              (SELECT COUNT(*) FROM technician_attendance a
                WHERE a.technician_id = t.id AND a.attendance_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                  AND a.status = 'present') AS present_30d
         FROM technicians t ${where}
        ORDER BY (t.status = 'active') DESC, t.name`,
      params
    );
    sendSuccess(res, rows);
  })
);

router.put(
  '/technicians/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    await assertTechnician(Number(req.params.id), vendorId);
    const name = String(req.body.name || '').trim();
    if (!name) throw ApiError.badRequest('Technician name is required');
    const phone = trimOrNull(req.body.phone);
    if (phone && !/^[6-9]\d{9}$|^\+?\d{8,15}$/.test(phone)) throw ApiError.badRequest('Invalid phone number');
    await pool.query(
      `UPDATE technicians SET name = ?, phone = ?, skill = ?, address = ?, id_proof = ?, notes = ?,
              status = ?
        WHERE id = ? AND vendor_id = ?`,
      [
        name,
        phone,
        trimOrNull(req.body.skill),
        trimOrNull(req.body.address),
        trimOrNull(req.body.id_proof),
        trimOrNull(req.body.notes),
        req.body.status === 'inactive' ? 'inactive' : 'active',
        Number(req.params.id),
        vendorId,
      ]
    );
    await writeAudit({
      actor: req.user,
      action: 'technician.update',
      entity: 'technicians',
      entityId: Number(req.params.id),
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
