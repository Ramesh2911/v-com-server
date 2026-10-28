const PREFIXES = {
  request: 'VCOM-REQ',
  sos: 'VCOM-SOS',
  quotation: 'VCOM-QT',
  job: 'VCOM-JOB',
  property: 'VCOM-PROP',
  propertyEnquiry: 'VCOM-ENQ',
  support: 'VCOM-SUP',
  leave: 'VCOM-LV',
};

/**
 * Generate a sequential ticket like VCOM-REQ-000001
 * @param {import('mysql2/promise').Pool} pool
 * @param {keyof typeof PREFIXES} kind
 */
async function generateTicketNo(pool, kind) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`Unknown ticket kind: ${kind}`);

  const tableMap = {
    request: 'requests',
    sos: 'sos_tickets',
    quotation: 'quotations',
    job: 'jobs',
    property: 'properties',
    propertyEnquiry: 'property_enquiries',
    support: 'support_tickets',
    leave: 'leave_requests',
  };
  const table = tableMap[kind];

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt, MAX(id) AS maxId FROM \`${table}\``
  );
  const next = Math.max(rows[0].cnt + 1, (rows[0].maxId || 0) + 1);
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

module.exports = { generateTicketNo, PREFIXES };
