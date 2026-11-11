const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { kycUpload, uploadKycFiles, toPublicUrl } = require('../../middlewares/upload');
const { notify } = require('../../utils/notify');

router.use(authMiddleware);

const KYC_DOC_FIELDS = ['photo', 'aadhar_front', 'aadhar_back', 'pan_front', 'pan_back'];

const requireVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('No provider account found for this user'));
  next();
};

// "Bangalore, Mysore" | '["a","b"]' | ["a","b"] → ["a","b"]
const parseCoverage = (value) => {
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch (_) { /* plain CSV string */ }
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
};

const getVendorProfile = async (userId) => {
  const [rows] = await pool.query(
    `SELECT v.*, u.name AS owner_name, u.email, u.phone, u.avatar, u.status AS user_status
       FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.user_id = ?`,
    [userId]
  );
  if (!rows.length) throw ApiError.notFound('Vendor profile not found');
  const row = rows[0];
  const [cats] = await pool.query(
    `SELECT c.id, c.name, m.name AS module_name, m.code AS module_code
       FROM vendor_service_categories vsc
       JOIN service_categories c ON c.id = vsc.category_id
       JOIN service_modules m ON m.id = c.module_id
      WHERE vsc.vendor_id = ?`,
    [row.id]
  );
  const [[stats]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage = 'completed') AS completed_jobs,
       (SELECT COUNT(*) FROM jobs WHERE vendor_id = ? AND stage IN ('accepted','scheduled','in_progress','awaiting_approval')) AS active_jobs,
       (SELECT COUNT(*) FROM requests WHERE assigned_vendor_id = ? AND status = 'pending_review') AS pending_requests`,
    [row.id, row.id, row.id]
  );
  return {
    ...row,
    logo: toPublicUrl(row.logo),
    photo: toPublicUrl(row.photo),
    aadhar_front: toPublicUrl(row.aadhar_front),
    aadhar_back: toPublicUrl(row.aadhar_back),
    pan_front: toPublicUrl(row.pan_front),
    pan_back: toPublicUrl(row.pan_back),
    coverage_areas: parseCoverage(row.coverage_areas),
    rating: Number(row.rating),
    total_jobs: Number(row.total_jobs),
    kyc_complete: KYC_DOC_FIELDS.every((f) => row[f]),
    categories: cats,
    stats,
  };
};

router.get(
  '/profile',
  requireVendor,
  asyncHandler(async (req, res) => {
    sendSuccess(res, await getVendorProfile(req.user.id));
  })
);

router.put(
  '/profile',
  requireVendor,
  kycUpload.any(),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM vendors WHERE user_id = ?', [req.user.id]);
    if (!rows.length) throw ApiError.notFound('Vendor profile not found');
    const row = rows[0];
    const body = req.body || {};

    // coverage_areas: array or comma/JSON string → store CSV
    let coverage = null;
    if (body.coverage_areas !== undefined && body.coverage_areas !== null && body.coverage_areas !== '') {
      coverage = Array.isArray(body.coverage_areas)
        ? body.coverage_areas.map((s) => String(s).trim()).filter(Boolean).join(', ')
        : String(body.coverage_areas).trim();
    }

    const pincode =
      body.pincode !== undefined && body.pincode !== null && body.pincode !== ''
        ? String(body.pincode).trim()
        : null;
    if (pincode && !/^\d{6}$/.test(pincode)) throw ApiError.badRequest('pincode must be a 6-digit number');

    // register field is gst_no, PUT historically used gst_number — accept both
    const gstRaw = body.gst_number !== undefined ? body.gst_number : body.gst_no;
    const gst = gstRaw === null || gstRaw === undefined || gstRaw === '' ? null : String(gstRaw).trim();

    // optional file re-upload: logo + KYC docs (rejected vendor can resubmit)
    const files = req.files || [];
    const unknown = files.find((f) => f.fieldname !== 'logo' && !KYC_DOC_FIELDS.includes(f.fieldname));
    if (unknown) throw ApiError.badRequest(`Unknown file field: ${unknown.fieldname}`);
    const docs = files.length ? await uploadKycFiles(files) : {};
    const resubmittedKyc = KYC_DOC_FIELDS.some((f) => docs[f]);
    const resubmit = resubmittedKyc && row.status === 'rejected';
    const status = resubmit ? 'pending' : row.status;
    const rejectionReason = resubmit ? null : row.rejection_reason;

    await pool.query(
      `UPDATE vendors SET business_name = COALESCE(?, business_name), contact_person = COALESCE(?, contact_person),
              city = COALESCE(?, city), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
              coverage_areas = COALESCE(?, coverage_areas), address = COALESCE(?, address),
              gst_number = COALESCE(?, gst_number), logo = COALESCE(?, logo),
              photo = COALESCE(?, photo), aadhar_front = COALESCE(?, aadhar_front),
              aadhar_back = COALESCE(?, aadhar_back), pan_front = COALESCE(?, pan_front),
              pan_back = COALESCE(?, pan_back), status = ?, rejection_reason = ?
        WHERE user_id = ?`,
      [
        body.business_name || null, body.contact_person || null,
        body.city || null, body.state || null, pincode,
        coverage, body.address || null,
        gst, docs.logo || null,
        docs.photo || null, docs.aadhar_front || null,
        docs.aadhar_back || null, docs.pan_front || null,
        docs.pan_back || null, status, rejectionReason,
        req.user.id,
      ]
    );
    if (body.name && String(body.name).trim()) {
      await pool.query('UPDATE users SET name = ? WHERE id = ?', [String(body.name).trim(), req.user.id]);
    }
    if (resubmit) {
      await notify({
        userId: req.user.id,
        title: 'Documents resubmitted',
        body: 'Your KYC documents were received and are pending review.',
      });
    }
    sendSuccess(
      res,
      await getVendorProfile(req.user.id),
      resubmit ? 'Profile updated — documents pending review' : 'Profile updated'
    );
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
