const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify } = require('../../utils/notify');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('quotations.view'));

const Q_SELECT = `
  SELECT q.*, r.ticket_no AS request_ticket, r.title AS request_title, r.status AS request_status,
         r.customer_id, r.assigned_vendor_id,
         v.business_name AS vendor_name,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM quotations q
    JOIN requests r ON r.id = q.request_id
    JOIN vendors v ON v.id = q.vendor_id
    JOIN users u ON u.id = r.customer_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND q.status = ?';
      params.push(req.query.status);
    }
    if (req.query.vendor_id) {
      where += ' AND q.vendor_id = ?';
      params.push(req.query.vendor_id);
    }
    if (req.query.request_id) {
      where += ' AND q.request_id = ?';
      params.push(req.query.request_id);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (q.ticket_no LIKE ? OR r.ticket_no LIKE ? OR v.business_name LIKE ?)';
      params.push(s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM quotations q
        JOIN requests r ON r.id = q.request_id JOIN vendors v ON v.id = q.vendor_id ${where}`,
      params
    );
    const [rows] = await pool.query(`${Q_SELECT} ${where} ORDER BY q.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params, limit, offset,
    ]);
    const ids = rows.map((r) => r.id);
    const [items] = ids.length ? await pool.query('SELECT * FROM quotation_items WHERE quotation_id IN (?)', [ids]) : [[]];
    sendPaginated(res, {
      items: rows.map((r) => ({ ...r, items: items.filter((i) => i.quotation_id === r.id) })),
      total, page, limit,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${Q_SELECT} WHERE q.id = ? OR q.ticket_no = ?`, [req.params.id, req.params.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    const [items] = await pool.query('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order', [rows[0].id]);
    sendSuccess(res, { ...rows[0], items });
  })
);

// admin overrides decision (e.g. approve on behalf of customer)
router.post(
  '/:id/review',
  requirePermission('quotations.manage'),
  asyncHandler(async (req, res) => {
    const { decision, note } = req.body;
    if (!['accepted', 'rejected', 'clarification_requested'].includes(decision)) throw ApiError.badRequest('Invalid decision');
    const [rows] = await pool.query(`${Q_SELECT} WHERE q.id = ?`, [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    const q = rows[0];
    await pool.query(
      `UPDATE quotations SET status = ?, reviewed_by = ?, reviewed_at = NOW(), clarification_note = ? WHERE id = ?`,
      [decision, req.user.id, note || null, q.id]
    );
    if (decision === 'accepted') {
      // reject competing quotations for same request
      await pool.query(`UPDATE quotations SET status = 'rejected' WHERE request_id = ? AND id != ? AND status IN ('pending','clarification_requested')`, [q.request_id, q.id]);
      await pool.query('UPDATE requests SET status = ?, estimated_amount = ? WHERE id = ?', ['approved', q.total_amount, q.request_id]);
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'approved', ?, ?)`,
        [q.request_id, `Quotation ${q.ticket_no} approved`, req.user.id]
      );
    }
    const [[vendor]] = await pool.query('SELECT user_id FROM vendors WHERE id = ?', [q.vendor_id]);
    if (vendor) {
      await notify({
        userId: vendor.user_id, event: 'quotation_decision', type: 'quotation',
        title: `Quotation ${q.ticket_no} — ${decision.replace('_', ' ')}`,
        data: { ticket_no: q.ticket_no, request_ticket: q.request_ticket, status: decision },
      });
    }
    await notify({
      userId: q.customer_id, type: 'quotation', title: `Quotation ${q.ticket_no} — ${decision.replace('_', ' ')}`,
      data: { ticket_no: q.ticket_no, status: decision },
    });
    await writeAudit({ actor: req.user, action: 'quotation.review', entity: 'quotations', entityId: q.id, details: { decision }, req });
    sendSuccess(res, null, `Quotation ${decision}`);
  })
);

// admin creates quotation on behalf of a vendor
router.post(
  '/',
  requirePermission('quotations.manage'),
  asyncHandler(async (req, res) => {
    const { request_id, vendor_id, notes, valid_until } = req.body;
    let items = req.body.items;
    if (typeof items === 'string') items = JSON.parse(items);
    if (!Array.isArray(items) || !items.length) throw ApiError.badRequest('items required');

    const parsed = items.map((it, idx) => {
      const quantity = parseFloat(it.quantity) || 1;
      const rate = parseFloat(it.rate) || 0;
      return {
        item_name: it.item_name, description: it.description || null, quantity,
        unit: it.unit || 'unit', rate, amount: Math.round(quantity * rate * 100) / 100, sort_order: idx,
      };
    });
    const subtotal = Math.round(parsed.reduce((s, i) => s + i.amount, 0) * 100) / 100;
    const taxRate = parseFloat(req.body.tax_rate) || 0;
    const taxAmount = Math.round(subtotal * taxRate) / 100;
    const discount = parseFloat(req.body.discount) || 0;
    const total = Math.round((subtotal + taxAmount - discount) * 100) / 100;

    const [reqRows] = await pool.query('SELECT * FROM requests WHERE id = ?', [request_id]);
    if (!reqRows.length) throw ApiError.badRequest('Request not found');

    const ticketNo = await generateTicketNo(pool, 'quotation');
    const [result] = await pool.query(
      `INSERT INTO quotations (ticket_no, request_id, vendor_id, admin_id, subtotal, tax_rate, tax_amount, discount, total_amount, notes, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, request_id, vendor_id, req.user.id, subtotal, taxRate, taxAmount, discount, total, notes || null, valid_until || null]
    );
    for (const it of parsed) {
      await pool.query(
        `INSERT INTO quotation_items (quotation_id, item_name, description, quantity, unit, rate, amount, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, it.item_name, it.description, it.quantity, it.unit, it.rate, it.amount, it.sort_order]
      );
    }
    await pool.query(`UPDATE requests SET status = 'quoted' WHERE id = ?`, [request_id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'quoted', ?, ?)`,
      [request_id, `Quotation ${ticketNo} created by admin`, req.user.id]
    );
    const [[vendor]] = await pool.query('SELECT user_id FROM vendors WHERE id = ?', [vendor_id]);
    if (vendor) {
      await notify({ userId: vendor.user_id, type: 'quotation', title: `Quotation ${ticketNo} created`, data: { ticket_no: ticketNo } });
    }
    await notify({ userId: reqRows[0].customer_id, event: 'quotation_submitted', type: 'quotation', title: `Quotation ${ticketNo} received`, data: { ticket_no: ticketNo, request_ticket: reqRows[0].ticket_no } });
    await writeAudit({ actor: req.user, action: 'quotation.create', entity: 'quotations', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo }, 'Quotation created', 201);
  })
);

module.exports = router;
