const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { authMiddleware } = require('../../middlewares/auth');
const { writeAudit } = require('../../utils/audit');
const { HOTEL_CATEGORIES, CATEGORY_IDS, MEAL_PLANS, STAR_RATINGS } = require('./categories.const');
const {
  j, num, rateFor,
  serializePropertyListItem, serializePropertyDetail, serializeRoom,
  serializeReservationCreated, serializeReservationListItem, serializeVoucher, serializeReview,
} = require('./serialize');
const { generateVoucherPdf, pdfUrl, pdfExists } = require('../../utils/hotelVoucher');

const catTitle = (id) => (HOTEL_CATEGORIES.find((c) => c.id === id) || {}).title || id;

/* ================= GET /categories — stay categories ================= */
router.get('/categories', asyncHandler(async (req, res) => {
  sendSuccess(res, HOTEL_CATEGORIES, 'Stay categories retrieved successfully');
}));

/* ================= GET /properties — search & filter ================= */
router.get('/properties', asyncHandler(async (req, res) => {
  const q = req.query;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(q.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const where = [`p.status = 'active'`];
  const params = [];

  const city = (q.city || q.destination || '').trim();
  if (city) {
    where.push('(p.city LIKE ? OR p.location LIKE ?)');
    params.push(`%${city}%`, `%${city}%`);
  }
  if (q.category_id && q.category_id !== 'all') {
    where.push('p.category_id = ?');
    params.push(q.category_id);
  }
  if (q.star_rating && q.star_rating !== 'all') {
    where.push('p.star_rating = ?');
    params.push(q.star_rating);
  }

  // starting tariff = min EP rate across active rooms
  const startingTariff = `(SELECT MIN(r.ep_rate) FROM hotel_rooms r WHERE r.property_id = p.id AND r.status = 'active')`;
  if (q.min_price) {
    where.push(`${startingTariff} >= ?`);
    params.push(Number(q.min_price));
  }
  if (q.max_price) {
    where.push(`${startingTariff} <= ?`);
    params.push(Number(q.max_price));
  }

  // amenities: comma tokens matched against amenities + key_amenities (loose, _ → space)
  if (q.amenities) {
    for (const raw of String(q.amenities).split(',').map((s) => s.trim()).filter(Boolean)) {
      const t1 = `%${raw}%`;
      const t2 = `%${raw.replace(/_/g, ' ')}%`;
      where.push('(JSON_EXTRACT(p.amenities, "$") LIKE ? OR JSON_EXTRACT(p.key_amenities, "$") LIKE ? OR JSON_EXTRACT(p.amenities, "$") LIKE ?)');
      params.push(t1, t2, t2);
    }
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const sortMap = {
    recommended: 'p.popular_score DESC, p.guest_rating DESC',
    price_low: 'starting_tariff ASC',
    price_high: 'starting_tariff DESC',
    rating: 'p.guest_rating DESC',
  };
  const orderBy = sortMap[q.sort_by] || sortMap.recommended;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM hotel_properties p ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT p.*, ${startingTariff} AS starting_tariff
       FROM hotel_properties p ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  sendSuccess(res, {
    total,
    items: rows.map((r) => ({ ...serializePropertyListItem(r), category_id: r.category_id })),
  }, 'Properties fetched successfully');
}));

/* ================= GET /properties/:id — detail ================= */
router.get('/properties/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.* FROM hotel_properties p WHERE p.id = ? AND p.status = 'active'`,
    [req.params.id]
  );
  if (!rows.length) throw ApiError.notFound('Property not found');
  const data = serializePropertyDetail({ ...rows[0], category_title: catTitle(rows[0].category_id) });
  sendSuccess(res, data, 'Property fetched successfully');
}));

