const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { jobUpload, classifyFileType, toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify } = require('../../utils/notify');

router.use(authMiddleware);

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('Vendor account required'));
  next();
};

const J_SELECT = `
  SELECT j.*, r.ticket_no AS request_ticket, r.title AS request_title, r.status AS request_status,
         m.name AS module_name, u.name AS customer_name, u.phone AS customer_phone, r.site_location
    FROM jobs j
    JOIN requests r ON r.id = j.request_id
    JOIN service_modules m ON m.id = r.module_id
    JOIN users u ON u.id = r.customer_id`;

const VENDOR_STAGES = ['scheduled', 'in_progress', 'awaiting_approval', 'completed'];

router.get(
  '/jobs',
  requireVendor,
  asyncHandler(async (req, res) => {
    let where = 'WHERE j.vendor_id = ?';
    const params = [req.user.vendor.id];
    if (req.query.stage) {
      where += ' AND j.stage = ?';
      params.push(req.query.stage);
    }
    const [rows] = await pool.query(`${J_SELECT} ${where} ORDER BY j.updated_at DESC LIMIT 100`, params);
    sendSuccess(res, rows);
  })
);

// create job from an approved request
router.post(
  '/jobs',
  requireVendor,
  asyncHandler(async (req, res) => {
    const { request_id, schedule_date, amount } = req.body;
    const vendorId = req.user.vendor.id;
    const [reqRows] = await pool.query(
      `SELECT * FROM requests WHERE id = ? AND assigned_vendor_id = ?`,
      [request_id, vendorId]
    );
    if (!reqRows.length) throw ApiError.badRequest('Request not assigned to you');
    const request = reqRows[0];
    if (['completed', 'closed', 'cancelled'].includes(request.status)) throw ApiError.badRequest('Request is closed');

    const [[qRow]] = await pool.query(
      `SELECT id, total_amount FROM quotations WHERE request_id = ? AND vendor_id = ? AND status = 'accepted'
        ORDER BY created_at DESC LIMIT 1`,
      [request_id, vendorId]
    );
    const jobNo = await generateTicketNo(pool, 'job');
    const [result] = await pool.query(
      `INSERT INTO jobs (job_no, request_id, quotation_id, vendor_id, stage, schedule_date, amount)
       VALUES (?, ?, ?, ?, 'accepted', ?, ?)`,
      [jobNo, request_id, qRow ? qRow.id : null, vendorId, schedule_date || null, amount || (qRow ? qRow.total_amount : null)]
    );
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, 'accepted', 'Job created', ?)`,
      [result.insertId, req.user.id]
    );
    await pool.query(`UPDATE requests SET status = 'scheduled' WHERE id = ? AND status IN ('approved','assigned','quoted')`, [request_id]);
    await notify({
      userId: request.customer_id, event: 'job_stage_updated', type: 'job',
      title: `Job ${jobNo} created`, data: { job_no: jobNo, stage: 'accepted' },
    });
    sendSuccess(res, { id: result.insertId, job_no: jobNo }, 'Job created', 201);
  })
);

router.get(
  '/jobs/:id',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${J_SELECT} WHERE j.id = ? AND j.vendor_id = ?`, [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Job not found');
    const [history] = await pool.query(
      `SELECT h.*, u.name AS changed_by_name FROM job_status_history h
        LEFT JOIN users u ON u.id = h.changed_by WHERE h.job_id = ? ORDER BY h.created_at ASC`,
      [req.params.id]
    );
    const [files] = await pool.query('SELECT * FROM job_attachments WHERE job_id = ?', [req.params.id]);
    sendSuccess(res, {
      ...rows[0],
      history,
      attachments: files.map((f) => ({
        id: f.id, file_type: f.file_type, kind: f.kind, original_name: f.original_name, url: toPublicUrl(f.file_path),
      })),
    });
  })
);

router.post(
  '/jobs/:id/status',
  requireVendor,
  asyncHandler(async (req, res) => {
    const { stage, note, schedule_date, completion_notes } = req.body;
    if (!VENDOR_STAGES.includes(stage)) throw ApiError.badRequest(`Stage must be one of: ${VENDOR_STAGES.join(', ')}`);
    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ? AND vendor_id = ?`, [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Job not found');
    const job = rows[0];

    const updates = ['stage = ?'];
    const params = [stage];
    if (schedule_date) {
      updates.push('schedule_date = ?');
      params.push(schedule_date);
    }
    if (stage === 'in_progress' && !job.started_at) updates.push('started_at = NOW()');
    if (stage === 'completed') {
      updates.push('completed_at = NOW()');
      if (completion_notes) {
        updates.push('completion_notes = ?');
        params.push(completion_notes);
      }
    }
    await pool.query(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`, [...params, req.params.id]);
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, ?, ?, ?)`,
      [req.params.id, stage, note || completion_notes || null, req.user.id]
    );

    const reqStatusMap = { scheduled: 'scheduled', in_progress: 'in_progress', awaiting_approval: 'in_progress', completed: 'completed' };
    const newReqStatus = reqStatusMap[stage];
    if (newReqStatus) {
      await pool.query('UPDATE requests SET status = ? WHERE id = ?', [newReqStatus, job.request_id]);
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)`,
        [job.request_id, newReqStatus, `Job ${job.job_no} → ${stage}`, req.user.id]
      );
    }
    const [[request]] = await pool.query('SELECT customer_id, ticket_no FROM requests WHERE id = ?', [job.request_id]);
    if (request) {
      await notify({
        userId: request.customer_id, event: 'job_stage_updated', type: 'job',
        title: `Job ${job.job_no} — ${stage.replace('_', ' ')}`,
        data: { job_no: job.job_no, stage },
      });
    }
    sendSuccess(res, null, 'Job stage updated');
  })
);

router.post(
  '/jobs/:id/attachments',
  requireVendor,
  jobUpload.array('files', 10),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ? AND vendor_id = ?`, [req.params.id, req.user.vendor.id]);
    if (!rows.length) throw ApiError.notFound('Job not found');
    const kind = req.body.kind === 'completion' ? 'completion' : 'progress';
    const saved = [];
    for (const file of req.files || []) {
      const [result] = await pool.query(
        `INSERT INTO job_attachments (job_id, file_path, file_type, original_name, kind) VALUES (?, ?, ?, ?, ?)`,
        [req.params.id, `jobs/${file.filename}`, classifyFileType(file.mimetype), file.originalname, kind]
      );
      saved.push({ id: result.insertId, url: toPublicUrl(`jobs/${file.filename}`), kind });
    }
    sendSuccess(res, saved, 'Attachments uploaded', 201);
  })
);

module.exports = router;
