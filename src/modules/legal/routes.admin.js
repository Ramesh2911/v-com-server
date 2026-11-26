const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');
const { byId } = require('./categories.const');
const { upperStatus, serializeAdvocate } = require('./serialize');

router.use(authMiddleware, requirePermission('requests.view'));

const LEGAL_STATUSES = ['request_received', 'advocate_assigned', 'in_consultation', 'resolved', 'cancelled'];
// allowed transitions
const TRANSITIONS = {
  request_received: ['advocate_assigned', 'cancelled'],
  advocate_assigned: ['in_consultation', 'resolved', 'cancelled'],
  in_consultation: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

// ---------- Advocates (register BEFORE /tickets to avoid shadowing) ----------

router.get(
  '/advocates',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND a.status = ?';
      params.push(req.query.status);
    }
    if (req.query.category_id) {
      where += ' AND a.category_id = ?';
      params.push(Number(req.query.category_id));
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM legal_advocates a ${where}`, params);
    const [rows] = await pool.query(
      `SELECT a.* FROM legal_advocates a ${where} ORDER BY a.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const items = rows.map((r) => ({
      ...r,
      category_name: r.category_id ? byId(r.category_id)?.title || null : null,
      category_code: r.category_id ? byId(r.category_id)?.code || null : null,
    }));
    sendPaginated(res, { items, total, page, limit, message: 'Advocates fetched' });
  })
);

