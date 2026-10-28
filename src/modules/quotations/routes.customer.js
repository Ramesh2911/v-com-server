const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');

router.use(authMiddleware);

const Q_SELECT = `
  SELECT q.*, r.ticket_no AS request_ticket, r.title AS request_title, r.status AS request_status,
         v.business_name AS vendor_name
    FROM quotations q
    JOIN requests r ON r.id = q.request_id
    JOIN vendors v ON v.id = q.vendor_id`;

async function withItems(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [items] = await pool.query('SELECT * FROM quotation_items WHERE quotation_id IN (?) ORDER BY sort_order, id', [ids]);
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.quotation_id === r.id) }));
}

router.get(
  '/quotations',
  asyncHandler(async (req, res) => {
    let where = 'WHERE r.customer_id = ?';
    const params = [req.user.id];
    if (req.query.status) {
      where += ' AND q.status = ?';
      params.push(req.query.status);
    }
    const [rows] = await pool.query(`${Q_SELECT} ${where} ORDER BY q.created_at DESC LIMIT 100`, params);
    sendSuccess(res, await withItems(rows));
  })
);

router.get(
  '/quotations/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${Q_SELECT} WHERE q.id = ? AND r.customer_id = ?`, [req.params.id, req.user.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    sendSuccess(res, (await withItems(rows))[0]);
  })
);

// customer accepts / rejects / requests clarification
router.post(
  '/quotations/:id/decision',
  asyncHandler(async (req, res) => {
    const { decision, note } = req.body;
    if (!['accepted', 'rejected', 'clarification_requested'].includes(decision)) {
      throw ApiError.badRequest('decision must be accepted, rejected or clarification_requested');
    }
    const [rows] = await pool.query(
      `${Q_SELECT} WHERE q.id = ? AND r.customer_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    const q = rows[0];
    if (!['pending', 'clarification_requested'].includes(q.status)) {
      throw ApiError.badRequest('Quotation already reviewed');
    }
    await pool.query(
      `UPDATE quotations SET status = ?, reviewed_by = ?, reviewed_at = NOW(), clarification_note = ? WHERE id = ?`,
      [decision, req.user.id, note || null, q.id]
    );
    if (decision === 'accepted') {
      await pool.query('UPDATE requests SET status = ?, estimated_amount = ? WHERE id = ?', ['approved', q.total_amount, q.request_id]);
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'approved', ?, ?)`,
        [q.request_id, `Quotation ${q.ticket_no} accepted by customer`, req.user.id]
      );
    } else if (decision === 'rejected') {
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
        [q.request_id, 'assigned', `Quotation ${q.ticket_no} rejected by customer`, req.user.id]
      );
    }
    const [[vendor]] = await pool.query('SELECT user_id FROM vendors WHERE id = ?', [q.vendor_id]);
    if (vendor) {
      const { notify } = require('../../utils/notify');
      await notify({
        userId: vendor.user_id,
        event: 'quotation_decision',
        type: 'quotation',
        title: `Quotation ${q.ticket_no} — ${decision.replace('_', ' ')}`,
        data: { ticket_no: q.ticket_no, request_ticket: q.request_ticket, status: decision },
      });
    }
    sendSuccess(res, null, `Quotation ${decision.replace('_', ' ')}`);
  })
);

module.exports = router;
