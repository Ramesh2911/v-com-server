const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { num, parseCats } = require('./serialize');

router.use(authMiddleware, requirePermission('scrap.view'));

const SELECT_REQ = `
  SELECT s.*, b.name AS buyer_name, b.phone AS buyer_phone, b.vehicle_no AS buyer_vehicle_no, b.scale_type AS buyer_scale_type,
         u.name AS customer_name, u.email AS customer_email
    FROM scrap_requests s
    LEFT JOIN scrap_buyers b ON b.id = s.assigned_buyer_id
    LEFT JOIN users u ON u.id = s.user_id`;

/* ============ REQUESTS ============ */

router.get('/requests', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.pickup_type) { where.push('s.pickup_type = ?'); params.push(req.query.pickup_type); }
  if (req.query.buyer_id) { where.push('s.assigned_buyer_id = ?'); params.push(req.query.buyer_id); }
  if (req.query.search) {
    where.push('(s.request_code LIKE ? OR s.pickup_address LIKE ? OR s.contact_phone LIKE ? OR u.name LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM scrap_requests s LEFT JOIN users u ON u.id = s.user_id ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `${SELECT_REQ} ${whereSql} ORDER BY s.created_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  sendPaginated(res, {
    items: rows.map((r) => ({ ...r, materials: parseCats(r.material_categories) })),
    total, page, limit, message: 'Scrap requests fetched successfully',
  });
}));

router.get('/requests/:id', asyncHandler(async (req, res) => {
  const key = /^\d+$/.test(req.params.id) ? 's.id' : 's.request_code';
  const [rows] = await pool.query(`${SELECT_REQ} WHERE ${key} = ?`, [req.params.id]);
  if (!rows.length) throw ApiError.notFound('Pickup request not found');
  sendSuccess(res, { ...rows[0], materials: parseCats(rows[0].material_categories) }, 'Request fetched successfully');
}));

/* ---- manual buyer assign (admin decision) ---- */
router.patch('/requests/:id/assign', requirePermission('scrap.manage'), asyncHandler(async (req, res) => {
  const buyerId = (req.body || {}).buyer_id;
  if (!buyerId) throw ApiError.badRequest('buyer_id is required');

  const key = /^\d+$/.test(req.params.id) ? 's.id' : 's.request_code';
  const [rows] = await pool.query(`${SELECT_REQ} WHERE ${key} = ?`, [req.params.id]);
  if (!rows.length) throw ApiError.notFound('Pickup request not found');
  const r = rows[0];
  if (r.status !== 'REQUEST_PLACED') throw ApiError.badRequest(`Only REQUEST_PLACED requests can be assigned (current: ${r.status})`);

  const [[buyer]] = await pool.query('SELECT * FROM scrap_buyers WHERE id = ?', [buyerId]);
  if (!buyer) throw ApiError.notFound('Buyer not found');
  if (buyer.status !== 'active') throw ApiError.badRequest('Buyer is not active');

  const assignedAt = new Date();
  await pool.query(
    `UPDATE scrap_requests SET assigned_buyer_id = ?, status = 'BUYER_ASSIGNED', assigned_at = ? WHERE id = ?`,
    [buyerId, assignedAt, r.id]
  );
  await writeAudit({
    actor: req.user, action: 'scrap.request.assign', entity: 'scrap_requests',
    entityId: r.id, details: { request_code: r.request_code, buyer_id: buyerId }, req,
  });

  const [updated] = await pool.query(`${SELECT_REQ} WHERE s.id = ?`, [r.id]);
  sendSuccess(res, { ...updated[0], materials: parseCats(updated[0].material_categories) }, 'Buyer assigned successfully');
}));

/* ---- status transitions (out / weigh / pay / cancel) ---- */
const TRANSITIONS = {
  OUT_FOR_PICKUP: { from: ['BUYER_ASSIGNED'], ts: 'out_at' },
  WEIGHING_COMPLETED: { from: ['OUT_FOR_PICKUP'], ts: 'weighed_at', requires: ['actual_weight_kg', 'final_amount'] },
  PAYMENT_COMPLETED: { from: ['WEIGHING_COMPLETED'], ts: 'paid_at', requires: ['payment_mode'] },
  CANCELLED: { from: ['REQUEST_PLACED', 'BUYER_ASSIGNED', 'OUT_FOR_PICKUP', 'WEIGHING_COMPLETED'], ts: 'cancelled_at' },
};