/* ================= GET /properties/:id/rooms — tariffs (EP/CP/MAP/AP) ================= */
router.get('/properties/:id/rooms', asyncHandler(async (req, res) => {
  const [props] = await pool.query(`SELECT id FROM hotel_properties WHERE id = ? AND status = 'active'`, [req.params.id]);
  if (!props.length) throw ApiError.notFound('Property not found');

  const { check_in, check_out } = req.query;
  const [rooms] = await pool.query(
    `SELECT * FROM hotel_rooms WHERE property_id = ? AND status = 'active' ORDER BY ep_rate ASC`,
    [req.params.id]
  );

  // overlap counts per room when dates given
  const bookedMap = {};
  if (check_in && check_out && rooms.length) {
    const ids = rooms.map((r) => r.id);
    const [booked] = await pool.query(
      `SELECT room_id, SUM(number_of_rooms) AS booked
         FROM hotel_reservations
        WHERE room_id IN (?) AND booking_status = 'CONFIRMED'
          AND check_in_date < ? AND check_out_date > ?
        GROUP BY room_id`,
      [ids, check_out, check_in]
    );
    for (const b of booked) bookedMap[b.room_id] = num(b.booked);
  }

  sendSuccess(res, rooms.map((r) => serializeRoom(r, bookedMap[r.id] || 0)), 'Rooms fetched successfully');
}));

