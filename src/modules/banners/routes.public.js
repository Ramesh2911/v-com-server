const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { toPublicUrl } = require('../../middlewares/upload');

const banners = express.Router();

/* Public: active banners for app home (carousel) — ordered by slot ASC.
   Active = status 1 AND within [starts_at, ends_at] window (null = open). */
banners.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, title, subtitle, image, slot, starts_at, ends_at
         FROM banners
        WHERE status = 1
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY slot ASC, id ASC
        LIMIT 50`
    );
    sendSuccess(
      res,
      rows.map((r) => ({
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
