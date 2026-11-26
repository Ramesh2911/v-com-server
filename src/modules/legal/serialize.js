// Legal & Advisory response serializers (UPPERCASE status, nested advocate)
const { byId } = require('./categories.const');

const STATUS_UPPER = {
  request_received: 'REQUEST_RECEIVED',
  advocate_assigned: 'ADVOCATE_ASSIGNED',
  in_consultation: 'IN_CONSULTATION',
  resolved: 'RESOLVED',
  cancelled: 'CANCELLED',
};

const upperStatus = (s) => STATUS_UPPER[s] || String(s || '').toUpperCase();

const serializeAdvocate = (a) => {
  if (!a) return null;
  return {
    name: a.name,
    specialization: a.specialization,
    contact_status: a.contact_status,
    phone: a.phone || null,
  };
};

// Public track / request response
const serializeTicket = (row) => {
  if (!row) return null;
  const cat = byId(row.category_id);
  return {
    id: row.id,
    ticket_no: row.ticket_no,
    category: row.category_name || (cat ? cat.title : null),
    category_id: row.category_id,
    category_code: cat ? cat.code : null,
    location: row.location,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    other_query: row.other_query || null,
    status: upperStatus(row.status),
    assigned_advocate: row._advocate || null,
    submitted_at: row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at || null,
    cancelled_at: row.cancelled_at || null,
  };
};

// History list item (lighter)
const serializeHistoryItem = (row) => ({
  id: row.id,
  ticket_no: row.ticket_no,
  category: row.category_name || null,
  location: row.location,
  status: upperStatus(row.status),
  created_at: row.created_at,
});

module.exports = { STATUS_UPPER, upperStatus, serializeAdvocate, serializeTicket, serializeHistoryItem };
