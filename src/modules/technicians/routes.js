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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SUB_STATUSES = ['on_the_way', 'reached', 'started'];
const SUB_RANK = { assigned: 0, on_the_way: 1, reached: 2, started: 3, in_progress: 4, completed: 5 };
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const todayStr = () => new Date().toISOString().slice(0, 10);
const empCode = (t) => t.employee_code || `TECH-${String(t.id).padStart(4, '0')}`;
const fmtPhone = (p) => {
  if (!p) return null;
  const s = String(p).replace(/\D/g, '').slice(-10);
  return `+91 ${s.slice(0, 5)} ${s.slice(5)}`;
};
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const fmtDateShort = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d} ${MONTHS_SHORT[Number(m) - 1]}`;
};
const fmtDateFull = (s) => {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d} ${MONTHS_SHORT[Number(m) - 1]} ${y}`;
};
const fmtDateTime = (s) => {
  if (!s) return null;
  const str = String(s);
  const datePart = str.slice(0, 10);
  const timePart = str.slice(11, 16);
  if (!timePart) return fmtDateFull(datePart);
  let [hh, mm] = timePart.split(':').map(Number);
  const ap = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  return `${fmtDateFull(datePart)}, ${hh}:${String(mm).padStart(2, '0')} ${ap}`;
};
const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const requireTechnician = asyncHandler(async (req, res, next) => {
  const [rows] = await pool.query(
    `SELECT t.*, v.business_name, vu.phone AS contact_phone
       FROM technicians t
       JOIN vendors v ON v.id = t.vendor_id
       LEFT JOIN users vu ON vu.id = v.user_id
      WHERE t.user_id = ?`,
    [req.user.id]
  );
  if (!rows.length) throw ApiError.forbidden('No technician account linked to this user');
  if (rows[0].status !== 'active') {
    throw ApiError.forbidden('Your technician account is not active. Please contact your Service Provider.', {
      status: rows[0].status,
    });
  }
  req.technician = rows[0];
  next();
});

const lastTechLocation = async (technicianId) => {
  const [rows] = await pool.query(
    `SELECT latitude, longitude FROM technician_locations
      WHERE technician_id = ? ORDER BY id DESC LIMIT 1`,
    [technicianId]
  );
  return rows[0] || null;
};

const distanceLabel = (loc, lat, lon, suffix = '') => {
  if (!loc || lat == null || lon == null) return null;
  const km = haversineKm(Number(loc.latitude), Number(loc.longitude), Number(lat), Number(lon));
  if (!Number.isFinite(km)) return null;
  return `${km.toFixed(1)} km${suffix}`;
};

// resolve a job owned by this technician: accepts job_no or numeric id
const getTechJob = async (techId, idOrNo) => {
  const numeric = /^\d+$/.test(String(idOrNo));
  const [rows] = await pool.query(
    `SELECT j.*, r.title AS service_title, r.description AS request_description,
            r.site_location, r.city, r.latitude, r.longitude, r.priority, r.customer_id,
            r.status AS request_status, r.ticket_no AS request_ticket,
            m.name AS module_name, c.name AS category_name,
            u.name AS customer_name, u.phone AS customer_phone
       FROM jobs j
       JOIN requests r ON r.id = j.request_id
       JOIN request_technicians rt ON rt.request_id = r.id AND rt.technician_id = ?
       JOIN service_modules m ON m.id = r.module_id
       LEFT JOIN service_categories c ON c.id = r.category_id
       JOIN users u ON u.id = r.customer_id
      WHERE ${numeric ? '(j.job_no = ? OR j.id = ?)' : 'j.job_no = ?'}
      LIMIT 1`,
    numeric ? [techId, idOrNo, Number(idOrNo)] : [techId, idOrNo]
  );
  if (!rows.length) throw ApiError.notFound('Job not found');
  return rows[0];
};

const jobAddress = (job) =>
  [job.site_location, job.city].filter(Boolean).join(', ') || null;

/* ======================= 2. PROFILE / DUTY / SKILLS ======================= */

