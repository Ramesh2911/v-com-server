const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const env = require('../config');
const ApiError = require('../utils/ApiError');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const createStorage = (subfolder) => {
  const dest = ensureDir(path.join(UPLOAD_ROOT, subfolder));
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dest),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${ext}`);
    },
  });
};

const fileFilter = (req, file, cb) => {
  const ok =
    /^image\//.test(file.mimetype) ||
    /^video\//.test(file.mimetype) ||
    /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.|text\/)/.test(file.mimetype);
  if (ok) return cb(null, true);
  cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
};

const makeUploader = (subfolder, maxFiles) =>
  multer({
    storage: createStorage(subfolder),
    fileFilter,
    limits: {
      files: maxFiles,
      fileSize: env.upload.maxVideoSizeMb * 1024 * 1024,
    },
  });

const requestUpload = makeUploader('requests', 8);
const jobUpload = makeUploader('jobs', 10);
const propertyUpload = makeUploader('properties', 16);
const generalUpload = makeUploader('general', 5);

// ---- Cloudinary (service category / service images) ----
const cloudinaryConfigured = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

const imageFileFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) return cb(null, true);
  cb(ApiError.badRequest(`Only images are allowed: ${file.mimetype}`));
};

// Memory storage: buffer theke Cloudinary e upload, req.file.path = secure_url
const cloudinaryMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: env.upload.maxImageSizeMb * 1024 * 1024, files: 1 },
});

const uploadBufferToCloudinary = (file) =>
  new Promise((resolve, reject) => {
    const folder = env.cloudinary.folder || 'v-com';
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(file.buffer);
  });

// Usage: await cloudinaryImage(req, res) after cloudinaryMemory.single('image')
// Falls back to local disk path when Cloudinary keys are not configured.
const cloudinaryImage = async (req, res) => {
  if (!req.file) return null;
  if (!cloudinaryConfigured) return `general/${req.file.filename || `${Date.now()}`}`;
  try {
    const result = await uploadBufferToCloudinary(req.file);
    req.file.path = result.secure_url;
    return result.secure_url;
  } catch (err) {
    throw ApiError.internal(`Cloudinary upload failed: ${err.message}`);
  }
};

const cloudinaryUpload = cloudinaryConfigured ? cloudinaryMemory : generalUpload;

const classifyFileType = (mimetype) => {
  if (/^image\//.test(mimetype)) return 'image';
  if (/^video\//.test(mimetype)) return 'video';
  return 'document';
};

const toPublicUrl = (value) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value; // Cloudinary / absolute URLs pass through
  return `${env.publicFileBaseUrl}/${value.replace(/\\/g, '/')}`;
};

module.exports = {
  UPLOAD_ROOT,
  requestUpload,
  jobUpload,
  propertyUpload,
  generalUpload,
  cloudinaryUpload,
  cloudinaryImage,
  classifyFileType,
  toPublicUrl,
};
