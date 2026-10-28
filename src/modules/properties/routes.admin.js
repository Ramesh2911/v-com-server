const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');
const { propertyUpload, classifyFileType, toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('properties.view'));

const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ======================= DASHBOARD STATS =======================
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [[propStats]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'available') AS available,
              SUM(listing_type = 'sale') AS for_sale,
              SUM(listing_type = 'rent') AS for_rent
         FROM properties`
    );
    const [[enqStats]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(status = 'new') AS new_count FROM property_enquiries`
    );
    const [[counts]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM builders) AS builders,
              (SELECT COUNT(*) FROM projects) AS projects,
              (SELECT COUNT(*) FROM areas) AS areas`
    );
    sendSuccess(res, { properties: propStats, enquiries: enqStats, ...counts });
  })
);

// ======================= BUILDERS =======================
router.get(
  '/builders',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT b.*, (SELECT COUNT(*) FROM projects p WHERE p.builder_id = b.id) AS project_count,
              (SELECT COUNT(*) FROM properties pr WHERE pr.builder_id = b.id) AS property_count
         FROM builders b ORDER BY b.name`
    );
    sendSuccess(res, rows.map((r) => ({ ...r, logo: toPublicUrl(r.logo) })));
  })
);

router.post(
  '/builders',
  requirePermission('properties.manage'),
  propertyUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const { name, description, website, contact_phone, status = 1 } = req.body;
    if (!name) throw ApiError.badRequest('Name is required');
    let slug = slugify(name);
    const [dup] = await pool.query('SELECT id FROM builders WHERE slug = ?', [slug]);
    if (dup.length) slug = `${slug}-${Date.now().toString(36)}`;
    const logo = req.file ? `properties/${req.file.filename}` : null;
    const [result] = await pool.query(
      `INSERT INTO builders (name, slug, logo, description, website, contact_phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, slug, logo, description || null, website || null, contact_phone || null, status]
    );
    await writeAudit({ actor: req.user, action: 'builder.create', entity: 'builders', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Builder created', 201);
  })
);

router.put(
  '/builders/:id',
  requirePermission('properties.manage'),
  propertyUpload.single('logo'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM builders WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Builder not found');
    const { name, description, website, contact_phone, status } = req.body;
    const logo = req.file ? `properties/${req.file.filename}` : rows[0].logo;
    await pool.query(
      `UPDATE builders SET name = COALESCE(?, name), logo = ?, description = COALESCE(?, description),
              website = COALESCE(?, website), contact_phone = COALESCE(?, contact_phone), status = COALESCE(?, status)
        WHERE id = ?`,
      [name || null, logo, description ?? null, website || null, contact_phone || null, status ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'builder.update', entity: 'builders', entityId: req.params.id, req });
    sendSuccess(res, null, 'Builder updated');
  })
);

router.delete(
  '/builders/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM properties WHERE builder_id = ?', [req.params.id]);
    if (cnt) throw ApiError.badRequest('Cannot delete builder with properties');
    await pool.query('DELETE FROM builders WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'builder.delete', entity: 'builders', entityId: req.params.id, req });
    sendSuccess(res, null, 'Builder deleted');
  })
);

// ======================= PROJECTS =======================
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    let where = '';
    const params = [];
    if (req.query.builder_id) {
      where = 'WHERE p.builder_id = ?';
      params.push(req.query.builder_id);
    }
    const [rows] = await pool.query(
      `SELECT p.*, b.name AS builder_name,
              (SELECT COUNT(*) FROM properties pr WHERE pr.project_id = p.id) AS property_count
         FROM projects p JOIN builders b ON b.id = p.builder_id
        ${where} ORDER BY p.name`,
      params
    );
    sendSuccess(res, rows);
  })
);

router.post(
  '/projects',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const { builder_id, name, description, status = 1 } = req.body;
    if (!builder_id || !name) throw ApiError.badRequest('builder_id and name are required');
    let slug = slugify(name);
    const [dup] = await pool.query('SELECT id FROM projects WHERE slug = ?', [slug]);
    if (dup.length) slug = `${slug}-${Date.now().toString(36)}`;
    const [result] = await pool.query(
      `INSERT INTO projects (builder_id, name, slug, description, status) VALUES (?, ?, ?, ?, ?)`,
      [builder_id, name, slug, description || null, status]
    );
    await writeAudit({ actor: req.user, action: 'project.create', entity: 'projects', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Project created', 201);
  })
);

router.put(
  '/projects/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Project not found');
    const { builder_id, name, description, status } = req.body;
    await pool.query(
      `UPDATE projects SET builder_id = COALESCE(?, builder_id), name = COALESCE(?, name),
              description = COALESCE(?, description), status = COALESCE(?, status) WHERE id = ?`,
      [builder_id ?? null, name || null, description ?? null, status ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'project.update', entity: 'projects', entityId: req.params.id, req });
    sendSuccess(res, null, 'Project updated');
  })
);

router.delete(
  '/projects/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM properties WHERE project_id = ?', [req.params.id]);
    if (cnt) throw ApiError.badRequest('Cannot delete project with properties');
    await pool.query('DELETE FROM projects WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'project.delete', entity: 'projects', entityId: req.params.id, req });
    sendSuccess(res, null, 'Project deleted');
  })
);

// ======================= AREAS =======================
router.get(
  '/areas',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT a.*, (SELECT COUNT(*) FROM properties p WHERE p.area_id = a.id) AS property_count
         FROM areas a ORDER BY a.city, a.name`
    );
    sendSuccess(res, rows);
  })
);

