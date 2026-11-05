const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { recomputeVendorRating, parseRating, parseComment, toCustomerView } = require('./lib');

router.use(authMiddleware);

// ---- Customer: review a completed request (auto-published) ----
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const requestId = Number(b.request_id);
    if (!Number.isInteger(requestId) || requestId < 1) throw ApiError.badRequest('request_id is required');

    const [reqs] = await pool.query(
      `SELECT id, customer_id, status, module_id, category_id, assigned_vendor_id
         FROM requests WHERE id = ?`,
      [requestId]
    );
    if (!reqs.length || reqs[0].customer_id !== req.user.id) throw ApiError.notFound('Request not found');
    const request = reqs[0];
    if (!['completed', 'closed'].includes(request.status)) {
      throw ApiError.badRequest('You can only review a request after it is completed');
    }

    const [dups] = await pool.query('SELECT id FROM service_reviews WHERE request_id = ?', [requestId]);
    if (dups.length) throw ApiError.conflict('You have already reviewed this request');

    const serviceRating = parseRating(b.service_rating, 'service_rating', true);
    const serviceComment = parseComment(b.service_comment, 'service_comment');
    const hasVendor = !!request.assigned_vendor_id;
    const technicianRating = parseRating(b.technician_rating, 'technician_rating', hasVendor);
    const technicianComment = parseComment(b.technician_comment, 'technician_comment');

    const [result] = await pool.query(
      `INSERT INTO service_reviews
         (request_id, customer_id, module_id, category_id, vendor_id,
          service_rating, service_comment, technician_rating, technician_comment, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible')`,
      [
        requestId,
        req.user.id,
        request.module_id,
        request.category_id || null,
        hasVendor ? request.assigned_vendor_id : null,
        serviceRating,
        serviceComment,
        hasVendor ? technicianRating : null,
        hasVendor ? technicianComment : null,
      ]
    );
    await recomputeVendorRating(request.assigned_vendor_id);

    const [rows] = await pool.query('SELECT * FROM service_reviews WHERE id = ?', [result.insertId]);
    sendSuccess(res, toCustomerView(rows[0]), 'Review submitted', 201);
  })
);

// ---- Customer: edit own review ----
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid id required');

    const [rows] = await pool.query(
      `SELECT sr.*, r.assigned_vendor_id FROM service_reviews sr
         JOIN requests r ON r.id = sr.request_id
        WHERE sr.id = ? AND sr.customer_id = ?`,
      [id, req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Review not found');
    const existing = rows[0];
    const b = req.body || {};
    const hasVendor = !!existing.vendor_id;

    const sets = [];
    const vals = [];
    if ('service_rating' in b) {
      const v = parseRating(b.service_rating, 'service_rating', true);
      sets.push('service_rating = ?');
      vals.push(v);
    }
    if ('service_comment' in b) {
      sets.push('service_comment = ?');
      vals.push(parseComment(b.service_comment, 'service_comment'));
    }
    if (hasVendor && 'technician_rating' in b) {
      const v = parseRating(b.technician_rating, 'technician_rating', true);
      sets.push('technician_rating = ?');
      vals.push(v);
    }
    if (hasVendor && 'technician_comment' in b) {
      sets.push('technician_comment = ?');
      vals.push(parseComment(b.technician_comment, 'technician_comment'));
    }
    if (!sets.length) throw ApiError.badRequest('No updatable fields provided');

    await pool.query(`UPDATE service_reviews SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    await recomputeVendorRating(existing.vendor_id);

    const [updated] = await pool.query('SELECT * FROM service_reviews WHERE id = ?', [id]);
    sendSuccess(res, toCustomerView(updated[0]), 'Review updated');
  })
);

// ---- Customer: my review for a request (app helper) ----
router.get(
  '/request/:requestId',
  asyncHandler(async (req, res) => {
    const requestId = Number(req.params.requestId);
    if (!Number.isInteger(requestId) || requestId < 1) throw ApiError.badRequest('Valid request id required');
    const [rows] = await pool.query(
      'SELECT * FROM service_reviews WHERE request_id = ? AND customer_id = ?',
      [requestId, req.user.id]
    );
    sendSuccess(res, rows.length ? toCustomerView(rows[0]) : null);
  })
);

module.exports = router;
