const pool = require('../../config/db');
const ApiError = require('../../utils/ApiError');

const maskName = (name) => {
  if (!name) return 'Customer';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1][0]}.`;
};

async function recomputeVendorRating(vendorId) {
  if (!vendorId) return;
  await pool.query(
    `UPDATE vendors v SET rating = COALESCE((
       SELECT ROUND(AVG(technician_rating), 2) FROM service_reviews
       WHERE vendor_id = ? AND status = 'visible' AND technician_rating IS NOT NULL
     ), 0) WHERE v.id = ?`,
    [vendorId, vendorId]
  );
}

const parseRating = (value, field, required = false) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required (1-5)`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw ApiError.badRequest(`${field} must be an integer between 1 and 5`);
  }
  return n;
};

const parseComment = (value, field) => {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  if (s.length > 2000) throw ApiError.badRequest(`${field} must be 2000 characters or fewer`);
  return s;
};

// Customer/public shape — technician fields intentionally excluded (never shown to customers)
const toCustomerView = (r) =>
  r && {
    id: r.id,
    request_id: r.request_id,
    service_rating: r.service_rating,
    service_comment: r.service_comment,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };

module.exports = { maskName, recomputeVendorRating, parseRating, parseComment, toCustomerView };
