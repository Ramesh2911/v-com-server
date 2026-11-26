const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { authMiddleware } = require('../../middlewares/auth');
const { writeAudit } = require('../../utils/audit');
const { notify, staffWithPermission } = require('../../utils/notify');
const { LEGAL_CATEGORIES, byId } = require('./categories.const');
const { serializeTicket, serializeHistoryItem, serializeAdvocate } = require('./serialize');

// VLA-<year>-<5digit> — e.g. VLA-2026-90412 (doc contract)
async function generateLegalTicketNo() {
  const year = new Date().getFullYear();
  const prefix = `VLA-${year}-`;
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM legal_tickets WHERE ticket_no LIKE ?`,
    [`${prefix}%`]
  );
  // random-ish 5-digit start in 9xxxx range per doc, then sequential fallback
  const base = 90000 + ((n * 7919) % 9999);
  let candidate = `${prefix}${String(base).padStart(5, '0')}`;
  // ensure uniqueness
  for (let i = 0; i < 20; i++) {
    const [[dup]] = await pool.query(`SELECT id FROM legal_tickets WHERE ticket_no = ?`, [candidate]);
    if (!dup) return candidate;
    candidate = `${prefix}${String((Number(candidate.slice(prefix.length)) + 1) % 100000).padStart(5, '0')}`;
  }
  return `${prefix}${String(Date.now() % 100000).padStart(5, '0')}`;
}

const attachAdvocate = async (ticket) => {
  if (!ticket) return ticket;
  if (ticket.advocate_id) {
    const [rows] = await pool.query('SELECT * FROM legal_advocates WHERE id = ?', [ticket.advocate_id]);
    ticket._advocate = serializeAdvocate(rows[0] || null);
  } else {
    ticket._advocate = null;
  }
  return ticket;
};

const loadTicketByNo = async (ticketNo) => {
  const [rows] = await pool.query('SELECT * FROM legal_tickets WHERE ticket_no = ?', [ticketNo]);
  return rows[0] || null;
};

const notifyStaff = async (ticketNo, legalId, category, location) => {
  const staff = await staffWithPermission('requests.manage');
  for (const sid of staff) {
    await notify({
      userId: sid,
      event: 'request_created',
      type: 'legal',
      title: `Legal Request ${ticketNo}`,
      body: `${category} — ${String(location || '').slice(0, 100)}`,
      data: { ticket_no: ticketNo, legal_id: legalId, category },
    });
  }
};

// ---------- 1. GET /categories (public) ----------

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    sendSuccess(res, LEGAL_CATEGORIES, 'Legal categories retrieved successfully');
  })
);

// ---------- 2. POST /request (auth required) ----------

router.post(
  '/request',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const b = req.body || {};

    const category = byId(b.category_id);
    if (!category) throw ApiError.badRequest('Invalid category_id');

    const location = String(b.location || '').trim();
    if (!location) throw ApiError.badRequest('location is required');

    const latitude = b.latitude !== undefined && b.latitude !== '' && b.latitude != null ? Number(b.latitude) : null;
    const longitude = b.longitude !== undefined && b.longitude !== '' && b.longitude != null ? Number(b.longitude) : null;
    if (latitude != null && (Number.isNaN(latitude) || latitude < -90 || latitude > 90)) {
      throw ApiError.badRequest('Invalid latitude');
    }
    if (longitude != null && (Number.isNaN(longitude) || longitude < -180 || longitude > 180)) {
      throw ApiError.badRequest('Invalid longitude');
    }

    // category 8 (OTHER) → other_query required; others → optional (ignored if empty)
    let otherQuery = String(b.other_query || '').trim() || null;
    if (category.requires_custom_input) {
      if (!otherQuery) throw ApiError.badRequest('other_query is required for "Other Legal Advisory"');
    }

    const ticketNo = await generateLegalTicketNo();
    const [result] = await pool.query(
      `INSERT INTO legal_tickets (ticket_no, customer_id, category_id, category_name, location, latitude, longitude, other_query, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'request_received')`,
      [ticketNo, req.user.id, category.id, category.title, location, latitude, longitude, otherQuery]
    );
    await pool.query(
      `INSERT INTO legal_status_history (legal_id, status, note, changed_by) VALUES (?, 'request_received', 'Legal request submitted', ?)`,
      [result.insertId, req.user.id]
    );

    await notifyStaff(ticketNo, result.insertId, category.title, location);
    await writeAudit({
      actor: req.user,
      action: 'legal.request',
      entity: 'legal_tickets',
      entityId: result.insertId,
      details: { ticket_no: ticketNo, category: category.code },
      req,
    });

    const ticket = await loadTicketByNo(ticketNo);
    const payload = serializeTicket(ticket);
    // doc response shape: only these fields
    sendSuccess(
      res,
      {
        ticket_no: payload.ticket_no,
        category: payload.category,
        location: payload.location,
        other_query: payload.other_query,
        status: payload.status,
        submitted_at: payload.submitted_at,
      },
      'Legal assistance request submitted successfully',
      201
    );
  })
);

// ---------- 3. GET /track/:ticket_no (auth + owner) ----------

router.get(
  '/track/:ticket_no',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const ticket = await loadTicketByNo(req.params.ticket_no);
    if (!ticket) throw ApiError.notFound('Legal request not found');
    if (ticket.customer_id !== req.user.id) throw ApiError.notFound('Legal request not found');

    await attachAdvocate(ticket);
    const payload = serializeTicket(ticket);
    sendSuccess(
      res,
      {
        ticket_no: payload.ticket_no,
        category: payload.category,
        location: payload.location,
        status: payload.status,
        assigned_advocate: payload.assigned_advocate,
        created_at: payload.created_at,
      },
      'Legal request tracked successfully'
    );
  })
);

// ---------- 4. GET /history (auth, owner-scoped) ----------

router.get(
  '/history',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM legal_tickets WHERE customer_id = ?', [
      req.user.id,
    ]);
    const [rows] = await pool.query(
      `SELECT * FROM legal_tickets WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
    sendPaginated(res, {
      items: rows.map((r) => serializeHistoryItem(r)),
      total,
      page,
      limit,
      message: 'Legal request history fetched successfully',
    });
  })
);

module.exports = router;
