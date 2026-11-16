const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const pool = require('../../config/db');
const env = require('../../config');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { toPublicUrl, UPLOAD_ROOT } = require('../../middlewares/upload');

router.use(authMiddleware);

const MAX_CV_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

// memory upload — manual per-field validation below (cv: pdf, avatar: image)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CV_BYTES, files: 2 },
});

const cloudinaryConfigured = Boolean(
  env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret
);

const uploadBufferToCloudinary = (buffer, { raw = false, extension = '' } = {}) =>
  new Promise((resolve, reject) => {
    const folder = env.cloudinary.folder || 'v-com';
    const opts = raw
      ? { folder, resource_type: 'raw', public_id: `cv-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}` }
      : { folder, resource_type: 'image' };
    const stream = cloudinary.uploader.upload_stream(opts, (error, result) =>
      error ? reject(error) : resolve(result.secure_url)
    );
    stream.end(buffer);
  });

const saveToDisk = async (buffer, subfolder, filename) => {
  const dir = path.join(UPLOAD_ROOT, subfolder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, filename), buffer);
  return `${subfolder}/${filename}`;
};

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PHONE_RE = /^(\d{10}|\+91\d{10})$/;

const toAppView = (r) => ({
  id: r.id,
  application_ref: r.application_ref,
  role: r.role || null,
  status: r.status,
  name: r.name,
  email: r.email,
  phone: r.phone,
  address: r.address || null,
  avatar_url: toPublicUrl(r.avatar),
  cv_url: toPublicUrl(r.cv),
  submitted_at: r.submitted_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/* ================= POST /customer/job-applications ================= */

router.post(
  '/',
  upload.any(),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const { name, email, phone, address, role } = b;
    if (!name || !email || !phone || !address) {
      throw ApiError.badRequest('name, email, phone and address are required');
    }
    if (!EMAIL_RE.test(String(email).trim())) throw ApiError.badRequest('email is invalid');
    const phoneNorm = String(phone).replace(/[\s-]/g, '');
    if (!PHONE_RE.test(phoneNorm)) throw ApiError.badRequest('phone must be a 10 digit mobile number');

    const files = req.files || [];
    const cv = files.find((f) => f.fieldname === 'cv');
    const avatar = files.find((f) => f.fieldname === 'avatar');
    if (!cv) throw ApiError.badRequest('cv is required');
    if (cv.mimetype !== 'application/pdf') throw ApiError.badRequest('cv must be a PDF');
    if (cv.size > MAX_CV_BYTES) throw ApiError.badRequest('cv must be 10MB or smaller');
    if (avatar) {
      if (!/^image\//.test(avatar.mimetype)) throw ApiError.badRequest('avatar must be an image (JPEG/PNG)');
      if (avatar.size > MAX_AVATAR_BYTES) throw ApiError.badRequest('avatar must be 5MB or smaller');
    }

    // upload files: Cloudinary when configured, else local disk
    let cvStored;
    let avatarStored = null;
    if (cloudinaryConfigured) {
      try {
        cvStored = await uploadBufferToCloudinary(cv.buffer, { raw: true, extension: '.pdf' });
        if (avatar) avatarStored = await uploadBufferToCloudinary(avatar.buffer);
      } catch (err) {
        throw ApiError.internal(`File upload failed: ${err.message}`);
      }
    } else {
      const uniq = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cvStored = await saveToDisk(cv.buffer, 'job-applications', `${uniq}.pdf`);
      if (avatar) {
        const ext = path.extname(avatar.originalname).toLowerCase().slice(0, 10) || '.png';
        avatarStored = await saveToDisk(avatar.buffer, 'job-applications', `${uniq}-avatar${ext}`);
      }
    }

    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM job_applications');
    const applicationRef = `JOB-${new Date().getFullYear()}-${String(Number(n) + 1).padStart(3, '0')}`;

    const [result] = await pool.query(
      `INSERT INTO job_applications (user_id, application_ref, name, email, phone, address, role, avatar, cv, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'under_review')`,
      [
        req.user.id,
        applicationRef,
        String(name).trim(),
        String(email).trim(),
        phoneNorm,
        String(address).trim(),
        role ? String(role).trim().slice(0, 120) : null,
        avatarStored,
        cvStored,
      ]
    );

    const [[row]] = await pool.query('SELECT * FROM job_applications WHERE id = ?', [result.insertId]);
    sendSuccess(
      res,
      {
        id: row.id,
        application_ref: row.application_ref,
        status: row.status,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        role: row.role,
        avatar_url: toPublicUrl(row.avatar),
        cv_url: toPublicUrl(row.cv),
        submitted_at: row.submitted_at,
      },
      'Application submitted successfully',
      201
    );
  })
);

/* ================= GET /customer/job-applications — my list ================= */

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, application_ref, role, status, submitted_at
         FROM job_applications
        WHERE user_id = ?
        ORDER BY submitted_at DESC, id DESC
        LIMIT 100`,
      [req.user.id]
    );
    sendSuccess(
      res,
      {
        items: rows.map((r) => ({
          id: r.id,
          application_ref: r.application_ref,
          role: r.role || null,
          status: r.status,
          submitted_at: r.submitted_at,
        })),
      },
      'Applications fetched successfully'
    );
  })
);

/* ================= GET /customer/job-applications/:id ================= */

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest('Valid id required');
    const [rows] = await pool.query(
      'SELECT * FROM job_applications WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) throw ApiError.notFound('Application not found');
    sendSuccess(res, toAppView(rows[0]), 'Application fetched successfully');
  })
);

module.exports = router;
