const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { toPublicUrl } = require('../../middlewares/upload');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');

router.use(authMiddleware, requirePermission('jobs.view'));

const J_SELECT = `
  SELECT j.*, r.ticket_no AS request_ticket, r.title AS request_title, r.status AS request_status,
         m.name AS module_name, v.business_name AS vendor_name,
         u.name AS customer_name, u.phone AS customer_phone
    FROM jobs j
    JOIN requests r ON r.id = j.request_id
    JOIN service_modules m ON m.id = r.module_id
    JOIN vendors v ON v.id = j.vendor_id
    JOIN users u ON u.id = r.customer_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    for (const f of ['stage', 'vendor_id', 'request_id']) {
      if (req.query[f]) {
        where += ` AND j.${f} = ?`;
        params.push(req.query[f]);
      }
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (j.job_no LIKE ? OR r.ticket_no LIKE ? OR r.title LIKE ? OR v.business_name LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM jobs j
        JOIN requests r ON r.id = j.request_id JOIN vendors v ON v.id = j.vendor_id ${where}`,
      params
    );
    const [rows] = await pool.query(`${J_SELECT} ${where} ORDER BY j.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params, limit, offset,
    ]);
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT stage, COUNT(*) AS count FROM jobs GROUP BY stage');
    sendSuccess(res, rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${J_SELECT} WHERE j.id = ? OR j.job_no = ?`, [req.params.id, req.params.id]);
    if (!rows.length) throw ApiError.notFound('Job not found');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM job_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.job_id = ? ORDER BY h.created_at ASC`,
      [rows[0].id]
    );
    const [files] = await pool.query('SELECT * FROM job_attachments WHERE job_id = ?', [rows[0].id]);
    sendSuccess(res, {
      ...rows[0],
      history,
      attachments: files.map((f) => ({
        id: f.id, file_type: f.file_type, kind: f.kind, original_name: f.original_name, url: toPublicUrl(f.file_path),
      })),
    });
  })
);

router.patch(
  '/:id/stage',
  requirePermission('jobs.manage'),
  asyncHandler(async (req, res) => {
    const { stage, note, schedule_date } = req.body;
    const allowed = ['accepted', 'scheduled', 'in_progress', 'awaiting_approval', 'completed', 'cancelled'];
    if (!allowed.includes(stage)) throw ApiError.badRequest('Invalid stage');
    const [rows] = await pool.query('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Job not found');
    const job = rows[0];
    await pool.query('UPDATE jobs SET stage = ?, schedule_date = COALESCE(?, schedule_date) WHERE id = ?', [
      stage, schedule_date || null, req.params.id,
    ]);
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, stage, note || 'Updated by admin', req.user.id]
    );
    const reqStatusMap = { scheduled: 'scheduled', in_progress: 'in_progress', awaiting_approval: 'in_progress', completed: 'completed', cancelled: 'cancelled' };
    if (reqStatusMap[stage]) {
      await pool.query('UPDATE requests SET status = ? WHERE id = ?', [reqStatusMap[stage], job.request_id]);
    }
    const [[request]] = await pool.query('SELECT customer_id FROM requests WHERE id = ?', [job.request_id]);
    const [[vendor]] = await pool.query('SELECT user_id FROM vendors WHERE id = ?', [job.vendor_id]);
    for (const uid of [request && request.customer_id, vendor && vendor.user_id]) {
      if (uid) {
        await notify({ userId: uid, event: 'job_stage_updated', type: 'job', title: `Job ${job.job_no} — ${stage.replace('_', ' ')}`, data: { job_no: job.job_no, stage } });
      }
    }
    await writeAudit({ actor: req.user, action: 'job.stage', entity: 'jobs', entityId: req.params.id, details: { stage }, req });
    sendSuccess(res, null, 'Job stage updated');
  })
);

router.post(
  '/',
  requirePermission('jobs.manage'),
  asyncHandler(async (req, res) => {
    const { request_id, vendor_id, schedule_date, amount } = req.body;
    const [reqRows] = await pool.query('SELECT * FROM requests WHERE id = ?', [request_id]);
    if (!reqRows.length) throw ApiError.badRequest('Request not found');
    const [venRows] = await pool.query(`SELECT id FROM vendors WHERE id = ? AND status = 'approved'`, [vendor_id]);
    if (!venRows.length) throw ApiError.badRequest('Approved vendor not found');

    const { generateTicketNo } = require('../../utils/ticketNo');
    const jobNo = await generateTicketNo(pool, 'job');
    const [result] = await pool.query(
      `INSERT INTO jobs (job_no, request_id, vendor_id, stage, schedule_date, amount)
       VALUES (?, ?, ?, 'accepted', ?, ?)`,
      [jobNo, request_id, vendor_id, schedule_date || null, amount || null]
    );
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, 'accepted', 'Created by admin', ?)`,
      [result.insertId, req.user.id]
    );
    await writeAudit({ actor: req.user, action: 'job.create', entity: 'jobs', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId, job_no: jobNo }, 'Job created', 201);
  })
);

module.exports = router;
