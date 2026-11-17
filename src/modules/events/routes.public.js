const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');

/* Public Event & Corporate Arrangements directory — no auth (Bearer optional/ignored).
   event_date/start_time stored as IST wall-clock; `date` returned as UTC ISO. */

const istDateNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // 'YYYY-MM-DD'

const addDays = (d, n) => {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// upcoming Saturday–Sunday window (IST). today Sat -> [today, +1]; today Sun -> [today, today]
const weekendWindow = (today) => {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (dow === 6) return [today, addDays(today, 1)];
  if (dow === 0) return [today, today];
  const sat = addDays(today, 6 - dow);
  return [sat, addDays(sat, 1)];
};

const toIso = (dateStr, timeStr) => {
  if (!dateStr) return null;
  return new Date(`${dateStr}T${timeStr || '00:00:00'}+05:30`).toISOString();
};

const DATE_TYPES = new Set(['all', 'today', 'tomorrow', 'this_weekend', 'this_month', 'custom']);

const mapItem = (r) => ({
  id: r.id,
  title: r.title,
  organizer: r.organizer || null,
  category: r.category || null,
  date: toIso(r.event_date, r.start_time),
  time_range: r.time_range || null,
  location: r.location,
  venue_name: r.venue_name || null,
  venue_address: r.venue_address || null,
  banner_url: r.banner_url || null,
  is_featured: !!r.is_featured,
  description: r.description || null,
  highlights: Array.isArray(r.highlights) ? r.highlights : [],
});

const mapDetail = (r) => ({
  ...mapItem(r),
  amenities: Array.isArray(r.amenities) ? r.amenities : [],
  coordinates: {
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  },
});

/* GET /events — list with location + date filters, custom pagination shape */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = ['status = 1'];
    const params = [];

    const loc = String(req.query.location || '').trim();
    if (loc && loc.toLowerCase() !== 'all') {
      where.push('location LIKE ?');
      params.push(`%${loc}%`);
    }

    const today = istDateNow();
    const dateType = String(req.query.date || 'all').trim().toLowerCase();
    if (!DATE_TYPES.has(dateType)) {
      throw ApiError.badRequest('Invalid date filter — use all|today|tomorrow|this_weekend|this_month|custom');
    }
    if (dateType === 'custom') {
      const cd = String(req.query.custom_date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cd) || Number.isNaN(new Date(`${cd}T00:00:00Z`).getTime())) {
        throw ApiError.badRequest('custom_date must be YYYY-MM-DD');
      }
      where.push('event_date = ?');
      params.push(cd);
    } else if (dateType === 'all') {
      where.push('event_date >= ?'); // upcoming only (IST today)
      params.push(today);
    } else if (dateType === 'today') {
      where.push('event_date = ?');
      params.push(today);
    } else if (dateType === 'tomorrow') {
      where.push('event_date = ?');
      params.push(addDays(today, 1));
    } else if (dateType === 'this_weekend') {
      const [from, to] = weekendWindow(today);
      where.push('event_date BETWEEN ? AND ?');
      params.push(from, to);
    } else if (dateType === 'this_month') {
      where.push(`event_date >= ? AND DATE_FORMAT(event_date, '%Y-%m') = ?`);
      params.push(today, today.slice(0, 7));
    }

    const whereSql = where.join(' AND ');
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM events WHERE ${whereSql}`, params);
    const { page, limit, offset } = getPagination({ ...req.query, limit: req.query.limit ?? '10' });
    const [rows] = await pool.query(
      `SELECT * FROM events WHERE ${whereSql}
        ORDER BY event_date ASC, start_time ASC, id ASC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    sendSuccess(
      res,
      {
        items: rows.map(mapItem),
        pagination: {
          current_page: page,
          total_pages: Math.max(1, Math.ceil(total / limit)),
          total_items: total,
          per_page: limit,
        },
      },
      'Events retrieved successfully'
    );
  })
);

/* GET /events/locations — matching location names only (string array).
   Must be registered BEFORE /:id. */
const locationSearch = asyncHandler(async (req, res) => {
  const source = req.method === 'POST' ? req.body || {} : req.query;
  const q = String(source.query ?? source.q ?? '').trim();
  const [rows] = q
    ? await pool.query(
        `SELECT DISTINCT location FROM events WHERE status = 1 AND location LIKE ? ORDER BY location`,
        [`%${q}%`]
      )
    : await pool.query(`SELECT DISTINCT location FROM events WHERE status = 1 ORDER BY location`);
  res.status(200).json({ success: true, data: rows.map((r) => r.location) });
});

router.get('/locations', locationSearch);
router.post('/locations/search', locationSearch);

/* GET /events/:id — full detail (incl. past events) */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 16) throw ApiError.notFound('Event not found');
    const [rows] = await pool.query(`SELECT * FROM events WHERE id = ? AND status = 1`, [id]);
    if (!rows.length) throw ApiError.notFound('Event not found');
    sendSuccess(res, mapDetail(rows[0]), 'Event details fetched successfully');
  })
);

module.exports = router;