router.get(
  '/profile',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const [[counts]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage = 'completed'`,
      [t.id]
    );
    sendSuccess(res, {
      id: t.id,
      name: t.name,
      Score: null,
      phone: fmtPhone(t.phone),
      email: t.email || null,
      address: t.address || null,
      photo: toPublicUrl(t.photo),
      employee_code: empCode(t),
      vendor: {
        id: t.vendor_id,
        business_name: t.business_name,
        contact_phone: fmtPhone(t.contact_phone),
      },
      is_on_duty: !!t.is_online,
      rating: null,
      total_jobs_completed: Number(counts.total) || 0,
    });
  })
);

router.put(
  '/status/duty',
  requireTechnician,
  asyncHandler(async (req, res) => {
    if (typeof req.body.is_on_duty !== 'boolean') {
      throw ApiError.badRequest('is_on_duty must be a boolean');
    }
    await pool.query('UPDATE technicians SET is_online = ? WHERE id = ?', [
      req.body.is_on_duty ? 1 : 0,
      req.technician.id,
    ]);
    sendSuccess(
      res,
      { is_on_duty: req.body.is_on_duty },
      req.body.is_on_duty ? 'Duty status updated to On-Duty' : 'Duty status updated to Off-Duty'
    );
  })
);

router.get(
  '/skills',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT ts.category_id, cat.name, cat.image, cat.status, sm.name AS module_name
         FROM technician_services ts
         JOIN service_categories cat ON cat.id = ts.category_id
         JOIN service_modules sm ON sm.id = cat.module_id
        WHERE ts.technician_id = ?
        ORDER BY cat.sort_order, cat.id`,
      [req.technician.id]
    );
    sendSuccess(
      res,
      rows.map((r) => ({
        id: r.category_id,
        name: r.name,
        category: r.module_name,
        level: null,
        Status: r.status ? 'Active' : 'Inactive',
        Photo: toPublicUrl(r.image),
      }))
    );
  })
);

/* ======================= 3. ATTENDANCE ======================= */

router.get(
  '/attendance',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const now = new Date();
    let year = Number(req.query.year) || now.getFullYear();
    let month = Number(req.query.month) || now.getMonth() + 1;
    if (req.query.month && MONTH_RE.test(String(req.query.month))) {
      const [y, m] = String(req.query.month).split('-');
      year = Number(y);
      month = Number(m);
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw ApiError.badRequest('year must be a valid year');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw ApiError.badRequest('month must be 1-12 (or YYYY-MM)');
    }

    const t = req.technician;
    const [rows] = await pool.query(
      `SELECT attendance_date, status, notes FROM technician_attendance
        WHERE technician_id = ? AND YEAR(attendance_date) = ? AND MONTH(attendance_date) = ?
        ORDER BY attendance_date`,
      [t.id, year, month]
    );
    const [[todayRow]] = await pool.query(
      `SELECT status FROM technician_attendance WHERE technician_id = ? AND attendance_date = CURDATE()`,
      [t.id]
    );
    const attended = rows.filter((r) => ['present', 'late', 'half_day'].includes(r.status));
    const isMarked = !!todayRow;
    const day = todayStr();

    sendSuccess(res, {
      technician: {
        name: t.name,
        avatar: initials(t.name),
        designation: t.skill || null,
        employee_code: empCode(t),
        is_verified: t.status === 'active',
      },
      today: {
        date: day,
        is_marked_today: isMarked,
        status_text: isMarked
          ? 'Today: Attendance Marked & Active'
          : 'Today: Not Marked Yet (Duty Pending)',
      },
      month,
      year,
      month_name: MONTHS_FULL[month - 1],
      total_days_joined: attended.length,
      summary_text: `You've joined ${attended.length} days this month`,
      attended_days: attended.map((r) =>
        String(r.attendance_date).slice(0, 10)
      ),
    });
  })
);

