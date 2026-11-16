const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { toPublicUrl } = require('../../middlewares/upload');

const banners = express.Router();

/* Schedule times are stored as IST (Asia/Kolkata) wall-clock — the admin panel's
   datetime-local values. MySQL NOW() may be UTC (live) or IST (local), so the
   window check is done here in app code against IST wall time instead of SQL
   NOW(), keeping live and local behaviour identical. */
const istWallNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()); // 'YYYY-MM-DD HH:MM:SS'

/* Public: active banners for app home (carousel) — ordered by slot ASC.
   Active = status 1 AND within [starts_at, ends_at] window (null = open). */
banners.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, subtitle, image, slot,
              DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
              DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at
         FROM banners
        WHERE status = 1
        ORDER BY slot ASC, id ASC
        LIMIT 50`
    );
    const now = istWallNow();
    const active = rows.filter(
      (r) => (!r.starts_at || r.starts_at <= now) && (!r.ends_at || r.ends_at >= now)
    );
    sendSuccess(
      res,
      active.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.subtitle || null,
        image: toPublicUrl(r.image),
        slot: Number(r.slot),
      })),
      'Banners fetched'
    );
  })
);

module.exports = banners;
