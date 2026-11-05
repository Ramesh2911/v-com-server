const router = require('express').Router();
const { body } = require('express-validator');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { toPublicUrl, uploadDataUri } = require('../../middlewares/upload');

router.use(authMiddleware);

const loadProfile = async (userId, req) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.user_type, u.avatar, u.status, u.last_login_at, u.created_at,
            r.name AS role_name, r.slug AS role_slug
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [userId]
  );
  const user = rows[0];
  user.avatar = toPublicUrl(user.avatar);
  const [vendor] = await pool.query('SELECT * FROM vendors WHERE user_id = ?', [userId]);
  const [employee] = await pool.query('SELECT * FROM employees WHERE user_id = ?', [userId]);
  return {
    ...user,
    permissions: req.user.permissions,
    vendor: vendor[0] || null,
    employee: employee[0] || null,
  };
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    sendSuccess(res, await loadProfile(req.user.id, req));
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

    if ('avatar' in req.body) {
      let avatarValue = null;
      if (avatar) {
        const raw = String(avatar);
        if (raw.startsWith('data:')) {
          // base64 photo from mobile app → upload to Cloudinary; fall back to storing raw
          try {
            avatarValue = (await uploadDataUri(raw)) || raw;
          } catch {
            avatarValue = raw;
          }
        } else if (/^(https?:\/\/|\/|general\/)/i.test(raw) && raw.length <= 512) {
          avatarValue = raw;
        } else {
          throw ApiError.badRequest('Invalid avatar — send a data URI, URL, or upload path');
        }
      }
      await pool.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarValue, req.user.id]);
    }

    sendSuccess(res, await loadProfile(req.user.id, req), 'Profile updated');
  })
);

module.exports = router;
