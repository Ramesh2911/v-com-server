const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('customers.view'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const search = req.query.search ? `%${req.query.search}%` : null;
    const status = req.query.status || null;
    let where = `WHERE u.user_type = 'customer'`;
    const params = [];
    if (search) {
      where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(search, search, search);
    }
    if (status) {
      where += ' AND u.status = ?';
      params.push(status);
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.status, u.last_login_at, u.created_at,
              (SELECT COUNT(*) FROM requests r WHERE r.customer_id = u.id) AS request_count,
              (SELECT COUNT(*) FROM sos_tickets s WHERE s.customer_id = u.id) AS sos_count
         FROM users u ${where}
        ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, status, last_login_at, created_at
         FROM users WHERE id = ? AND user_type = 'customer'`,
      [req.params.id]
    );
    if (!rows.length) return sendSuccess(res, null, 'Customer not found');
    const [requests] = await pool.query(
      `SELECT r.id, r.ticket_no, r.title, r.status, r.priority, r.created_at, m.name AS module_name
         FROM requests r JOIN service_modules m ON m.id = r.module_id
        WHERE r.customer_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      [req.params.id]
    );
    sendSuccess(res, { ...rows[0], requests });
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['active', 'inactive', 'blocked'].includes(status)) {
      return sendSuccess(res, null, 'Invalid status', 400);
    }
    const [rows] = await pool.query(`SELECT id, name FROM users WHERE id = ? AND user_type = 'customer'`, [req.params.id]);
    if (!rows.length) return sendSuccess(res, null, 'Customer not found', 404);
    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    await writeAudit({ actor: req.user, action: 'customer.status', entity: 'users', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'Customer status updated');
  })
);

module.exports = router;
