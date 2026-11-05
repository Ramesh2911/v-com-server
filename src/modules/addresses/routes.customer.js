const router = require('express').Router();
const { body, param } = require('express-validator');
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');

router.use(authMiddleware);

const MAX_ADDRESSES = 10;

const mapAddress = (a) => ({
  ...a,
  is_default: !!a.is_default,
  status: !!a.status,
  latitude: a.latitude === null || a.latitude === undefined ? null : Number(a.latitude),
  longitude: a.longitude === null || a.longitude === undefined ? null : Number(a.longitude),
});

const str = (v) => (v === undefined || v === '' ? null : v);

// forms send '' for blank optional fields — treat as null
const normalizeEmpty = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    for (const k of Object.keys(req.body)) {
      if (req.body[k] === '') req.body[k] = null;
    }
  }
  next();
};

const idRules = [param('id').isInt({ min: 1 }).withMessage('Valid address id required')];

const addressRules = [
  body('label').optional({ nullable: true }).trim().isLength({ max: 30 }).withMessage('label max 30 chars'),
  body('line1').optional().trim().notEmpty().withMessage('line1 is required').isLength({ max: 255 }),
  body('line2').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('landmark').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('city').optional().trim().notEmpty().withMessage('city is required').isLength({ max: 100 }),
  body('state').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('pincode').optional({ nullable: true }).trim().matches(/^\d{3,10}$/).withMessage('pincode must be 3-10 digits'),
  body('phone').optional({ nullable: true }).trim().isLength({ min: 8, max: 20 }),
  body('latitude').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('latitude must be -90..90'),
  body('longitude').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('longitude must be -180..180'),
  body('is_default').optional({ nullable: true }).isBoolean().withMessage('is_default must be boolean'),
];

const fetchAddress = async (id, userId) => {
  const [rows] = await pool.query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [id, userId]);
  return rows[0] || null;
};

const withTransaction = async (fn) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

// GET /api/v1/customer/addresses — my addresses (default first)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT * FROM addresses WHERE user_id = ? AND status = 1
        ORDER BY is_default DESC, id DESC`,
      [req.user.id]
    );
    sendSuccess(res, rows.map(mapAddress));
  })
);

// POST /api/v1/customer/addresses — add (first one auto-default, max 10)
router.post(
  '/',
  normalizeEmpty,
  addressRules,
  validate,
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const b = req.body;
    if (!b.line1) throw ApiError.badRequest('line1 is required', [{ field: 'line1', message: 'line1 is required' }]);
    if (!b.city) throw ApiError.badRequest('city is required', [{ field: 'city', message: 'city is required' }]);

    const id = await withTransaction(async (conn) => {
      const [cntRows] = await conn.query(
        'SELECT COUNT(*) AS cnt FROM addresses WHERE user_id = ? AND status = 1',
        [uid]
      );
      if (cntRows[0].cnt >= MAX_ADDRESSES) {
        throw ApiError.conflict(`Address limit reached (max ${MAX_ADDRESSES})`);
      }
      const makeDefault =
        b.is_default === true || b.is_default === 'true' || b.is_default === 1 || b.is_default === '1' ||
        cntRows[0].cnt === 0;
      if (makeDefault) {
        await conn.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [uid]);
      }
      const [ins] = await conn.query(
        `INSERT INTO addresses (user_id, label, line1, line2, landmark, city, state, pincode, phone, latitude, longitude, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid,
          str(b.label) || null,
          b.line1,
          str(b.line2),
          str(b.landmark),
          b.city,
          str(b.state),
          str(b.pincode),
          str(b.phone),
          b.latitude === undefined || b.latitude === '' || b.latitude === null ? null : Number(b.latitude),
          b.longitude === undefined || b.longitude === '' || b.longitude === null ? null : Number(b.longitude),
          makeDefault ? 1 : 0,
        ]
      );
      return ins.insertId;
    });

    const row = await fetchAddress(id, uid);
    sendSuccess(res, mapAddress(row), 'Address created', 201);
  })
);

// PUT /api/v1/customer/addresses/:id — update own address
router.put(
  '/:id',
  normalizeEmpty,
  [...idRules, ...addressRules],
  validate,
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const id = Number(req.params.id);
    const existing = await fetchAddress(id, uid);
    if (!existing) throw ApiError.notFound('Address not found');

    const b = req.body;
    const sets = [];
    const vals = [];
    const put = (col, val) => {
      sets.push(`${col} = ?`);
      vals.push(val);
    };
    if ('label' in b) put('label', str(b.label));
    if ('line1' in b) put('line1', b.line1);
    if ('line2' in b) put('line2', str(b.line2));
    if ('landmark' in b) put('landmark', str(b.landmark));
    if ('city' in b) put('city', b.city);
    if ('state' in b) put('state', str(b.state));
    if ('pincode' in b) put('pincode', str(b.pincode));
    if ('phone' in b) put('phone', str(b.phone));
    if ('latitude' in b) put('latitude', b.latitude === '' || b.latitude === null ? null : Number(b.latitude));
    if ('longitude' in b) put('longitude', b.longitude === '' || b.longitude === null ? null : Number(b.longitude));

    const makeDefault = b.is_default === true || b.is_default === 'true' || b.is_default === 1 || b.is_default === '1';

    if (!sets.length && !makeDefault) {
      return sendSuccess(res, mapAddress(existing), 'Address updated');
    }

    await withTransaction(async (conn) => {
      if (sets.length) {
        await conn.query(`UPDATE addresses SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [
          ...vals,
          id,
          uid,
        ]);
      }
      if (makeDefault && !existing.is_default) {
        await conn.query('UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id <> ?', [uid, id]);
        await conn.query('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [id, uid]);
      }
    });

    const row = await fetchAddress(id, uid);
    sendSuccess(res, mapAddress(row), 'Address updated');
  })
);

// PATCH /api/v1/customer/addresses/:id/default — make this the default
router.patch(
  '/:id/default',
  idRules,
  validate,
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const id = Number(req.params.id);
    const existing = await fetchAddress(id, uid);
    if (!existing) throw ApiError.notFound('Address not found');

    if (!existing.is_default) {
      await withTransaction(async (conn) => {
        await conn.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [uid]);
        await conn.query('UPDATE addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [id, uid]);
      });
    }

    const row = await fetchAddress(id, uid);
    sendSuccess(res, mapAddress(row), 'Default address set');
  })
);

// DELETE /api/v1/customer/addresses/:id — delete own; default auto-promotes
router.delete(
  '/:id',
  idRules,
  validate,
  asyncHandler(async (req, res) => {
    const uid = req.user.id;
    const id = Number(req.params.id);
    const existing = await fetchAddress(id, uid);
    if (!existing) throw ApiError.notFound('Address not found');

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM addresses WHERE id = ? AND user_id = ?', [id, uid]);
      if (existing.is_default) {
        const [rest] = await conn.query(
          'SELECT MIN(id) AS next_id FROM addresses WHERE user_id = ? AND status = 1',
          [uid]
        );
        if (rest[0].next_id) {
          await conn.query('UPDATE addresses SET is_default = 1 WHERE id = ?', [rest[0].next_id]);
        }
      }
    });

    sendSuccess(res, null, 'Address deleted');
  })
);

module.exports = router;
