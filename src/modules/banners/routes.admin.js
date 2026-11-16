const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { cloudinaryUpload, cloudinaryImage, toPublicUrl } = require('../../middlewares/upload');
const { writeAudit } = require('../../utils/audit');

const banners = express.Router();

banners.use(authMiddleware, requirePermission('banners.view'));

const parseId = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid id required');
  return id;
};

const SLOT_MIN = 1;
const SLOT_MAX = 99;

const parseSlot = (v, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw ApiError.badRequest('slot is required');
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < SLOT_MIN || n > SLOT_MAX) {
    throw ApiError.badRequest(`slot must be an integer between ${SLOT_MIN} and ${SLOT_MAX}`);
  }
  return n;
};

const parseDate = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  // accept "YYYY-MM-DD HH:mm[:ss]" (datetime-local) or ISO
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.replace('T', ' ').slice(0, 19) : s;
  const d = new Date(normalized.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`${field} must be a valid date/time`);
  return normalized.length === 10 ? `${normalized} 00:00:00` : normalized;
};

const toView = (r) => ({
  id: r.id,
  title: r.title,
  subtitle: r.subtitle || null,
  image: toPublicUrl(r.image),
  slot: Number(r.slot),
  starts_at: r.starts_at,
  ends_at: r.ends_at,
  status: Number(r.status),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/* Schedule columns as IST wall-clock strings ('YYYY-MM-DD HH:mm:ss') — same
   shape datetime-local sends, so comparisons and the web form stay tz-safe
   regardless of the MySQL server's timezone. */
const BANNER_SELECT = `SELECT id, title, subtitle, image, slot, status, created_at, updated_at,
  DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
  DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at
  FROM banners`;

/* ---- list ---- */
banners.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${BANNER_SELECT} ORDER BY slot ASC, id ASC`);
    sendSuccess(res, rows.map(toView), 'Banners fetched');
  })
);

/* ---- create ---- */
banners.post(
  '/',
  requirePermission('banners.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('title is required');
    const image = await cloudinaryImage(req, res);
    if (!image) throw ApiError.badRequest('image is required');

    const slot = parseSlot(b.slot) ?? 1;
    const startsAt = parseDate(b.starts_at, 'starts_at');
    const endsAt = parseDate(b.ends_at, 'ends_at');
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw ApiError.badRequest('ends_at must be after starts_at');
    }
    const status = b.status === undefined || b.status === '' ? 1 : Number(b.status) ? 1 : 0;

    const [result] = await pool.query(
      `INSERT INTO banners (title, subtitle, image, slot, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(b.title).trim().slice(0, 150),
        b.subtitle ? String(b.subtitle).trim().slice(0, 255) : null,
        image,
        slot,
        startsAt,
        endsAt,
        status,
      ]
    );
    await writeAudit({ actor: req.user, action: 'banner.create', entity: 'banners', entityId: result.insertId, req });
    const [[row]] = await pool.query(`${BANNER_SELECT} WHERE id = ?`, [result.insertId]);
    sendSuccess(res, toView(row), 'Banner created', 201);
  })
);

/* ---- update (partial; image omitted = keep) ---- */
banners.put(
  '/:id',
  requirePermission('banners.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(`${BANNER_SELECT} WHERE id = ?`, [id]);
    if (!rows.length) throw ApiError.notFound('Banner not found');

    const b = req.body || {};
    const sets = [];
    const vals = [];
    const put = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };

    if ('title' in b) {
      if (!b.title || !String(b.title).trim()) throw ApiError.badRequest('title is required');
      put('title', String(b.title).trim().slice(0, 150));
    }
    if ('subtitle' in b) put('subtitle', b.subtitle ? String(b.subtitle).trim().slice(0, 255) : null);
    if ('slot' in b) {
      const slot = parseSlot(b.slot, { required: true });
      put('slot', slot);
    }
    if ('starts_at' in b) put('starts_at', parseDate(b.starts_at, 'starts_at'));
    if ('ends_at' in b) put('ends_at', parseDate(b.ends_at, 'ends_at'));
    if ('status' in b && b.status !== '') put('status', Number(b.status) ? 1 : 0);

    // validate window if either side is (being) set
    const nextStarts = 'starts_at' in b ? parseDate(b.starts_at, 'starts_at') : rows[0].starts_at;
    const nextEnds = 'ends_at' in b ? parseDate(b.ends_at, 'ends_at') : rows[0].ends_at;
    if (nextStarts && nextEnds && nextEnds <= nextStarts) {
      throw ApiError.badRequest('ends_at must be after starts_at');
    }

    const image = await cloudinaryImage(req, res);
    if (image !== null) put('image', image);

    if (sets.length) {
      await pool.query(`UPDATE banners SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    }
    await writeAudit({ actor: req.user, action: 'banner.update', entity: 'banners', entityId: id, req });
    const [[row]] = await pool.query(`${BANNER_SELECT} WHERE id = ?`, [id]);
    sendSuccess(res, toView(row), 'Banner updated');
  })
);

/* ---- delete ---- */
banners.delete(
  '/:id',
  requirePermission('banners.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query('SELECT id FROM banners WHERE id = ?', [id]);
    if (!rows.length) throw ApiError.notFound('Banner not found');
    await pool.query('DELETE FROM banners WHERE id = ?', [id]);
    await writeAudit({ actor: req.user, action: 'banner.delete', entity: 'banners', entityId: id, req });
    sendSuccess(res, null, 'Banner deleted');
  })
);

module.exports = { banners };
