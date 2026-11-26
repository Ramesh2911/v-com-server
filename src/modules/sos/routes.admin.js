const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');
const { SOS_CATEGORIES, byId } = require('./categories.const');

router.use(authMiddleware, requirePermission('sos.view'));

// ---------- Responders (register BEFORE /:id to avoid shadowing) ----------

router.get(
  '/responders',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND r.status = ?';
      params.push(req.query.status);
    }
    if (req.query.category_id) {
      where += ' AND r.category_id = ?';
      params.push(Number(req.query.category_id));
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM sos_responders r ${where}`, params);
    const [rows] = await pool.query(
      `SELECT r.* FROM sos_responders r ${where} ORDER BY r.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const items = rows.map((r) => ({
      ...r,
      category_name: r.category_id ? byId(r.category_id)?.name || null : 'General',
      category_code: r.category_id ? byId(r.category_id)?.code || null : null,
    }));
    sendPaginated(res, { items, total, page, limit, message: 'Responders fetched' });
  })
);

router.post(
  '/responders',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const unitName = String(b.unit_name || '').trim();
    const contactNo = String(b.contact_no || '').trim();
    if (!unitName) throw ApiError.badRequest('unit_name is required');
    if (!contactNo) throw ApiError.badRequest('contact_no is required');
    if (b.category_id != null && b.category_id !== '' && !byId(b.category_id)) {
      throw ApiError.badRequest('Invalid category_id');
    }
    const categoryId = b.category_id != null && b.category_id !== '' ? Number(b.category_id) : null;
    const status = ['active', 'inactive'].includes(b.status) ? b.status : 'active';

    const [result] = await pool.query(
      `INSERT INTO sos_responders (category_id, unit_name, contact_no, vehicle_no, driver_name, latitude, longitude, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        unitName,
        contactNo,
        b.vehicle_no || null,
        b.driver_name || null,
        b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null,
        b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null,
        status,
      ]
    );
    await writeAudit({ actor: req.user, action: 'sos.responder.create', entity: 'sos_responders', entityId: result.insertId, details: { unit_name: unitName }, req });
    const [rows] = await pool.query('SELECT * FROM sos_responders WHERE id = ?', [result.insertId]);
    sendSuccess(res, rows[0], 'Responder created', 201);
  })
);

router.put(
  '/responders/:id',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const [exist] = await pool.query('SELECT * FROM sos_responders WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Responder not found');
    const b = req.body || {};
    const unitName = b.unit_name !== undefined ? String(b.unit_name).trim() : exist[0].unit_name;
    const contactNo = b.contact_no !== undefined ? String(b.contact_no).trim() : exist[0].contact_no;
    if (!unitName) throw ApiError.badRequest('unit_name is required');
    if (!contactNo) throw ApiError.badRequest('contact_no is required');
    let categoryId = exist[0].category_id;
    if (b.category_id !== undefined) {
      if (b.category_id === null || b.category_id === '') categoryId = null;
      else {
        if (!byId(b.category_id)) throw ApiError.badRequest('Invalid category_id');
        categoryId = Number(b.category_id);
      }
    }
    const status = b.status !== undefined ? b.status : exist[0].status;
    if (!['active', 'inactive'].includes(status)) throw ApiError.badRequest('Invalid status');

    await pool.query(
      `UPDATE sos_responders SET category_id = ?, unit_name = ?, contact_no = ?, vehicle_no = ?, driver_name = ?,
              latitude = ?, longitude = ?, status = ? WHERE id = ?`,
      [
        categoryId,
        unitName,
        contactNo,
        b.vehicle_no !== undefined ? b.vehicle_no : exist[0].vehicle_no,
        b.driver_name !== undefined ? b.driver_name : exist[0].driver_name,
        b.latitude !== undefined && b.latitude !== '' && b.latitude != null ? Number(b.latitude) : exist[0].latitude,
        b.longitude !== undefined && b.longitude !== '' && b.longitude != null ? Number(b.longitude) : exist[0].longitude,
        status,
        req.params.id,
      ]
    );
    await writeAudit({ actor: req.user, action: 'sos.responder.update', entity: 'sos_responders', entityId: Number(req.params.id), details: { unit_name: unitName }, req });
    const [rows] = await pool.query('SELECT * FROM sos_responders WHERE id = ?', [req.params.id]);
    sendSuccess(res, rows[0], 'Responder updated');
  })
);

router.patch(
  '/responders/:id/status',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) throw ApiError.badRequest('Invalid status');
    const [exist] = await pool.query('SELECT id FROM sos_responders WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Responder not found');
    await pool.query('UPDATE sos_responders SET status = ? WHERE id = ?', [status, req.params.id]);
    await writeAudit({ actor: req.user, action: 'sos.responder.status', entity: 'sos_responders', entityId: Number(req.params.id), details: { status }, req });
    sendSuccess(res, null, 'Responder status updated');
  })
);

router.delete(
  '/responders/:id',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const [exist] = await pool.query('SELECT id FROM sos_responders WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Responder not found');
    await pool.query('DELETE FROM sos_responders WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'sos.responder.delete', entity: 'sos_responders', entityId: Number(req.params.id), req });
    sendSuccess(res, null, 'Responder deleted');
  })
);

// ---------- Tickets ----------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND s.status = ?';
      params.push(req.query.status);
    }
    if (req.query.category_id) {
      where += ' AND s.category_id = ?';
      params.push(Number(req.query.category_id));
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (s.ticket_no LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR s.requester_phone LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM sos_tickets s JOIN users u ON u.id = s.customer_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              a.name AS assignee_name,
              r.unit_name AS responder_unit_name, r.contact_no AS responder_contact_no,
              r.vehicle_no AS responder_vehicle_no, r.driver_name AS responder_driver_name
         FROM sos_tickets s
         JOIN users u ON u.id = s.customer_id
         LEFT JOIN users a ON a.id = s.assigned_to
         LEFT JOIN sos_responders r ON r.id = s.responder_id
        ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const items = rows.map((row) => {
      const cat = row.category_id ? byId(row.category_id) : null;
      return { ...row, category_name: cat ? cat.name : null, category_code: cat ? cat.code : null };
    });
    sendPaginated(res, { items, total, page, limit });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT status, COUNT(*) AS count FROM sos_tickets GROUP BY status');
    const [[{ open }]] = await pool.query(
      `SELECT COUNT(*) AS open FROM sos_tickets WHERE status IN ('open','acknowledged','dispatched','in_progress')`
    );
    sendSuccess(res, { by_status: rows, active: open });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              a.name AS assignee_name,
              r.unit_name AS responder_unit_name, r.contact_no AS responder_contact_no,
              r.vehicle_no AS responder_vehicle_no, r.driver_name AS responder_driver_name,
              r.latitude AS responder_latitude, r.longitude AS responder_longitude
         FROM sos_tickets s JOIN users u ON u.id = s.customer_id
         LEFT JOIN users a ON a.id = s.assigned_to
         LEFT JOIN sos_responders r ON r.id = s.responder_id
        WHERE s.id = ? OR s.ticket_no = ?`,
      [req.params.id, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('SOS ticket not found');
    const row = rows[0];
    const cat = row.category_id ? byId(row.category_id) : null;
    row.category_name = cat ? cat.name : null;
    row.category_code = cat ? cat.code : null;

    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM sos_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.sos_id = ? ORDER BY h.created_at ASC`,
      [row.id]
    );
    sendSuccess(res, { ...row, history });
  })
);

const SOS_STATUSES = ['open', 'acknowledged', 'dispatched', 'in_progress', 'resolved', 'closed', 'cancelled'];

router.post(
  '/:id/status',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const { status, note, assign_to, resolution_notes } = req.body;
    if (!SOS_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM sos_tickets WHERE id = ? OR ticket_no = ?', [
      req.params.id,
      req.params.id,
    ]);
    if (!rows.length) throw ApiError.notFound('SOS ticket not found');
    const ticket = rows[0];

    const updates = ['status = ?'];
    const params = [status];
    if (assign_to) {
      updates.push('assigned_to = ?');
      params.push(assign_to);
    }
    if (resolution_notes) {
      updates.push('resolution_notes = ?');
      params.push(resolution_notes);
    }
    if (['resolved', 'closed'].includes(status)) {
      updates.push('resolved_at = NOW()');
      if (!resolution_notes) {
        updates.push('resolution_notes = ?');
        params.push(note || 'Resolved');
      }
    }
    if (status === 'cancelled') {
      updates.push('cancelled_at = NOW()');
    }
    await pool.query(`UPDATE sos_tickets SET ${updates.join(', ')} WHERE id = ?`, [...params, ticket.id]);
    await pool.query(`INSERT INTO sos_status_history (sos_id, status, note, changed_by) VALUES (?, ?, ?, ?)`, [
      ticket.id,
      status,
      note || null,
      req.user.id,
    ]);
    await notify({
      userId: ticket.customer_id,
      event: 'sos_status_updated',
      type: 'sos',
      title: `SOS ${ticket.ticket_no} — ${status}`,
      data: { ticket_no: ticket.ticket_no, status },
    });
    await writeAudit({ actor: req.user, action: 'sos.status', entity: 'sos_tickets', entityId: ticket.id, details: { status }, req });
    sendSuccess(res, null, 'SOS status updated');
  })
);

module.exports = router;
