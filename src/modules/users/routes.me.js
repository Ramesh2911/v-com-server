const router = require('express').Router();
const { body } = require('express-validator');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { toPublicUrl } = require('../../middlewares/upload');

router.use(authMiddleware);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.user_type, u.avatar, u.status, u.last_login_at, u.created_at,
              r.name AS role_name, r.slug AS role_slug
         FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [req.user.id]
    );
    const user = rows[0];
    user.avatar = toPublicUrl(user.avatar);
    const [vendor] = await pool.query('SELECT * FROM vendors WHERE user_id = ?', [req.user.id]);
    const [employee] = await pool.query('SELECT * FROM employees WHERE user_id = ?', [req.user.id]);
    sendSuccess(res, {
      ...user,
      permissions: req.user.permissions,
      vendor: vendor[0] || null,
      employee: employee[0] || null,
    });
  })
);

router.put(
  '/',
  [
    body('name').optional().trim().notEmpty(),
    body('email').optional().isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').optional({ nullable: true }).isLength({ min: 8, max: 20 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, phone, email, avatar } = req.body;

    if (email) {
      const [dupe] = await pool.query('SELECT id FROM users WHERE email = ? AND id <> ?', [email, req.user.id]);
      if (dupe.length) throw ApiError.conflict('Email already in use');
    }
    if (phone) {
      const [dupe] = await pool.query('SELECT id FROM users WHERE phone = ? AND id <> ?', [phone, req.user.id]);
      if (dupe.length) throw ApiError.conflict('Phone already in use');
    }

    await pool.query(
      'UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?',
      [name || null, email || null, phone || null, req.user.id]
    );
    if (avatar) await pool.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, req.user.id]);
    sendSuccess(res, null, 'Profile updated');
  })
);

module.exports = router;