router.post(
  '/areas',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const { name, locality, city, status = 1 } = req.body;
    if (!name || !city) throw ApiError.badRequest('name and city are required');
    const [result] = await pool.query(
      `INSERT INTO areas (name, locality, city, status) VALUES (?, ?, ?, ?)`,
      [name, locality || null, city, status]
    );
    await writeAudit({ actor: req.user, action: 'area.create', entity: 'areas', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Area created', 201);
  })
);

router.put(
  '/areas/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM areas WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Area not found');
    const { name, locality, city, status } = req.body;
    await pool.query(
      `UPDATE areas SET name = COALESCE(?, name), locality = COALESCE(?, locality),
              city = COALESCE(?, city), status = COALESCE(?, status) WHERE id = ?`,
      [name || null, locality || null, city || null, status ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'area.update', entity: 'areas', entityId: req.params.id, req });
    sendSuccess(res, null, 'Area updated');
  })
);

router.delete(
  '/areas/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM properties WHERE area_id = ?', [req.params.id]);
    if (cnt) throw ApiError.badRequest('Cannot delete area with properties');
    await pool.query('DELETE FROM areas WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'area.delete', entity: 'areas', entityId: req.params.id, req });
    sendSuccess(res, null, 'Area deleted');
  })
);

// ======================= PROPERTIES =======================
const PROP_ADMIN_SELECT = `
  SELECT p.*, b.name AS builder_name, pr.name AS project_name, a.name AS area_name, a.city,
         u.name AS created_by_name
    FROM properties p
    JOIN builders b ON b.id = p.builder_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    JOIN areas a ON a.id = p.area_id
    LEFT JOIN users u ON u.id = p.created_by`;