router.post(
  '/attendance',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const date = req.body.date || todayStr();
    if (!DATE_RE.test(date)) throw ApiError.badRequest('date must be YYYY-MM-DD');
    if (date > todayStr()) throw ApiError.badRequest('Attendance date cannot be in the future');

    const t = req.technician;
    const [[existing]] = await pool.query(
      `SELECT id FROM technician_attendance WHERE technician_id = ? AND attendance_date = ?`,
      [t.id, date]
    );
    if (existing) {
      throw ApiError.badRequest(
        date === todayStr()
          ? `Attendance already marked for today (${date})`
          : `Attendance already marked for ${date}`
      );
    }
    await pool.query(
      `INSERT INTO technician_attendance (technician_id, attendance_date, status, marked_by)
       VALUES (?, ?, 'present', ?)`,
      [t.id, date, req.user.id]
    );
    // "Duty activated" → also flip the technician online
    await pool.query('UPDATE technicians SET is_online = 1 WHERE id = ?', [t.id]);

    const [[counts]] = await pool.query(
      `SELECT COUNT(*) AS n FROM technician_attendance
        WHERE technician_id = ? AND YEAR(attendance_date) = ? AND MONTH(attendance_date) = ?
          AND status IN ('present','late','half_day')`,
      [t.id, Number(date.slice(0, 4)), Number(date.slice(5, 7))]
    );
    sendSuccess(
      res,
      {
        date,
        is_marked_today: date === todayStr(),
        total_days_joined: Number(counts.n) || 0,
        status: 'present',
        status_text:
          date === todayStr()
            ? 'Today: Attendance Marked & Active'
            : `Attendance marked for ${date}`,
      },
      'Attendance marked successfully! Duty activated for today.',
      201
    );
  })
);

/* ======================= 4. DASHBOARD ======================= */

router.get(
  '/dashboard',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const loc = await lastTechLocation(t.id);

    const [[todayStats]] = await pool.query(
      `SELECT COALESCE(SUM(j.amount), 0) AS earnings, COUNT(*) AS n
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage = 'completed' AND j.completed_at >= CURDATE()`,
      [t.id]
    );

    const [[openJobs]] = await pool.query(
      `SELECT COUNT(*) AS n
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage NOT IN ('completed','cancelled')`,
      [t.id]
    );
    const [[assignedNoJob]] = await pool.query(
      `SELECT COUNT(*) AS n
         FROM request_technicians rt
         JOIN requests r ON r.id = rt.request_id
         LEFT JOIN jobs j ON j.request_id = r.id
        WHERE rt.technician_id = ? AND j.id IS NULL
          AND r.status NOT IN ('completed','closed','cancelled')`,
      [t.id]
    );

    // active job: latest open job
    const [activeRows] = await pool.query(
      `SELECT j.id, j.job_no, j.stage, j.sub_status, j.schedule_date, j.amount, j.customer_otp,
              r.title, r.description, r.site_location, r.city, r.latitude, r.longitude,
              r.priority, r.customer_id,
              m.name AS module_name, c.name AS category_name,
              u.name AS customer_name, u.phone AS customer_phone
         FROM jobs j
         JOIN requests r ON r.id = j.request_id
         JOIN request_technicians rt ON rt.request_id = r.id AND rt.technician_id = ?
         JOIN service_modules m ON m.id = r.module_id
         LEFT JOIN service_categories c ON c.id = r.category_id
         JOIN users u ON u.id = r.customer_id
        WHERE j.stage NOT IN ('completed','cancelled')
        ORDER BY j.updated_at DESC
        LIMIT 1`,
      [t.id]
    );
    const a = activeRows[0];
    const activeJob = a
      ? {
          id: a.job_no,
          service: a.title,
          category: a.category_name || a.module_name,
          status: a.sub_status || 'assigned',
          customer_name: a.customer_name,
          customer_phone: fmtPhone(a.customer_phone),
          address: jobAddress(a),
          distance: distanceLabel(loc, a.latitude, a.longitude, ' away'),
          customer_lat: a.latitude != null ? Number(a.latitude) : null,
          customer_lng: a.longitude != null ? Number(a.longitude) : null,
          scheduled_time: a.schedule_date
            ? a.schedule_date === todayStr()
              ? 'Today'
              : fmtDateShort(a.schedule_date)
            : null,
          amount: a.amount != null ? Number(a.amount) : null,
          is_urgent: a.priority === 'urgent',
          customer_otp: a.customer_otp || null,
          instructions: a.description || null,
        }
      : null;

    // weekly chart: Mon–Sun of current week
    const [weekRows] = await pool.query(
      `SELECT DATE(j.completed_at) AS d, COALESCE(SUM(j.amount), 0) AS amt, COUNT(*) AS n
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage = 'completed'
          AND j.completed_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
          AND j.completed_at <  DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)
        GROUP BY DATE(j.completed_at)`,
      [t.id]
    );
    const byDay = {};
    for (const r of weekRows) {
      const key = String(r.d).slice(0, 10);
      byDay[key] = { amt: Number(r.amt), n: Number(r.n) };
    }
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const weekly = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const bucket = byDay[key] || { amt: 0, n: 0 };
      weekly.push({
        label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
        amount: bucket.amt,
        jobs: bucket.n,
      });
    }
    const maxAmt = Math.max(...weekly.map((w) => w.amount));
    weekly.forEach((w) => {
      w.ratio = maxAmt > 0 ? Math.round((w.amount / maxAmt) * 100) / 100 : 0;
      w.is_highest = maxAmt > 0 && w.amount === maxAmt;
    });

    sendSuccess(res, {
      is_on_duty: !!t.is_online,
      today_earnings: Number(todayStats.earnings) || 0,
      today_completed_jobs: Number(todayStats.n) || 0,
      pending_tasks: Number(openJobs.n || 0) + Number(assignedNoJob.n || 0),
      active_job: activeJob,
      weekly_chart: weekly,
    });
  })
);

