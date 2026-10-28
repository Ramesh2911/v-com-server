const jwt = require('jsonwebtoken');
const env = require('../config');
const pool = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const signAccessToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      user_type: user.user_type,
      role_id: user.role_id || null,
      name: user.name,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

const signRefreshToken = (user) =>
  jwt.sign({ id: user.id, type: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
  });

const verifyAccessToken = (token) => jwt.verify(token, env.jwt.secret);
const verifyRefreshToken = (token) => jwt.verify(token, env.jwt.refreshSecret);

const loadUserPermissions = async (userId) => {
  const [rows] = await pool.query(
    `SELECT p.code
       FROM users u
       LEFT JOIN role_permissions rp ON rp.role_id = u.role_id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ? AND p.code IS NOT NULL`,
    [userId]
  );
  return rows.map((r) => r.code);
};

const authMiddleware = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Authentication required');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.user_type, u.role_id, u.status, u.avatar,
            r.name AS role_name, r.slug AS role_slug
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [decoded.id]
  );
  const user = rows[0];
  if (!user) throw ApiError.unauthorized('Account not found');
  if (user.status !== 'active') throw ApiError.forbidden('Account is inactive or blocked');

  const [vendorRows] = await pool.query(
    `SELECT id, business_name, status FROM vendors WHERE user_id = ?`,
    [user.id]
  );

  user.permissions = await loadUserPermissions(user.id);
  user.vendor = vendorRows[0] || null;
  req.user = user;
  next();
});

const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const decoded = verifyAccessToken(token);
    const [rows] = await pool.query(
      `SELECT id, name, email, user_type, role_id, status FROM users WHERE id = ?`,
      [decoded.id]
    );
    if (rows[0] && rows[0].status === 'active') {
      const [vendorRows] = await pool.query(
        `SELECT id, business_name, status FROM vendors WHERE user_id = ?`,
        [rows[0].id]
      );
      rows[0].vendor = vendorRows[0] || null;
      req.user = rows[0];
    }
  } catch (_) {
    /* ignore invalid optional token */
  }
  next();
});

module.exports = {
  authMiddleware,
  optionalAuth,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  loadUserPermissions,
};
