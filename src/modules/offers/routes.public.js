const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { toPublicUrl } = require('../../middlewares/upload');

const offers = express.Router();
const coupons = express.Router();

// GET /api/v1/offers — active-now offers (public)
offers.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT o.id, o.title, o.description, o.discount_type, o.discount_value,
              o.starts_at, o.ends_at, o.image,
              c.id AS category_id, c.name AS category_name, c.image AS category_image, c.price AS category_price,
              m.id AS module_id, m.name AS module_name, m.code AS module_code
         FROM offers o
         JOIN service_categories c ON c.id = o.category_id
         JOIN service_modules m ON m.id = c.module_id
        WHERE o.status = 1 AND c.status = 1 AND m.status = 1
          AND (o.starts_at IS NULL OR o.starts_at <= NOW())
          AND (o.ends_at IS NULL OR o.ends_at >= NOW())
        ORDER BY o.id DESC`
    );
    sendSuccess(
      res,
      rows.map((r) => ({
        ...r,
        image: toPublicUrl(r.image),
        category_image: toPublicUrl(r.category_image),
      }))
    );
  })
);

// POST /api/v1/coupons/validate — { code, amount? } → coupon info + computed discount
coupons.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!code) throw ApiError.badRequest('code is required');

    const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ?', [code]);
    if (!rows.length) throw ApiError.notFound('Coupon not found');
    const c = rows[0];

    if (!c.status) throw ApiError.notFound('Coupon is not active');
    if (c.starts_at && new Date(c.starts_at) > new Date()) throw ApiError.notFound('Coupon is not active yet');
    if (c.ends_at && new Date(c.ends_at) < new Date()) throw ApiError.notFound('Coupon has expired');
    if (c.usage_limit !== null && c.used_count >= c.usage_limit) {
      throw ApiError.notFound('Coupon usage limit reached');
    }

    let amount = null;
    if (req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== '') {
      amount = Number(req.body.amount);
      if (Number.isNaN(amount) || amount < 0) throw ApiError.badRequest('amount must be a non-negative number');
      if (c.min_amount !== null && amount < Number(c.min_amount)) {
        throw ApiError.badRequest(`A minimum amount of ${c.min_amount} is required for this coupon`);
      }
    }

    let computedDiscount = null;
    if (amount !== null) {
      if (c.discount_type === 'percent') {
        computedDiscount = (amount * Number(c.discount_value)) / 100;
        if (c.max_discount !== null) computedDiscount = Math.min(computedDiscount, Number(c.max_discount));
      } else {
        computedDiscount = Math.min(Number(c.discount_value), amount);
      }
      computedDiscount = Math.round(computedDiscount * 100) / 100;
    }

    sendSuccess(res, {
      code: c.code,
      title: c.title,
      discount_type: c.discount_type,
      discount_value: Number(c.discount_value),
      max_discount: c.max_discount === null ? null : Number(c.max_discount),
      min_amount: c.min_amount === null ? null : Number(c.min_amount),
      applies_to: c.applies_to,
      category_id: c.category_id,
      computed_discount: computedDiscount,
    });
  })
);

module.exports = { offers, coupons };
