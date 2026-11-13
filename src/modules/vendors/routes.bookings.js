const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { toPublicUrl } = require('../../middlewares/upload');

router.use(authMiddleware);

const requireApprovedVendor = (req, res, next) => {
  if (!req.user.vendor) return next(ApiError.forbidden('Vendor account required'));
  if (req.user.vendor.status !== 'approved') return next(ApiError.forbidden('Vendor account is not approved'));
  next();
};

const STATUS_MAP = `
  CASE
    WHEN r.status = 'pending_review' THEN 'pending'
    WHEN r.status IN ('assigned','quoted','approved') THEN 'accepted'
    WHEN r.status IN ('scheduled','in_progress') THEN 'in_progress'
    WHEN r.status IN ('completed','closed') THEN 'completed'
    WHEN r.status = 'cancelled' THEN 'cancelled'
  END`;

const TITLE_STATUS = {
  pending: 'Pending',
  accepted: 'Accepted',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const inr = (n, dec = 0) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;

const fmtTime = (d) => {
  const date = new Date(d);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const hm = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const same = (a, b) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  if (same(date, today)) return `Today, ${hm}`;
  if (same(date, yest)) return `Yesterday, ${hm}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${hm}`;
};

const fmtDate = (d) => {
  const date = new Date(`${d}T00:00:00`);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const same = (a, b) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  if (same(date, today)) return 'Today';
  if (same(date, tomorrow)) return 'Tomorrow';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// resolve :id → request row (numeric id | ticket_no | job_no, '#'-stripped)
const resolveBooking = async (rawId, vendorId) => {
  const key = String(rawId).replace(/^#/, '').trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : null;
  const [rows] = await pool.query(
    `SELECT r.* FROM requests r
      WHERE (${numeric !== null ? 'r.id = ? OR ' : ''}r.ticket_no = ? OR EXISTS (
              SELECT 1 FROM jobs j WHERE j.request_id = r.id AND j.job_no = ?))
        AND (r.assigned_vendor_id = ? OR EXISTS (
              SELECT 1 FROM request_assignments a WHERE a.request_id = r.id AND a.vendor_id = ? AND a.status IN ('active','completed')))`,
    numeric !== null ? [numeric, key, key, vendorId, vendorId] : [key, key, vendorId, vendorId]
  );
  if (!rows.length) throw ApiError.notFound('Booking not found or not assigned to you');
  return rows[0];
};

const BASE_SELECT = `
  SELECT r.id, r.ticket_no, r.title, r.category_id, r.priority, r.status AS request_status,
         r.estimated_amount, r.site_location, r.city, r.created_at, r.updated_at,
         ${STATUS_MAP} AS booking_status,
         c.name AS category_name,
         u.name AS customer_name, u.phone AS customer_phone,
         (SELECT j.id FROM jobs j WHERE j.request_id = r.id AND j.vendor_id = ? ORDER BY j.id DESC LIMIT 1) AS job_id,
         (SELECT j.job_no FROM jobs j WHERE j.request_id = r.id AND j.vendor_id = ? ORDER BY j.id DESC LIMIT 1) AS job_no,
         (SELECT j.schedule_date FROM jobs j WHERE j.request_id = r.id AND j.vendor_id = ? ORDER BY j.id DESC LIMIT 1) AS schedule_date,
         (SELECT j.amount FROM jobs j WHERE j.request_id = r.id AND j.vendor_id = ? ORDER BY j.id DESC LIMIT 1) AS job_amount,
         (SELECT q.total_amount FROM quotations q WHERE q.request_id = r.id AND q.vendor_id = ? AND q.status = 'accepted' ORDER BY q.id DESC LIMIT 1) AS quote_amount,
         t.id AS tech_id, t.name AS tech_name, t.phone AS tech_phone, t.photo AS tech_photo
    FROM requests r
    JOIN users u ON u.id = r.customer_id
    LEFT JOIN service_categories c ON c.id = r.category_id
    LEFT JOIN request_technicians rt ON rt.request_id = r.id
    LEFT JOIN technicians t ON t.id = rt.technician_id`;

const MY_BOOKINGS_WHERE = `
  WHERE (r.assigned_vendor_id = ? OR EXISTS (
      SELECT 1 FROM request_assignments a WHERE a.request_id = r.id AND a.vendor_id = ? AND a.status IN ('active','completed')))`;

// GET /vendor/bookings — list with tabs + pagination + search
router.get(
  '/bookings',
  requireApprovedVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const { page, limit, offset } = getPagination(req.query);
    const status = req.query.status || 'all';
    const allowed = ['all', 'pending', 'accepted', 'in_progress', 'completed', 'cancelled'];
    if (!allowed.includes(status)) throw ApiError.badRequest(`status must be one of: ${allowed.join(', ')}`);

    const params = [vendorId, vendorId, vendorId, vendorId, vendorId, vendorId, vendorId];
    let outer = '';
    const args = [...params];
    if (status !== 'all') {
      outer += ' WHERE b.booking_status = ?';
      args.push(status);
    }
    if (req.query.search) {
      const s = `%${String(req.query.search).trim()}%`;
      outer += (outer ? ' AND ' : ' WHERE ') + '(b.ticket_no LIKE ? OR b.customer_name LIKE ? OR b.site_location LIKE ?)';
      args.push(s, s, s);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM (${BASE_SELECT} ${MY_BOOKINGS_WHERE}) b${outer}`,
      args
    );
    const [rows] = await pool.query(
      `SELECT * FROM (${BASE_SELECT} ${MY_BOOKINGS_WHERE}) b${outer}
        ORDER BY b.updated_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const bookings = rows.map((r) => {
      const amount = r.job_amount != null ? Number(r.job_amount) : r.quote_amount != null ? Number(r.quote_amount) : r.estimated_amount != null ? Number(r.estimated_amount) : null;
      return {
        id: r.ticket_no,
        request_id: r.id,
        service: r.title,
        category_id: r.category_id,
        category_name: r.category_name,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        address: [r.site_location, r.city].filter(Boolean).join(', '),
        scheduled_time: r.schedule_date ? `${r.schedule_date}T00:00:00` : null,
        display_time: r.schedule_date ? fmtDate(r.schedule_date) : fmtTime(r.created_at),
        amount,
        payment_status: null, // payments module not in platform yet
        status: r.booking_status,
        is_urgent: r.priority === 'urgent',
        job_no: r.job_no,
        technician: r.tech_id
          ? { id: r.tech_id, name: r.tech_name, phone: r.tech_phone, photo: toPublicUrl(r.tech_photo) }
          : null,
      };
    });

    sendSuccess(res, { total, page, limit, bookings }, 'Bookings retrieved');
  })
);

// GET /vendor/bookings/:id — detail with payment_summary + timeline
router.get(
  '/bookings/:id',
  requireApprovedVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const r = await resolveBooking(req.params.id, vendorId);
    const bookingStatus = r.status === 'pending_review' ? 'pending'
      : ['assigned', 'quoted', 'approved'].includes(r.status) ? 'accepted'
      : ['scheduled', 'in_progress'].includes(r.status) ? 'in_progress'
      : ['completed', 'closed'].includes(r.status) ? 'completed' : 'cancelled';

    const [[job]] = await pool.query(
      'SELECT * FROM jobs WHERE request_id = ? AND vendor_id = ? ORDER BY id DESC LIMIT 1',
      [r.id, vendorId]
    );
    const [[quote]] = await pool.query(
      "SELECT * FROM quotations WHERE request_id = ? AND vendor_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1",
      [r.id, vendorId]
    );
    const [[tech]] = await pool.query(
      `SELECT t.id, t.name, t.photo FROM request_technicians rt
         JOIN technicians t ON t.id = rt.technician_id WHERE rt.request_id = ?`,
      [r.id]
    );
    const [[cat]] = r.category_id
      ? await pool.query('SELECT name FROM service_categories WHERE id = ?', [r.category_id])
      : [[{ name: null }]];
    const [[cust]] = await pool.query('SELECT name, phone FROM users WHERE id = ?', [r.customer_id]);
    const categoryName = cat ? cat.name : null;

    const base = quote ? Number(quote.subtotal) : job && job.amount != null ? Number(job.amount) : r.estimated_amount != null ? Number(r.estimated_amount) : 0;
    const tax = quote ? Number(quote.tax_amount) : 0;
    const total = quote ? Number(quote.total_amount) : base + tax;

    const assigned = Boolean(tech);
    const approved = !['pending_review'].includes(r.status);
    const done = ['completed', 'closed'].includes(r.status);
    const timeLabel = job && job.schedule_date ? fmtDate(job.schedule_date) : fmtTime(r.created_at);

    sendSuccess(
      res,
      {
        id: r.ticket_no,
        request_id: r.id,
        job_no: job ? job.job_no : null,
        service: r.title,
        category: categoryName,
        customer: cust.name,
        phone: cust.phone,
        address: [r.site_location, r.city].filter(Boolean).join(', '),
        time: timeLabel,
        amount: inr(total),
        status: TITLE_STATUS[bookingStatus],
        technician: tech ? tech.name : 'Unassigned',
        technician_id: tech ? tech.id : null,
        Photo: tech ? toPublicUrl(tech.photo) : null,
        payment_summary: {
          base_fee: inr(base),
          visiting_charges: '₹0 (Free)',
          platform_fee_taxes: tax > 0 ? inr(tax) : 'Included',
          total_payable: inr(total),
          payment_mode: null, // payments module not in platform yet
        },
        timeline: [
          {
            title: 'Order Placed by Customer',
            subtitle: 'Booking request created successfully',
            is_completed: true,
          },
          {
            title: 'Vendor Approval',
            subtitle: approved ? 'Approved by you' : 'Awaiting your approval',
            is_completed: approved,
          },
          {
            title: 'Technician Assignment',
            subtitle: assigned ? `Assigned to ${tech.name}` : 'Not assigned yet',
            is_completed: assigned,
          },
          {
            title: 'Service Execution',
            subtitle: done ? 'Service completed' : `Scheduled for ${timeLabel}`,
            is_completed: done,
          },
        ],
      },
      'Booking details retrieved successfully'
    );
  })
);

