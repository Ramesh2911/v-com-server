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

router.use(authMiddleware, requirePermission('sos.view'));

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
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (s.ticket_no LIKE ? OR u.name LIKE ? OR u.phone LIKE ?)';
      params.push(s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM sos_tickets s JOIN users u ON u.id = s.customer_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              a.name AS assignee_name
         FROM sos_tickets s
         JOIN users u ON u.id = s.customer_id
         LEFT JOIN users a ON a.id = s.assigned_to
        ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT status, COUNT(*) AS count FROM sos_tickets GROUP BY status');
    const [[{ open }]] = await pool.query(`SELECT COUNT(*) AS open FROM sos_tickets WHERE status IN ('open','acknowledged','dispatched','in_progress')`);
    sendSuccess(res, { by_status: rows, active: open });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              a.name AS assignee_name
         FROM sos_tickets s JOIN users u ON u.id = s.customer_id
         LEFT JOIN users a ON a.id = s.assigned_to
        WHERE s.id = ? OR s.ticket_no = ?`,
      [req.params.id, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('SOS ticket not found');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM sos_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.sos_id = ? ORDER BY h.created_at ASC`,
      [rows[0].id]
    );
    sendSuccess(res, { ...rows[0], history });
  })
);

const SOS_STATUSES = ['open', 'acknowledged', 'dispatched', 'in_progress', 'resolved', 'closed'];

router.post(
  '/:id/status',
  requirePermission('sos.manage'),
  asyncHandler(async (req, res) => {
    const { status, note, assign_to, resolution_notes } = req.body;
    if (!SOS_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM sos_tickets WHERE id = ?', [req.params.id]);
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
    await pool.query(`UPDATE sos_tickets SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    await pool.query(
      `INSERT INTO sos_status_history (sos_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, status, note || null, req.user.id]
    );
    await notify({
      userId: ticket.customer_id,
      event: 'sos_status_updated',
      type: 'sos',
      title: `SOS ${ticket.ticket_no} — ${status}`,
      data: { ticket_no: ticket.ticket_no, status },
    });
    await writeAudit({ actor: req.user, action: 'sos.status', entity: 'sos_tickets', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'SOS status updated');
  })
);

module.exports = router;
