const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('staff.manage'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    const search = req.query.search ? `%${req.query.search}%` : null;
    const role = req.query.role || null;
    let where = `WHERE u.user_type IN ('staff','employee')`;
    const params = [];
    if (search) {
      where += ' AND (u.name LIKE ? OR u.email LIKE ?)';
      params.push(search, search);
    }
    if (role) {
      where += ' AND r.slug = ?';
      params.push(role);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM users u LEFT JOIN roles r ON r.id = u.role_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.user_type, u.status, u.last_login_at, u.created_at,
              r.id AS role_id, r.name AS role_name, r.slug AS role_slug
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        ${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, user_type = 'staff', role_id } = req.body;
    if (!['staff', 'employee'].includes(user_type)) throw ApiError.badRequest('user_type must be staff or employee');
    if (!password || password.length < 6) throw ApiError.badRequest('Password must be at least 6 characters');
    const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (exists.length) throw ApiError.conflict('Email already in use');

    const [result] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, role_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, phone || null, bcrypt.hashSync(password, 10), user_type, role_id || null]
    );
    await writeAudit({ actor: req.user, action: 'staff.create', entity: 'users', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Staff account created', 201);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name, email, phone, role_id, status, password, user_type } = req.body;
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ? AND user_type IN ('staff','employee')`, [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Staff not found');
    if (email && email !== rows[0].email) {
      const [exists] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.params.id]);
      if (exists.length) throw ApiError.conflict('Email already in use');
    }
    await pool.query(
      `UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
              role_id = COALESCE(?, role_id), status = COALESCE(?, status), user_type = COALESCE(?, user_type)
        WHERE id = ?`,
      [name || null, email || null, phone || null, role_id ?? null, status || null, user_type || null, req.params.id]
    );
    if (password && password.length >= 6) {
      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), req.params.id]);
    }
    await writeAudit({ actor: req.user, action: 'staff.update', entity: 'users', entityId: req.params.id, req });
    sendSuccess(res, null, 'Staff account updated');
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (Number(req.params.id) === req.user.id) throw ApiError.badRequest('You cannot delete your own account');
    const [rows] = await pool.query(`SELECT id, role_id FROM users WHERE id = ? AND user_type IN ('staff','employee')`, [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Staff not found');
    if (rows[0].role_id) {
      const [[role]] = await pool.query('SELECT slug FROM roles WHERE id = ?', [rows[0].role_id]);
      if (role && role.slug === 'super_admin') throw ApiError.badRequest('Super admin cannot be deleted');
    }
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'staff.delete', entity: 'users', entityId: req.params.id, req });
    sendSuccess(res, null, 'Staff account deleted');
  })
);

module.exports = router;
