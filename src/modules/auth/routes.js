const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const controller = require('./controller');
const env = require('../../config');
const validate = require('../../middlewares/validate');
const { authMiddleware } = require('../../middlewares/auth');
const { kycUpload } = require('../../middlewares/upload');

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.sms.limits.sendPerMinuteIp,
  standardHeaders: true,
  legacyHeaders: false,
});
const otpVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// vendor phone-OTP registration (provider_owner) — email optional, business details + services required
const isVendorOtp = (value, { req }) =>
  !!req.body.verifyToken && req.body.client === 'vendor' && (req.body.role || 'provider_owner') === 'provider_owner';

router.post(
  '/register',
  registerLimiter,
  // vendor signup sends multipart (fields + photo/aadhar/pan images); JSON requests pass through untouched
  kycUpload.any(),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email')
      .if((value, { req }) => !(req.body.verifyToken && req.body.client === 'vendor'))
      .isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('email')
      .if((value, { req }) => !!req.body.verifyToken && req.body.client === 'vendor' && String(value || '').trim() !== '')
      .isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').optional({ nullable: true }).isLength({ min: 8, max: 20 }),
    body('verifyToken').if(body('verifyToken').exists()).notEmpty().withMessage('verifyToken is required'),
    body('client')
      .if(body('verifyToken').exists())
      .isIn(['customer', 'vendor'])
      .withMessage('client must be "customer" or "vendor"'),
    body('role').optional().isIn(['provider_owner', 'technician']).withMessage('Invalid role'),
    body('business_name').if(isVendorOtp).trim().notEmpty().withMessage('Business name is required'),
    body('contact_person').if(isVendorOtp).optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('city').if(isVendorOtp).optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('state').if(isVendorOtp).optional({ nullable: true }).trim().isLength({ max: 100 }),
    body('pincode').if(isVendorOtp).optional({ nullable: true }).trim().isLength({ max: 10 }),
    body('address').if(isVendorOtp).trim().notEmpty().withMessage('Address is required').isLength({ max: 255 }),
    body('gst_no').if(isVendorOtp).optional({ nullable: true }).trim().isLength({ max: 30 }),
    body('category_ids')
      .if(isVendorOtp)
      .custom((value) => {
        let ids = value;
        if (typeof ids === 'string') {
          try { ids = JSON.parse(ids); } catch (_) { ids = ids.split(','); }
        }
        if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one service category');
        if (ids.some((i) => !Number.isInteger(Number(i)) || Number(i) < 1)) throw new Error('Invalid category_ids');
        return true;
      }),
    body('password')
      .if(body('verifyToken').not().exists())
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  validate,
  (req, res, next) => (req.body.verifyToken ? controller.appRegister(req, res, next) : controller.register(req, res, next))
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  controller.login
);

router.post(
  '/otp/send',
  otpSendLimiter,
  [body('phone').notEmpty().withMessage('Phone is required')],
  validate,
  controller.otpSend
);

router.post(
  '/otp/verify',
  otpVerifyLimiter,
  [
    body('phone').notEmpty().withMessage('Phone is required'),
    body('code').isLength({ min: 4, max: 6 }).withMessage('OTP must be 4-6 digits').bail().isNumeric(),
    body('client').optional().isIn(['customer', 'vendor', 'technician']).withMessage('client must be "customer", "vendor" or "technician"'),
  ],
  validate,
  controller.otpVerify
);

router.post('/refresh', controller.refresh);
router.post('/logout', authMiddleware, controller.logout);

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  controller.forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  controller.resetPassword
);

router.post(
  '/change-password',
  authMiddleware,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }),
  ],
  validate,
  controller.changePassword
);

module.exports = router;