/* ======================= 5. JOBS ======================= */

router.get(
  '/jobs',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const status = req.query.status;
    if (status && !['assigned', 'ongoing', 'completed'].includes(status)) {
      throw ApiError.badRequest('status must be assigned, ongoing or completed');
    }
    let filter = '';
    if (status === 'assigned') {
      filter = `AND (j.sub_status IS NULL OR j.sub_status = 'assigned') AND j.stage NOT IN ('completed','cancelled')`;
    } else if (status === 'ongoing') {
      filter = `AND j.sub_status IN ('on_the_way','reached','started','in_progress') AND j.stage NOT IN ('completed','cancelled')`;
    } else if (status === 'completed') {
      filter = `AND j.stage = 'completed'`;
    }

    const [rows] = await pool.query(
      `SELECT j.id, j.job_no, j.stage, j.sub_status, j.schedule_date, j.amount,
              r.title, r.site_location, r.city, r.latitude, r.longitude, r.priority,
              m.name AS module_name, c.name AS category_name,
              u.name AS customer_name, u.phone AS customer_phone
         FROM jobs j
         JOIN requests r ON r.id = j.request_id
         JOIN request_technicians rt ON rt.request_id = r.id AND rt.technician_id = ?
         JOIN service_modules m ON m.id = r.module_id
         LEFT JOIN service_categories c ON c.id = r.category_id
         JOIN users u ON u.id = r.customer_id
        WHERE 1=1 ${filter}
        ORDER BY j.updated_at DESC
        LIMIT 100`,
      [t.id]
    );
    const loc = await lastTechLocation(t.id);

    const items = rows.map((r) => {
      const tabStatus =
        r.stage === 'completed'
          ? 'completed'
          : ['on_the_way', 'reached', 'started', 'in_progress'].includes(r.sub_status)
            ? 'ongoing'
            : 'assigned';
      return {
        id: r.job_no,
        service: r.title,
        category: r.category_name || r.module_name,
        status: tabStatus,
        sub_status: r.sub_status || (r.stage === 'completed' ? 'completed' : 'assigned'),
        customer_name: r.customer_name,
        customer_phone: fmtPhone(r.customer_phone),
        address: [r.site_location, r.city].filter(Boolean).join(', ') || null,
        distance: distanceLabel(loc, r.latitude, r.longitude),
        time: r.schedule_date
          ? r.schedule_date === todayStr()
            ? 'Today'
            : fmtDateShort(r.schedule_date)
          : null,
        amount: r.amount != null ? Number(r.amount) : null,
        is_urgent: r.priority === 'urgent',
      };
    });
    sendSuccess(res, items);
  })
);

