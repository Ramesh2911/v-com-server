const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');

router.use(authMiddleware, requirePermission('reports.view'));

const escapeCsv = (val) => {
  if (val == null) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCsv(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => escapeCsv(r[c.key])).join(','));
  return [header, ...lines].join('\n');
}

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const [[requests]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'pending_review') AS pending_review,
              SUM(status = 'assigned') AS assigned,
              SUM(status = 'in_progress') AS in_progress,
              SUM(status = 'completed') AS completed,
              SUM(status = 'closed') AS closed,
              SUM(status = 'cancelled') AS cancelled
         FROM requests`
    );
    const [[quotations]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'accepted') AS accepted, SUM(status = 'rejected') AS rejected,
              SUM(status = 'pending') AS pending, IFNULL(SUM(CASE WHEN status = 'accepted' THEN total_amount END), 0) AS accepted_value
         FROM quotations`
    );
    const [[vendors]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'approved') AS approved, SUM(status = 'pending') AS pending,
              SUM(status = 'suspended') AS suspended
         FROM vendors`
    );
    const [[jobs]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(stage = 'completed') AS completed,
              SUM(stage IN ('accepted','scheduled','in_progress','awaiting_approval')) AS active
         FROM jobs`
    );
    const [modulePerf] = await pool.query(
      `SELECT m.name AS module, COUNT(r.id) AS requests,
              SUM(r.status = 'completed') AS completed,
              IFNULL(SUM(r.estimated_amount), 0) AS estimated_value
         FROM service_modules m LEFT JOIN requests r ON r.module_id = m.id
        GROUP BY m.id ORDER BY m.sort_order`
    );
    const [monthly] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS requests
         FROM requests WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
        GROUP BY month ORDER BY month`
    );
    sendSuccess(res, { requests, quotations, vendors, jobs, module_performance: modulePerf, monthly });
  })
);

const reportDefs = {
  requests: {
    sql: `SELECT r.ticket_no, m.name AS module, r.title, r.priority, r.status, r.created_at,
                 u.name AS customer, IFNULL(v.business_name, '-') AS vendor
            FROM requests r
            JOIN service_modules m ON m.id = r.module_id
            JOIN users u ON u.id = r.customer_id
            LEFT JOIN vendors v ON v.id = r.assigned_vendor_id`,
    columns: [
      { key: 'ticket_no', label: 'Ticket No' },
      { key: 'module', label: 'Module' },
      { key: 'title', label: 'Title' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'customer', label: 'Customer' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'created_at', label: 'Created At' },
    ],
  },
  quotations: {
    sql: `SELECT q.ticket_no, r.ticket_no AS request_ticket, v.business_name AS vendor, q.total_amount, q.status, q.created_at
            FROM quotations q JOIN requests r ON r.id = q.request_id JOIN vendors v ON v.id = q.vendor_id`,
    columns: [
      { key: 'ticket_no', label: 'Quotation No' },
      { key: 'request_ticket', label: 'Request' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'total_amount', label: 'Total' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Created At' },
    ],
  },
  jobs: {
    sql: `SELECT j.job_no, r.ticket_no AS request_ticket, v.business_name AS vendor, j.stage, j.amount, j.schedule_date, j.completed_at
            FROM jobs j JOIN requests r ON r.id = j.request_id JOIN vendors v ON v.id = j.vendor_id`,
    columns: [
      { key: 'job_no', label: 'Job No' },
      { key: 'request_ticket', label: 'Request' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'stage', label: 'Stage' },
      { key: 'amount', label: 'Amount' },
      { key: 'schedule_date', label: 'Scheduled' },
      { key: 'completed_at', label: 'Completed' },
    ],
  },
  customers: {
    sql: `SELECT u.name, u.email, u.phone, u.created_at,
                 (SELECT COUNT(*) FROM requests r WHERE r.customer_id = u.id) AS requests
            FROM users u WHERE u.user_type = 'customer'`,
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'requests', label: 'Requests' },
      { key: 'created_at', label: 'Joined' },
    ],
  },
  vendors: {
    sql: `SELECT v.business_name, u.name AS contact, u.email, u.phone, v.city, v.status, v.rating, v.total_jobs
            FROM vendors v JOIN users u ON u.id = v.user_id`,
    columns: [
      { key: 'business_name', label: 'Business' },
      { key: 'contact', label: 'Contact Person' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'city', label: 'City' },
      { key: 'status', label: 'Status' },
      { key: 'rating', label: 'Rating' },
      { key: 'total_jobs', label: 'Jobs' },
    ],
  },
  sos: {
    sql: `SELECT s.ticket_no, u.name AS customer, u.phone, s.priority, s.status, s.created_at, s.resolved_at
            FROM sos_tickets s JOIN users u ON u.id = s.customer_id`,
    columns: [
      { key: 'ticket_no', label: 'SOS No' },
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'priority', label: 'Priority' },
      { key: 'status', label: 'Status' },
      { key: 'created_at', label: 'Raised' },
      { key: 'resolved_at', label: 'Resolved' },
    ],
  },
  properties: {
    sql: `SELECT p.property_code, p.title, b.name AS builder, a.name AS area, a.city, p.listing_type, p.total_amount, p.status
            FROM properties p JOIN builders b ON b.id = p.builder_id JOIN areas a ON a.id = p.area_id`,
    columns: [
      { key: 'property_code', label: 'Code' },
      { key: 'title', label: 'Title' },
      { key: 'builder', label: 'Builder' },
      { key: 'area', label: 'Area' },
      { key: 'city', label: 'City' },
      { key: 'listing_type', label: 'Type' },
      { key: 'total_amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
    ],
  },
  leaves: {
    sql: `SELECT l.leave_no, u.name AS employee, e.employee_code, l.leave_type, l.from_date, l.to_date, l.total_days, l.status
            FROM leave_requests l JOIN employees e ON e.id = l.employee_id JOIN users u ON u.id = e.user_id`,
    columns: [
      { key: 'leave_no', label: 'Leave No' },
      { key: 'employee', label: 'Employee' },
      { key: 'employee_code', label: 'Code' },
      { key: 'leave_type', label: 'Type' },
      { key: 'from_date', label: 'From' },
      { key: 'to_date', label: 'To' },
      { key: 'total_days', label: 'Days' },
      { key: 'status', label: 'Status' },
    ],
  },
};

router.get(
  '/:type',
  asyncHandler(async (req, res) => {
    const def = reportDefs[req.params.type];
    if (!def) return sendSuccess(res, { types: Object.keys(reportDefs) });
    const [rows] = await pool.query(`${def.sql} ORDER BY 1 DESC LIMIT 5000`);
    if (req.query.format === 'csv') {
      return sendCsv(res, `vcom-${req.params.type}-${Date.now()}.csv`, toCsv(rows, def.columns));
    }
    sendSuccess(res, { columns: def.columns, rows, total: rows.length });
  })
);

module.exports = router;
