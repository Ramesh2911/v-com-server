const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');

// GET /api/v1/categories/:id/sub-services — public special-service work-type cards
router.get(
  '/:id/sub-services',
  asyncHandler(async (req, res) => {
    const raw = String(req.params.id || '').trim();
    if (!/^\d+$/.test(raw)) {
      throw ApiError.badRequest(
        'Invalid category id — numeric id required (e.g. /api/v1/categories/36/sub-services)'
      );
    }
    const id = Number(raw);
    const [cats] = await pool.query(
      `SELECT id, name, bg_color, text_color FROM service_categories WHERE id = ? AND status = 1`,
      [id]
    );
    if (!cats.length) throw ApiError.notFound('Service not found');
    const cat = cats[0];

    const [subs] = await pool.query(
      `SELECT id, code, title, subtitle, image, bg_color, text_color, is_active
         FROM service_sub_services
        WHERE category_id = ? AND is_active = 1
        ORDER BY id`,
      [id]
    );

    sendSuccess(
      res,
      {
        category_id: cat.id,
        category_name: cat.name,
        bg_color: cat.bg_color || '#1E40AF',
        text_color: cat.text_color || '#FFFFFF',
        sub_services: subs.map((s) => ({ ...s, is_active: !!s.is_active })),
      },
      'Sub-services fetched successfully'
    );
  })
);

module.exports = router;
