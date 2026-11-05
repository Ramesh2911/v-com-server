const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { cloudinaryUpload, cloudinaryImage, toPublicUrl } = require('../../middlewares/upload');
const { writeAudit } = require('../../utils/audit');

const offers = express.Router();
const coupons = express.Router();

const toDate = (v, endOfDay = false) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return endOfDay ? `${s} 23:59:59` : `${s} 00:00:00`;
  return s.replace('T', ' ');
};

const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw ApiError.badRequest('Invalid number value');
  return n;
};

const parseDiscount = (type, value) => {
  const t = type || 'percent';
  if (t !== 'percent' && t !== 'flat') throw ApiError.badRequest("discount_type must be 'percent' or 'flat'");
  const v = Number(value);
  if (Number.isNaN(v) || v <= 0) throw ApiError.badRequest('discount_value must be greater than 0');
  if (t === 'percent' && v > 100) throw ApiError.badRequest('percent discount cannot exceed 100');
  return { type: t, value: v };
};

const assertDateOrder = (startsAt, endsAt) => {
  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    throw ApiError.badRequest('starts_at must be before ends_at');
  }
};

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid id required');
  return id;
};

// ============================== OFFERS ==============================

offers.use(authMiddleware, requirePermission('offers.view'));

offers.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status !== undefined && req.query.status !== '') {
      where.push('o.status = ?');
      params.push(Number(req.query.status));
    }
    if (req.query.category_id) {
      where.push('o.category_id = ?');
      params.push(Number(req.query.category_id));
    }
    if (req.query.module_id) {
      where.push('c.module_id = ?');
      params.push(Number(req.query.module_id));
    }
    const sql = `SELECT o.*, c.name AS category_name, c.image AS category_image, c.price AS category_price,
                        m.id AS module_id, m.name AS module_name, m.code AS module_code
                   FROM offers o
                   JOIN service_categories c ON c.id = o.category_id
                   JOIN service_modules m ON m.id = c.module_id
                   ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                  ORDER BY o.id DESC`;
    const [rows] = await pool.query(sql, params);
    sendSuccess(
      res,
      rows.map((r) => ({ ...r, image: toPublicUrl(r.image), category_image: toPublicUrl(r.category_image) }))
    );
  })
);

offers.post(
  '/',
  requirePermission('offers.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const b = req.body;
    if (!b.category_id) throw ApiError.badRequest('category_id is required');
    if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('title is required');
    const discount = parseDiscount(b.discount_type, b.discount_value);
    const startsAt = toDate(b.starts_at);
    const endsAt = toDate(b.ends_at, true);
    assertDateOrder(startsAt, endsAt);

    const [[cat]] = await pool.query('SELECT id FROM service_categories WHERE id = ?', [Number(b.category_id)]);
    if (!cat) throw ApiError.badRequest('Service (category) does not exist');

    const image = await cloudinaryImage(req, res);
    const [result] = await pool.query(
      `INSERT INTO offers (category_id, title, description, discount_type, discount_value, starts_at, ends_at, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(b.category_id),
        String(b.title).trim(),
        b.description || null,
        discount.type,
        discount.value,
        startsAt,
        endsAt,
        image,
        b.status === undefined || b.status === '' ? 1 : Number(b.status),
      ]
    );
    await writeAudit({ actor: req.user, action: 'offer.create', entity: 'offers', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Offer created', 201);
  })
);

offers.put(
  '/:id',
  requirePermission('offers.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT * FROM offers WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Offer not found');
    const existing = rows[0];
    const b = req.body;

    const sets = [];
    const vals = [];
    const put = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };

    if ('category_id' in b && b.category_id !== null && b.category_id !== '') {
      const cid = Number(b.category_id);
      const [[cat]] = await pool.query('SELECT id FROM service_categories WHERE id = ?', [cid]);
      if (!cat) throw ApiError.badRequest('Service (category) does not exist');
      put('category_id', cid);
    }
    if ('title' in b) {
      if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('title is required');
      put('title', String(b.title).trim());
    }
    if ('description' in b) put('description', b.description || null);

    const finalType = 'discount_type' in b ? b.discount_type || 'percent' : existing.discount_type;
    const finalValue = 'discount_value' in b ? b.discount_value : existing.discount_value;
    if ('discount_type' in b || 'discount_value' in b) {
      const discount = parseDiscount(finalType, finalValue);
      put('discount_type', discount.type);
      put('discount_value', discount.value);
    }

    let startsAt = existing.starts_at;
    let endsAt = existing.ends_at;
    if ('starts_at' in b) {
      startsAt = toDate(b.starts_at);
      put('starts_at', startsAt);
    }
    if ('ends_at' in b) {
      endsAt = toDate(b.ends_at, true);
      put('ends_at', endsAt);
    }
    assertDateOrder(startsAt, endsAt);

    if ('status' in b && b.status !== '') put('status', Number(b.status));

    const image = await cloudinaryImage(req, res);
    if (image !== null) put('image', image);

    if (sets.length) {
      await pool.query(`UPDATE offers SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    }
    await writeAudit({ actor: req.user, action: 'offer.update', entity: 'offers', entityId: id, req });
    sendSuccess(res, null, 'Offer updated');
  })
);