router.get(
  '/jobs/:id',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const job = await getTechJob(t.id, req.params.id);
    const loc = await lastTechLocation(t.id);

    let items = [];
    if (job.quotation_id) {
      const [qi] = await pool.query(
        `SELECT item_name, quantity, rate FROM quotation_items WHERE quotation_id = ? ORDER BY sort_order, id`,
        [job.quotation_id]
      );
      items = qi.map((x) => ({ name: x.item_name, qty: Number(x.quantity), price: Number(x.rate) }));
    }

    const [history] = await pool.query(
      `SELECT stage, created_at FROM job_status_history WHERE job_id = ? ORDER BY created_at ASC, id ASC`,
      [job.id]
    );
    const findTime = (stages) => {
      const hit = history.find((h) => stages.includes(h.stage));
      return hit ? fmtDateTime(hit.created_at) : null;
    };
    const cur = job.sub_status || (job.stage === 'completed' ? 'completed' : 'assigned');
    const rank = SUB_RANK[cur] ?? 0;
    const steps = [
      { title: 'Job Assigned', time: findTime(['accepted']) || fmtDateTime(job.created_at), is_done: true },
      { title: 'On The Way', time: findTime(['on_the_way']), is_done: rank >= 1 },
      { title: 'Reached Location', time: findTime(['reached']), is_done: rank >= 2 },
      { title: 'Service In Progress', time: findTime(['started', 'in_progress']), is_done: rank >= 3 },
      { title: 'Job Completed', time: findTime(['completed']) || fmtDateTime(job.completed_at), is_done: rank >= 5 },
    ];

    sendSuccess(res, {
      id: job.job_no,
      service: job.service_title,
      category: job.category_name || job.module_name,
      status: cur,
      amount: job.amount != null ? Number(job.amount) : null,
      payment_mode: null,
      is_urgent: job.priority === 'urgent',
      customer: {
        name: job.customer_name,
        phone: fmtPhone(job.customer_phone),
        address: jobAddress(job),
        latitude: job.latitude != null ? Number(job.latitude) : null,
        longitude: job.longitude != null ? Number(job.longitude) : null,
      },
      distance: distanceLabel(loc, job.latitude, job.longitude, ' away'),
      customer_otp: job.customer_otp || null,
      notes: job.request_description || null,
      service_items: items,
      timeline: steps,
    });
  })
);

router.put(
  '/jobs/:id/status',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const { status } = req.body;
    if (!SUB_STATUSES.includes(status)) {
      throw ApiError.badRequest(`status must be one of: ${SUB_STATUSES.join(', ')}`);
    }
    const job = await getTechJob(t.id, req.params.id);
    if (job.stage === 'completed') throw ApiError.badRequest('Job is already completed');

    await pool.query('UPDATE jobs SET sub_status = ? WHERE id = ?', [status, job.id]);
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, ?, ?, ?)`,
      [job.id, status, `Status → ${status.replace('_', ' ')}`, req.user.id]
    );
    sendSuccess(res, { id: job.job_no, status }, `Job status updated to ${status.replace('_', ' ')}`);
  })
);

router.post(
  '/jobs/:id/verify-otp',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const otpCode = String(req.body.otp || '').trim();
    if (!/^\d{4,6}$/.test(otpCode)) throw ApiError.badRequest('otp must be 4-6 digits');
    const job = await getTechJob(t.id, req.params.id);
    if (job.stage === 'completed') throw ApiError.badRequest('Job is already completed');
    if (!job.customer_otp) throw ApiError.badRequest('OTP not available for this job');
    if (String(job.customer_otp) !== otpCode) throw ApiError.badRequest('Invalid OTP');

    await pool.query(
      `UPDATE jobs SET sub_status = 'in_progress', stage = 'in_progress',
              started_at = COALESCE(started_at, NOW())
        WHERE id = ?`,
      [job.id]
    );
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, 'in_progress', 'Customer OTP verified', ?)`,
      [job.id, req.user.id]
    );
    sendSuccess(res, { id: job.job_no, is_otp_verified: true, status: 'in_progress' }, 'OTP verified');
  })
);

