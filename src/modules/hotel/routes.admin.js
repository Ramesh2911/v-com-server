const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { CATEGORY_IDS, STAR_RATINGS, MEAL_PLANS } = require('./categories.const');
const { num, serializeRoom, serializeReview } = require('./serialize');

router.use(authMiddleware, requirePermission('hotel.view'));

/* ============ PROPERTIES ============ */

router.get('/properties', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.search) {
    where.push('(p.name LIKE ? OR p.city LIKE ? OR p.location LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }
  if (req.query.city) { where.push('p.city = ?'); params.push(req.query.city); }
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(req.query.category_id); }
  if (req.query.star_rating) { where.push('p.star_rating = ?'); params.push(req.query.star_rating); }
  if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hotel_properties p ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT p.*,
            (SELECT MIN(r.ep_rate) FROM hotel_rooms r WHERE r.property_id = p.id AND r.status = 'active') AS starting_tariff
       FROM hotel_properties p ${whereSql}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  sendPaginated(res, { items: rows, total, page, limit, message: 'Properties fetched successfully' });
}));

const nextPropertyId = async () => {
  const [rows] = await pool.query('SELECT id FROM hotel_properties');
  let max = 100;
  for (const r of rows) {
    const m = /(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `prop-${max + 1}`;
};

router.post('/properties', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.location || !b.city) throw ApiError.badRequest('name, location and city are required');
  if (b.category_id && !CATEGORY_IDS.includes(b.category_id)) throw ApiError.badRequest('Invalid category_id');
  if (b.star_rating && !STAR_RATINGS.includes(b.star_rating)) throw ApiError.badRequest('Invalid star_rating');

  const id = await nextPropertyId();
  await pool.query(
    `INSERT INTO hotel_properties
       (id, name, star_rating, category_id, property_type, location, city, gps_lat, gps_lng,
        guest_rating, reviews_count, description, main_image, gallery_images, amenities, key_amenities,
        check_in_time, check_out_time, id_proof_mandatory, pet_friendly, cancellation_policy,
        has_free_cancellation, has_breakfast_included, status, popular_score)
     VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, b.name, b.star_rating || '4-Star', b.category_id || 'hotels', b.property_type || null,
      b.location, b.city, b.gps_lat || null, b.gps_lng || null,
      b.description || null, b.main_image || null,
      JSON.stringify(b.gallery_images || []), JSON.stringify(b.amenities || []), JSON.stringify(b.key_amenities || []),
      b.check_in_time || '02:00 PM', b.check_out_time || '11:00 AM',
      b.id_proof_mandatory ? 1 : 0, b.pet_friendly ? 1 : 0,
      b.cancellation_policy || 'Free cancellation up to 48 hours before check-in.',
      b.has_free_cancellation === false ? 0 : 1, b.has_breakfast_included ? 1 : 0,
      b.status === 'inactive' ? 'inactive' : 'active', b.popular_score || 0,
    ]
  );
  await writeAudit({ actor: req.user, action: 'hotel.property.create', entity: 'hotel_properties', entityId: id, details: { name: b.name }, req });
  res.status(201);
  const [[row]] = await pool.query('SELECT * FROM hotel_properties WHERE id = ?', [id]);
  sendSuccess(res, row, 'Property created successfully', 201);
}));

router.get('/properties/:id', asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM hotel_properties WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Property not found');
  sendSuccess(res, row, 'Property fetched successfully');
}));

router.put('/properties/:id', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM hotel_properties WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Property not found');
  const b = req.body || {};
  if (b.category_id && !CATEGORY_IDS.includes(b.category_id)) throw ApiError.badRequest('Invalid category_id');
  if (b.star_rating && !STAR_RATINGS.includes(b.star_rating)) throw ApiError.badRequest('Invalid star_rating');

  const fields = {
    name: b.name, star_rating: b.star_rating, category_id: b.category_id, property_type: b.property_type,
    location: b.location, city: b.city, gps_lat: b.gps_lat, gps_lng: b.gps_lng,
    description: b.description, main_image: b.main_image,
    check_in_time: b.check_in_time, check_out_time: b.check_out_time,
    cancellation_policy: b.cancellation_policy, status: b.status, popular_score: b.popular_score,
  };
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (b.gallery_images !== undefined) { sets.push('gallery_images = ?'); params.push(JSON.stringify(b.gallery_images)); }
  if (b.amenities !== undefined) { sets.push('amenities = ?'); params.push(JSON.stringify(b.amenities)); }
  if (b.key_amenities !== undefined) { sets.push('key_amenities = ?'); params.push(JSON.stringify(b.key_amenities)); }
  if (b.id_proof_mandatory !== undefined) { sets.push('id_proof_mandatory = ?'); params.push(b.id_proof_mandatory ? 1 : 0); }
  if (b.pet_friendly !== undefined) { sets.push('pet_friendly = ?'); params.push(b.pet_friendly ? 1 : 0); }
  if (b.has_free_cancellation !== undefined) { sets.push('has_free_cancellation = ?'); params.push(b.has_free_cancellation ? 1 : 0); }
  if (b.has_breakfast_included !== undefined) { sets.push('has_breakfast_included = ?'); params.push(b.has_breakfast_included ? 1 : 0); }
  if (!sets.length) throw ApiError.badRequest('No fields to update');

  await pool.query(`UPDATE hotel_properties SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  await writeAudit({ actor: req.user, action: 'hotel.property.update', entity: 'hotel_properties', entityId: req.params.id, details: { fields: Object.keys(fields).filter((k) => fields[k] !== undefined) }, req });
  const [[updated]] = await pool.query('SELECT * FROM hotel_properties WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated, 'Property updated successfully');
}));

router.delete('/properties/:id', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT id FROM hotel_properties WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Property not found');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM hotel_reservations WHERE property_id = ?', [req.params.id]);
  if (num(n) > 0) throw ApiError.conflict('Cannot delete: reservations exist for this property');
  await pool.query('DELETE FROM hotel_rooms WHERE property_id = ?', [req.params.id]);
  await pool.query('DELETE FROM hotel_reviews WHERE property_id = ?', [req.params.id]);
  await pool.query('DELETE FROM hotel_properties WHERE id = ?', [req.params.id]);
  await writeAudit({ actor: req.user, action: 'hotel.property.delete', entity: 'hotel_properties', entityId: req.params.id, details: { id: req.params.id }, req });
  sendSuccess(res, { id: req.params.id }, 'Property deleted successfully');
}));

