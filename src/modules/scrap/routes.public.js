const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { authMiddleware } = require('../../middlewares/auth');
const { writeAudit } = require('../../utils/audit');
const { scrapPhotoUpload, uploadScrapPhoto } = require('../../middlewares/upload');
const { SCRAP_CATEGORIES, PICKUP_SLOTS } = require('./categories.const');
const { parseCats, serializeRequestCreated, serializeTrack, serializeListItem } = require('./serialize');

/* ================= GET /categories ================= */
router.get('/categories', asyncHandler(async (req, res) => {
  sendSuccess(res, SCRAP_CATEGORIES, 'Scrap categories retrieved successfully');
}));

/* ================= GET /pickup-slots ================= */
router.get('/pickup-slots', asyncHandler(async (req, res) => {
  sendSuccess(res, PICKUP_SLOTS, 'Pickup slots retrieved successfully');
}));

/* ================= POST /pickup-request (multipart, photo optional) ================= */
router.post(
  '/pickup-request',
  authMiddleware,
  scrapPhotoUpload.single('scrap_photo'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};

    let materials = [];
    if (b.material_categories) {
      try {
        const parsed = JSON.parse(b.material_categories);
        materials = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        materials = String(b.material_categories).split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    materials = materials.map((m) => String(m).trim()).filter(Boolean);
    if (!materials.length) throw ApiError.badRequest('At least one scrap material category is required');
    if (!b.approx_weight_range) throw ApiError.badRequest('approx_weight_range is required');
    if (!PICKUP_SLOTS.weight_ranges.includes(b.approx_weight_range)) throw ApiError.badRequest('Invalid approx_weight_range');
    if (!['Doorstep', 'Bulk'].includes(b.pickup_type)) throw ApiError.badRequest('pickup_type must be Doorstep or Bulk');
    if (!b.pickup_address || !String(b.pickup_address).trim()) throw ApiError.badRequest('pickup_address is required');
    if (!b.contact_phone || !String(b.contact_phone).replace(/\D/g, '').match(/^\d{10}$/)) {
      throw ApiError.badRequest('contact_phone must be a 10-digit mobile number');
    }
    if (!PICKUP_SLOTS.date_options.includes(b.preferred_date)) throw ApiError.badRequest('Invalid preferred_date');
    if (!PICKUP_SLOTS.time_slots.includes(b.preferred_time_slot)) throw ApiError.badRequest('Invalid preferred_time_slot');

    // optional photo (jpg/png) -> Cloudinary (or local /uploads/scrap fallback)
    let photoUrl = null;
    if (req.file) photoUrl = await uploadScrapPhoto(req.file);

    // request code VSW-<year>-<5digit>
    let code;
    for (let t = 0; t < 20; t++) {
      const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM scrap_requests');
      const base = String(Number(n) + 1).padStart(5, '0');
      code = `VSW-${new Date().getFullYear()}-${base}`;
      const [[dup]] = await pool.query('SELECT id FROM scrap_requests WHERE request_code = ?', [code]);
      if (!dup) break;
      code = null;
    }
    if (!code) code = `VSW-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

    // manual buyer assign (admin assigns later) -> status stays REQUEST_PLACED
    const [result] = await pool.query(
      `INSERT INTO scrap_requests
         (request_code, user_id, material_categories, approx_weight_range, pickup_type,
          pickup_address, latitude, longitude, contact_phone, preferred_date, preferred_time_slot,
          scrap_photo_url, special_instructions, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'REQUEST_PLACED')`,
      [
        code, req.user.id, JSON.stringify(materials), b.approx_weight_range, b.pickup_type,
        String(b.pickup_address).trim(),
        b.latitude !== undefined && b.latitude !== '' ? Number(b.latitude) : null,
        b.longitude !== undefined && b.longitude !== '' ? Number(b.longitude) : null,
        String(b.contact_phone).trim(), b.preferred_date, b.preferred_time_slot,
        photoUrl, b.special_instructions || null,
      ]
    );

    const [[row]] = await pool.query(
      `SELECT s.*, b.name AS buyer_name, b.phone AS buyer_phone, b.vehicle_no AS buyer_vehicle_no, b.scale_type AS buyer_scale_type
         FROM scrap_requests s LEFT JOIN scrap_buyers b ON b.id = s.assigned_buyer_id
        WHERE s.id = ?`,
      [result.insertId]
    );

    await writeAudit({
      actor: req.user, action: 'scrap.request.create', entity: 'scrap_requests',
      entityId: row.id, details: { request_code: code, pickup_type: b.pickup_type }, req,
    });

    res.status(201);
    sendSuccess(res, serializeRequestCreated(row), 'Scrap pickup request submitted successfully. An authorized buyer will be assigned shortly.', 201);
  })
);

/* ================= GET /requests/:id/track (owner only) ================= */
router.get('/requests/:id/track', authMiddleware, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, b.name AS buyer_name, b.phone AS buyer_phone, b.vehicle_no AS buyer_vehicle_no, b.scale_type AS buyer_scale_type
       FROM scrap_requests s LEFT JOIN scrap_buyers b ON b.id = s.assigned_buyer_id
      WHERE s.request_code = ? AND s.user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw ApiError.notFound('Pickup request not found');
  sendSuccess(res, serializeTrack(rows[0]), 'Pickup tracked successfully');
}));

/* ================= GET /my-pickups ================= */
router.get('/my-pickups', authMiddleware, asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['s.user_id = ?'];
  const params = [req.user.id];
  const status = (req.query.status || '').toUpperCase();
  if (status && status !== 'ALL') {
    where.push('s.status = ?');
    params.push(status);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM scrap_requests s ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT s.* FROM scrap_requests s ${whereSql}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  sendSuccess(res, { total, items: rows.map(serializeListItem) }, 'Pickups fetched successfully');
}));

/* ================= POST /requests/:id/cancel ================= */
const CANCELABLE = ['REQUEST_PLACED', 'BUYER_ASSIGNED', 'OUT_FOR_PICKUP', 'WEIGHING_COMPLETED'];

router.post('/requests/:id/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM scrap_requests WHERE request_code = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw ApiError.notFound('Pickup request not found');
  const r = rows[0];

  if (!CANCELABLE.includes(r.status)) {
    throw ApiError.badRequest(`Request cannot be cancelled in status "${r.status}"`);
  }

  const reason = (req.body && req.body.cancellation_reason) || null;
  const cancelledAt = new Date();
  await pool.query(
    `UPDATE scrap_requests SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = ? WHERE id = ?`,
    [reason, cancelledAt, r.id]
  );

  await writeAudit({
    actor: req.user, action: 'scrap.request.cancel', entity: 'scrap_requests',
    entityId: r.id, details: { request_code: r.request_code, reason }, req,
  });

  sendSuccess(res, {
    request_id: r.request_code,
    status: 'CANCELLED',
  }, 'Scrap pickup request cancelled successfully.');
}));

module.exports = router;
