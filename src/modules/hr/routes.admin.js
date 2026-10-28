const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission, hasPermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../../utils/notify');

router.use(authMiddleware, requirePermission('hr.view'));

// ======================= EMPLOYEES =======================
router.get(
  '/employees',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND e.status = ?';
      params.push(req.query.status);
    }
    if (req.query.department) {
      where += ' AND e.department = ?';
      params.push(req.query.department);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (u.name LIKE ? OR u.email LIKE ? OR e.employee_code LIKE ?)';
      params.push(s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM employees e JOIN users u ON u.id = e.user_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT e.*, u.name, u.email, u.phone, u.status AS user_status,
              mu.name AS manager_name
         FROM employees e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
         LEFT JOIN users mu ON mu.id = m.user_id
        ${where} ORDER BY e.employee_code LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.post(
  '/employees',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, employee_code, designation, department, date_of_joining, date_of_birth, gender, address, emergency_contact, role_id } = req.body;
    if (!password || password.length < 6) throw ApiError.badRequest('Password must be at least 6 characters');
    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) throw ApiError.conflict('Email already in use');
    const [codeExists] = await pool.query('SELECT id FROM employees WHERE employee_code = ?', [employee_code]);
    if (codeExists.length) throw ApiError.conflict('Employee code already in use');

    const [userResult] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, role_id) VALUES (?, ?, ?, ?, 'employee', ?)`,
      [name, email, phone || null, bcrypt.hashSync(password, 10), role_id || null]
    );
    const [empResult] = await pool.query(
      `INSERT INTO employees (user_id, employee_code, designation, department, date_of_joining, date_of_birth, gender, address, emergency_contact)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userResult.insertId, employee_code, designation || null, department || null, date_of_joining || null,
       date_of_birth || null, gender || null, address || null, emergency_contact || null]
    );
    await writeAudit({ actor: req.user, action: 'employee.create', entity: 'employees', entityId: empResult.insertId, req });
    sendSuccess(res, { id: empResult.insertId, user_id: userResult.insertId }, 'Employee created', 201);
  })
);

router.put(
  '/employees/:id',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Employee not found');
    const { name, phone, designation, department, date_of_joining, date_of_birth, gender, address, emergency_contact, reporting_manager_id, status, password } = req.body;
    await pool.query(
      `UPDATE employees SET designation = COALESCE(?, designation), department = COALESCE(?, department),
              date_of_joining = COALESCE(?, date_of_joining), date_of_birth = COALESCE(?, date_of_birth),
              gender = COALESCE(?, gender), address = COALESCE(?, address),
              emergency_contact = COALESCE(?, emergency_contact), reporting_manager_id = COALESCE(?, reporting_manager_id),
              status = COALESCE(?, status)
        WHERE id = ?`,
      [designation || null, department || null, date_of_joining || null, date_of_birth || null,
       gender || null, address || null, emergency_contact || null, reporting_manager_id ?? null, status || null, req.params.id]
    );
    if (name || phone) {
      await pool.query('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?', [
        name || null, phone || null, rows[0].user_id,
      ]);
    }
    if (password && password.length >= 6) {
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), rows[0].user_id]);
    }
    await writeAudit({ actor: req.user, action: 'employee.update', entity: 'employees', entityId: req.params.id, req });
    sendSuccess(res, null, 'Employee updated');
  })
);

// ======================= ATTENDANCE =======================
router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.date) {
      where += ' AND a.attendance_date = ?';
      params.push(req.query.date);
    }
    if (req.query.month) {
      where += ' AND DATE_FORMAT(a.attendance_date, "%Y-%m") = ?';
      params.push(req.query.month);
    }
    if (req.query.employee_id) {
      where += ' AND a.employee_id = ?';
      params.push(req.query.employee_id);
    }
    if (req.query.status) {
      where += ' AND a.status = ?';
      params.push(req.query.status);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM attendance a ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT a.*, e.employee_code, u.name, u.email
         FROM attendance a JOIN employees e ON e.id = a.employee_id JOIN users u ON u.id = e.user_id
        ${where} ORDER BY a.attendance_date DESC, u.name LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.post(
  '/attendance',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const { employee_id, attendance_date, check_in, check_out, status = 'present', notes } = req.body;
    if (!employee_id || !attendance_date) throw ApiError.badRequest('employee_id and attendance_date required');
    await pool.query(
      `INSERT INTO attendance (employee_id, attendance_date, check_in, check_out, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE check_in = VALUES(check_in), check_out = VALUES(check_out),
              status = VALUES(status), notes = VALUES(notes)`,
      [employee_id, attendance_date, check_in || null, check_out || null, status, notes || null]
    );
    await writeAudit({ actor: req.user, action: 'attendance.mark', entity: 'attendance', entityId: employee_id, details: { attendance_date, status }, req });
    sendSuccess(res, null, 'Attendance saved');
  })
);

