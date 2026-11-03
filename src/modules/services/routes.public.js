const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { optionalAuth } = require('../../middlewares/auth');
const { toPublicUrl } = require('../../middlewares/upload');

const mapModule = (m) => ({ ...m, image: toPublicUrl(m.image) });
const mapCategory = (c) => ({ ...c, image: toPublicUrl(c.image) });

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
    sendSuccess(res, { kind: 'category', ...mapCategory(rows[0]) });
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
      return sendSuccess(res, { kind: 'module', ...mapModule(rows[0]), categories: cats.map(mapCategory) });
    }

    // fallback: category id (app sometimes passes service/category ids)
    const [catRows] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code, m.icon AS module_icon
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.id = ? AND c.status = 1 AND m.status = 1`,
      [id]
    );
    if (catRows.length) return sendSuccess(res, { kind: 'category', ...mapCategory(catRows[0]) });

    throw ApiError.notFound('Service not found');
  })
);

module.exports = router;
