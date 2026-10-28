const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { generalUpload, toPublicUrl } = require('../../middlewares/upload');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');

router.use(authMiddleware, requirePermission('vendors.view'));

const vendorListSql = `
  SELECT v.id, v.business_name, v.contact_person, v.city, v.coverage_areas, v.status, v.rating,
         v.total_jobs, v.created_at, v.approved_at, v.rejection_reason,
         u.id AS user_id, u.name, u.email, u.phone, u.status AS user_status,
         (SELECT GROUP_CONCAT(c.name ORDER BY c.name SEPARATOR ', ')
            FROM vendor_service_categories vsc JOIN service_categories c ON c.id = vsc.category_id
           WHERE vsc.vendor_id = v.id) AS categories
    FROM vendors v JOIN users u ON u.id = v.user_id`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND v.status = ?';
      params.push(req.query.status);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (v.business_name LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
      params.push(s, s, s, s);
    }
    if (req.query.category_id) {
      where += ' AND EXISTS (SELECT 1 FROM vendor_service_categories vsc WHERE vsc.vendor_id = v.id AND vsc.category_id = ?)';
      params.push(req.query.category_id);
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM vendors v JOIN users u ON u.id = v.user_id ${where}`, params);
    const [rows] = await pool.query(`${vendorListSql} ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit,
      offset,
    ]);
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT status, COUNT(*) AS count FROM vendors GROUP BY status`
    );
    sendSuccess(res, rows);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${vendorListSql} WHERE v.id = ?`, [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Vendor not found');
    const [cats] = await pool.query(
      `SELECT category_id FROM vendor_service_categories WHERE vendor_id = ?`,
      [req.params.id]
    );
    const [jobs] = await pool.query(
      `SELECT j.id, j.job_no, j.stage, j.schedule_date, j.amount, j.updated_at, r.ticket_no, r.title
         FROM jobs j JOIN requests r ON r.id = j.request_id
        WHERE j.vendor_id = ? ORDER BY j.updated_at DESC LIMIT 10`,
      [req.params.id]
    );
    sendSuccess(res, {
      ...rows[0],
      logo: toPublicUrl(rows[0].logo),
      category_ids: cats.map((c) => c.category_id),
      recent_jobs: jobs,
    });
  })
);

router.post(
  '/',
  requirePermission('vendors.manage'),
  generalUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, business_name, contact_person, city, coverage_areas, category_ids } = req.body;
    if (!password || password.length < 6) throw ApiError.badRequest('Password must be at least 6 characters');
    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) throw ApiError.conflict('Email already in use');

    const [result] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, user_type) VALUES (?, ?, ?, ?, 'customer')`,
      [name, email, phone || null, bcrypt.hashSync(password, 10)]
    );
    const userId = result.insertId;
    const logo = req.file ? `general/${req.file.filename}` : null;
    const [vResult] = await pool.query(
      `INSERT INTO vendors (user_id, business_name, contact_person, city, coverage_areas, logo, status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, NOW())`,
      [userId, business_name, contact_person || null, city || null, coverage_areas || null, logo, req.user.id]
    );
    await attachCategories(vResult.insertId, category_ids);
    await writeAudit({ actor: req.user, action: 'vendor.create', entity: 'vendors', entityId: vResult.insertId, req });
    sendSuccess(res, { id: vResult.insertId, user_id: userId }, 'Vendor created', 201);
  })
);

router.put(
  '/:id',
  requirePermission('vendors.manage'),
  generalUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Vendor not found');
    const { business_name, contact_person, city, state, pincode, coverage_areas, address, gst_number, category_ids } = req.body;
    const logo = req.file ? `general/${req.file.filename}` : rows[0].logo;
    await pool.query(
      `UPDATE vendors SET business_name = COALESCE(?, business_name), contact_person = COALESCE(?, contact_person),
              city = COALESCE(?, city), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
              coverage_areas = COALESCE(?, coverage_areas), address = COALESCE(?, address),
              gst_number = COALESCE(?, gst_number), logo = ?
        WHERE id = ?`,
      [business_name || null, contact_person || null, city || null, state || null, pincode || null,
       coverage_areas || null, address || null, gst_number || null, logo, req.params.id]
    );
    if (category_ids !== undefined) await attachCategories(req.params.id, category_ids);
    await writeAudit({ actor: req.user, action: 'vendor.update', entity: 'vendors', entityId: req.params.id, req });
    sendSuccess(res, null, 'Vendor updated');
  })
);

router.post(
  '/:id/approve',
  requirePermission('vendors.approve'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Vendor not found');
    await pool.query(
      `UPDATE vendors SET status = 'approved', approved_by = ?, approved_at = NOW(), rejection_reason = NULL WHERE id = ?`,
      [req.user.id, req.params.id]
    );
    await notify({ userId: rows[0].user_id, event: 'vendor_status', type: 'vendor', title: 'Vendor account approved', body: 'Congratulations! Your vendor account has been approved.', data: { status: 'approved' } });
    await writeAudit({ actor: req.user, action: 'vendor.approve', entity: 'vendors', entityId: req.params.id, req });
    sendSuccess(res, null, 'Vendor approved');
  })
);

router.post(
  '/:id/reject',
  requirePermission('vendors.approve'),
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Vendor not found');
    await pool.query(
      `UPDATE vendors SET status = 'rejected', rejection_reason = ?, approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [reason || 'Did not meet criteria', req.user.id, req.params.id]
    );
    await notify({ userId: rows[0].user_id, event: 'vendor_status', type: 'vendor', title: 'Vendor application rejected', body: reason || 'Your application was not approved.', data: { status: 'rejected' } });
    await writeAudit({ actor: req.user, action: 'vendor.reject', entity: 'vendors', entityId: req.params.id, details: { reason }, req });
    sendSuccess(res, null, 'Vendor rejected');
  })
);

router.patch(
  '/:id/status',
  requirePermission('vendors.manage'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Vendor not found');
    await pool.query('UPDATE vendors SET status = ? WHERE id = ?', [status, req.params.id]);
    await notify({ userId: rows[0].user_id, event: 'vendor_status', type: 'vendor', title: `Vendor account — ${status}`, data: { status } });
    await writeAudit({ actor: req.user, action: 'vendor.status', entity: 'vendors', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'Vendor status updated');
  })
);

router.get(
  '/:id/assignments',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT a.*, r.ticket_no, r.title, r.status AS request_status
         FROM request_assignments a JOIN requests r ON r.id = a.request_id
        WHERE a.vendor_id = ? ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    sendSuccess(res, rows);
  })
);

async function attachCategories(vendorId, categoryIds) {
  let ids = categoryIds;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch (_) {
      ids = ids.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(ids)) return;
  await pool.query('DELETE FROM vendor_service_categories WHERE vendor_id = ?', [vendorId]);
  for (const catId of ids) {
    await pool.query('INSERT IGNORE INTO vendor_service_categories (vendor_id, category_id) VALUES (?, ?)', [
      vendorId,
      Number(catId),
    ]);
  }
}

module.exports = { router, attachCategories };
