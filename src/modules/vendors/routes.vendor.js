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

const inr = (n, dec = 0) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

const fmtClock = (d) => {
  const date = new Date(d);
  const today = new Date();
  const hm = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (date.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return `Today, ${hm}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${hm}`;
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
  const [[{ total_ratings }]] = await pool.query(
    `SELECT COUNT(*) AS total_ratings FROM service_reviews WHERE vendor_id = ? AND status = 'visible'`,
    [row.id]
  );
  return {
    ...row,
    is_online: !!row.is_online,
    gst_no: row.gst_number,
    total_ratings,
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
    sendSuccess(res, await getVendorProfile(req.user.id), 'Vendor profile retrieved');
  })
);

router.put(
  '/status/toggle',
  requireVendor,
  asyncHandler(async (req, res) => {
    const { is_online: isOnline } = req.body;
    if (typeof isOnline !== 'boolean') throw ApiError.badRequest('is_online must be a boolean');
    await pool.query('UPDATE vendors SET is_online = ? WHERE user_id = ?', [isOnline ? 1 : 0, req.user.id]);
    sendSuccess(res, { is_online: isOnline }, `Vendor status set to ${isOnline ? 'Online' : 'Offline'}`);
  })
);

router.get(
  '/services',
  requireVendor,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, m.name AS module_name, m.code AS module_code,
              c.status AS is_active, c.price AS base_price
         FROM vendor_service_categories vsc
         JOIN service_categories c ON c.id = vsc.category_id
         JOIN service_modules m ON m.id = c.module_id
        WHERE vsc.vendor_id = ? ORDER BY m.sort_order, c.sort_order`,
      [req.user.vendor.id]
    );
    sendSuccess(
      res,
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        module_name: r.module_name,
        module_code: r.module_code,
        is_active: !!r.is_active,
        base_price: r.base_price === null ? null : Number(r.base_price),
      }))
    );
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
    if (body.email !== undefined && body.email !== null && String(body.email).trim()) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw ApiError.badRequest('Invalid email address');
      const [dup] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
      if (dup.length) throw ApiError.conflict('This email is already linked to another account');
      await pool.query('UPDATE users SET email = ? WHERE id = ?', [email, req.user.id]);
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

// GET /vendor/dashboard — unified home screen (spec §3)
router.get(
  '/dashboard',
  requireVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const [[vendor]] = await pool.query('SELECT is_online, rating FROM vendors WHERE user_id = ?', [req.user.id]);

    const [[today]] = await pool.query(
      `SELECT COUNT(*) AS jobs_done, COALESCE(SUM(amount), 0) AS earnings
         FROM jobs WHERE vendor_id = ? AND stage = 'completed'
          AND completed_at IS NOT NULL AND DATE(completed_at) = CURDATE()`,
      [vendorId]
    );

    const [[weeks]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) THEN amount END), 0) AS this_week,
              COALESCE(SUM(CASE WHEN completed_at >= DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE()) + 7) DAY)
                                 AND completed_at <  DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) THEN amount END), 0) AS last_week
         FROM jobs WHERE vendor_id = ? AND stage = 'completed'`,
      [vendorId]
    );
    const growthPct = weeks.last_week > 0
      ? Math.round(((weeks.this_week - weeks.last_week) / weeks.last_week) * 100)
      : weeks.this_week > 0 ? 100 : 0;
    const growthBadge = `${growthPct >= 0 ? '+' : ''}${growthPct}% vs Last Week`;

    const [[open]] = await pool.query(
      `SELECT COUNT(*) AS open_count,
              COALESCE(SUM(r.status = 'pending_review'), 0) AS awaiting
         FROM requests r
        WHERE (r.assigned_vendor_id = ? OR EXISTS (
                SELECT 1 FROM request_assignments a WHERE a.request_id = r.id AND a.vendor_id = ? AND a.status = 'active'))
          AND r.status NOT IN ('completed','closed','cancelled')`,
      [vendorId, vendorId]
    );

    const [[techs]] = await pool.query(
      `SELECT COALESCE(SUM(status = 'active'), 0) AS active_count FROM technicians WHERE vendor_id = ?`,
      [vendorId]
    );
    const [[onDuty]] = await pool.query(
      `SELECT COUNT(*) AS on_duty FROM technician_attendance a
         JOIN technicians t ON t.id = a.technician_id
        WHERE t.vendor_id = ? AND a.attendance_date = CURDATE() AND a.status = 'present'`,
      [vendorId]
    );

    const [[{ total_ratings }]] = await pool.query(
      `SELECT COUNT(*) AS total_ratings FROM service_reviews WHERE vendor_id = ? AND status = 'visible'`,
      [vendorId]
    );

    // revenue chart: current week Mon..Sun (WEEKDAY(): Mon=0 → Monday of this week)
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const startStr = monday.toISOString().slice(0, 10);
    const [daily] = await pool.query(
      `SELECT DATE(completed_at) AS d, COALESCE(SUM(amount), 0) AS amt
         FROM jobs WHERE vendor_id = ? AND stage = 'completed'
          AND completed_at >= ? AND completed_at < DATE_ADD(?, INTERVAL 7 DAY)
        GROUP BY DATE(completed_at)`,
      [vendorId, startStr, startStr]
    );
    const dayMap = new Map(daily.map((x) => [x.d.toISOString().slice(0, 10), Number(x.amt)]));
    const chart = [];
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(`${startStr}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + i);
      const key = dt.toISOString().slice(0, 10);
      chart.push({
        day: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        amount: inr(dayMap.get(key) || 0),
        _amt: dayMap.get(key) || 0,
        is_highest: false,
      });
    }
    const maxAmt = Math.max(...chart.map((c) => c._amt));
    chart.forEach((c) => {
      c.ratio = maxAmt > 0 ? Number((c._amt / maxAmt).toFixed(2)) : 0;
      c.is_highest = maxAmt > 0 && c._amt === maxAmt;
      delete c._amt;
    });
    const realWeekTotal = daily.reduce((s, x) => s + Number(x.amt), 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const selected = chart.find((c, i) => {
      const dt = new Date(`${startStr}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + i);
      return dt.toISOString().slice(0, 10) === todayKey;
    });

    const [incomingRows] = await pool.query(
      `SELECT r.ticket_no, r.title, r.estimated_amount, r.created_at,
              c.name AS category_name, u.name AS customer_name, u.phone AS customer_phone,
              r.site_location, r.city
         FROM requests r
         JOIN users u ON u.id = r.customer_id
         LEFT JOIN service_categories c ON c.id = r.category_id
        WHERE r.assigned_vendor_id = ? AND r.status = 'pending_review'
        ORDER BY r.created_at DESC LIMIT 10`,
      [vendorId]
    );

    const rating = Number(vendor.rating || 0);
    sendSuccess(
      res,
      {
        is_online: !!vendor.is_online,
        stats: {
          today_earnings: {
            amount: inr(today.earnings, 2),
            jobs_done: Number(today.jobs_done),
            display_text: `• ${today.jobs_done} Jobs Done`,
          },
          total_earnings: {
            amount: inr(weeks.total),
            growth: `${growthPct >= 0 ? '+' : ''}${growthPct}% this week`,
          },
          active_bookings: {
            count: Number(open.open_count),
            display_text: `${open.open_count} Orders`,
            awaiting_dispatch: Number(open.awaiting),
            subtitle: `${open.awaiting} awaiting dispatch`,
          },
          technicians: {
            active_count: Number(techs.active_count),
            display_text: `${techs.active_count} Active`,
            on_duty: Number(onDuty.on_duty),
            subtitle: `${onDuty.on_duty} on service duty`,
          },
          vendor_rating: {
            rating,
            display_text: `${rating} ★`,
            reviews_count: Number(total_ratings),
            subtitle: `Based on ${total_ratings} reviews`,
          },
        },
        revenue_chart: {
          title: 'Weekly Revenue Pulse',
          total_earned: inr(realWeekTotal),
          subtitle: `${inr(realWeekTotal)} earned this week`,
          growth_badge: growthBadge,
          selected_day: selected ? selected.day : null,
          chart,
        },
        incoming_requests: incomingRows.map((r) => ({
          id: r.ticket_no,
          service: r.title,
          category: r.category_name,
          customer: r.customer_name,
          phone: r.customer_phone,
          address: [r.site_location, r.city].filter(Boolean).join(', '),
          time: fmtClock(r.created_at),
          amount: r.estimated_amount != null ? inr(r.estimated_amount) : null,
          status: 'Pending',
          technician: 'Unassigned',
        })),
      },
      'Dashboard data retrieved successfully'
    );
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