/* ============ ROOMS ============ */

router.get('/rooms', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.property_id) { where.push('r.property_id = ?'); params.push(req.query.property_id); }
  if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hotel_rooms r ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT r.*, p.name AS property_name FROM hotel_rooms r
       JOIN hotel_properties p ON p.id = r.property_id
       ${whereSql}
      ORDER BY r.ep_rate ASC, r.id ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  sendPaginated(res, { items: rows, total, page, limit, message: 'Rooms fetched successfully' });
}));

router.post('/rooms', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.property_id || !b.room_name) throw ApiError.badRequest('property_id and room_name are required');
  const [[prop]] = await pool.query('SELECT id FROM hotel_properties WHERE id = ?', [b.property_id]);
  if (!prop) throw ApiError.notFound('Property not found');

  const [existing] = await pool.query('SELECT id FROM hotel_rooms WHERE property_id = ?', [b.property_id]);
  const seq = existing.length + 1;
  const propNum = (/(\d+)$/.exec(b.property_id) || [, '1'])[1];
  const id = `rm-${propNum}-${seq}`;

  const rate = (v) => (v != null ? Number(v) : null);
  if (b.ep_rate == null) throw ApiError.badRequest('ep_rate is required');

  await pool.query(
    `INSERT INTO hotel_rooms
       (id, property_id, room_name, bed_type, room_size, view, max_adults, max_children,
        available_rooms, ep_rate, cp_rate, map_rate, ap_rate, image_url, amenities, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, b.property_id, b.room_name, b.bed_type || null, b.room_size || null, b.view || null,
      b.max_adults || 2, b.max_children || 0, b.available_rooms || 1,
      rate(b.ep_rate), rate(b.cp_rate), rate(b.map_rate), rate(b.ap_rate),
      b.image_url || null, JSON.stringify(b.amenities || []), b.status === 'inactive' ? 'inactive' : 'active',
    ]
  );
  await writeAudit({ actor: req.user, action: 'hotel.room.create', entity: 'hotel_rooms', entityId: id, details: { room_name: b.room_name }, req });
  res.status(201);
  const [[row]] = await pool.query('SELECT * FROM hotel_rooms WHERE id = ?', [id]);
  sendSuccess(res, row, 'Room created successfully', 201);
}));

router.put('/rooms/:id', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT * FROM hotel_rooms WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Room not found');
  const b = req.body || {};

  const fields = {
    room_name: b.room_name, bed_type: b.bed_type, room_size: b.room_size, view: b.view,
    max_adults: b.max_adults, max_children: b.max_children, available_rooms: b.available_rooms,
    ep_rate: b.ep_rate, cp_rate: b.cp_rate, map_rate: b.map_rate, ap_rate: b.ap_rate,
    image_url: b.image_url, status: b.status,
  };
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (b.amenities !== undefined) { sets.push('amenities = ?'); params.push(JSON.stringify(b.amenities)); }
  if (!sets.length) throw ApiError.badRequest('No fields to update');

  await pool.query(`UPDATE hotel_rooms SET ${sets.join(', ')} WHERE id = ?`, [...params, req.params.id]);
  await writeAudit({ actor: req.user, action: 'hotel.room.update', entity: 'hotel_rooms', entityId: req.params.id, details: {}, req });
  const [[updated]] = await pool.query('SELECT * FROM hotel_rooms WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated, 'Room updated successfully');
}));

router.delete('/rooms/:id', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const [[row]] = await pool.query('SELECT id FROM hotel_rooms WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Room not found');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM hotel_reservations WHERE room_id = ?', [req.params.id]);
  if (num(n) > 0) throw ApiError.conflict('Cannot delete: reservations exist for this room');
  await pool.query('DELETE FROM hotel_rooms WHERE id = ?', [req.params.id]);
  await writeAudit({ actor: req.user, action: 'hotel.room.delete', entity: 'hotel_rooms', entityId: req.params.id, details: {}, req });
  sendSuccess(res, { id: req.params.id }, 'Room deleted successfully');
}));

/* ============ RESERVATIONS ============ */

router.get('/reservations', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('h.booking_status = ?'); params.push(req.query.status); }
  if (req.query.property_id) { where.push('h.property_id = ?'); params.push(req.query.property_id); }
  if (req.query.search) {
    where.push('(h.reservation_code LIKE ? OR h.guest_name LIKE ? OR h.guest_phone LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hotel_reservations h ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT h.*, p.name AS property_name, r.room_name
       FROM hotel_reservations h
       JOIN hotel_properties p ON p.id = h.property_id
       JOIN hotel_rooms r ON r.id = h.room_id
       ${whereSql}
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  sendPaginated(res, { items: rows, total, page, limit, message: 'Reservations fetched successfully' });
}));

router.get('/reservations/:id', asyncHandler(async (req, res) => {
  const key = /^\d+$/.test(req.params.id) ? 'h.id' : 'h.reservation_code';
  const [rows] = await pool.query(
    `SELECT h.*, p.name AS property_name, p.location AS property_location, r.room_name
       FROM hotel_reservations h
       JOIN hotel_properties p ON p.id = h.property_id
       JOIN hotel_rooms r ON r.id = h.room_id
      WHERE ${key} = ?`,
    [req.params.id]
  );
  if (!rows.length) throw ApiError.notFound('Reservation not found');
  sendSuccess(res, rows[0], 'Reservation fetched successfully');
}));

const ADMIN_RESERVATION_STATUSES = ['COMPLETED', 'NO_SHOW', 'CANCELLED'];

router.patch('/reservations/:id/status', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const status = (req.body || {}).status;
  if (!ADMIN_RESERVATION_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of ${ADMIN_RESERVATION_STATUSES.join(', ')}`);
  }
  const key = /^\d+$/.test(req.params.id) ? 'id' : 'reservation_code';
  const [rows] = await pool.query(`SELECT * FROM hotel_reservations WHERE ${key} = ?`, [req.params.id]);
  if (!rows.length) throw ApiError.notFound('Reservation not found');
  const r = rows[0];
  if (r.booking_status === 'CANCELLED' && status !== 'CANCELLED') {
    throw ApiError.badRequest('Cancelled reservation status cannot be changed');
  }

  await pool.query('UPDATE hotel_reservations SET booking_status = ? WHERE id = ?', [status, r.id]);
  await writeAudit({ actor: req.user, action: 'hotel.reservation.status', entity: 'hotel_reservations', entityId: r.id, details: { from: r.booking_status, to: status }, req });
  const [[updated]] = await pool.query('SELECT * FROM hotel_reservations WHERE id = ?', [r.id]);
  sendSuccess(res, updated, `Reservation marked ${status}`);
}));

