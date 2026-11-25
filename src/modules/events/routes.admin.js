const express = require('express');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { writeAudit } = require('../../utils/audit');

const eventsAdmin = express.Router();

eventsAdmin.use(authMiddleware, requirePermission('events.view'));

const parseId = (v) => {
  const id = String(v || '').trim();
  if (!id || id.length > 16) throw ApiError.badRequest('Valid event id required');
  return id;
};

const EVENT_SELECT = 'SELECT * FROM events';

const toView = (r) => ({
  id: r.id,
  title: r.title,
  organizer: r.organizer || null,
  category: r.category || null,
  event_date: r.event_date,
  start_time: r.start_time || null,
  time_range: r.time_range || null,
  location: r.location,
  venue_name: r.venue_name || null,
  venue_address: r.venue_address || null,
  banner_url: r.banner_url || null,
  is_featured: Number(r.is_featured) ? 1 : 0,
  description: r.description || null,
  highlights: Array.isArray(r.highlights) ? r.highlights : [],
  amenities: Array.isArray(r.amenities) ? r.amenities : [],
  latitude: r.latitude != null ? Number(r.latitude) : null,
  longitude: r.longitude != null ? Number(r.longitude) : null,
  status: Number(r.status),
  sort_order: Number(r.sort_order),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

const asStr = (v) => String(v).trim();

const cleanStr = (v, field, { required = false, max = 255 } = {}) => {
  if (v === undefined || v === null || asStr(v) === '') {
    if (required) throw ApiError.badRequest(`${field} is required`);
    return null;
  }
  const s = asStr(v);
  if (s.length > max) throw ApiError.badRequest(`${field} must be ${max} characters or fewer`);
  return s;
};

const cleanDate = (v, field, { required = false } = {}) => {
  if (v === undefined || v === null || asStr(v) === '') {
    if (required) throw ApiError.badRequest(`${field} is required`);
    return null;
  }
  const s = asStr(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
    throw ApiError.badRequest(`${field} must be YYYY-MM-DD`);
  }
  return s;
};

const cleanTime = (v) => {
  if (v === undefined || v === null || asStr(v) === '') return null;
  const s = asStr(v);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw ApiError.badRequest('start_time must be HH:MM');
  return s;
};

const cleanBool = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (v === true || v === 1 || v === '1') return 1;
  if (v === false || v === 0 || v === '0') return 0;
  throw ApiError.badRequest(`${field} must be 0 or 1`);
};

const cleanInt = (v, field, { min = 0, max = 999999 } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw ApiError.badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
};

const cleanCoord = (v, field, min, max) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n < min || n > max) {
    throw ApiError.badRequest(`${field} must be between ${min} and ${max}`);
  }
  return n;
};

const cleanList = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  let arr = v;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = arr.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(arr)) throw ApiError.badRequest(`${field} must be an array`);
  if (arr.length > 50) throw ApiError.badRequest(`${field} must have 50 items or fewer`);
  return arr.map((s) => String(s).trim().slice(0, 300)).filter(Boolean);
};

/* mysql2 expands array params into multiple placeholders — always stringify */
const jsonCol = (arr) => (arr && arr.length ? JSON.stringify(arr) : null);

/* ---- list (all statuses; optional q + status filters) ---- */
eventsAdmin.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    const q = asStr(req.query.q || '');
    if (q) {
      where.push('(title LIKE ? OR organizer LIKE ? OR location LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.status === '0' || req.query.status === '1') {
      where.push('status = ?');
      params.push(Number(req.query.status));
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `${EVENT_SELECT}${whereSql} ORDER BY event_date DESC, id DESC LIMIT 500`,
      params
    );
    sendSuccess(res, rows.map(toView), 'Events fetched');
  })
);

