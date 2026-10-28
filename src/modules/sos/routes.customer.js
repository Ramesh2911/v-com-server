const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');

router.use(authMiddleware);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { description, latitude, longitude, address, priority = 'critical' } = req.body;
    if (!description || !description.trim()) throw ApiError.badRequest('Emergency description is required');

    const ticketNo = await generateTicketNo(pool, 'sos');
    const [result] = await pool.query(
      `INSERT INTO sos_tickets (ticket_no, customer_id, description, latitude, longitude, address, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, req.user.id, description.trim(), latitude || null, longitude || null, address || null, priority]
    );
    await pool.query(
      `INSERT INTO sos_status_history (sos_id, status, note, changed_by) VALUES (?, 'open', 'SOS raised by customer', ?)`,
      [result.insertId, req.user.id]
    );

    const responders = await staffWithPermission('sos.manage');
    for (const sid of responders) {
      await notify({
        userId: sid,
        event: 'sos_created',
        type: 'sos',
        title: `SOS Alert ${ticketNo}`,
        body: description.slice(0, 120),
        data: { ticket_no: ticketNo, sos_id: result.insertId, priority },
      });
    }
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo }, 'SOS ticket created', 201);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM sos_tickets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    sendSuccess(res, rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM sos_tickets WHERE id = ? AND customer_id = ?`, [req.params.id, req.user.id]);
    if (!rows.length) throw ApiError.notFound('SOS ticket not found');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM sos_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.sos_id = ? ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    sendSuccess(res, { ...rows[0], history });
  })
);

module.exports = router;
