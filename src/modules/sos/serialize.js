// SOS response serializers — public API contract (uppercase status/priority, nested shapes)
const { byId } = require('./categories.const');

const STATUS_UPPER = {
  open: 'OPEN',
  acknowledged: 'ACKNOWLEDGED',
  dispatched: 'DISPATCHED',
  in_progress: 'IN_PROGRESS',
  resolved: 'RESOLVED',
  closed: 'CLOSED',
  cancelled: 'CANCELLED',
};

const PRIORITY_UPPER = { high: 'HIGH', critical: 'HIGH_CRITICAL' };

const upperStatus = (s) => STATUS_UPPER[s] || String(s || '').toUpperCase();
const upperPriority = (p) => PRIORITY_UPPER[p] || String(p || '').toUpperCase();

// haversine km
const haversineKm = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ETA: distance/40kmh + 5min base; null coords → 10 min default; cap 90 min
const estimateEta = (lat1, lon1, lat2, lon2) => {
  const km = haversineKm(lat1, lon1, lat2, lon2);
  if (km == null) return '10 mins';
  const mins = Math.min(90, Math.max(5, Math.round((km / 40) * 60 + 5)));
  return `${mins} mins`;
};

const serializeResponder = (r, { lat, lng } = {}) => {
  if (!r) return null;
  return {
    unit_name: r.unit_name,
    contact_no: r.contact_no,
    vehicle_no: r.vehicle_no || null,
    driver_name: r.driver_name || null,
    estimated_eta: estimateEta(lat, lng, r.latitude, r.longitude),
  };
};

// Public track/dispatch response ticket core
const serializeTicket = (row) => {
  if (!row) return null;
  const cat = row.category_id ? byId(row.category_id) : null;
  const isForOther = Boolean(row.is_for_other);
  const patientName =
    row.other_person_name && row.relationship
      ? `${row.other_person_name} (${row.relationship})`
      : row.other_person_name || null;

  return {
    id: row.id,
    ticket_no: row.ticket_no,
    category: cat ? cat.name : row.category_name || null,
    category_id: row.category_id || null,
    category_code: cat ? cat.code : null,
    status: upperStatus(row.status),
    priority: upperPriority(row.priority),
    description: row.description,
    dispatched_at: row.created_at,
    requester: {
      phone: row.requester_phone || row.customer_phone || null,
      location: row.requester_location || row.address || null,
    },
    patient: {
      is_for_other: isForOther,
      name: isForOther ? patientName : null,
      phone: isForOther ? row.other_person_phone || null : null,
      exact_location: row.patient_location || null,
    },
    photo_url: row.photo_url || null,
    special_instructions: row.special_instructions || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    assigned_responder: row._responder || null,
    cancelled_at: row.cancelled_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

// History list item (lighter)
const serializeHistoryItem = (row) => ({
  id: row.id,
  ticket_no: row.ticket_no,
  category: row.category_name || (row.category_id ? byId(row.category_id)?.name : null) || null,
  status: upperStatus(row.status),
  priority: upperPriority(row.priority),
  description: row.description,
  requester_location: row.requester_location || row.address || null,
  cancelled_at: row.cancelled_at || null,
  created_at: row.created_at,
});

module.exports = {
  STATUS_UPPER,
  PRIORITY_UPPER,
  upperStatus,
  upperPriority,
  haversineKm,
  estimateEta,
  serializeResponder,
  serializeTicket,
  serializeHistoryItem,
};