// PUT /vendor/bookings/:id/action — accept | reject (wraps request assignment flow)
router.put(
  '/bookings/:id/action',
  requireApprovedVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const { action, reason } = req.body || {};
    if (!['accept', 'reject'].includes(action)) throw ApiError.badRequest('action must be accept or reject');
    const r = await resolveBooking(req.params.id, vendorId);
    if (['completed', 'closed', 'cancelled'].includes(r.status)) throw ApiError.badRequest('Booking already finished');

    if (action === 'accept') {
      if (r.assigned_vendor_id !== vendorId) throw ApiError.badRequest('Booking is not assigned to you');
      await pool.query(
        `UPDATE request_assignments SET status = 'active' WHERE request_id = ? AND vendor_id = ?`,
        [r.id, vendorId]
      );
      await pool.query(`UPDATE requests SET status = 'assigned' WHERE id = ? AND status = 'pending_review'`, [r.id]);
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'assigned', 'Vendor accepted the assignment', ?)`,
        [r.id, req.user.id]
      );
    } else {
      if (r.assigned_vendor_id !== vendorId) throw ApiError.badRequest('Booking is not assigned to you');
      await pool.query(
        `UPDATE request_assignments SET status = 'declined', note = ? WHERE request_id = ? AND vendor_id = ?`,
        [reason || 'Declined by vendor', r.id, vendorId]
      );
      await pool.query(
        `UPDATE requests SET assigned_vendor_id = NULL, status = 'pending_review' WHERE id = ?`,
        [r.id]
      );
      await pool.query(
        `INSERT INTO request_status_history (request_id, status, note, changed_by) VALUES (?, 'pending_review', ?, ?)`,
        [r.id, `Vendor declined: ${reason || 'no reason'}`, req.user.id]
      );
    }
    await writeAudit({
      actor: req.user,
      action: `booking.${action}`,
      entity: 'requests',
      entityId: r.id,
      details: { ticket_no: r.ticket_no, reason: reason || null },
      req,
    });
    sendSuccess(
      res,
      { id: r.ticket_no, status: action === 'accept' ? 'accepted' : 'rejected' },
      `Booking ${action === 'accept' ? 'accepted' : 'rejected'} successfully`
    );
  })
);

// POST /vendor/bookings/:id/assign — assign technician (request-level link)
router.post(
  '/bookings/:id/assign',
  requireApprovedVendor,
  asyncHandler(async (req, res) => {
    const vendorId = req.user.vendor.id;
    const r = await resolveBooking(req.params.id, vendorId);
    if (['completed', 'closed', 'cancelled'].includes(r.status)) throw ApiError.badRequest('Booking already finished');
    const technicianId = Number(req.body.technician_id);
    if (!Number.isInteger(technicianId) || technicianId < 1) {
      throw ApiError.badRequest('technician_id is required');
    }
    const [[tech]] = await pool.query(
      `SELECT id, name FROM technicians WHERE id = ? AND vendor_id = ? AND status = 'active'`,
      [technicianId, vendorId]
    );
    if (!tech) throw ApiError.notFound('Active technician not found for this vendor');
    await pool.query(
      `INSERT INTO request_technicians (request_id, technician_id, assigned_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE technician_id = VALUES(technician_id), assigned_by = VALUES(assigned_by)`,
      [r.id, technicianId, req.user.id]
    );
    await pool.query(
      `INSERT INTO request_status_history (request_id, status, note, changed_by)
       SELECT id, status, ?, ? FROM requests WHERE id = ?`,
      [`Technician assigned: ${tech.name}`, req.user.id, r.id]
    );
    await writeAudit({
      actor: req.user,
      action: 'booking.assign_technician',
      entity: 'request_technicians',
      entityId: r.id,
      details: { ticket_no: r.ticket_no, technician_id: technicianId },
      req,
    });
    sendSuccess(
      res,
      { booking_id: r.ticket_no, technician_id: technicianId, technician_name: tech.name, status: 'assigned' },
      'Technician assigned successfully'
    );
  })
);

module.exports = router;
