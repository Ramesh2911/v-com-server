const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const env = require('../../config');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { signAccessToken, signRefreshToken, verifyRefreshToken, loadUserPermissions } = require('../../middlewares/auth');
const { writeAudit } = require('../../utils/audit');
const otp = require('./otp.service');

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  user_type: u.user_type,
  role_id: u.role_id,
  role_name: u.role_name || null,
  role_slug: u.role_slug || null,
  avatar: u.avatar || null,
  status: u.status,
});

const buildAuthResponse = async (user) => {
  const permissions = await loadUserPermissions(user.id);
  const [vendorRows] = await pool.query(
    `SELECT id, business_name, status, coverage_areas FROM vendors WHERE user_id = ?`,
    [user.id]
  );
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`,
    [user.id, refreshToken, refreshExp]
  );
  return {
    user: { ...publicUser(user), permissions },
    vendor: vendorRows[0] || null,
    accessToken,
    refreshToken,
  };
};

exports.register = asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body;
  const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (exists.length) throw ApiError.conflict('An account with this email already exists');

  const hash = bcrypt.hashSync(password, 10);
  const [result] = await pool.query(
    `INSERT INTO users (name, email, phone, password_hash, user_type) VALUES (?, ?, ?, ?, 'customer')`,
    [name, email, phone || null, hash]
  );
  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug FROM users u
      LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [result.insertId]
  );
  await notifyWelcome(user.id);
  const data = await buildAuthResponse(user);
  await writeAudit({ actor: user, action: 'auth.register', entity: 'users', entityId: user.id, req });
  sendSuccess(res, data, 'Registration successful', 201);
});

async function notifyWelcome(userId) {
  try {
    const { notify } = require('../../utils/notify');
    await notify({ userId, event: 'welcome', title: 'Welcome to V_COM', body: 'Your account has been created successfully.' });
  } catch (_) { /* non-fatal */ }
}

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.email = ?`,
    [email]
  );
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.status !== 'active') throw ApiError.forbidden('Your account is inactive. Please contact support.');

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  const data = await buildAuthResponse(user);
  await writeAudit({ actor: user, action: 'auth.login', entity: 'users', entityId: user.id, req });
  sendSuccess(res, data, 'Login successful');
});

exports.refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.body.refreshToken || req.body.refresh_token;
  if (!refreshToken) throw ApiError.badRequest('refreshToken is required');

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  // Active token
  let [rows] = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token = ? AND revoked_at IS NULL AND expires_at > NOW()`,
    [refreshToken]
  );
  // Grace window: a token rotated in the last 60s (multi-tab / concurrent refresh race)
  // is still accepted so legitimate clients are never logged out by rotation.
  let grace = false;
  if (!rows.length) {
    [rows] = await pool.query(
      `SELECT * FROM refresh_tokens
        WHERE token = ? AND expires_at > NOW()
          AND revoked_at IS NOT NULL AND revoked_at >= NOW() - INTERVAL 60 SECOND`,
      [refreshToken]
    );
    if (rows.length) grace = true;
  }
  if (!rows.length) throw ApiError.unauthorized('Refresh token revoked or expired');

  const [userRows] = await pool.query(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [decoded.id]
  );
  const user = userRows[0];
  if (!user || user.status !== 'active') throw ApiError.unauthorized('Account inactive');

  if (!grace) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  const data = await buildAuthResponse(user);
  sendSuccess(res, data, 'Token refreshed');
});

exports.logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token = ?', [refreshToken]);
  }
  if (req.user) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [req.user.id]);
  }
  sendSuccess(res, null, 'Logged out');
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  const generic = { message: 'If that email exists, a reset link has been generated.' };
  if (!rows.length) return sendSuccess(res, generic);

  const token = jwt.sign({ id: rows[0].id }, env.jwt.secret, { expiresIn: '1h' });
  await pool.query(
    `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
    [rows[0].id, token]
  );
  // Email delivery will be wired when SMTP is configured; token returned in dev for testing.
  const data = env.nodeEnv === 'development' ? { resetToken: token } : null;
  sendSuccess(res, data, generic.message);
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const [rows] = await pool.query(
    `SELECT * FROM password_resets WHERE token = ? AND used_at IS NULL AND expires_at > NOW()`,
    [token]
  );
  if (!rows.length) throw ApiError.badRequest('Invalid or expired reset token');

  const hash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, rows[0].user_id]);
  await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [rows[0].id]);
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [rows[0].user_id]);
  sendSuccess(res, null, 'Password has been reset');
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, rows[0].password_hash)) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), req.user.id]);
  sendSuccess(res, null, 'Password changed');
});

/* ============ App phone + OTP auth ============ */

exports.otpSend = asyncHandler(async (req, res) => {
  const phone = otp.normalizePhone(req.body.phone);
  otp.assertValidPhone(phone);
  const code = await otp.createOtp(phone);
  const data = {
    phone,
    expiresIn: env.sms.otpTtlMinutes * 60,
  };
  if (env.nodeEnv !== 'production') data.devOtp = code;
  sendSuccess(res, data, 'OTP sent successfully');
});

exports.otpVerify = asyncHandler(async (req, res) => {
  const phone = otp.normalizePhone(req.body.phone);
  otp.assertValidPhone(phone);

  const [rows] = await pool.query(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.phone = ?`,
    [phone]
  );
  const user = rows[0];

  // app↔role mismatch check BEFORE burning the OTP
  if (user) {
    otp.assertClientRole(req.body.client, user.role_slug || (user.user_type === 'customer' ? 'customer' : null));
  }

  await otp.verifyOtp(phone, req.body.code);

  // existing user → login right here (no separate login call needed)
  if (user) {
    if (user.status !== 'active') throw ApiError.forbidden('Your account is inactive. Please contact support.');
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const data = await buildAuthResponse(user);
    await writeAudit({ actor: user, action: 'auth.otp_login', entity: 'users', entityId: user.id, req });
    return sendSuccess(res, { ...data, isNewUser: false }, 'Login successful');
  }

  // new user → verifyToken for registration
  const verifyToken = otp.signVerifyToken(phone);
  sendSuccess(res, { verifyToken, isNewUser: true, phone }, 'Phone verified — complete your registration');
});

exports.appRegister = asyncHandler(async (req, res) => {
  const { verifyToken, client, role } = req.body;
  const { phone } = otp.readVerifyToken(verifyToken);

  const [[existsPhone]] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
  if (existsPhone) throw ApiError.conflict('An account already exists for this phone. Please login.');

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name) throw ApiError.badRequest('Name is required');

  const roleSlug = client === 'customer' ? 'customer' : role || 'provider_owner';
  const userType = roleSlug === 'technician' ? 'employee' : 'customer';

  const [[roleRow]] = await pool.query('SELECT id FROM roles WHERE slug = ? AND status = 1', [roleSlug]);
  if (!roleRow) throw ApiError.badRequest('Invalid role');

  const [emailRows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (emailRows.length) throw ApiError.conflict('This email is already linked to another account');

  const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
  let result;
  try {
    [result] = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, user_type, role_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [name, email, phone, passwordHash, userType, roleRow.id]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw ApiError.conflict('An account already exists for this phone');
    throw err;
  }

  const [[user]] = await pool.query(
    `SELECT u.*, r.name AS role_name, r.slug AS role_slug FROM users u
      LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [result.insertId]
  );
  await notifyWelcome(user.id);
  const data = await buildAuthResponse(user);
  await writeAudit({ actor: user, action: 'auth.otp_register', entity: 'users', entityId: user.id, req });
  sendSuccess(res, data, 'Registration successful', 201);
});