router.post(
  '/jobs/:id/complete',
  requireTechnician,
  jobUpload.fields([
    { name: 'before_photo', maxCount: 1 },
    { name: 'after_photo', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const t = req.technician;
    const job = await getTechJob(t.id, req.params.id);
    if (job.stage === 'completed') throw ApiError.badRequest('Job is already completed');

    const before = (req.files || []).before_photo && req.files.before_photo[0];
    const after = (req.files || []).after_photo && req.files.after_photo[0];
    if (!before) throw ApiError.badRequest('before_photo is required');
    if (!after) throw ApiError.badRequest('after_photo is required');

    const notes = req.body.completion_notes ? String(req.body.completion_notes).trim() : null;
    let extra = null;
    if (req.body.extra_parts_cost !== undefined && String(req.body.extra_parts_cost).trim() !== '') {
      const v = Number(req.body.extra_parts_cost);
      if (!Number.isFinite(v) || v < 0) throw ApiError.badRequest('extra_parts_cost must be a non-negative number');
      extra = v;
    }
    let collected = null;
    if (req.body.payment_collected !== undefined && String(req.body.payment_collected).trim() !== '') {
      collected = ['true', '1', 'yes'].includes(String(req.body.payment_collected).toLowerCase()) ? 1 : 0;
    }

    await pool.query(
      `UPDATE jobs SET stage = 'completed', sub_status = 'completed', completed_at = NOW(),
              completion_notes = ?, extra_parts_cost = ?, payment_collected = ?
        WHERE id = ?`,
      [notes, extra, collected, job.id]
    );
    for (const [file, kind] of [[before, 'before'], [after, 'after']]) {
      await pool.query(
        `INSERT INTO job_attachments (job_id, file_path, file_type, original_name, kind)
         VALUES (?, ?, ?, ?, ?)`,
        [job.id, `jobs/${file.filename}`, classifyFileType(file.mimetype), file.originalname, kind]
      );
    }
    await pool.query(
      `INSERT INTO job_status_history (job_id, stage, note, changed_by) VALUES (?, 'completed', ?, ?)`,
      [job.id, notes || 'Completed by technician', req.user.id]
    );

    // close the request too (mirror vendor completion)
    if (job.request_status !== 'completed' && job.request_status !== 'closed') {
      await pool.query(`UPDATE requests SET status = 'completed' WHERE id = ?`, [job.request_id]);
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'completed', ?, ?)`,
        [job.request_id, `Job ${job.job_no} → completed`, req.user.id]
      );
    }
    try {
      await notify({
        userId: job.customer_id,
        event: 'job_stage_updated',
        type: 'job',
        title: `Job ${job.job_no} — completed`,
        data: { job_no: job.job_no, stage: 'completed' },
      });
    } catch (_) { /* non-fatal */ }

    const [[fresh]] = await pool.query(
      `SELECT DATE_FORMAT(completed_at, '%Y-%m-%d %H:%i:%s') AS completion_time FROM jobs WHERE id = ?`,
      [job.id]
    );
    sendSuccess(
      res,
      {
        id: job.job_no,
        status: 'completed',
        earned_commission: null,
        completion_time: fresh ? fresh.completion_time : null,
      },
      'Job completed successfully',
      201
    );
  })
);

/* ======================= 6. LOCATION / EARNINGS / SAFETY / SUPPORT ======================= */

router.post(
  '/location/update',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const lat = Number(req.body.latitude);
    const lon = Number(req.body.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw ApiError.badRequest('latitude must be a valid number between -90 and 90');
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw ApiError.badRequest('longitude must be a valid number between -180 and 180');
    }
    const heading = req.body.heading !== undefined && String(req.body.heading).trim() !== '' ? Number(req.body.heading) : null;
    const speed = req.body.speed !== undefined && String(req.body.speed).trim() !== '' ? Number(req.body.speed) : null;
    const activeJobId = req.body.active_job_id ? String(req.body.active_job_id) : null;
    await pool.query(
      `INSERT INTO technician_locations (technician_id, latitude, longitude, heading, speed, active_job_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.technician.id, lat, lon, Number.isFinite(heading) ? heading : null, Number.isFinite(speed) ? speed : null, activeJobId]
    );
    sendSuccess(res, null, 'Location updated');
  })
);

const periodRange = (period) => {
  // returns { start, end, prevStart, kind } — windows are [start, end)
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (period === 'this_week') {
    const dow = (now.getDay() + 6) % 7; // Mon=0
    const start = new Date(y, m, d - dow);
    const end = new Date(y, m, d - dow + 7);
    const prevStart = new Date(y, m, d - dow - 7);
    return { start, end, prevStart, kind: 'week' };
  }
  if (period === 'this_month') {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 1);
    const prevStart = new Date(y, m - 1, 1);
    return { start, end, prevStart, kind: 'month' };
  }
  const start = new Date(y, m, d);
  const end = new Date(y, m, d + 1);
  const prevStart = new Date(y, m, d - 1);
  return { start, end, prevStart, kind: 'day' };
};

