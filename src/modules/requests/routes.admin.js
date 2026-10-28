const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission, moduleFilterSql, canAccessModule } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { requestUpload, classifyFileType, toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify } = require('../../utils/notify');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('requests.view'));

const ADMIN_SELECT = `
  SELECT r.*,
         m.name AS module_name, m.code AS module_code, c.name AS category_name,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         v.business_name AS vendor_name, vu.name AS vendor_user_name, vu.phone AS vendor_phone,
         (SELECT COUNT(*) FROM request_attachments a WHERE a.request_id = r.id) AS attachment_count,
         (SELECT COUNT(*) FROM quotations q WHERE q.request_id = r.id) AS quotation_count
    FROM requests r
    JOIN service_modules m ON m.id = r.module_id
    LEFT JOIN service_categories c ON c.id = r.category_id
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN vendors v ON v.id = r.assigned_vendor_id
    LEFT JOIN users vu ON vu.id = v.user_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const mod = moduleFilterSql(req.user, 'r');
    let where = `WHERE 1=1 ${mod.sql}`;
    const params = [...mod.params];
    const filters = ['status', 'module_id', 'priority', 'assigned_vendor_id', 'customer_id'];
    for (const f of filters) {
      if (req.query[f]) {
        where += ` AND r.${f} = ?`;
        params.push(req.query[f]);
      }
    }
    if (req.query.from_date) {
      where += ' AND r.created_at >= ?';
      params.push(req.query.from_date);
    }
    if (req.query.to_date) {
      where += ' AND r.created_at <= ?';
      params.push(`${req.query.to_date} 23:59:59`);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (r.ticket_no LIKE ? OR r.title LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM requests r JOIN users u ON u.id = r.customer_id ${where}`,
      params
    );
    const [rows] = await pool.query(`${ADMIN_SELECT} ${where} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params, limit, offset,
    ]);
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const mod = moduleFilterSql(req.user, 'r');
    const [byStatus] = await pool.query(
      `SELECT r.status, COUNT(*) AS count FROM requests r WHERE 1=1 ${mod.sql} GROUP BY r.status`,
      mod.params
    );
    const [byModule] = await pool.query(
      `SELECT m.name AS module_name, m.code, COUNT(r.id) AS count
         FROM service_modules m LEFT JOIN requests r ON r.module_id = m.id
        GROUP BY m.id ORDER BY m.sort_order`,
      []
    );
    sendSuccess(res, { by_status: byStatus, by_module: byModule });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${ADMIN_SELECT} WHERE r.id = ? OR r.ticket_no = ?`, [req.params.id, req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    const row = rows[0];
    if (!canAccessModule(req.user, row.module_code)) throw ApiError.forbidden('No access to this module');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM request_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.request_id = ? ORDER BY h.created_at ASC`,
      [row.id]
    );
    const [files] = await pool.query('SELECT * FROM request_attachments WHERE request_id = ?', [row.id]);
    const [quotations] = await pool.query(
      `SELECT q.*, v.business_name AS vendor_name FROM quotations q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.request_id = ? ORDER BY q.created_at DESC`,
      [row.id]
    );
    const [assignments] = await pool.query(
      `SELECT a.*, v.business_name AS vendor_name, u.name AS assigned_by_name
         FROM request_assignments a
         JOIN vendors v ON v.id = a.vendor_id
         LEFT JOIN users u ON u.id = a.assigned_by
        WHERE a.request_id = ? ORDER BY a.created_at DESC`,
      [row.id]
    );
    sendSuccess(res, {
      ...row,
      history,
      quotations,
      assignments,
      attachments: files.map((f) => ({
        id: f.id, file_type: f.file_type, original_name: f.original_name, url: toPublicUrl(f.file_path),
      })),
    });
  })
);

// admin creates request on behalf of a customer
router.post(
  '/',
  requirePermission('requests.manage'),
  requestUpload.array('attachments', 8),
  asyncHandler(async (req, res) => {
    const { customer_id, module_id, category_id, title, description, site_location, city, quantity, specifications, priority = 'normal' } = req.body;
    const [[cust]] = await pool.query(`SELECT id FROM users WHERE id = ? AND user_type = 'customer'`, [customer_id]);
    if (!cust) throw ApiError.badRequest('Customer not found');
    const [[mod]] = await pool.query('SELECT id, name FROM service_modules WHERE id = ?', [module_id]);
    if (!mod) throw ApiError.badRequest('Module not found');

    const ticketNo = await generateTicketNo(pool, 'request');
    const [result] = await pool.query(
      `INSERT INTO requests (ticket_no, customer_id, module_id, category_id, title, description, site_location, city,
        quantity, specifications, priority, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
      [ticketNo, customer_id, module_id, category_id || null, title, description || null, site_location || null,
       city || null, quantity || null, specifications || null, priority]
    );
    for (const file of req.files || []) {
      await pool.query(
        `INSERT INTO request_attachments (request_id, file_path, file_type, original_name) VALUES (?, ?, ?, ?)`,
        [result.insertId, `requests/${file.filename}`, classifyFileType(file.mimetype), file.originalname]
      );
    }
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', 'Created by admin', ?)`,
      [result.insertId, req.user.id]
    );
    await notify({ userId: customer_id, event: 'request_created', type: 'request', title: `Request ${ticketNo} created`, data: { ticket_no: ticketNo } });
    await writeAudit({ actor: req.user, action: 'request.create', entity: 'requests', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo }, 'Request created', 201);
  })
);

