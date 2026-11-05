const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { writeAudit } = require('../../utils/audit');
const { recomputeVendorRating, maskName } = require('./lib');

router.use(authMiddleware, requirePermission('reviews.view'));

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid id required');
  return id;
};

const ADMIN_SELECT = `
  SELECT sr.*, u.name AS customer_name, u.email AS customer_email, u.avatar AS customer_avatar,
         r.ticket_no, r.title AS request_title,
         m.name AS module_name, m.code AS module_code,
         c.name AS category_name,
         v.business_name AS vendor_name
    FROM service_reviews sr
    JOIN users u ON u.id = sr.customer_id
    JOIN requests r ON r.id = sr.request_id
    JOIN service_modules m ON m.id = sr.module_id
    LEFT JOIN service_categories c ON c.id = sr.category_id
    LEFT JOIN vendors v ON v.id = sr.vendor_id`;

// ---- Admin: list reviews (moderation) ----
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const where = [];
    const params = [];

    if (req.query.status) {
      where.push('sr.status = ?');
      params.push(String(req.query.status));
    }
    if (req.query.rating) {
      const n = Number(req.query.rating);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw ApiError.badRequest('rating must be 1-5');
      where.push('sr.service_rating = ?');
      params.push(n);
    }
    if (req.query.module_id) {
      where.push('sr.module_id = ?');
      params.push(Number(req.query.module_id));
    }
    if (req.query.category_id) {
      where.push('sr.category_id = ?');
      params.push(Number(req.query.category_id));
    }
    if (req.query.vendor_id) {
      where.push('sr.vendor_id = ?');
      params.push(Number(req.query.vendor_id));
    }
    if (req.query.search) {
      const q = `%${String(req.query.search).trim()}%`;
      where.push('(r.ticket_no LIKE ? OR u.name LIKE ? OR sr.service_comment LIKE ? OR sr.technician_comment LIKE ?)');
      params.push(q, q, q, q);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM service_reviews sr
         JOIN users u ON u.id = sr.customer_id
         JOIN requests r ON r.id = sr.request_id ${whereSql}`,
      params
    );
    const [rows] = await pool.query(
      `${ADMIN_SELECT} ${whereSql} ORDER BY sr.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    sendPaginated(res, {
      items: rows.map((r) => ({
        ...r,
        customer_name: maskName(r.customer_name),
        customer_avatar: r.customer_avatar || null,
      })),
      total,
      page,
      limit,
    });
  })
);

// ---- Admin: hide / show ----
router.patch(
  '/:id',
  requirePermission('reviews.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const status = String(req.body?.status || '');
    if (status !== 'visible' && status !== 'hidden') {
      throw ApiError.badRequest("status must be 'visible' or 'hidden'");
    }
    const [rows] = await pool.query('SELECT id, vendor_id, status FROM service_reviews WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Review not found');
    if (rows[0].status === status) return sendSuccess(res, null, `Review already ${status}`);

    await pool.query('UPDATE service_reviews SET status = ? WHERE id = ?', [status, id]);
    await recomputeVendorRating(rows[0].vendor_id);
    await writeAudit({
      actor: req.user,
      action: status === 'hidden' ? 'review.hide' : 'review.show',
      entity: 'service_reviews',
      entityId: id,
      req,
    });
    sendSuccess(res, null, status === 'hidden' ? 'Review hidden' : 'Review visible');
  })
);

// ---- Admin: delete ----
router.delete(
  '/:id',
  requirePermission('reviews.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT id, vendor_id FROM service_reviews WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Review not found');
    await pool.query('DELETE FROM service_reviews WHERE id = ?', [id]);
    await recomputeVendorRating(rows[0].vendor_id);
    await writeAudit({ actor: req.user, action: 'review.delete', entity: 'service_reviews', entityId: id, req });
    sendSuccess(res, null, 'Review deleted');
  })
);

module.exports = router;
