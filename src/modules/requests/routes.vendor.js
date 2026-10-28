const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { notify } = require('../../utils/notify');

router.use(authMiddleware);

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('Vendor account required'));
  if (req.user.vendor.status !== 'approved') return next(ApiError.forbidden('Vendor account is not approved'));
  next();
};

const VENDOR_SELECT = `
  SELECT r.*, m.name AS module_name, m.code AS module_code, c.name AS category_name,
         u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM requests r
    JOIN service_modules m ON m.id = r.module_id
    LEFT JOIN service_categories c ON c.id = r.category_id
    JOIN users u ON u.id = r.customer_id`;

// list requests relevant to this vendor
router.get(
  '/requests',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const status = req.query.status;
    const scope = req.query.scope || 'assigned';
    const params = [vendorId, vendorId];
    let where = `WHERE (r.assigned_vendor_id = ? OR EXISTS (
        SELECT 1 FROM request_assignments a WHERE a.request_id = r.id AND a.vendor_id = ? AND a.status = 'active'))`;
    if (scope === 'available') {
      where = `WHERE r.status = 'pending_review' AND r.assigned_vendor_id IS NULL`;
      params.length = 0;
    }
    if (status) {
      where += ' AND r.status = ?';
      params.push(status);
    }
    const [rows] = await pool.query(`${VENDOR_SELECT} ${where} ORDER BY r.updated_at DESC LIMIT 100`, params);
    const ids = rows.map((r) => r.id);
    let files = [];
    if (ids.length) {
      [files] = await pool.query(`SELECT * FROM request_attachments WHERE request_id IN (?)`, [ids]);
    }
    sendSuccess(
      res,
      rows.map((r) => ({
        ...r,
        attachments: files
          .filter((f) => f.request_id === r.id)
          .map((f) => ({
            id: f.id,
            file_type: f.file_type,
            original_name: f.original_name,
            url: `${process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:5000/uploads'}/${f.file_path}`,
          })),
      }))
    );
  })
);

router.get(
  '/requests/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const [rows] = await pool.query(
      `${VENDOR_SELECT} WHERE r.id = ? AND (r.assigned_vendor_id = ? OR EXISTS (
        SELECT 1 FROM request_assignments a WHERE a.request_id = r.id AND a.vendor_id = ?))`,
      [req.params.id, vendorId, vendorId]
    );
    if (!rows.length) throw ApiError.notFound('Request not found or not assigned to you');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM request_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.request_id = ? ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    const [files] = await pool.query('SELECT * FROM request_attachments WHERE request_id = ?', [req.params.id]);
    sendSuccess(res, {
      ...rows[0],
      history,
      attachments: files.map((f) => ({
        id: f.id,
        file_type: f.file_type,
        original_name: f.original_name,
        url: `${process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:5000/uploads'}/${f.file_path}`,
      })),
    });
  })
);

// accept assignment
router.post(
  '/requests/:id/accept',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const [rows] = await pool.query(`SELECT * FROM requests WHERE id = ? AND assigned_vendor_id = ?`, [req.params.id, vendorId]);
    if (!rows.length) throw ApiError.notFound('Assigned request not found');
    if (['completed', 'closed', 'cancelled'].includes(rows[0].status)) throw ApiError.badRequest('Request already finished');
    await pool.query(`UPDATE request_assignments SET status = 'active' WHERE request_id = ? AND vendor_id = ?`, [req.params.id, vendorId]);
    await pool.query(`UPDATE requests SET status = 'assigned' WHERE id = ? AND status = 'pending_review'`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'assigned', 'Vendor accepted the assignment', ?)`,
      [req.params.id, req.user.id]
    );
    await notify({ userId: rows[0].customer_id, event: 'request_status_updated', type: 'request', title: `Request ${rows[0].ticket_no} accepted`, data: { ticket_no: rows[0].ticket_no, status: 'assigned' } });
    sendSuccess(res, null, 'Assignment accepted');
  })
);

// decline assignment
router.post(
  '/requests/:id/decline',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const { reason } = req.body;
    const [rows] = await pool.query(`SELECT * FROM requests WHERE id = ? AND assigned_vendor_id = ?`, [req.params.id, vendorId]);
    if (!rows.length) throw ApiError.notFound('Assigned request not found');
    await pool.query(`UPDATE request_assignments SET status = 'declined', note = ? WHERE request_id = ? AND vendor_id = ?`, [
      reason || 'Declined by vendor', req.params.id, vendorId,
    ]);
    await pool.query(`UPDATE requests SET assigned_vendor_id = NULL, status = 'pending_review' WHERE id = ?`, [req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', ?, ?)`,
      [req.params.id, `Vendor declined: ${reason || 'no reason'}`, req.user.id]
    );
    sendSuccess(res, null, 'Assignment declined');
  })
);

// vendor updates status with notes
const VENDOR_STATUSES = ['in_progress', 'scheduled', 'completed'];
router.post(
  '/requests/:id/status',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const { status, note, schedule_date } = req.body;
    if (!VENDOR_STATUSES.includes(status)) throw ApiError.badRequest(`Status must be one of: ${VENDOR_STATUSES.join(', ')}`);
    const [rows] = await pool.query(`SELECT * FROM requests WHERE id = ? AND assigned_vendor_id = ?`, [req.params.id, vendorId]);
    if (!rows.length) throw ApiError.notFound('Request not found');
    await pool.query('UPDATE requests SET status = ? WHERE id = ?', [status, req.params.id]);
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, status, note || null, req.user.id]
    );
    if (schedule_date) {
      const [jobRows] = await pool.query(`SELECT id FROM jobs WHERE request_id = ? AND vendor_id = ?`, [req.params.id, vendorId]);
      if (jobRows.length) {
        await pool.query('UPDATE jobs SET schedule_date = ? WHERE id = ?', [schedule_date, jobRows[0].id]);
      }
    }
    await notify({
      userId: rows[0].customer_id,
      event: 'request_status_updated',
      type: 'request',
      title: `Request ${rows[0].ticket_no} — ${status.replace('_', ' ')}`,
      data: { ticket_no: rows[0].ticket_no, status },
    });
    sendSuccess(res, null, 'Status updated');
  })
);

module.exports = router;
