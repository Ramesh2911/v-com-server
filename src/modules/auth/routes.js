const router = require('express').Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const controller = require('./controller');
const validate = require('../../middlewares/validate');
const { authMiddleware } = require('../../middlewares/auth');

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
const otpSendLimiter = rateLimit({ windowMs: 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false });
const otpVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post(
  '/register',
  registerLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').optional({ nullable: true }).isLength({ min: 8, max: 20 }),
    body('verifyToken').if(body('verifyToken').exists()).notEmpty().withMessage('verifyToken is required'),
    body('client')
      .if(body('verifyToken').exists())
      .isIn(['customer', 'vendor'])
      .withMessage('client must be "customer" or "vendor"'),
    body('role').optional().isIn(['provider_owner', 'technician']).withMessage('Invalid role'),
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
    body('verifyToken').if(body('verifyToken').exists()).notEmpty().withMessage('verifyToken is required'),
    body('client').optional().isIn(['customer', 'vendor']).withMessage('client must be "customer" or "vendor"'),
    body('email').if(body('verifyToken').not().exists()).isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').if(body('verifyToken').not().exists()).notEmpty().withMessage('Password is required'),
  ],
  validate,
  (req, res, next) => (req.body.verifyToken ? controller.appLogin(req, res, next) : controller.login(req, res, next))
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