const dateOnly = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const growthPct = (cur, prev) => {
  if (prev === 0) return cur === 0 ? '0.0%' : '+100.0%';
  const g = ((cur - prev) / prev) * 100;
  return `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`;
};

router.get(
  '/earnings',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const period = ['today', 'this_week', 'this_month'].includes(req.query.period)
      ? req.query.period
      : 'today';
    const range = periodRange(period);
    const t = req.technician;

    const [rows] = await pool.query(
      `SELECT j.amount, j.payment_collected, j.completed_at
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage = 'completed' AND j.completed_at >= ? AND j.completed_at < ?`,
      [t.id, dateOnly(range.start), dateOnly(range.end)]
    );
    // prev window = [prevStart, start)
    const [prevRows] = await pool.query(
      `SELECT COALESCE(SUM(j.amount), 0) AS total
         FROM jobs j
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
        WHERE j.stage = 'completed' AND j.completed_at >= ? AND j.completed_at < ?`,
      [t.id, dateOnly(range.prevStart), dateOnly(range.start)]
    );

    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const count = rows.length;
    const prevTotal = Number(prevRows[0].total) || 0;
    const avg = count > 0 ? total / count : 0;
    const growth = growthPct(total, prevTotal);

    const cash = rows
      .filter((r) => Number(r.payment_collected) === 1)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const digital = total - cash;

    // trend buckets
    let buckets = [];
    if (range.kind === 'day') {
      for (let h = 0; h <= 23; h++) {
        buckets.push({
          label: `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`,
          key: h,
        });
      }
    } else if (range.kind === 'week') {
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((label, i) => buckets.push({ label, key: i }));
    } else {
      const last = new Date(range.start.getFullYear(), range.start.getMonth() + 1, 0).getDate();
      for (let dd = 1; dd <= last; dd++) buckets.push({ label: String(dd), key: dd });
    }

    const bucketAgg = {};
    for (const r of rows) {
      const dt = new Date(String(r.completed_at).replace(' ', 'T'));
      let key;
      if (range.kind === 'day') key = dt.getHours();
      else if (range.kind === 'week') key = (dt.getDay() + 6) % 7;
      else key = dt.getDate();
      if (!bucketAgg[key]) bucketAgg[key] = { amt: 0, n: 0 };
      bucketAgg[key].amt += Number(r.amount || 0);
      bucketAgg[key].n += 1;
    }

    let cum = 0;
    let cumN = 0;
    let lastGrowthIdx = 0;
    const points = buckets.map((b, i) => {
      const agg = bucketAgg[b.key] || { amt: 0, n: 0 };
      cum += agg.amt;
      cumN += agg.n;
      if (agg.n > 0) lastGrowthIdx = i;
      return { label: b.label, amount: Math.round(cum), jobs: cumN, _raw: agg.amt };
    });
    const maxAmt = Math.max(...points.map((p) => p.amount));
    const firstMaxIdx = points.findIndex((p) => p.amount === maxAmt && maxAmt > 0);
    points.forEach((p, i) => {
      p.formatted = inr(p.amount);
      p.ratio = maxAmt > 0 ? Math.round((p.amount / maxAmt) * 100) / 100 : 0;
      p.is_highest = maxAmt > 0 && i === firstMaxIdx;
      delete p._raw;
    });

    sendSuccess(res, {
      period,
      hero_card: {
        total_amount: inr(total),
        currency: 'INR',
        growth_percentage: growth,
        completed_tasks: `${count} Job${count === 1 ? '' : 's'}`,
        average_per_job: inr(avg),
      },
      cash_vs_digital: {
        digital_wallet: inr(digital),
        cash_in_hand: inr(cash),
      },
      analytics: {
        trend_chart: points,
        growth_badge: `${growth} growth`,
        active_index: points.length ? lastGrowthIdx : 0,
      },
      donut_share: null,
    });
  })
);