router.patch('/requests/:id/status', requirePermission('scrap.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const next = b.status;
  const rule = TRANSITIONS[next];
  if (!rule) throw ApiError.badRequest(`status must be one of ${Object.keys(TRANSITIONS).join(', ')}`);

  const key = /^\d+$/.test(req.params.id) ? 's.id' : 's.request_code';
  const [rows] = await pool.query(`${SELECT_REQ} WHERE ${key} = ?`, [req.params.id]);
  if (!rows.length) throw ApiError.notFound('Pickup request not found');
  const r = rows[0];
  if (!rule.from.includes(r.status)) {
    throw ApiError.badRequest(`Cannot move from "${r.status}" to "${next}"`);
  }
  for (const f of rule.requires || []) {
    if (b[f] === undefined || b[f] === null || b[f] === '') {
      throw ApiError.badRequest(`${f} is required for ${next}`);
    }
  }

  const now = new Date();
  const sets = ['status = ?', `${rule.ts} = ?`];
  const params = [next, now];
  if (next === 'WEIGHING_COMPLETED') {
    const w = Number(b.actual_weight_kg);
    const amt = Number(b.final_amount);
    if (!(w > 0)) throw ApiError.badRequest('actual_weight_kg must be > 0');
    if (!(amt > 0)) throw ApiError.badRequest('final_amount must be > 0');
    sets.push('actual_weight_kg = ?', 'final_amount = ?');
    params.push(w, amt);
  }
  if (next === 'PAYMENT_COMPLETED') {
    const mode = String(b.payment_mode).trim();
    if (!['Cash', 'UPI', 'Bank Transfer', 'Wallet'].includes(mode)) {
      throw ApiError.badRequest('payment_mode must be one of Cash, UPI, Bank Transfer, Wallet');
    }
    sets.push('payment_mode = ?');
    params.push(mode);
  }
  if (next === 'CANCELLED' && b.cancellation_reason) {
    sets.push('cancellation_reason = ?');
    params.push(String(b.cancellation_reason));
  }

  await pool.query(`UPDATE scrap_requests SET ${sets.join(', ')} WHERE id = ?`, [...params, r.id]);
  await writeAudit({
    actor: req.user, action: 'scrap.request.status', entity: 'scrap_requests',
    entityId: r.id, details: { request_code: r.request_code, from: r.status, to: next }, req,
  });

  const [updated] = await pool.query(`${SELECT_REQ} WHERE s.id = ?`, [r.id]);
  sendSuccess(res, { ...updated[0], materials: parseCats(updated[0].material_categories) }, `Request marked ${next}`);
}));

/* ============ BUYERS ============ */

router.get('/buyers', asyncHandler(async (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  const [rows] = await pool.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM scrap_requests s WHERE s.assigned_buyer_id = b.id) AS assigned_requests
       FROM scrap_buyers b
      WHERE ${where.join(' AND ')}
      ORDER BY b.name ASC`
  );
  sendSuccess(res, rows, 'Buyers fetched successfully');
}));

router.post('/buyers', requirePermission('scrap.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) throw ApiError.badRequest('name is required');
  if (!b.contact_phone && !b.phone) throw ApiError.badRequest('phone is required');
  const phone = String(b.contact_phone || b.phone).trim();

  const [result] = await pool.query(
    'INSERT INTO scrap_buyers (name, phone, vehicle_no, scale_type, status) VALUES (?,?,?,?,?)',
    [
      String(b.name).trim(), phone,
      b.vehicle_no || null, b.scale_type || null,
      b.status === 'inactive' ? 'inactive' : 'active',
    ]
  );
  await writeAudit({ actor: req.user, action: 'scrap.buyer.create', entity: 'scrap_buyers', entityId: result.insertId, details: { name: b.name }, req });
  res.status(201);
  const [[row]] = await pool.query('SELECT * FROM scrap_buyers WHERE id = ?', [result.insertId]);
  sendSuccess(res, row, 'Buyer created successfully', 201);
}));

router.put('/buyers/:id', requirePermission('scrap.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM scrap_buyers WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Buyer not found');
  const b = req.body || {};

  const fields = { name: b.name, phone: b.phone, vehicle_no: b.vehicle_no, scale_type: b.scale_type, status: b.status };
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) throw ApiError.badRequest('No fields to update');

  await pool.query(`UPDATE scrap_buyers SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  await writeAudit({ actor: req.user, action: 'scrap.buyer.update', entity: 'scrap_buyers', entityId: row.id, details: {}, req });
  const [[updated]] = await pool.query('SELECT * FROM scrap_buyers WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated, 'Buyer updated successfully');
}));

router.delete('/buyers/:id', requirePermission('scrap.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT id FROM scrap_buyers WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Buyer not found');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM scrap_requests WHERE assigned_buyer_id = ?', [req.params.id]);
  if (num(n) > 0) throw ApiError.conflict('Cannot delete: buyer has assigned requests');
  await pool.query('DELETE FROM scrap_buyers WHERE id = ?', [req.params.id]);
  await writeAudit({ actor: req.user, action: 'scrap.buyer.delete', entity: 'scrap_buyers', entityId: row.id, details: {}, req });
  sendSuccess(res, { id: Number(req.params.id) }, 'Buyer deleted successfully');
}));

/* ============ STATS ============ */

router.get('/stats', asyncHandler(async (req, res) => {
  const [[s]] = await pool.query(
    `SELECT COUNT(*) AS total_requests,
            SUM(status = 'REQUEST_PLACED') AS placed,
            SUM(status = 'BUYER_ASSIGNED') AS assigned,
            SUM(status = 'OUT_FOR_PICKUP') AS out_for_pickup,
            SUM(status = 'WEIGHING_COMPLETED') AS weighed,
            SUM(status = 'PAYMENT_COMPLETED') AS paid,
            SUM(status = 'CANCELLED') AS cancelled,
            COALESCE(SUM(CASE WHEN status = 'PAYMENT_COMPLETED' THEN final_amount END), 0) AS total_revenue
       FROM scrap_requests`
  );
  const [[buyers]] = await pool.query(
    `SELECT COUNT(*) AS total_buyers, SUM(status = 'active') AS active_buyers FROM scrap_buyers`
  );

  sendSuccess(res, {
    total_requests: num(s.total_requests),
    placed: num(s.placed),
    assigned: num(s.assigned),
    out_for_pickup: num(s.out_for_pickup),
    weighed: num(s.weighed),
    paid: num(s.paid),
    cancelled: num(s.cancelled),
    total_revenue: num(s.total_revenue),
    total_buyers: num(buyers.total_buyers),
    active_buyers: num(buyers.active_buyers),
  }, 'Scrap stats fetched successfully');
}));

module.exports = router;
