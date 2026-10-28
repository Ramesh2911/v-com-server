const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

function getPagination(query = {}) {
  let page = parseInt(query.page || '1', 10);
  let limit = parseInt(query.limit || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { getPagination, DEFAULT_LIMIT, MAX_LIMIT };