async function attachMedia(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [media] = await pool.query('SELECT * FROM property_media WHERE property_id IN (?) ORDER BY sort_order, id', [ids]);
  return rows.map((r) => ({
    ...r,
    media: media.filter((m) => m.property_id === r.id).map((m) => ({ id: m.id, type: m.media_type, url: toPublicUrl(m.file_path), sort_order: m.sort_order })),
  }));
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    for (const [f, col] of [['status', 'p.status'], ['listing_type', 'p.listing_type'], ['builder_id', 'p.builder_id'], ['project_id', 'p.project_id'], ['area_id', 'p.area_id'], ['property_type', 'p.property_type']]) {
      if (req.query[f]) {
        where += ` AND ${col} = ?`;
        params.push(req.query[f]);
      }
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (p.title LIKE ? OR p.property_code LIKE ? OR b.name LIKE ? OR a.name LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM properties p
        JOIN builders b ON b.id = p.builder_id JOIN areas a ON a.id = p.area_id ${where}`,
      params
    );
    const [rows] = await pool.query(`${PROP_ADMIN_SELECT} ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params, limit, offset,
    ]);
    sendPaginated(res, { items: await attachMedia(rows), total, page, limit });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${PROP_ADMIN_SELECT} WHERE p.id = ? OR p.property_code = ?`, [req.params.id, req.params.id]);
    if (!rows.length) throw ApiError.notFound('Property not found');
    const [withMedia] = await attachMedia(rows);
    const [enquiries] = await pool.query(
      `SELECT e.*, u.name AS assigned_name FROM property_enquiries e
        LEFT JOIN users u ON u.id = e.assigned_to WHERE e.property_id = ? ORDER BY e.created_at DESC`,
      [rows[0].id]
    );
    sendSuccess(res, { ...withMedia, enquiries });
  })
);

router.post(
  '/',
  requirePermission('properties.manage'),
  propertyUpload.array('media', 16),
  asyncHandler(async (req, res) => {
    const {
      builder_id, project_id, area_id, title, description, listing_type = 'sale', property_type = 'flat',
      area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms,
      address, status = 'available', is_featured = 0,
    } = req.body;
    if (!builder_id || !area_id || !title || !total_amount) {
      throw ApiError.badRequest('builder_id, area_id, title and total_amount are required');
    }
    const [[builder]] = await pool.query('SELECT id FROM builders WHERE id = ?', [builder_id]);
    if (!builder) throw ApiError.badRequest('Builder not found');
    const [[area]] = await pool.query('SELECT id FROM areas WHERE id = ?', [area_id]);
    if (!area) throw ApiError.badRequest('Area not found');

    const ticketNo = await generateTicketNo(pool, 'property');
    const [result] = await pool.query(
      `INSERT INTO properties (property_code, builder_id, project_id, area_id, title, description, listing_type, property_type,
        area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms, address, status, is_featured, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, builder_id, project_id || null, area_id, title, description || null, listing_type, property_type,
       area_sqft || null, facing || null, floor || null, total_floors || null, total_amount, rate_per_sqft || null,
       bedrooms || null, bathrooms || null, address || null, status, is_featured, req.user.id]
    );
    let sort = 0;
    for (const file of req.files || []) {
      await pool.query(
        `INSERT INTO property_media (property_id, media_type, file_path, sort_order) VALUES (?, ?, ?, ?)`,
        [result.insertId, classifyFileType(file.mimetype) === 'video' ? 'video' : 'image', `properties/${file.filename}`, sort++]
      );
    }
    await writeAudit({ actor: req.user, action: 'property.create', entity: 'properties', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId, property_code: ticketNo }, 'Property listed successfully', 201);
  })
);

