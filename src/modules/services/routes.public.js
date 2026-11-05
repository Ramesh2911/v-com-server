const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { optionalAuth } = require('../../middlewares/auth');
const { toPublicUrl } = require('../../middlewares/upload');
const { maskName } = require('../reviews/lib');

const mapModule = (m) => ({ ...m, image: toPublicUrl(m.image) });
const mapCategory = (c) => ({ ...c, image: toPublicUrl(c.image) });

// Public review block — service rating/comment ONLY (technician reviews never leave admin side)
async function reviewBlock(where, params) {
  const [[sum]] = await pool.query(
    `SELECT COUNT(*) AS service_count, COALESCE(ROUND(AVG(service_rating), 1), 0) AS service_avg
       FROM service_reviews sr WHERE sr.status = 'visible' AND ${where}`,
    params
  );
  const [dist] = await pool.query(
    `SELECT service_rating, COUNT(*) AS count FROM service_reviews sr
      WHERE sr.status = 'visible' AND ${where} GROUP BY service_rating`,
    params
  );
  const [items] = await pool.query(
    `SELECT sr.id, sr.service_rating, sr.service_comment, sr.created_at,
            u.name AS customer_name, u.avatar AS customer_avatar
       FROM service_reviews sr JOIN users u ON u.id = sr.customer_id
      WHERE sr.status = 'visible' AND ${where}
      ORDER BY sr.id DESC LIMIT 10`,
    params
  );
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of dist) distribution[d.service_rating] = d.count;
  return {
    review_summary: {
      service_avg: Number(sum.service_avg) || 0,
      service_count: Number(sum.service_count) || 0,
      distribution,
    },
    reviews: items.map((r) => ({
      id: r.id,
      service_rating: r.service_rating,
      service_comment: r.service_comment,
      created_at: r.created_at,
      customer_name: maskName(r.customer_name),
      customer_avatar: toPublicUrl(r.customer_avatar),
    })),
  };
}

async function resolveServiceId(id) {
  const [mods] = await pool.query(`SELECT id FROM service_modules WHERE id = ? AND status = 1`, [id]);
  if (mods.length) return 'module';
  const [cats] = await pool.query(`SELECT id FROM service_categories WHERE id = ? AND status = 1`, [id]);
  if (cats.length) return 'category';
  throw ApiError.notFound('Service not found');
}

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM service_modules WHERE status = 1 ORDER BY sort_order, id`
    );
    const [cats] = await pool.query(
      `SELECT c.*, m.code AS module_code FROM service_categories c
        JOIN service_modules m ON m.id = c.module_id
       WHERE c.status = 1 AND m.status = 1 ORDER BY c.sort_order, c.id`
    );
    const data = rows.map((m) => ({
      ...mapModule(m),
      categories: cats.filter((c) => c.module_id === m.id).map(mapCategory),
    }));
    sendSuccess(res, data);
  })
);

router.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.is_featured = 1 AND c.status = 1 AND m.status = 1
        ORDER BY c.sort_order LIMIT 12`
    );
    sendSuccess(res, rows.map(mapCategory));
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = `%${(req.query.q || '').trim()}%`;
    const [mods] = await pool.query(
      `SELECT * FROM service_modules WHERE status = 1 AND (name LIKE ? OR description LIKE ?)`,
      [q, q]
    );
    const [cats] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.status = 1 AND m.status = 1 AND (c.name LIKE ? OR c.description LIKE ?)`,
      [q, q]
    );
    sendSuccess(res, { modules: mods.map(mapModule), categories: cats.map(mapCategory) });
  })
);

router.get(
  '/category/:id',
  asyncHandler(async (req, res) => {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) {
      throw ApiError.badRequest('Invalid category id — numeric id required (e.g. /api/v1/services/category/31)');
    }
    const [rows] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code, m.icon AS module_icon
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.id = ? AND c.status = 1 AND m.status = 1`,
      [Number(raw)]
    );
    if (!rows.length) throw ApiError.notFound('Service not found');
    const block = await reviewBlock('sr.category_id = ?', [Number(raw)]);
    sendSuccess(res, { kind: 'category', ...mapCategory(rows[0]), ...block });
  })
);

router.get(
  '/:id/reviews',
  asyncHandler(async (req, res) => {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) throw ApiError.badRequest('Invalid id — numeric id required');
    const id = Number(raw);
    const kind = await resolveServiceId(id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const where = kind === 'module' ? 'sr.module_id = ?' : 'sr.category_id = ?';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM service_reviews sr WHERE sr.status = 'visible' AND ${where}`,
      [id]
    );
    const [rows] = await pool.query(
      `SELECT sr.id, sr.service_rating, sr.service_comment, sr.created_at,
              u.name AS customer_name, u.avatar AS customer_avatar
         FROM service_reviews sr JOIN users u ON u.id = sr.customer_id
        WHERE sr.status = 'visible' AND ${where}
        ORDER BY sr.id DESC LIMIT ? OFFSET ?`,
      [id, limit, (page - 1) * limit]
    );
    sendPaginated(res, {
      items: rows.map((r) => ({
        id: r.id,
        service_rating: r.service_rating,
        service_comment: r.service_comment,
        created_at: r.created_at,
        customer_name: maskName(r.customer_name),
        customer_avatar: toPublicUrl(r.customer_avatar),
      })),
      total,
      page,
      limit,
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) {
      throw ApiError.badRequest(
        'Invalid id — numeric module or category id required (e.g. /api/v1/services/7 or /api/v1/services/31)'
      );
    }
    const id = Number(raw);

    const [rows] = await pool.query(`SELECT * FROM service_modules WHERE id = ? AND status = 1`, [id]);
    if (rows.length) {
      const [cats] = await pool.query(
        `SELECT * FROM service_categories WHERE module_id = ? AND status = 1 ORDER BY sort_order`,
        [id]
      );
      const block = await reviewBlock('sr.module_id = ?', [id]);
      return sendSuccess(res, {
        kind: 'module',
        ...mapModule(rows[0]),
        categories: cats.map(mapCategory),
        ...block,
      });
    }

    // fallback: category id (app sometimes passes service/category ids)
    const [catRows] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code, m.icon AS module_icon
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.id = ? AND c.status = 1 AND m.status = 1`,
      [id]
    );
    if (catRows.length) {
      const block = await reviewBlock('sr.category_id = ?', [id]);
      return sendSuccess(res, { kind: 'category', ...mapCategory(catRows[0]), ...block });
    }

    throw ApiError.notFound('Service not found');
  })
);

module.exports = router;