offers.delete(
  '/:id',
  requirePermission('offers.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT id FROM offers WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Offer not found');
    await pool.query('DELETE FROM offers WHERE id = ?', [id]);
    await writeAudit({ actor: req.user, action: 'offer.delete', entity: 'offers', entityId: id, req });
    sendSuccess(res, null, 'Offer deleted');
  })
);

// ============================== COUPONS ==============================

coupons.use(authMiddleware, requirePermission('offers.view'));

coupons.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status !== undefined && req.query.status !== '') {
      where.push('k.status = ?');
      params.push(Number(req.query.status));
    }
    if (req.query.search) {
      where.push('(k.code LIKE ? OR k.title LIKE ?)');
      const q = `%${String(req.query.search).trim()}%`;
      params.push(q, q);
    }
    const [rows] = await pool.query(
      `SELECT k.*, c.name AS category_name
         FROM coupons k LEFT JOIN service_categories c ON c.id = k.category_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY k.id DESC`,
      params
    );
    sendSuccess(res, rows);
  })
);

coupons.post(
  '/',
  requirePermission('offers.manage'),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
      throw ApiError.badRequest('code must be 3-30 characters (letters, numbers, - or _)');
    }
    const [dup] = await pool.query('SELECT id FROM coupons WHERE code = ?', [code]);
    if (dup.length) throw ApiError.conflict('Coupon code already exists');

    const discount = parseDiscount(b.discount_type, b.discount_value);
    const maxDiscount = numOrNull(b.max_discount);
    const minAmount = numOrNull(b.min_amount);
    const usageLimit = numOrNull(b.usage_limit);
    const perUserLimit = numOrNull(b.per_user_limit);
    if (maxDiscount !== null && maxDiscount < 0) throw ApiError.badRequest('max_discount must be >= 0');
    if (minAmount !== null && minAmount < 0) throw ApiError.badRequest('min_amount must be >= 0');
    if (usageLimit !== null && usageLimit < 1) throw ApiError.badRequest('usage_limit must be >= 1');
    if (perUserLimit !== null && perUserLimit < 1) throw ApiError.badRequest('per_user_limit must be >= 1');

    const appliesTo = b.applies_to === 'category' ? 'category' : 'all';
    let categoryId = null;
    if (appliesTo === 'category') {
      if (!b.category_id) throw ApiError.badRequest('category_id is required when applies_to = category');
      const [[cat]] = await pool.query('SELECT id FROM service_categories WHERE id = ?', [Number(b.category_id)]);
      if (!cat) throw ApiError.badRequest('Service (category) does not exist');
      categoryId = Number(b.category_id);
    }

    const startsAt = toDate(b.starts_at);
    const endsAt = toDate(b.ends_at, true);
    assertDateOrder(startsAt, endsAt);

    const [result] = await pool.query(
      `INSERT INTO coupons (code, title, discount_type, discount_value, max_discount, min_amount,
                            usage_limit, per_user_limit, applies_to, category_id, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        b.title || null,
        discount.type,
        discount.value,
        maxDiscount,
        minAmount,
        usageLimit,
        perUserLimit,
        appliesTo,
        categoryId,
        startsAt,
        endsAt,
        b.status === undefined || b.status === '' ? 1 : Number(b.status),
      ]
    );
    await writeAudit({ actor: req.user, action: 'coupon.create', entity: 'coupons', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId, code }, 'Coupon created', 201);
  })
);

coupons.put(
  '/:id',
  requirePermission('offers.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT * FROM coupons WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Coupon not found');
    const existing = rows[0];
    const b = req.body;

    const sets = [];
    const vals = [];
    const put = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };

    if ('code' in b && b.code !== null && b.code !== '') {
      const code = String(b.code).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,30}$/.test(code)) {
        throw ApiError.badRequest('code must be 3-30 characters (letters, numbers, - or _)');
      }
      const [dup] = await pool.query('SELECT id FROM coupons WHERE code = ? AND id <> ?', [code, id]);
      if (dup.length) throw ApiError.conflict('Coupon code already exists');
      put('code', code);
    }
    if ('title' in b) put('title', b.title || null);

    const finalType = 'discount_type' in b ? b.discount_type || 'percent' : existing.discount_type;
    const finalValue = 'discount_value' in b ? b.discount_value : existing.discount_value;
    if ('discount_type' in b || 'discount_value' in b) {
      const discount = parseDiscount(finalType, finalValue);
      put('discount_type', discount.type);
      put('discount_value', discount.value);
    }

    if ('max_discount' in b) {
      const v = numOrNull(b.max_discount);
      if (v !== null && v < 0) throw ApiError.badRequest('max_discount must be >= 0');
      put('max_discount', v);
    }
    if ('min_amount' in b) {
      const v = numOrNull(b.min_amount);
      if (v !== null && v < 0) throw ApiError.badRequest('min_amount must be >= 0');
      put('min_amount', v);
    }
    if ('per_user_limit' in b) {
      const v = numOrNull(b.per_user_limit);
      if (v !== null && v < 1) throw ApiError.badRequest('per_user_limit must be >= 1');
      put('per_user_limit', v);
    }

    if ('usage_limit' in b) {
      const usageLimit = numOrNull(b.usage_limit);
      if (usageLimit !== null && usageLimit < 1) throw ApiError.badRequest('usage_limit must be >= 1');
      if (usageLimit !== null && usageLimit < existing.used_count) {
        throw ApiError.badRequest(`usage_limit cannot be below used_count (${existing.used_count})`);
      }
      put('usage_limit', usageLimit);
    }

    if ('applies_to' in b) {
      const appliesTo = b.applies_to === 'category' ? 'category' : 'all';
      put('applies_to', appliesTo);
      if (appliesTo === 'category') {
        if (!b.category_id) throw ApiError.badRequest('category_id is required when applies_to = category');
        const [[cat]] = await pool.query('SELECT id FROM service_categories WHERE id = ?', [Number(b.category_id)]);
        if (!cat) throw ApiError.badRequest('Service (category) does not exist');
        put('category_id', Number(b.category_id));
      } else {
        put('category_id', null);
      }
    } else if ('category_id' in b && existing.applies_to === 'category') {
      if (!b.category_id) throw ApiError.badRequest('category_id is required when applies_to = category');
      const [[cat]] = await pool.query('SELECT id FROM service_categories WHERE id = ?', [Number(b.category_id)]);
      if (!cat) throw ApiError.badRequest('Service (category) does not exist');
      put('category_id', Number(b.category_id));
    }

    let startsAt = existing.starts_at;
    let endsAt = existing.ends_at;
    if ('starts_at' in b) {
      startsAt = toDate(b.starts_at);
      put('starts_at', startsAt);
    }
    if ('ends_at' in b) {
      endsAt = toDate(b.ends_at, true);
      put('ends_at', endsAt);
    }
    assertDateOrder(startsAt, endsAt);

    if ('status' in b && b.status !== '') put('status', Number(b.status));

    if (sets.length) {
      await pool.query(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    }
    await writeAudit({ actor: req.user, action: 'coupon.update', entity: 'coupons', entityId: id, req });
    sendSuccess(res, null, 'Coupon updated');
  })
);

coupons.delete(
  '/:id',
  requirePermission('offers.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT id FROM coupons WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Coupon not found');
    await pool.query('DELETE FROM coupons WHERE id = ?', [id]);
    await writeAudit({ actor: req.user, action: 'coupon.delete', entity: 'coupons', entityId: id, req });
    sendSuccess(res, null, 'Coupon deleted');
  })
);

module.exports = { offers, coupons };
