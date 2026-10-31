const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { cloudinaryUpload, cloudinaryImage, toPublicUrl } = require('../../middlewares/upload');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('services.view'));

// ---- modules ----
router.get(
  '/modules',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT m.*,
              (SELECT COUNT(*) FROM service_categories c WHERE c.module_id = m.id) AS category_count,
              (SELECT COUNT(*) FROM requests r WHERE r.module_id = m.id) AS request_count
         FROM service_modules m ORDER BY m.sort_order, m.id`
    );
    sendSuccess(res, rows.map((r) => ({ ...r, image: toPublicUrl(r.image) })));
  })
);

router.post(
  '/modules',
  requirePermission('services.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const { code, name, description, icon, status = 1, sort_order = 0 } = req.body;
    const [exists] = await pool.query('SELECT id FROM service_modules WHERE code = ?', [code]);
    if (exists.length) throw ApiError.conflict('Module code already exists');
    const image = await cloudinaryImage(req, res);
    const [result] = await pool.query(
      `INSERT INTO service_modules (code, name, description, icon, image, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, name, description || null, icon || null, image, status, sort_order]
    );
    await writeAudit({ actor: req.user, action: 'module.create', entity: 'service_modules', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Module created', 201);
  })
);

router.put(
  '/modules/:id',
  requirePermission('services.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const { name, description, icon, status, sort_order } = req.body;
    const [rows] = await pool.query('SELECT * FROM service_modules WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Module not found');
    const image = (await cloudinaryImage(req, res)) ?? rows[0].image;
    await pool.query(
      `UPDATE service_modules SET name = COALESCE(?, name), description = COALESCE(?, description),
              icon = COALESCE(?, icon), image = ?, status = COALESCE(?, status), sort_order = COALESCE(?, sort_order)
        WHERE id = ?`,
      [name || null, description ?? null, icon || null, image, status ?? null, sort_order ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'module.update', entity: 'service_modules', entityId: req.params.id, req });
    sendSuccess(res, null, 'Module updated');
  })
);

router.delete(
  '/modules/:id',
  requirePermission('services.manage'),
  asyncHandler(async (req, res) => {
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM requests WHERE module_id = ?', [req.params.id]);
    if (cnt > 0) throw ApiError.badRequest('Cannot delete module with existing requests');
    await pool.query('DELETE FROM service_modules WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'module.delete', entity: 'service_modules', entityId: req.params.id, req });
    sendSuccess(res, null, 'Module deleted');
  })
);

// ---- categories ----
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    let where = '';
    const params = [];
    if (req.query.module_id) {
      where = 'WHERE c.module_id = ?';
      params.push(req.query.module_id);
    }
    const [rows] = await pool.query(
      `SELECT c.*, m.name AS module_name, m.code AS module_code
         FROM service_categories c JOIN service_modules m ON m.id = c.module_id
        ${where} ORDER BY c.sort_order, c.id`,
      params
    );
    sendSuccess(res, rows.map((r) => ({ ...r, image: toPublicUrl(r.image) })));
  })
);

router.post(
  '/categories',
  requirePermission('services.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const { module_id, name, description, price, is_featured = 0, status = 1, sort_order = 0 } = req.body;
    const [[mod]] = await pool.query('SELECT id FROM service_modules WHERE id = ?', [module_id]);
    if (!mod) throw ApiError.badRequest('Module does not exist');
    let priceValue = null;
    if (price !== undefined && price !== null && price !== '') {
      priceValue = Number(price);
      if (Number.isNaN(priceValue) || priceValue < 0) throw ApiError.badRequest('Price must be a non-negative number');
    }
    const image = await cloudinaryImage(req, res);
    const [result] = await pool.query(
      `INSERT INTO service_categories (module_id, name, description, image, price, is_featured, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [module_id, name, description || null, image, priceValue, is_featured, status, sort_order]
    );
    await writeAudit({ actor: req.user, action: 'category.create', entity: 'service_categories', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Category created', 201);
  })
);

router.put(
  '/categories/:id',
  requirePermission('services.manage'),
  cloudinaryUpload.single('image'),
  asyncHandler(async (req, res) => {
    const { name, description, price, is_featured, status, sort_order } = req.body;
    const [rows] = await pool.query('SELECT * FROM service_categories WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Category not found');
    let priceValue = rows[0].price;
    if (price !== undefined) {
      if (price === null || price === '') priceValue = null;
      else {
        priceValue = Number(price);
        if (Number.isNaN(priceValue) || priceValue < 0) throw ApiError.badRequest('Price must be a non-negative number');
      }
    }
    const image = (await cloudinaryImage(req, res)) ?? rows[0].image;
    await pool.query(
      `UPDATE service_categories SET name = COALESCE(?, name), description = COALESCE(?, description),
              image = ?, price = ?, is_featured = COALESCE(?, is_featured), status = COALESCE(?, status),
              sort_order = COALESCE(?, sort_order)
        WHERE id = ?`,
      [name || null, description ?? null, image, priceValue, is_featured ?? null, status ?? null, sort_order ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'category.update', entity: 'service_categories', entityId: req.params.id, req });
    sendSuccess(res, null, 'Category updated');
  })
);

router.delete(
  '/categories/:id',
  requirePermission('services.manage'),
  asyncHandler(async (req, res) => {
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM requests WHERE category_id = ?', [req.params.id]);
    if (cnt > 0) throw ApiError.badRequest('Cannot delete category with existing requests');
    await pool.query('DELETE FROM service_categories WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'category.delete', entity: 'service_categories', entityId: req.params.id, req });
    sendSuccess(res, null, 'Category deleted');
  })
);

module.exports = router;