router.put(
  '/:id',
  requirePermission('properties.manage'),
  propertyUpload.array('media', 16),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Property not found');
    const p = rows[0];
    const {
      builder_id, project_id, area_id, title, description, listing_type, property_type,
      area_sqft, facing, floor, total_floors, total_amount, rate_per_sqft, bedrooms, bathrooms,
      address, status, is_featured,
    } = req.body;
    await pool.query(
      `UPDATE properties SET builder_id = COALESCE(?, builder_id), project_id = COALESCE(?, project_id),
              area_id = COALESCE(?, area_id), title = COALESCE(?, title), description = COALESCE(?, description),
              listing_type = COALESCE(?, listing_type), property_type = COALESCE(?, property_type),
              area_sqft = COALESCE(?, area_sqft), facing = COALESCE(?, facing), floor = COALESCE(?, floor),
              total_floors = COALESCE(?, total_floors), total_amount = COALESCE(?, total_amount),
              rate_per_sqft = COALESCE(?, rate_per_sqft), bedrooms = COALESCE(?, bedrooms),
              bathrooms = COALESCE(?, bathrooms), address = COALESCE(?, address),
              status = COALESCE(?, status), is_featured = COALESCE(?, is_featured)
        WHERE id = ?`,
      [builder_id ?? null, project_id ?? null, area_id ?? null, title || null, description ?? null,
       listing_type || null, property_type || null, area_sqft ?? null, facing || null, floor ?? null,
       total_floors ?? null, total_amount ?? null, rate_per_sqft ?? null, bedrooms ?? null, bathrooms ?? null,
       address ?? null, status || null, is_featured ?? null, req.params.id]
    );
    let sort = (await pool.query('SELECT COUNT(*) AS c FROM property_media WHERE property_id = ?', [req.params.id]))[0][0].c;
    for (const file of req.files || []) {
      await pool.query(
        `INSERT INTO property_media (property_id, media_type, file_path, sort_order) VALUES (?, ?, ?, ?)`,
        [req.params.id, classifyFileType(file.mimetype) === 'video' ? 'video' : 'image', `properties/${file.filename}`, sort++]
      );
    }
    await writeAudit({ actor: req.user, action: 'property.update', entity: 'properties', entityId: req.params.id, req });
    sendSuccess(res, null, 'Property updated');
  })
);

router.delete(
  '/:id',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT id FROM properties WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Property not found');
    await pool.query('DELETE FROM properties WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'property.delete', entity: 'properties', entityId: req.params.id, req });
    sendSuccess(res, null, 'Property deleted');
  })
);

router.delete(
  '/media/:mediaId',
  requirePermission('properties.manage'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM property_media WHERE id = ?', [req.params.mediaId]);
    if (!rows.length) throw ApiError.notFound('Media not found');
    await pool.query('DELETE FROM property_media WHERE id = ?', [req.params.mediaId]);
    sendSuccess(res, null, 'Media removed');
  })
);

// ======================= ENQUIRIES =======================
router.get(
  '/enquiries/all',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.status) {
      where += ' AND e.status = ?';
      params.push(req.query.status);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (e.ticket_no LIKE ? OR e.name LIKE ? OR e.phone LIKE ? OR p.title LIKE ?)';
      params.push(s, s, s, s);
    }
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM property_enquiries e JOIN properties p ON p.id = e.property_id ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT e.*, p.title AS property_title, p.property_code, p.listing_type, p.total_amount,
              b.name AS builder_name, a.name AS area_name, a.city, u.name AS assigned_name
         FROM property_enquiries e
         JOIN properties p ON p.id = e.property_id
         JOIN builders b ON b.id = p.builder_id
         JOIN areas a ON a.id = p.area_id
         LEFT JOIN users u ON u.id = e.assigned_to
        ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, { items: rows, total, page, limit });
  })
);

router.patch(
  '/enquiries/:id/status',
  requirePermission('properties.enquiries'),
  asyncHandler(async (req, res) => {
    const { status, assigned_to } = req.body;
    if (!['new', 'contacted', 'follow_up', 'closed'].includes(status)) throw ApiError.badRequest('Invalid status');
    const [rows] = await pool.query('SELECT * FROM property_enquiries WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Enquiry not found');
    await pool.query('UPDATE property_enquiries SET status = ?, assigned_to = COALESCE(?, assigned_to) WHERE id = ?', [
      status, assigned_to || null, req.params.id,
    ]);
    await writeAudit({ actor: req.user, action: 'property_enquiry.status', entity: 'property_enquiries', entityId: req.params.id, details: { status }, req });
    sendSuccess(res, null, 'Enquiry updated');
  })
);

module.exports = router;
