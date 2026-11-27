const { MEAL_PLANS } = require('./categories.const');

const j = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return v;
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch (e) {
    return [];
  }
};

const num = (v) => (v == null ? 0 : Number(v));
const rateFor = (row, plan) => {
  const m = { EP: row.ep_rate, CP: row.cp_rate, MAP: row.map_rate, AP: row.ap_rate };
  return num(m[plan]);
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmtDate = (d) => {
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

const serializeCategory = (c) => ({ ...c });

const serializePropertyListItem = (r) => ({
  id: r.id,
  name: r.name,
  star_rating: r.star_rating,
  category_id: r.category_id,
  property_type: r.property_type || null,
  location: r.location,
  city: r.city,
  guest_rating: num(r.guest_rating),
  reviews_count: num(r.reviews_count),
  starting_tariff: r.starting_tariff != null ? num(r.starting_tariff) : num(r.ep_rate),
  main_image: r.main_image || null,
  key_amenities: j(r.key_amenities),
  has_free_cancellation: !!Number(r.has_free_cancellation),
  has_breakfast_included: !!Number(r.has_breakfast_included),
});

const serializePropertyDetail = (r) => ({
  id: r.id,
  name: r.name,
  star_rating: r.star_rating,
  category: r.category_title || r.category_id,
  property_type: r.property_type || null,
  location: r.location,
  city: r.city,
  gps_coordinates: r.gps_lat != null ? { latitude: num(r.gps_lat), longitude: num(r.gps_lng) } : null,
  guest_rating: num(r.guest_rating),
  reviews_count: num(r.reviews_count),
  description: r.description || null,
  gallery_images: j(r.gallery_images),
  amenities: j(r.amenities),
  policies: {
    check_in_time: r.check_in_time,
    check_out_time: r.check_out_time,
    id_proof_mandatory: !!Number(r.id_proof_mandatory),
    pet_friendly: !!Number(r.pet_friendly),
    cancellation_policy: r.cancellation_policy || null,
  },
});

const serializeRoom = (r, booked = 0) => {
  const available = Math.max(0, num(r.available_rooms) - booked);
  const tariffs = {};
  for (const plan of ['EP', 'CP', 'MAP', 'AP']) {
    tariffs[plan] = {
      plan_name: MEAL_PLANS[plan].plan_name,
      rate_per_night: rateFor(r, plan),
      ...(plan === 'CP' ? { is_recommended: true } : {}),
    };
  }
  return {
    room_id: r.id,
    room_name: r.room_name,
    bed_type: r.bed_type || null,
    room_size: r.room_size || null,
    view: r.view || null,
    max_adults: num(r.max_adults),
    max_children: num(r.max_children),
    available_rooms: available,
    image_url: r.image_url || null,
    amenities: j(r.amenities),
    tariffs,
  };
};

// create-reservation response (doc §5)
const serializeReservationCreated = (r, property, room) => ({
  reservation_id: r.reservation_code,
  property_name: property.name,
  room_name: room.room_name,
  meal_plan: MEAL_PLANS[r.meal_plan].full,
  check_in: r.check_in_date,
  check_out: r.check_out_date,
  duration_nights: num(r.number_of_nights),
  pricing: {
    room_tariff: num(r.room_tariff),
    taxes_gst_18: num(r.taxes_gst),
    extras: num(r.extras),
    total_amount: num(r.total_amount),
    currency: r.currency || 'INR',
  },
  payment_status: r.payment_status,
  booking_status: r.booking_status,
  voucher_pdf_url: r.voucher_pdf_path ? `/uploads/${r.voucher_pdf_path}` : null,
  created_at: r.created_at,
});

// my-reservations list item (doc §7)
const serializeReservationListItem = (r) => ({
  reservation_id: r.reservation_code,
  property_name: r.property_name,
  main_image: r.main_image || null,
  check_in: r.check_in_date,
  check_out: r.check_out_date,
  total_amount: num(r.total_amount),
  status: r.booking_status,
});

// voucher response (doc §6)
const serializeVoucher = (r, property, room) => ({
  reservation_id: r.reservation_code,
  qr_code_data: `VCOM_HOTEL_${r.reservation_code}_VERIFIED`,
  property: {
    name: property.name,
    address: property.location,
    phone: property.phone || '+91 824 244 5555',
  },
  stay_details: {
    guest_name: r.guest_name,
    adults: num(r.adults),
    rooms: num(r.number_of_rooms),
    room_category: room.room_name,
    meal_plan: r.meal_plan,
    check_in: `${fmtDate(r.check_in_date)} (${property.check_in_time})`,
    check_out: `${fmtDate(r.check_out_date)} (${property.check_out_time})`,
  },
  payment_summary: {
    room_tariff: num(r.room_tariff),
    taxes: num(r.taxes_gst),
    total_amount: num(r.total_amount),
    paid_amount: r.payment_method === 'online' && r.payment_status === 'PAID' ? num(r.total_amount) : 0,
    balance_payable_at_hotel:
      r.payment_method === 'online' && r.payment_status === 'PAID' ? 0 : num(r.total_amount),
    status: r.payment_method === 'online' ? 'Paid Online' : 'Pay at Property',
  },
  voucher_pdf_download_url: r.voucher_pdf_path ? `/uploads/${r.voucher_pdf_path}` : null,
});

const serializeReview = (r) => ({
  review_id: `rev-${r.id}`,
  property_id: r.property_id,
  overall_rating: num(r.overall_rating),
  cleanliness_rating: num(r.cleanliness_rating),
  room_comfort_rating: num(r.room_comfort_rating),
  staff_behaviour_rating: num(r.staff_behaviour_rating),
  food_quality_rating: num(r.food_quality_rating),
  amenities_rating: num(r.amenities_rating),
  value_for_money_rating: num(r.value_for_money_rating),
  review_text: r.review_text || null,
  stay_type: r.stay_type || null,
  would_recommend: !!Number(r.would_recommend),
  status: r.status,
  created_at: r.created_at,
});

module.exports = {
  j,
  num,
  rateFor,
  fmtDate,
  serializeCategory,
  serializePropertyListItem,
  serializePropertyDetail,
  serializeRoom,
  serializeReservationCreated,
  serializeReservationListItem,
  serializeVoucher,
  serializeReview,
};
