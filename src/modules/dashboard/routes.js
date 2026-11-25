const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission, moduleFilterSql } = require('../../middlewares/rbac');

router.use(authMiddleware, requirePermission('dashboard.view'));

/* IST wall-clock date (DB-independent) for event_date comparisons */
const istToday = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const daysParam = Number(req.query.days);
    const days = [7, 14, 30].includes(daysParam) ? daysParam : 14;

    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE user_type = 'customer') AS customers,
         (SELECT COUNT(*) FROM vendors) AS vendors,
         (SELECT COUNT(*) FROM vendors WHERE status = 'pending') AS pending_vendors,
         (SELECT COUNT(*) FROM vendors WHERE status = 'approved') AS vendors_active,
         (SELECT COUNT(*) FROM requests) AS requests,
         (SELECT COUNT(*) FROM requests WHERE status IN ('pending_review','assigned','quoted','approved','scheduled','in_progress')) AS active_requests,
         (SELECT COUNT(*) FROM requests WHERE status = 'completed') AS completed_requests,
         (SELECT COUNT(*) FROM sos_tickets WHERE status IN ('open','acknowledged','dispatched','in_progress')) AS active_sos,
         (SELECT COUNT(*) FROM sos_tickets) AS sos_total,
         (SELECT COUNT(*) FROM quotations WHERE status = 'pending') AS pending_quotations,
         (SELECT COUNT(*) FROM quotations) AS quotations,
         (SELECT COUNT(*) FROM jobs WHERE stage IN ('accepted','scheduled','in_progress','awaiting_approval')) AS active_jobs,
         (SELECT COUNT(*) FROM jobs WHERE stage = 'completed') AS completed_jobs,
         (SELECT COUNT(*) FROM properties WHERE status = 'available') AS properties,
         (SELECT COUNT(*) FROM property_enquiries WHERE status = 'new') AS new_property_enquiries,
         (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending') AS pending_leaves,
         (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS open_support,
         (SELECT COUNT(*) FROM events) AS events_total,
         (SELECT COUNT(*) FROM payouts WHERE status = 'pending') AS payouts_pending_count,
         (SELECT COUNT(*) FROM payouts WHERE status = 'processed') AS payouts_processed_count,
         (SELECT IFNULL(SUM(CASE WHEN status = 'pending' THEN amount END), 0) FROM payouts) AS payouts_pending_amount,
         (SELECT IFNULL(SUM(CASE WHEN status = 'processed' THEN amount END), 0) FROM payouts) AS payouts_processed_amount,
         (SELECT IFNULL(SUM(total_amount), 0) FROM quotations WHERE status = 'accepted') AS revenue
       `
    );
    counts.payouts_pending_amount = Number(counts.payouts_pending_amount) || 0;
    counts.payouts_processed_amount = Number(counts.payouts_processed_amount) || 0;
    const [[ev]] = await pool.query(`SELECT COUNT(*) AS n FROM events WHERE status = 1 AND event_date >= ?`, [istToday()]);
    counts.events_upcoming = Number(ev.n) || 0;

    const mod = moduleFilterSql(req.user, 'r');
    const [byModule] = await pool.query(
      `SELECT m.name, m.code, COUNT(r.id) AS count
         FROM service_modules m LEFT JOIN requests r ON r.module_id = m.id
        GROUP BY m.id ORDER BY m.sort_order`,
      []
    );
    const [byStatus] = await pool.query(
      `SELECT r.status, COUNT(*) AS count FROM requests r WHERE 1=1 ${mod.sql} GROUP BY r.status`,
      mod.params
    );
    const [recentRequests] = await pool.query(
      `SELECT r.ticket_no, r.title, r.status, r.priority, r.created_at, m.name AS module_name,
              u.name AS customer_name, v.business_name AS vendor_name,
              NULLIF(CONCAT_WS(', ', r.site_location, r.city), '') AS location
         FROM requests r
         JOIN service_modules m ON m.id = r.module_id
         JOIN users u ON u.id = r.customer_id
         LEFT JOIN vendors v ON v.id = r.assigned_vendor_id
        WHERE 1=1 ${mod.sql} ORDER BY r.created_at DESC LIMIT 8`,
      mod.params
    );
    const [recentActivity] = await pool.query(
      `SELECT a.action, a.entity, a.actor_name, a.created_at
         FROM audit_logs a ORDER BY a.created_at DESC LIMIT 10`
    );
    const [chart] = await pool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM requests WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        GROUP BY DATE(created_at) ORDER BY date`
    );

    /* ---- per-module daily request counts (module tab) ---- */
    const [[range]] = await pool.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL ? DAY) AS start_date, CURDATE() AS end_date`,
      [days - 1]
    );
    const [modules] = await pool.query(
      'SELECT id, code, name FROM service_modules ORDER BY sort_order, id'
    );
    const [dailyRaw] = await pool.query(
      `SELECT r.module_id, DATE(r.created_at) AS date, COUNT(*) AS count
         FROM requests r
        WHERE DATE(r.created_at) BETWEEN ? AND ? ${mod.sql}
        GROUP BY r.module_id, DATE(r.created_at)`,
      [range.start_date, range.end_date, ...mod.params]
    );

    const dateList = [];
    {
      const d = new Date(`${range.start_date}T00:00:00Z`);
      const end = new Date(`${range.end_date}T00:00:00Z`);
      while (d <= end) {
        dateList.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    const byKey = {};
    for (const row of dailyRaw) byKey[`${row.module_id}|${row.date}`] = Number(row.count);
    const module_daily = modules.map((m) => {
      const daysArr = dateList.map((date) => ({ date, count: byKey[`${m.id}|${date}`] || 0 }));
      return {
        module_id: m.id,
        module_code: m.code,
        module_name: m.name,
        total: daysArr.reduce((s, d) => s + d.count, 0),
        days: daysArr,
      };
    });

    sendSuccess(res, {
      counts,
      days,
      by_module: byModule,
      by_status: byStatus,
      module_daily,
      recent_requests: recentRequests,
      recent_activity: recentActivity,
      request_chart: chart,
    });
  })
);

module.exports = router;