router.get(
  '/attendance/summary',
  asyncHandler(async (req, res) => {
    const month = req.query.month;
    const [rows] = await pool.query(
      `SELECT e.id AS employee_id, e.employee_code, u.name,
              SUM(a.status = 'present') AS present,
              SUM(a.status = 'absent') AS absent,
              SUM(a.status = 'leave') AS leave_days,
              SUM(a.status = 'half_day') AS half_days
         FROM employees e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN attendance a ON a.employee_id = e.id
           AND (? IS NULL OR DATE_FORMAT(a.attendance_date, '%Y-%m') = ?)
        WHERE e.status = 'active' GROUP BY e.id ORDER BY e.employee_code`,
      [month || null, month || null]
    );
    sendSuccess(res, rows);
  })
);

// ======================= LEAVES =======================
router.get(
  '/leaves',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND l.status = ?';
      params.push(req.query.status);
    }
    if (req.query.employee_id) {
      where += ' AND l.employee_id = ?';
      params.push(req.query.employee_id);
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM leave_requests l ${where}`, params);
    const [rows] = await pool.query(
      `SELECT l.*, e.employee_code, u.name, u.email, r.name AS reviewer_name
         FROM leave_requests l
         JOIN employees e ON e.id = l.employee_id
         JOIN users u ON u.id = e.user_id
         LEFT JOIN users r ON r.id = l.reviewed_by
        ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.post(
  '/leaves/:id/review',
  requirePermission('hr.manage'),
  asyncHandler(async (req, res) => {
    const { decision, review_note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) throw ApiError.badRequest('decision must be approved or rejected');
    const [rows] = await pool.query(
      `SELECT l.*, u.id AS user_id FROM leave_requests l
        JOIN employees e ON e.id = l.employee_id JOIN users u ON u.id = e.user_id WHERE l.id = ?`,
      [req.params.id]
    );
    if (!rows.length) throw ApiError.notFound('Leave request not found');
    if (rows[0].status !== 'pending') throw ApiError.badRequest('Leave already reviewed');
    await pool.query(
      `UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE id = ?`,
      [decision, req.user.id, review_note || null, req.params.id]
    );
    if (decision === 'approved') {
      // mark attendance as leave for the date range
      await pool.query(
        `INSERT INTO attendance (employee_id, attendance_date, status, notes)
         SELECT employee_id, d, 'leave', ?
           FROM leave_requests l
           JOIN (
             SELECT DATE_ADD(l2.from_date, INTERVAL seq DAY) AS d
               FROM leave_requests l2
               JOIN (SELECT 0 AS seq UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
                     UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12
                     UNION SELECT 13 UNION SELECT 14 UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18
                     UNION SELECT 19 UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24
                     UNION SELECT 25 UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29 UNION SELECT 30) s
              WHERE l2.id = ? AND DATE_ADD(l2.from_date, INTERVAL seq DAY) <= l2.to_date
           ) dates
          WHERE l.id = ?
         ON DUPLICATE KEY UPDATE status = 'leave', notes = VALUES(notes)`,
        [`Leave: ${rows[0].leave_no}`, req.params.id, req.params.id]
      ).catch((e) => console.error('leave attendance:', e.message));
    }
    await notify({
      userId: rows[0].user_id, event: 'leave_reviewed', type: 'hr',
      title: `Leave ${rows[0].leave_no} — ${decision}`,
      data: { leave_no: rows[0].leave_no, status: decision },
    });
    await writeAudit({ actor: req.user, action: 'leave.review', entity: 'leave_requests', entityId: req.params.id, details: { decision }, req });
    sendSuccess(res, null, `Leave ${decision}`);
  })
);

module.exports = router;
