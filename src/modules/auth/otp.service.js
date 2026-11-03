const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const env = require('../../config');
const ApiError = require('../../utils/ApiError');

const PHONE_RE = /^[6-9]\d{9}$/;
const MAX_ATTEMPTS = 5;
const PURPOSE = 'login';

const normalizePhone = (raw) => {
  let p = String(raw || '').replace(/[\s-]/g, '');
  if (p.startsWith('+91')) p = p.slice(3);
  else if (p.startsWith('+910')) p = p.slice(4);
  if (/^91\d{10}$/.test(p)) p = p.slice(2);
  if (/^0\d{10}$/.test(p)) p = p.slice(1);
  return p;
};

const assertValidPhone = (phone) => {
  if (!PHONE_RE.test(phone)) throw ApiError.badRequest('Enter a valid 10-digit mobile number');
};

const isMockProvider = () => !['msg91', 'twilio'].includes(env.sms.provider);

const sendSms = async (phone, code) => {
  const provider = env.sms.provider;
  if (provider === 'msg91') {
    if (!env.sms.msg91.authKey) throw ApiError.internal('MSG91 is not configured');
    const res = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        authkey: env.sms.msg91.authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template: env.sms.msg91.templateId || '',
        mobile: `91${phone}`,
        otp: code,
        sender: env.sms.msg91.senderId || 'VCOM',
      }),
    });
    if (!res.ok) throw ApiError.internal(`SMS provider error (${res.status})`);
    return;
  }
  if (provider === 'twilio') {
    const { accountSid, authToken, from } = env.sms.twilio;
    if (!accountSid || !authToken || !from) throw ApiError.internal('Twilio is not configured');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({
      From: from,
      To: `+91${phone}`,
      Body: `Your V_COM verification code is ${code}. It expires in ${env.sms.otpTtlMinutes} minutes.`,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw ApiError.internal(`SMS provider error (${res.status})`);
    return;
  }
  // mock: fixed OTP + console log (dev/test)
  console.log(`[OTP][mock] phone=${phone} code=${code}`);
};

const assertSendRate = async (phone) => {
  const { daily, perPhoneMinute } = env.sms.limits;
  if (perPhoneMinute > 0) {
    const [recent] = await pool.query(
      `SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND created_at > NOW() - INTERVAL 1 MINUTE`,
      [phone]
    );
    if (recent[0].n >= perPhoneMinute) throw ApiError.tooMany('Please wait a minute before requesting another OTP');
  }
  if (daily > 0) {
    const [dayRows] = await pool.query(
      `SELECT COUNT(*) AS n FROM otp_codes WHERE phone = ? AND created_at > NOW() - INTERVAL 1 DAY`,
      [phone]
    );
    if (dayRows[0].n >= daily) throw ApiError.tooMany('Daily OTP limit reached. Try again tomorrow.');
  }
};

const createOtp = async (phone) => {
  await assertSendRate(phone);
  const code = isMockProvider() ? env.sms.fixedCode : String(crypto.randomInt(100000, 1000000));
  await pool.query(`UPDATE otp_codes SET consumed_at = NOW() WHERE phone = ? AND consumed_at IS NULL`, [phone]);
  await pool.query(
    `INSERT INTO otp_codes (phone, code, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [phone, code, PURPOSE, env.sms.otpTtlMinutes]
  );
  await sendSms(phone, code);
  return code;
};

const verifyOtp = async (phone, code) => {
  const [rows] = await pool.query(
    `SELECT * FROM otp_codes
      WHERE phone = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [phone, PURPOSE]
  );
  const row = rows[0];
  if (!row) throw ApiError.badRequest('OTP not found or already used. Please request a new one.');
  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?', [row.id]);
    throw ApiError.tooMany('Too many failed attempts. Please request a new OTP.');
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw ApiError.badRequest('OTP expired. Please request a new one.');
  }
  if (String(row.code) !== String(code)) {
    await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    throw ApiError.badRequest('Incorrect OTP');
  }
  const [result] = await pool.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL', [
    row.id,
  ]);
  if (!result.affectedRows) throw ApiError.badRequest('OTP already used. Please request a new one.');
};

const signVerifyToken = (phone) =>
  jwt.sign({ phone, p: 'otp' }, env.jwt.secret, { expiresIn: `${env.sms.otpTtlMinutes}m` });

const readVerifyToken = (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, env.jwt.secret);
  } catch (_) {
    throw ApiError.unauthorized('Invalid or expired verification token');
  }
  if (decoded.p !== 'otp' || !PHONE_RE.test(decoded.phone || '')) {
    throw ApiError.unauthorized('Invalid verification token');
  }
  return decoded;
};

const CLIENT_ROLES = {
  customer: ['customer'],
  vendor: ['provider_owner', 'technician'],
};

const assertClientRole = (client, roleSlug) => {
  if (!client) return;
  const allowed = CLIENT_ROLES[client];
  if (!allowed) throw ApiError.badRequest('Invalid client. Use "customer" or "vendor".');
  if (!allowed.includes(roleSlug)) throw ApiError.forbidden('This account does not belong to this app');
};

module.exports = {
  PHONE_RE,
  CLIENT_ROLES,
  normalizePhone,
  assertValidPhone,
  createOtp,
  verifyOtp,
  signVerifyToken,
  readVerifyToken,
  assertClientRole,
};