router.get(
  '/earnings/history',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const period = ['today', 'this_week', 'this_month'].includes(req.query.period)
      ? req.query.period
      : 'today';
    const range = periodRange(period);
    const t = req.technician;

    const [rows] = await pool.query(
      `SELECT j.job_no, j.amount, j.payment_collected, j.completed_at,
              r.title, u.name AS customer_name
         FROM jobs j
         JOIN requests r ON r.id = j.request_id
         JOIN request_technicians rt ON rt.request_id = j.request_id AND rt.technician_id = ?
         JOIN users u ON u.id = r.customer_id
        WHERE j.stage = 'completed' AND j.completed_at >= ? AND j.completed_at < ?
        ORDER BY j.completed_at DESC`,
      [t.id, dateOnly(range.start), dateOnly(range.end)]
    );

    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const today = todayStr();
    const yesterday = dateOnly(new Date(Date.now() - 86400000));
    const fmtHistoryDate = (s) => {
      const day = String(s).slice(0, 10);
      const time = String(s).slice(11, 16);
      let hh = Number((time || '00:00').split(':')[0]);
      const mm = (time || '00:00').split(':')[1] || '00';
      const ap = hh >= 12 ? 'PM' : 'AM';
      hh = hh % 12 || 12;
      const clock = time ? `${hh}:${mm} ${ap}` : null;
      if (day === today && clock) return `Today, ${clock}`;
      if (day === yesterday && clock) return `Yesterday, ${clock}`;
      return fmtDateFull(day);
    };

    sendSuccess(res, {
      period,
      total_jobs: rows.length,
      total_payout: inr(total),
      payout_history: rows.map((r) => {
        const isCash = Number(r.payment_collected) === 1;
        return {
          id: `#${r.job_no}`,
          service: r.title,
          customer: r.customer_name,
          date: fmtHistoryDate(r.completed_at),
          amount: inr(r.amount),
          mode: isCash ? 'Cash Collected' : 'Online Paid',
          status: isCash ? 'Cash Collected' : 'Received',
        };
      }),
    });
  })
);

const SAFETY_GUIDELINES = [
  {
    group: 'Personal Safety',
    guidelines: [
      {
        id: 1,
        title: 'Wear protective gear',
        description: 'Always wear gloves, safety shoes and eye protection while working on any job site.',
      },
      {
        id: 2,
        title: 'Inspect tools before use',
        description: 'Check tools and cables for damage before every job. Never use faulty equipment.',
      },
      {
        id: 3,
        title: 'Switch off power first',
        description: 'Turn off mains power before starting any electrical work. Verify with a tester.',
      },
    ],
  },
  {
    group: 'Job Site Safety',
    guidelines: [
      {
        id: 4,
        title: 'Confirm job details',
        description: 'Verify customer name, address and job scope before starting work. Share your ETA.',
      },
      {
        id: 5,
        title: 'Keep the area clean',
        description: 'Protect the customer premises with drop sheets and clean up thoroughly after completion.',
      },
      {
        id: 6,
        title: 'Emergency? Call for help',
        description: 'In case of accident or hazard, move to safety and contact support or use SOS immediately.',
      },
    ],
  },
];

router.get(
  '/safety-guidelines',
  requireTechnician,
  asyncHandler(async (req, res) => {
    sendSuccess(res, SAFETY_GUIDELINES);
  })
);

router.post(
  '/support/messages',
  requireTechnician,
  asyncHandler(async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) throw ApiError.badRequest('message is required');
    const jobId = req.body.job_id ? String(req.body.job_id).trim() : null;
    const firstLine = message.split('\n')[0].slice(0, 150);
    const subject = jobId ? `[${jobId}] ${firstLine}` : firstLine;

    const ticketNo = await generateTicketNo(pool, 'support');
    const [result] = await pool.query(
      `INSERT INTO support_tickets (ticket_no, user_id, user_type, subject, message, category, priority)
       VALUES (?, ?, 'technician', ?, ?, ?, 'normal')`,
      [ticketNo, req.user.id, subject, message, jobId ? 'job' : 'app']
    );
    const [[created]] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') AS sent_at FROM support_tickets WHERE id = ?`,
      [result.insertId]
    );
    try {
      const [staff] = await pool.query(
        `SELECT DISTINCT u.id FROM users u
           JOIN role_permissions rp ON rp.role_id = u.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.code IN ('support.manage','modules.all') AND u.status = 'active'`
      );
      for (const s of staff) {
        await notify({ userId: s.id, type: 'support', title: `Support ticket ${ticketNo}`, body: subject });
      }
    } catch (_) { /* non-fatal */ }

    sendSuccess(res, { message_id: result.insertId, sent_at: created ? created.sent_at : null }, 'Message sent', 201);
  })
);

module.exports = router;