/* ============ REVIEWS ============ */

router.get('/reviews', asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('rv.status = ?'); params.push(req.query.status); }
  if (req.query.property_id) { where.push('rv.property_id = ?'); params.push(req.query.property_id); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hotel_reviews rv ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT rv.*, p.name AS property_name, u.name AS guest_name, u.email AS guest_email
       FROM hotel_reviews rv
       JOIN hotel_properties p ON p.id = rv.property_id
       LEFT JOIN users u ON u.id = rv.user_id
       ${whereSql}
      ORDER BY rv.created_at DESC, rv.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  sendPaginated(res, { items: rows.map((r) => ({ ...serializeReview(r), property_name: r.property_name, guest_name: r.guest_name })), total, page, limit, message: 'Reviews fetched successfully' });
}));

router.patch('/reviews/:id/status', requirePermission('hotel.manage'), asyncHandler(async (req, res) => {
  const status = (req.body || {}).status;
  if (!['published', 'hidden'].includes(status)) throw ApiError.badRequest('status must be published or hidden');
  const [[row]] = await pool.query('SELECT * FROM hotel_reviews WHERE id = ?', [req.params.id]);
  if (!row) throw ApiError.notFound('Review not found');
  await pool.query('UPDATE hotel_reviews SET status = ? WHERE id = ?', [status, req.params.id]);
  await writeAudit({ actor: req.user, action: 'hotel.review.status', entity: 'hotel_reviews', entityId: row.id, details: { from: row.status, to: status }, req });
  const [[updated]] = await pool.query('SELECT * FROM hotel_reviews WHERE id = ?', [req.params.id]);
  sendSuccess(res, serializeReview(updated), `Review ${status}`);
}));

