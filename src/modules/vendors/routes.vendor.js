const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { generalUpload, toPublicUrl } = require('../../middlewares/upload');
const { notify } = require('../../utils/notify');

router.use(authMiddleware);

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('You are not an approved vendor account'));
  next();
};

router.get(
  '/profile',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT v.*, u.name AS owner_name, u.email, u.phone, u.status AS user_status
         FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.user_id = ?`,
      [req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Vendor profile not found');
    const [cats] = await pool.query(
      `SELECT c.id, c.name, m.name AS module_name, m.code AS module_code
         FROM vendor_service_categories vsc
         JOIN service_categories c ON c.id = vsc.category_id
         JOIN service_modules m ON m.id = c.module_id
        WHERE vsc.vendor_id = ?`,
      [rows[0].id]
    );
    const [[stats]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage = 'completed') AS completed_jobs,
         (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage IN ('accepted','scheduled','in_progress','awaiting_approval')) AS active_jobs,
         (SELECT COUNT(*) FROM requests WHERE assigned_vendor_id = ? AND status = 'pending_review') AS pending_requests`,
      [rows[0].id, rows[0].id, rows[0].id]
    );
    sendSuccess(res, { ...rows[0], logo: toPublicUrl(rows[0].logo), categories: cats, stats });
  })
);

router.put(
  '/profile',
  requireVendor,
  generalUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE user_id = ?', [req.user.id]);
    if (!rows.length) throw ApiError.notFound('Vendor profile not found');
    const { business_name, contact_person, city, state, pincode, coverage_areas, address, gst_number } = req.body;
    const logo = req.file ? `general/${req.file.filename}` : rows[0].logo;
    await pool.query(
      `UPDATE vendors SET business_name = COALESCE(?, business_name), contact_person = COALESCE(?, contact_person),
              city = COALESCE(?, city), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
              coverage_areas = COALESCE(?, coverage_areas), address = COALESCE(?, address),
              gst_number = COALESCE(?, gst_number), logo = ?
        WHERE user_id = ?`,
      [business_name || null, contact_person || null, city || null, state || null, pincode || null,
       coverage_areas || null, address || null, gst_number || null, logo, req.user.id]
    );
    sendSuccess(res, null, 'Profile updated');
  })
);

router.get(
  '/summary',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const [[summary]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM request_assignments WHERE vendor_id = ? AND status = 'active') AS active_assignments,
         (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage = 'in_progress') AS in_progress_jobs,
         (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage = 'completed') AS completed_jobs,
         (SELECT COUNT(*) FROM quotations WHERE vendor_id = ? AND status = 'pending') AS pending_quotations,
         (SELECT IFNULL(SUM(total_amount), 0) FROM quotations WHERE vendor_id = ? AND status = 'accepted') AS won_amount`,
      [vendorId, vendorId, vendorId, vendorId, vendorId]
    );
    const [recent] = await pool.query(
      `SELECT r.ticket_no, r.title, r.status, r.priority, r.created_at, m.name AS module_name
         FROM requests r JOIN service_modules m ON m.id = r.module_id
        WHERE r.assigned_vendor_id = ? ORDER BY r.updated_at DESC LIMIT 5`,
      [vendorId]
    );
    sendSuccess(res, { ...summary, recent_requests: recent });
  })
);

router.get(
  '/available-categories',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, m.name AS module_name, m.code AS module_code
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        WHERE c.status = 1 ORDER BY m.sort_order, c.sort_order`
    );
    sendSuccess(res, rows);
  })
);

router.put(
  '/service-categories',
  requireVendor,
  asyncHandler(async (req, res) => {
    let ids = req.body.category_ids;
    if (typeof ids === 'string') {
      try { ids = JSON.parse(ids); } catch (_) { ids = ids.split(','); }
    }
    if (!Array.isArray(ids)) throw ApiError.badRequest('category_ids must be an array');
    const vendorId = req.user.vendor.id;
    await pool.query('DELETE FROM vendor_service_categories WHERE vendor_id = ?', [vendorId]);
    for (const id of ids) {
      await pool.query('INSERT IGNORE INTO vendor_service_categories (vendor_id, category_id) VALUES (?, ?)', [
        vendorId, Number(id),
      ]);
    }
    sendSuccess(res, null, 'Service categories updated');
  })
);

router.post(
  '/complete-profile',
  requireVendor,
  asyncHandler(async (req, res) => {
    await notify({
      userId: req.user.id,
      title: 'Profile update received',
      body: 'Your vendor profile changes are saved.',
    });
    sendSuccess(res, null, 'Profile saved');
  })
);

module.exports = router;
