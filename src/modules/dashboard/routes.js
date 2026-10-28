const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission, moduleFilterSql } = require('../../middlewares/rbac');

router.use(authMiddleware, requirePermission('dashboard.view'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE user_type = 'customer') AS customers,
         (SELECT COUNT(*) FROM vendors) AS vendors,
         (SELECT COUNT(*) FROM vendors WHERE status = 'pending') AS pending_vendors,
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
         (SELECT IFNULL(SUM(total_amount), 0) FROM quotations WHERE status = 'accepted') AS revenue
       `
    );

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
      `SELECT r.ticket_no, r.title, r.status, r.priority, r.created_at, m.name AS module_name, u.name AS customer_name
         FROM requests r JOIN service_modules m ON m.id = r.module_id JOIN users u ON u.id = r.customer_id
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

    sendSuccess(res, {
      counts,
      by_module: byModule,
      by_status: byStatus,
      recent_requests: recentRequests,
      recent_activity: recentActivity,
      request_chart: chart,
    });
  })
);

module.exports = router;