/* ============ STATS ============ */

router.get('/stats', asyncHandler(async (req, res) => {
  const [[prop]] = await pool.query(
    `SELECT COUNT(*) AS total_properties, SUM(status = 'active') AS active_properties FROM hotel_properties`
  );
  const [[resv]] = await pool.query(
    `SELECT COUNT(*) AS total_reservations,
            SUM(booking_status = 'CONFIRMED') AS confirmed,
            SUM(booking_status = 'COMPLETED') AS completed,
            SUM(booking_status = 'CANCELLED') AS cancelled,
            SUM(booking_status = 'NO_SHOW') AS no_show,
            COALESCE(SUM(CASE WHEN booking_status IN ('CONFIRMED','COMPLETED') THEN total_amount END), 0) AS total_revenue
       FROM hotel_reservations`
  );
  const [[rev]] = await pool.query(
    `SELECT COUNT(*) AS total_reviews, AVG(overall_rating) AS avg_rating FROM hotel_reviews WHERE status = 'published'`
  );
  const [[rooms]] = await pool.query(
    `SELECT COUNT(*) AS total_rooms, SUM(status = 'active') AS active_rooms FROM hotel_rooms`
  );

  sendSuccess(res, {
    total_properties: num(prop.total_properties),
    active_properties: num(prop.active_properties),
    total_rooms: num(rooms.total_rooms),
    active_rooms: num(rooms.active_rooms),
    total_reservations: num(resv.total_reservations),
    confirmed: num(resv.confirmed),
    completed: num(resv.completed),
    cancelled: num(resv.cancelled),
    no_show: num(resv.no_show),
    total_revenue: num(resv.total_revenue),
    total_reviews: num(rev.total_reviews),
    avg_rating: rev.avg_rating != null ? Math.round(Number(rev.avg_rating) * 10) / 10 : null,
  }, 'Hotel stats fetched successfully');
}));

module.exports = router;
