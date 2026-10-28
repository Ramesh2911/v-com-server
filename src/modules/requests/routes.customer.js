const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requestUpload, classifyFileType, toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');

router.use(authMiddleware);

const REQUEST_SELECT = `
  SELECT r.*,
         m.name AS module_name, m.code AS module_code,
         c.name AS category_name,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
         v.business_name AS vendor_business_name,
         vu.name AS vendor_contact_name, vu.phone AS vendor_contact_phone
    FROM requests r
    JOIN service_modules m ON m.id = r.module_id
    LEFT JOIN service_categories c ON c.id = r.category_id
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN vendors v ON v.id = r.assigned_vendor_id
    LEFT JOIN users vu ON vu.id = v.user_id`;

async function withAttachments(requests) {
  if (!requests.length) return requests;
  const ids = requests.map((r) => r.id);
  const [files] = await pool.query(`SELECT * FROM request_attachments WHERE request_id IN (?)`, [ids]);
  return requests.map((r) => ({
    ...r,
    attachments: files
      .filter((f) => f.request_id === r.id)
      .map((f) => ({ id: f.id, file_type: f.file_type, original_name: f.original_name, url: toPublicUrl(f.file_path) })),
  }));
}

// ---- Customer: create request ----
router.post(
  '/requests',
  requestUpload.array('attachments', 8),
  asyncHandler(async (req, res) => {
    const { module_id, category_id, title, description, site_location, city, latitude, longitude, quantity, specifications, priority = 'normal' } = req.body;
    const [[mod]] = await pool.query('SELECT id, code, name FROM service_modules WHERE id = ? AND status = 1', [module_id]);
    if (!mod) throw ApiError.badRequest('Invalid service module');
    if (!title || !title.trim()) throw ApiError.badRequest('Title is required');

    const ticketNo = await generateTicketNo(pool, 'request');
    const [result] = await pool.query(
      `INSERT INTO requests (ticket_no, customer_id, module_id, category_id, title, description, site_location, city,
        latitude, longitude, quantity, specifications, priority, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')`,
      [ticketNo, req.user.id, module_id, category_id || null, title.trim(), description || null,
       site_location || null, city || null, latitude || null, longitude || null,
       quantity || null, specifications || null, priority]
    );
    const requestId = result.insertId;

    for (const file of req.files || []) {
      await pool.query(
        `INSERT INTO request_attachments (request_id, file_path, file_type, original_name) VALUES (?, ?, ?, ?)`,
        [requestId, `requests/${file.filename}`, classifyFileType(file.mimetype), file.originalname]
      );
    }
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', 'Request submitted', ?)`,
      [requestId, req.user.id]
    );

    const staff = await staffWithPermission('requests.manage');
    await notifyMany(staff, {
      event: 'request_created',
      type: 'request',
      title: `New request ${ticketNo}`,
      body: `A new ${mod.name} request has been submitted.`,
      data: { ticket_no: ticketNo, module: mod.name, request_id: requestId },
    });

    sendSuccess(res, { id: requestId, ticket_no: ticketNo }, 'Request submitted successfully', 201);
  })
);

async function notifyMany(ids, payload) {
  for (const id of ids) {
    await notify({ ...payload, userId: id });
  }
}

// ---- Customer: list my requests ----
router.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const params = [req.user.id];
    let where = 'WHERE r.customer_id = ?';
    if (req.query.status) {
      where += ' AND r.status = ?';
      params.push(req.query.status);
    }
    if (req.query.module_id) {
      where += ' AND r.module_id = ?';
      params.push(req.query.module_id);
    }
    if (req.query.search) {
      where += ' AND (r.title LIKE ? OR r.ticket_no LIKE ?)';
      params.push(`%${req.query.search}%`, `%${req.query.search}%`);
    }
    const [rows] = await pool.query(`${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC LIMIT 100`, params);
    sendSuccess(res, await withAttachments(rows));
  })
);

// ---- Customer: request detail ----
router.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${REQUEST_SELECT} WHERE r.id = ? AND r.customer_id = ?`, [req.params.id, req.user.id]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM request_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.request_id = ? ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    const [quotations] = await pool.query(
      `SELECT q.id, q.ticket_no, q.total_amount, q.status, q.created_at, v.business_name AS vendor_name
         FROM quotations q JOIN vendors v ON v.id = q.vendor_id
        WHERE q.request_id = ? ORDER BY q.created_at DESC`,
      [req.params.id]
    );
    const [reqRow] = await withAttachments(rows);
    sendSuccess(res, { ...reqRow, history, quotations });
  })
);

// ---- Customer: cancel own request ----
router.post(
  '/requests/:id/cancel',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, status, assigned_vendor_id FROM requests WHERE id = ? AND customer_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Request not found');
    if (['completed', 'closed', 'cancelled'].includes(rows[0].status)) {
      throw ApiError.badRequest('Request can no longer be cancelled');
    }
    await pool.query(`UPDATE requests SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'cancelled', 'Cancelled by customer', ?)`,
      [req.params.id, req.user.id]
    );
    sendSuccess(res, null, 'Request cancelled');
  })
);

module.exports = router;
