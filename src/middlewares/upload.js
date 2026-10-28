const path = require('path');
const fs = require('fs');
const multer = require('multer');
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

const classifyFileType = (mimetype) => {
  if (/^image\//.test(mimetype)) return 'image';
  if (/^video\//.test(mimetype)) return 'video';
  return 'document';
};

const toPublicUrl = (relativePath) =>
  relativePath ? `${env.publicFileBaseUrl}/${relativePath.replace(/\\/g, '/')}` : null;

module.exports = {
  UPLOAD_ROOT,
  requestUpload,
  jobUpload,
  propertyUpload,
  generalUpload,
  classifyFileType,
  toPublicUrl,
};