router.post(
  '/advocates',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const specialization = String(b.specialization || '').trim();
    if (!name) throw ApiError.badRequest('name is required');
    if (!specialization) throw ApiError.badRequest('specialization is required');
    if (b.category_id != null && b.category_id !== '' && !byId(b.category_id)) {
      throw ApiError.badRequest('Invalid category_id');
    }
    const categoryId = b.category_id != null && b.category_id !== '' ? Number(b.category_id) : null;
    const status = ['active', 'inactive'].includes(b.status) ? b.status : 'active';

    const [result] = await pool.query(
      `INSERT INTO legal_advocates (category_id, name, specialization, contact_status, phone, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        name,
        specialization,
        String(b.contact_status || 'Will call at registered number').trim(),
        b.phone || null,
        status,
      ]
    );
    await writeAudit({
      actor: req.user,
      action: 'legal.advocate.create',
      entity: 'legal_advocates',
      entityId: result.insertId,
      details: { name },
      req,
    });
    const [rows] = await pool.query('SELECT * FROM legal_advocates WHERE id = ?', [result.insertId]);
    sendSuccess(res, rows[0], 'Advocate created', 201);
  })
);

router.put(
  '/advocates/:id',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const [exist] = await pool.query('SELECT * FROM legal_advocates WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Advocate not found');
    const cur = exist[0];
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    const specialization = b.specialization !== undefined ? String(b.specialization).trim() : cur.specialization;
    if (!name) throw ApiError.badRequest('name is required');
    if (!specialization) throw ApiError.badRequest('specialization is required');
    let categoryId = cur.category_id;
    if (b.category_id !== undefined) {
      if (b.category_id === null || b.category_id === '') categoryId = null;
      else {
        if (!byId(b.category_id)) throw ApiError.badRequest('Invalid category_id');
        categoryId = Number(b.category_id);
      }
    }
    const status = b.status !== undefined ? b.status : cur.status;
    if (!['active', 'inactive'].includes(status)) throw ApiError.badRequest('Invalid status');

    await pool.query(
      `UPDATE legal_advocates SET category_id = ?, name = ?, specialization = ?, contact_status = ?, phone = ?, status = ? WHERE id = ?`,
      [
        categoryId,
        name,
        specialization,
        b.contact_status !== undefined ? b.contact_status : cur.contact_status,
        b.phone !== undefined ? b.phone : cur.phone,
        status,
        req.params.id,
      ]
    );
    await writeAudit({
      actor: req.user,
      action: 'legal.advocate.update',
      entity: 'legal_advocates',
      entityId: Number(req.params.id),
      details: { name },
      req,
    });
    const [rows] = await pool.query('SELECT * FROM legal_advocates WHERE id = ?', [req.params.id]);
    sendSuccess(res, rows[0], 'Advocate updated');
  })
);

router.patch(
  '/advocates/:id/status',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) throw ApiError.badRequest('Invalid status');
    const [exist] = await pool.query('SELECT id FROM legal_advocates WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Advocate not found');
    await pool.query('UPDATE legal_advocates SET status = ? WHERE id = ?', [status, req.params.id]);
    await writeAudit({
      actor: req.user,
      action: 'legal.advocate.status',
      entity: 'legal_advocates',
      entityId: Number(req.params.id),
      details: { status },
      req,
    });
    sendSuccess(res, null, 'Advocate status updated');
  })
);

router.delete(
  '/advocates/:id',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const [exist] = await pool.query('SELECT id FROM legal_advocates WHERE id = ?', [req.params.id]);
    if (!exist.length) throw ApiError.notFound('Advocate not found');
    await pool.query('DELETE FROM legal_advocates WHERE id = ?', [req.params.id]);
    await writeAudit({
      actor: req.user,
      action: 'legal.advocate.delete',
      entity: 'legal_advocates',
      entityId: Number(req.params.id),
      req,
    });
    sendSuccess(res, null, 'Advocate deleted');
  })
);

// ---------- Tickets ----------

router.get(
  '/tickets',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND t.status = ?';
      params.push(req.query.status);
    }
    if (req.query.category_id) {
      where += ' AND t.category_id = ?';
      params.push(Number(req.query.category_id));
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (t.ticket_no LIKE ? OR u.name LIKE ? OR u.phone LIKE ? OR t.category_name LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM legal_tickets t JOIN users u ON u.id = t.customer_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT t.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
              a.name AS advocate_name, a.specialization AS advocate_specialization,
              a.contact_status AS advocate_contact_status, a.phone AS advocate_phone
         FROM legal_tickets t
         JOIN users u ON u.id = t.customer_id
         LEFT JOIN legal_advocates a ON a.id = t.advocate_id
        ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const items = rows.map((row) => ({
      ...row,
      status: upperStatus(row.status),
      category_code: byId(row.category_id)?.code || null,
      assigned_advocate:
        row.advocate_id != null
          ? serializeAdvocate({
              name: row.advocate_name,
              specialization: row.advocate_specialization,
              contact_status: row.advocate_contact_status,
              phone: row.advocate_phone,
            })
          : null,
    }));
    sendPaginated(res, { items, total, page, limit });
  })
);

router.get(
  '/tickets/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT t.*, u.name AS customer_name, u.phone AS customer_phone, u.email AS customer_email
         FROM legal_tickets t JOIN users u ON u.id = t.customer_id
        WHERE t.id = ? OR t.ticket_no = ?`,
      [req.params.id, req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Legal ticket not found');
    const row = rows[0];
    row.status = upperStatus(row.status);
    row.category_code = byId(row.category_id)?.code || null;

    let advocate = null;
    if (row.advocate_id != null) {
      const [a] = await pool.query('SELECT * FROM legal_advocates WHERE id = ?', [row.advocate_id]);
      advocate = serializeAdvocate(a[0] || null);
    }

    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM legal_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.legal_id = ? ORDER BY h.created_at ASC`,
      [row.id]
    );
    sendSuccess(res, {
      ...row,
      assigned_advocate: advocate,
      history: history.map((h) => ({ ...h, status: upperStatus(h.status) })),
    });
  })
);

router.post(
  '/tickets/:id/status',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const { status, note, advocate_id } = req.body || {};
    if (!LEGAL_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM legal_tickets WHERE id = ? OR ticket_no = ?', [
      req.params.id,
      req.params.id,
    ]);
    if (!rows.length) throw ApiError.notFound('Legal ticket not found');
    const ticket = rows[0];

    const allowed = TRANSITIONS[ticket.status] || [];
    if (status !== ticket.status && !allowed.includes(status)) {
      throw ApiError.badRequest(`Cannot transition from ${upperStatus(ticket.status)} to ${upperStatus(status)}`);
    }

    // assigning advocate requires an advocate and sets advocate_assigned
    let finalStatus = status;
    if (advocate_id != null && advocate_id !== '') {
      const [a] = await pool.query('SELECT id FROM legal_advocates WHERE id = ?', [Number(advocate_id)]);
      if (!a.length) throw ApiError.badRequest('Invalid advocate_id');
      if (!['advocate_assigned', 'in_consultation'].includes(status)) {
        throw ApiError.badRequest('advocate_id can only be set with advocate_assigned or in_consultation');
      }
    } else if (status === 'advocate_assigned') {
      throw ApiError.badRequest('advocate_id is required for advocate_assigned');
    }

    const updates = ['status = ?'];
    const params = [finalStatus];
    if (advocate_id != null && advocate_id !== '') {
      updates.push('advocate_id = ?');
      params.push(Number(advocate_id));
    }
    if (finalStatus === 'resolved') updates.push('resolved_at = NOW()');
    if (finalStatus === 'cancelled') updates.push('cancelled_at = NOW()');

    await pool.query(`UPDATE legal_tickets SET ${updates.join(', ')} WHERE id = ?`, [...params, ticket.id]);
    await pool.query(`INSERT INTO legal_status_history (legal_id, status, note, changed_by) VALUES (?, ?, ?, ?)`, [
      ticket.id,
      finalStatus,
      note || null,
      req.user.id,
    ]);
    await notify({
      userId: ticket.customer_id,
      event: 'legal_status_updated',
      type: 'legal',
      title: `Legal Request ${ticket.ticket_no} — ${upperStatus(finalStatus)}`,
      data: { ticket_no: ticket.ticket_no, status: upperStatus(finalStatus) },
    });
    await writeAudit({
      actor: req.user,
      action: 'legal.status',
      entity: 'legal_tickets',
      entityId: ticket.id,
      details: { status: finalStatus, advocate_id: advocate_id || null },
      req,
    });
    sendSuccess(res, null, 'Legal ticket status updated');
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT status, COUNT(*) AS count FROM legal_tickets GROUP BY status');
    const [[{ open }]] = await pool.query(
      `SELECT COUNT(*) AS open FROM legal_tickets WHERE status IN ('request_received','advocate_assigned','in_consultation')`
    );
    sendSuccess(res, { by_status: rows, active: open });
  })
);

module.exports = router;