/* ================= POST /reservations — create booking ================= */
router.post('/reservations', authMiddleware, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { property_id, room_id, meal_plan, check_in_date, check_out_date, guest_name } = b;
  if (!property_id || !room_id || !meal_plan || !check_in_date || !check_out_date || !guest_name) {
    throw ApiError.badRequest('property_id, room_id, meal_plan, check_in_date, check_out_date and guest_name are required');
  }
  if (!MEAL_PLANS[meal_plan]) throw ApiError.badRequest('meal_plan must be one of EP, CP, MAP, AP');

  const ci = new Date(`${check_in_date}T00:00:00Z`);
  const co = new Date(`${check_out_date}T00:00:00Z`);
  if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime())) throw ApiError.badRequest('Dates must be YYYY-MM-DD');
  if (co <= ci) throw ApiError.badRequest('check_out_date must be after check_in_date');
  const nights = Math.round((co - ci) / 86400000);

  const numRooms = Math.max(1, parseInt(b.number_of_rooms, 10) || 1);
  const adults = Math.max(1, parseInt(b.adults, 10) || 1);
  const children = Math.max(0, parseInt(b.children, 10) || 0);

  const [props] = await pool.query(`SELECT * FROM hotel_properties WHERE id = ? AND status = 'active'`, [property_id]);
  if (!props.length) throw ApiError.notFound('Property not found');
  const property = props[0];

  const [rooms] = await pool.query(`SELECT * FROM hotel_rooms WHERE id = ? AND property_id = ? AND status = 'active'`, [room_id, property_id]);
  if (!rooms.length) throw ApiError.notFound('Room not found');
  const room = rooms[0];

  if (adults > num(room.max_adults) * numRooms) {
    throw ApiError.badRequest(`Selected room(s) accommodate max ${num(room.max_adults) * numRooms} adults`);
  }

  // availability: overlapping CONFIRMED bookings
  const [[{ booked }]] = await pool.query(
    `SELECT COALESCE(SUM(number_of_rooms), 0) AS booked
       FROM hotel_reservations
      WHERE room_id = ? AND booking_status = 'CONFIRMED'
        AND check_in_date < ? AND check_out_date > ?`,
    [room_id, check_out_date, check_in_date]
  );
  if (num(booked) + numRooms > num(room.available_rooms)) {
    throw ApiError.conflict('Selected room category is sold out for these dates.');
  }

  // pricing
  const rate = rateFor(room, meal_plan);
  const roomTariff = Math.round(rate * nights * numRooms * 100) / 100;
  const taxes = Math.round(roomTariff * 0.18 * 100) / 100;
  const total = Math.round((roomTariff + taxes + 0) * 100) / 100;
  const paymentMethod = b.payment_method === 'online' ? 'online' : 'pay_at_hotel';

  // reservation code VCB-<year>-<6digit>
  let code;
  for (let t = 0; t < 20; t++) {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM hotel_reservations');
    const base = String(num(n) + 1).padStart(6, '0');
    code = `VCB-${new Date().getFullYear()}-${base}`;
    const [[dup]] = await pool.query('SELECT id FROM hotel_reservations WHERE reservation_code = ?', [code]);
    if (!dup) break;
    code = null;
  }
  if (!code) code = `VCB-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

  const paymentStatus = paymentMethod === 'online' ? 'PAID' : 'PAY_AT_PROPERTY';

  const [result] = await pool.query(
    `INSERT INTO hotel_reservations
       (reservation_code, user_id, property_id, room_id, meal_plan, check_in_date, check_out_date,
        number_of_nights, number_of_rooms, adults, children, guest_name, guest_phone, guest_email,
        special_requests, payment_method, payment_status, booking_status,
        room_tariff, taxes_gst, extras, total_amount)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,0,?)`,
    [
      code, req.user.id, property_id, room_id, meal_plan, check_in_date, check_out_date,
      nights, numRooms, adults, children, guest_name, b.guest_phone || null, b.guest_email || null,
      b.special_requests || null, paymentMethod, paymentStatus, roomTariff, taxes, total,
    ]
  );

  const [[row]] = await pool.query('SELECT * FROM hotel_reservations WHERE id = ?', [result.insertId]);

  // voucher PDF (best-effort — booking succeeds even if PDF fails)
  try {
    const rel = await generateVoucherPdf(row, property, room);
    await pool.query('UPDATE hotel_reservations SET voucher_pdf_path = ? WHERE id = ?', [rel, row.id]);
    row.voucher_pdf_path = rel;
  } catch (e) {
    // keep booking; voucher URL null
  }

  await writeAudit({
    actor: req.user, action: 'hotel.reservation.create', entity: 'hotel_reservations',
    entityId: row.id, details: { reservation_code: code, property_id, room_id, total }, req,
  });

  res.status(201);
  sendSuccess(res, serializeReservationCreated(row, property, room), 'Hotel reservation confirmed successfully', 201);
}));

/* ================= GET /reservations/:id/voucher ================= */
router.get('/reservations/:id/voucher', authMiddleware, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT h.*, p.name AS p_name, p.location AS p_location, p.check_in_time, p.check_out_time, p.status AS p_status
       FROM hotel_reservations h
       JOIN hotel_properties p ON p.id = h.property_id
      WHERE h.reservation_code = ? AND h.user_id = ?`,
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw ApiError.notFound('Reservation not found');
  const r = rows[0];

  const [rooms] = await pool.query('SELECT * FROM hotel_rooms WHERE id = ?', [r.room_id]);
  const room = rooms[0] || { room_name: 'Room' };

  const property = {
    name: r.p_name, location: r.p_location,
    check_in_time: r.check_in_time, check_out_time: r.check_out_time,
  };

  // ensure PDF exists (regenerate if path missing or file deleted)
  if (!r.voucher_pdf_path || !pdfExists(r.reservation_code)) {
    try {
      const rel = await generateVoucherPdf(r, property, room);
      await pool.query('UPDATE hotel_reservations SET voucher_pdf_path = ? WHERE id = ?', [rel, r.id]);
      r.voucher_pdf_path = rel;
    } catch (e) { /* null url */ }
  }

  const data = serializeVoucher(r, property, room);
  if (data.voucher_pdf_download_url && r.voucher_pdf_path) {
    const code = r.reservation_code;
    data.voucher_pdf_download_url = pdfUrl(code);
  }
  sendSuccess(res, data, 'Voucher fetched successfully');
}));

/* ================= GET /my-reservations ================= */
router.get('/my-reservations', authMiddleware, asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const where = ['h.user_id = ?'];
  const params = [req.user.id];
  const status = (req.query.status || 'all').toUpperCase();
  if (status !== 'ALL') {
    where.push('h.booking_status = ?');
    params.push(status);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM hotel_reservations h ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT h.*, p.name AS property_name, p.main_image
       FROM hotel_reservations h
       JOIN hotel_properties p ON p.id = h.property_id
       ${whereSql}
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  sendSuccess(res, { total, items: rows.map(serializeReservationListItem) }, 'Reservations fetched successfully');
}));