// assign / reassign vendor
router.post(
  '/:id/assign',
  requirePermission('requests.assign'),
  asyncHandler(async (req, res) => {
    const { vendor_id, note } = req.body;
    const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    const request = rows[0];
    if (!canAccessModule(req.user, (await getModuleCode(request.module_id)))) {
      throw ApiError.forbidden('No access to this module');
    }
    const [[vendor]] = await pool.query(`SELECT v.*, u.id AS uid FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = ?`, [vendor_id]);
    if (!vendor) throw ApiError.badRequest('Vendor not found');
    if (vendor.status !== 'approved') throw ApiError.badRequest('Vendor is not approved');

    // category match soft-check
    const [[catMatch]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM vendor_service_categories WHERE vendor_id = ? AND category_id = ?`,
      [vendor_id, request.category_id || 0]
    );

    await pool.query(`UPDATE request_assignments SET status = 'cancelled' WHERE request_id = ? AND status = 'active'`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_assignments (request_id, vendor_id, assigned_by, note) VALUES (?, ?, ?, ?)`,
      [req.params.id, vendor_id, req.user.id, note || null]
    );
    await pool.query(`UPDATE requests SET assigned_vendor_id = ?, status = 'assigned' WHERE id = ?`, [vendor_id, req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'assigned', ?, ?)`,
      [req.params.id, `Assigned to ${vendor.business_name}${catMatch && catMatch.cnt === 0 && request.category_id ? ' (category mismatch)' : ''}`, req.user.id]
    );
    await notify({
      userId: vendor.uid,
      event: 'request_assigned',
      type: 'request',
      title: `New assignment ${request.ticket_no}`,
      body: `Request "${request.title}" has been assigned to you.`,
      data: { ticket_no: request.ticket_no, request_id: request.id },
    });
    await notify({
      userId: request.customer_id,
      event: 'request_status_updated',
      type: 'request',
      title: `Request ${request.ticket_no} assigned`,
      data: { ticket_no: request.ticket_no, status: 'assigned' },
    });
    await writeAudit({ actor: req.user, action: 'request.assign', entity: 'requests', entityId: req.params.id, details: { vendor_id }, req });
    sendSuccess(res, null, 'Vendor assigned');
  })
);

async function getModuleCode(moduleId) {
  const [[m]] = await pool.query('SELECT code FROM service_modules WHERE id = ?', [moduleId]);
  return m ? m.code : null;
}

const ADMIN_STATUSES = ['pending_review', 'assigned', 'quoted', 'approved', 'scheduled', 'in_progress', 'completed', 'closed', 'cancelled'];

router.patch(
  '/:id/status',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const { status, note } = req.body;
    if (!ADMIN_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    const closedAt = ['completed', 'closed', 'cancelled'].includes(status) ? new Date() : null;
    await pool.query('UPDATE requests SET status = ?, closed_at = COALESCE(?, closed_at) WHERE id = ?', [status, closedAt, req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, status, note || null, req.user.id]
    );
    await notify({
      userId: rows[0].customer_id,
      event: 'request_status_updated',
      type: 'request',
      title: `Request ${rows[0].ticket_no} — ${status.replace('_', ' ')}`,
      data: { ticket_no: rows[0].ticket_no, status },
    });
    if (rows[0].assigned_vendor_id) {
      const [[v]] = await pool.query('SELECT user_id FROM vendors WHERE id = ?', [rows[0].assigned_vendor_id]);
      if (v) {
        await notify({
          userId: v.user_id,
          event: 'request_status_updated',
          type: 'request',
          title: `Request ${rows[0].ticket_no} — ${status.replace('_', ' ')}`,
          data: { ticket_no: rows[0].ticket_no, status },
        });
      }
    }
    await writeAudit({ actor: req.user, action: 'request.status', entity: 'requests', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'Status updated');
  })
);

router.post(
  '/:id/close',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const { note } = req.body;
    const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    await pool.query(`UPDATE requests SET status = 'closed', closed_at = NOW() WHERE id = ?`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'closed', ?, ?)`,
      [req.params.id, note || 'Closed by admin', req.user.id]
    );
    await notify({ userId: rows[0].customer_id, event: 'request_status_updated', type: 'request', title: `Request ${rows[0].ticket_no} closed`, data: { ticket_no: rows[0].ticket_no, status: 'closed' } });
    await writeAudit({ actor: req.user, action: 'request.close', entity: 'requests', entityId: req.params.id, req });
    sendSuccess(res, null, 'Request closed');
  })
);

router.post(
  '/:id/escalate',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const { note } = req.body;
    const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    await pool.query(`UPDATE requests SET priority = 'urgent' WHERE id = ?`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, rows[0].status, `Escalated to urgent${note ? ': ' + note : ''}`, req.user.id]
    );
    await writeAudit({ actor: req.user, action: 'request.escalate', entity: 'requests', entityId: req.params.id, details: { note }, req });
    sendSuccess(res, null, 'Request escalated');
  })
);

router.delete(
  '/:id',
  requirePermission('requests.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT id, status FROM requests WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    if (['in_progress', 'scheduled'].includes(rows[0].status)) {
      throw ApiError.badRequest('Cannot delete an active request — cancel it instead');
    }
    await pool.query('DELETE FROM requests WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'request.delete', entity: 'requests', entityId: req.params.id, req });
    sendSuccess(res, null, 'Request deleted');
  })
);

module.exports = router;
