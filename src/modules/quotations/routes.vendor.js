const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');

router.use(authMiddleware);

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('Vendor account required'));
  next();
};

const Q_SELECT = `
  SELECT q.*, r.ticket_no AS request_ticket, r.title AS request_title, r.status AS request_status,
         r.customer_id
    FROM quotations q JOIN requests r ON r.id = q.request_id`;

function calcAmounts(body) {
  let items = body.items;
  if (typeof items === 'string') items = JSON.parse(items);
  if (!Array.isArray(items) || !items.length) throw ApiError.badRequest('At least one line item is required');
  const parsed = items.map((it, idx) => {
    const quantity = parseFloat(it.quantity) || 1;
    const rate = parseFloat(it.rate) || 0;
    return {
      item_name: it.item_name,
      description: it.description || null,
      quantity,
      unit: it.unit || 'unit',
      rate,
      amount: Math.round(quantity * rate * 100) / 100,
      sort_order: idx,
    };
  });
  const subtotal = Math.round(parsed.reduce((s, i) => s + i.amount, 0) * 100) / 100;
  const taxRate = parseFloat(body.tax_rate) || 0;
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const discount = parseFloat(body.discount) || 0;
  const total = Math.round((subtotal + taxAmount - discount) * 100) / 100;
  return { parsed, subtotal, taxRate, taxAmount, discount, total };
}

router.get(
  '/quotations',
  requireVendor,
  asyncHandler(async (req, res) => {
    let where = 'WHERE q.vendor_id = ?';
    const params = [req.user.vendor.id];
    if (req.query.status) {
      where += ' AND q.status = ?';
      params.push(req.query.status);
    }
    const [rows] = await pool.query(`${Q_SELECT} ${where} ORDER BY q.created_at DESC LIMIT 100`, params);
    const ids = rows.map((r) => r.id);
    const [items] = ids.length
      ? await pool.query('SELECT * FROM quotation_items WHERE quotation_id IN (?)', [ids])
      : [[]];
    sendSuccess(res, rows.map((r) => ({ ...r, items: items.filter((i) => i.quotation_id === r.id) })));
  })
);

router.post(
  '/quotations',
  requireVendor,
  asyncHandler(async (req, res) => {
    const { request_id, notes, valid_until } = req.body;
    const { parsed, subtotal, taxRate, taxAmount, discount, total } = calcAmounts(req.body);
    const vendorId = req.user.vendor.id;

    const [reqRows] = await pool.query(
      `SELECT * FROM requests WHERE id = ? AND assigned_vendor_id = ?`,
      [request_id, vendorId]
    );
    if (!reqRows.length) throw ApiError.badRequest('Request not found or not assigned to you');
    const request = reqRows[0];
    if (['completed', 'closed', 'cancelled'].includes(request.status)) {
      throw ApiError.badRequest('Request is already closed');
    }

    const ticketNo = await generateTicketNo(pool, 'quotation');
    const [result] = await pool.query(
      `INSERT INTO quotations (ticket_no, request_id, vendor_id, subtotal, tax_rate, tax_amount, discount, total_amount, notes, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, request_id, vendorId, subtotal, taxRate, taxAmount, discount, total, notes || null, valid_until || null]
    );
    for (const it of parsed) {
      await pool.query(
        `INSERT INTO quotation_items (quotation_id, item_name, description, quantity, unit, rate, amount, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [result.insertId, it.item_name, it.description, it.quantity, it.unit, it.rate, it.amount, it.sort_order]
      );
    }
    await pool.query('UPDATE requests SET status = ? WHERE id = ?', ['quoted', request_id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'quoted', ?, ?)`,
      [request_id, `Quotation ${ticketNo} submitted (${total})`, req.user.id]
    );
    await notify({
      userId: request.customer_id,
      event: 'quotation_submitted',
      type: 'quotation',
      title: `Quotation ${ticketNo} received`,
      body: `A quotation has been submitted for request ${request.ticket_no}.`,
      data: { ticket_no: ticketNo, request_ticket: request.ticket_no, total },
    });
    const staff = await staffWithPermission('quotations.manage');
    for (const sid of staff) {
      await notify({
        userId: sid, type: 'quotation', title: `Quotation ${ticketNo} submitted`,
        body: `Vendor submitted quotation for ${request.ticket_no}.`,
      });
    }
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo, total_amount: total }, 'Quotation submitted', 201);
  })
);

router.get(
  '/quotations/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${Q_SELECT} WHERE q.id = ? AND q.vendor_id = ?`, [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    const [items] = await pool.query('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order', [req.params.id]);
    sendSuccess(res, { ...rows[0], items });
  })
);

router.put(
  '/quotations/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM quotations WHERE id = ? AND vendor_id = ?', [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    if (!['pending', 'clarification_requested'].includes(rows[0].status)) {
      throw ApiError.badRequest('Quotation can no longer be edited');
    }
    const { parsed, subtotal, taxRate, taxAmount, discount, total } = calcAmounts(req.body);
    await pool.query(
      `UPDATE quotations SET subtotal = ?, tax_rate = ?, tax_amount = ?, discount = ?, total_amount = ?,
              notes = COALESCE(?, notes), valid_until = COALESCE(?, valid_until), status = 'pending', clarification_note = NULL
        WHERE id = ?`,
      [subtotal, taxRate, taxAmount, discount, total, req.body.notes || null, req.body.valid_until || null, req.params.id]
    );
    await pool.query('DELETE FROM quotation_items WHERE quotation_id = ?', [req.params.id]);
    for (const it of parsed) {
      await pool.query(
        `INSERT INTO quotation_items (quotation_id, item_name, description, quantity, unit, rate, amount, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, it.item_name, it.description, it.quantity, it.unit, it.rate, it.amount, it.sort_order]
      );
    }
    sendSuccess(res, null, 'Quotation updated');
  })
);

router.post(
  '/quotations/:id/withdraw',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM quotations WHERE id = ? AND vendor_id = ?', [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Quotation not found');
    if (rows[0].status !== 'pending') throw ApiError.badRequest('Only pending quotations can be withdrawn');
    await pool.query(`UPDATE quotations SET status = 'withdrawn' WHERE id = ?`, [req.params.id]);
    sendSuccess(res, null, 'Quotation withdrawn');
  })
);

module.exports = router;
