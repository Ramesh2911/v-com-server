const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify } = require('../../utils/notify');

router.use(authMiddleware);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { subject, message, category, priority = 'normal' } = req.body;
    if (!subject || !message) throw ApiError.badRequest('subject and message are required');
    const ticketNo = await generateTicketNo(pool, 'support');
    const [result] = await pool.query(
      `INSERT INTO support_tickets (ticket_no, user_id, user_type, subject, message, category, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, req.user.id, req.user.user_type, subject, message, category || null, priority]
    );
    const [staff] = await pool.query(
      `SELECT DISTINCT u.id FROM users u
        JOIN role_permissions rp ON rp.role_id = u.role_id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE p.code IN ('support.manage','modules.all') AND u.status = 'active'`
    );
    for (const s of staff) {
      await notify({ userId: s.id, type: 'support', title: `Support ticket ${ticketNo}`, body: subject });
    }
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo }, 'Support ticket created', 201);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    sendSuccess(res, rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Ticket not found');
    sendSuccess(res, rows[0]);
  })
);

module.exports = router;
