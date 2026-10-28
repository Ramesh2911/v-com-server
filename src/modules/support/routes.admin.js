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

router.use(authMiddleware, requirePermission('support.manage'));

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
      const q = `%${req.query.search}%`;
      where += ' AND (s.ticket_no LIKE ? OR s.subject LIKE ? OR u.name LIKE ?)';
      params.push(q, q, q);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM support_tickets s JOIN users u ON u.id = s.user_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
              a.name AS assignee_name
         FROM support_tickets s JOIN users u ON u.id = s.user_id
         LEFT JOIN users a ON a.id = s.assigned_to
        ${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.post(
  '/:id/reply',
  asyncHandler(async (req, res) => {
    const { reply, status = 'in_progress' } = req.body;
    if (!reply) throw ApiError.badRequest('reply is required');
    const [rows] = await pool.query('SELECT * FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Ticket not found');
    await pool.query(
      `UPDATE support_tickets SET reply = ?, status = ?, assigned_to = ?, replied_at = NOW() WHERE id = ?`,
      [reply, status, req.user.id, req.params.id]
    );
    await notify({
      userId: rows[0].user_id, type: 'support', event: 'support_reply',
      title: `Support ticket ${rows[0].ticket_no}`, body: reply.slice(0, 150),
      data: { ticket_no: rows[0].ticket_no },
    });
    await writeAudit({ actor: req.user, action: 'support.reply', entity: 'support_tickets', entityId: req.params.id, req });
    sendSuccess(res, null, 'Reply sent');
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM support_tickets WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Ticket not found');
    await pool.query('UPDATE support_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
    await writeAudit({ actor: req.user, action: 'support.status', entity: 'support_tickets', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'Status updated');
  })
);

module.exports = router;
