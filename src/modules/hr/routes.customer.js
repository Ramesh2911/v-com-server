const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');

router.use(authMiddleware);

const requireEmployee = async (req, res, next) => {
  const [rows] = await pool.query('SELECT * FROM employees WHERE user_id = ? AND status = ?', [req.user.id, 'active']);
  if (!rows.length) return next(ApiError.forbidden('HR features are only available to employee accounts'));
  req.employee = rows[0];
  next();
};

router.get(
  '/me',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const emp = req.employee;
    const [[attendanceSummary]] = await pool.query(
      `SELECT COUNT(*) AS total_days,
              SUM(status = 'present') AS present_days,
              SUM(status = 'absent') AS absent_days,
              SUM(status = 'leave') AS leave_days,
              SUM(status = 'half_day') AS half_days
         FROM attendance WHERE employee_id = ? AND attendance_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
      [emp.id]
    );
    const [leaves] = await pool.query(
      `SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20`,
      [emp.id]
    );
    const [today] = await pool.query(
      `SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = CURDATE()`,
      [emp.id]
    );
    sendSuccess(res, {
      employee: emp,
      attendance_summary: attendanceSummary,
      today_attendance: today[0] || null,
      leaves,
    });
  })
);

router.post(
  '/attendance/check-in',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query(
      `SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = CURDATE()`,
      [req.employee.id]
    );
    if (existing.length && existing[0].check_in) throw ApiError.badRequest('Already checked in today');
    if (existing.length) {
      await pool.query('UPDATE attendance SET check_in = NOW(), status = ? WHERE id = ?', ['present', existing[0].id]);
    } else {
      await pool.query(
        `INSERT INTO attendance (employee_id, attendance_date, check_in, status) VALUES (?, CURDATE(), NOW(), 'present')`,
        [req.employee.id]
      );
    }
    sendSuccess(res, null, 'Checked in');
  })
);

router.post(
  '/attendance/check-out',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query(
      `SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = CURDATE()`,
      [req.employee.id]
    );
    if (!existing.length || !existing[0].check_in) throw ApiError.badRequest('Check in first');
    if (existing[0].check_out) throw ApiError.badRequest('Already checked out today');
    await pool.query('UPDATE attendance SET check_out = NOW() WHERE id = ?', [existing[0].id]);
    sendSuccess(res, null, 'Checked out');
  })
);

router.get(
  '/attendance',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const month = req.query.month; // YYYY-MM
    let where = 'WHERE employee_id = ?';
    const params = [req.employee.id];
    if (month) {
      where += ' AND DATE_FORMAT(attendance_date, "%Y-%m") = ?';
      params.push(month);
    } else {
      where += ' AND attendance_date >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)';
    }
    const [rows] = await pool.query(`SELECT * FROM attendance ${where} ORDER BY attendance_date DESC LIMIT 90`, params);
    sendSuccess(res, rows);
  })
);

router.post(
  '/leaves',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const { leave_type, from_date, to_date, reason } = req.body;
    if (!leave_type || !from_date || !to_date) throw ApiError.badRequest('leave_type, from_date and to_date are required');
    const from = new Date(from_date);
    const to = new Date(to_date);
    if (to < from) throw ApiError.badRequest('to_date must be after from_date');
    const totalDays = Math.max(1, Math.round((to - from) / 86400000) + 1);

    const leaveNo = await generateTicketNo(pool, 'leave');
    const [result] = await pool.query(
      `INSERT INTO leave_requests (leave_no, employee_id, leave_type, from_date, to_date, total_days, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [leaveNo, req.employee.id, leave_type, from_date, to_date, totalDays, reason || null]
    );
    const staff = await staffWithPermission('hr.manage');
    for (const sid of staff) {
      await notify({
        userId: sid, event: 'leave_requested', type: 'hr',
        title: `Leave request ${leaveNo}`, body: `${req.user.name} applied for ${leave_type} leave.`,
        data: { leave_no: leaveNo },
      });
    }
    sendSuccess(res, { id: result.insertId, leave_no: leaveNo }, 'Leave request submitted', 201);
  })
);

router.get(
  '/leaves',
  requireEmployee,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.employee.id]
    );
    sendSuccess(res, rows);
  })
);

module.exports = router;