/* ================= POST /reservations/:id/cancel ================= */
router.post('/reservations/:id/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM hotel_reservations WHERE reservation_code = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) throw ApiError.notFound('Reservation not found');
  const r = rows[0];

  if (r.booking_status !== 'CONFIRMED') {
    throw ApiError.badRequest(`Reservation cannot be cancelled in status "${r.booking_status}"`);
  }

  const reason = (req.body && req.body.cancellation_reason) || null;
  const cancelledAt = new Date();
  await pool.query(
    `UPDATE hotel_reservations SET booking_status = 'CANCELLED', cancellation_reason = ?, cancelled_at = ? WHERE id = ?`,
    [reason, cancelledAt, r.id]
  );

  await writeAudit({
    actor: req.user, action: 'hotel.reservation.cancel', entity: 'hotel_reservations',
    entityId: r.id, details: { reservation_code: r.reservation_code, reason }, req,
  });

  sendSuccess(res, {
    reservation_id: r.reservation_code,
    status: 'CANCELLED',
    refund_amount: 0,
    cancelled_at: cancelledAt,
  }, 'Reservation cancelled successfully.');
}));

/* ================= POST /properties/:id/reviews ================= */
const RATING_FIELDS = [
  'overall_rating', 'cleanliness_rating', 'room_comfort_rating', 'staff_behaviour_rating',
  'food_quality_rating', 'amenities_rating', 'value_for_money_rating',
];

router.post('/properties/:id/reviews', authMiddleware, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const propertyId = req.params.id;

  const [props] = await pool.query('SELECT * FROM hotel_properties WHERE id = ?', [propertyId]);
  if (!props.length) throw ApiError.notFound('Property not found');
  const property = props[0];

  if (!b.reservation_id) throw ApiError.badRequest('reservation_id is required');

  const [resRows] = await pool.query(
    'SELECT * FROM hotel_reservations WHERE reservation_code = ? AND user_id = ? AND property_id = ?',
    [b.reservation_id, req.user.id, propertyId]
  );
  if (!resRows.length) throw ApiError.notFound('Reservation not found');
  const reservation = resRows[0];

  const today = new Date().toISOString().slice(0, 10);
  const stayDone = reservation.booking_status === 'COMPLETED'
    || (reservation.booking_status === 'CONFIRMED' && reservation.check_out_date <= today);
  if (!stayDone) throw ApiError.badRequest('You can review only after the stay is completed');

  const [existing] = await pool.query('SELECT id FROM hotel_reviews WHERE reservation_id = ?', [reservation.id]);
  if (existing.length) throw ApiError.conflict('You have already reviewed this stay');

  for (const f of RATING_FIELDS) {
    const v = Number(b[f]);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw ApiError.badRequest(`${f} must be an integer between 1 and 5`);
  }

  const [result] = await pool.query(
    `INSERT INTO hotel_reviews
       (reservation_id, property_id, user_id, overall_rating, cleanliness_rating, room_comfort_rating,
        staff_behaviour_rating, food_quality_rating, amenities_rating, value_for_money_rating,
        review_text, stay_type, would_recommend)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      reservation.id, propertyId, req.user.id,
      Number(b.overall_rating), Number(b.cleanliness_rating), Number(b.room_comfort_rating),
      Number(b.staff_behaviour_rating), Number(b.food_quality_rating), Number(b.amenities_rating),
      Number(b.value_for_money_rating),
      b.review_text || null, b.stay_type || null, b.would_recommend === false ? 0 : 1,
    ]
  );

  // weighted update of property aggregates (preserves seeded baseline)
  const oldRating = num(property.guest_rating);
  const oldCount = num(property.reviews_count);
  const newAvg = Math.round(((oldRating * oldCount + Number(b.overall_rating)) / (oldCount + 1)) * 10) / 10;
  await pool.query(
    'UPDATE hotel_properties SET guest_rating = ?, reviews_count = ? WHERE id = ?',
    [newAvg, oldCount + 1, propertyId]
  );

  res.status(201);
  sendSuccess(res, {
    review_id: `rev-${result.insertId}`,
    property_id: propertyId,
    average_rating: newAvg,
    created_at: new Date(),
  }, 'Thank you! Your verified stay review has been published.', 201);
}));

module.exports = router;