/* ---- create ---- */
eventsAdmin.post(
  '/',
  requirePermission('events.manage'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const title = cleanStr(b.title, 'title', { required: true, max: 200 });
    const location = cleanStr(b.location, 'location', { required: true, max: 100 });
    const eventDate = cleanDate(b.event_date, 'event_date', { required: true });

    const id = `ev-${Date.now().toString(36)}`;
    await pool.query(
      `INSERT INTO events
        (id, title, organizer, category, event_date, start_time, time_range, location,
         venue_name, venue_address, banner_url, is_featured, description, highlights, amenities,
         latitude, longitude, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        cleanStr(b.organizer, 'organizer', { max: 160 }),
        cleanStr(b.category, 'category', { max: 60 }),
        eventDate,
        cleanTime(b.start_time),
        cleanStr(b.time_range, 'time_range', { max: 40 }),
        location,
        cleanStr(b.venue_name, 'venue_name', { max: 160 }),
        cleanStr(b.venue_address, 'venue_address', { max: 255 }),
        cleanStr(b.banner_url, 'banner_url', { max: 512 }),
        cleanBool(b.is_featured, 'is_featured') ?? 0,
        cleanStr(b.description, 'description', { max: 5000 }),
        jsonCol(cleanList(b.highlights, 'highlights')),
        jsonCol(cleanList(b.amenities, 'amenities')),
        cleanCoord(b.latitude, 'latitude', -90, 90),
        cleanCoord(b.longitude, 'longitude', -180, 180),
        cleanBool(b.status, 'status') ?? 1,
        cleanInt(b.sort_order, 'sort_order') ?? 0,
      ]
    );
    await writeAudit({ actor: req.user, action: 'event.create', entity: 'events', entityId: id, req });
    const [[row]] = await pool.query(`${EVENT_SELECT} WHERE id = ?`, [id]);
    sendSuccess(res, toView(row), 'Event created', 201);
  })
);

/* ---- update (partial) ---- */
eventsAdmin.put(
  '/:id',
  requirePermission('events.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(`${EVENT_SELECT} WHERE id = ?`, [id]);
    if (!rows.length) throw ApiError.notFound('Event not found');

    const b = req.body || {};
    const sets = [];
    const vals = [];
    const put = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };

    if ('title' in b) put('title', cleanStr(b.title, 'title', { required: true, max: 200 }));
    if ('location' in b) put('location', cleanStr(b.location, 'location', { required: true, max: 100 }));
    if ('event_date' in b) put('event_date', cleanDate(b.event_date, 'event_date', { required: true }));
    if ('organizer' in b) put('organizer', cleanStr(b.organizer, 'organizer', { max: 160 }));
    if ('category' in b) put('category', cleanStr(b.category, 'category', { max: 60 }));
    if ('start_time' in b) put('start_time', cleanTime(b.start_time));
    if ('time_range' in b) put('time_range', cleanStr(b.time_range, 'time_range', { max: 40 }));
    if ('venue_name' in b) put('venue_name', cleanStr(b.venue_name, 'venue_name', { max: 160 }));
    if ('venue_address' in b) put('venue_address', cleanStr(b.venue_address, 'venue_address', { max: 255 }));
    if ('banner_url' in b) put('banner_url', cleanStr(b.banner_url, 'banner_url', { max: 512 }));
    if ('is_featured' in b) put('is_featured', cleanBool(b.is_featured, 'is_featured') ?? 0);
    if ('description' in b) put('description', cleanStr(b.description, 'description', { max: 5000 }));
    if ('highlights' in b) put('highlights', jsonCol(cleanList(b.highlights, 'highlights')));
    if ('amenities' in b) put('amenities', jsonCol(cleanList(b.amenities, 'amenities')));
    if ('latitude' in b) put('latitude', cleanCoord(b.latitude, 'latitude', -90, 90));
    if ('longitude' in b) put('longitude', cleanCoord(b.longitude, 'longitude', -180, 180));
    if ('status' in b) put('status', cleanBool(b.status, 'status') ?? 1);
    if ('sort_order' in b) put('sort_order', cleanInt(b.sort_order, 'sort_order') ?? 0);

    if (sets.length) {
      await pool.query(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
    }
    await writeAudit({ actor: req.user, action: 'event.update', entity: 'events', entityId: id, req });
    const [[row]] = await pool.query(`${EVENT_SELECT} WHERE id = ?`, [id]);
    sendSuccess(res, toView(row), 'Event updated');
  })
);

/* ---- delete (standalone table — hard delete) ---- */
eventsAdmin.delete(
  '/:id',
  requirePermission('events.manage'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const [rows] = await pool.query(`${EVENT_SELECT} WHERE id = ?`, [id]);
    if (!rows.length) throw ApiError.notFound('Event not found');
    await pool.query('DELETE FROM events WHERE id = ?', [id]);
    await writeAudit({ actor: req.user, action: 'event.delete', entity: 'events', entityId: id, req });
    sendSuccess(res, null, 'Event deleted');
  })
);

module.exports = { eventsAdmin };
