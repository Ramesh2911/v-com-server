const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { getPagination } = require('../../utils/pagination');
const { toPublicUrl } = require('../../middlewares/upload');
const { generateTicketNo } = require('../../utils/ticketNo');
const { notify, staffWithPermission } = require('../../utils/notify');

const PROP_SELECT = `
  SELECT p.*,
         b.name AS builder_name, b.slug AS builder_slug,
         pr.name AS project_name, pr.slug AS project_slug,
         a.name AS area_name, a.locality, a.city
    FROM properties p
    JOIN builders b ON b.id = p.builder_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    JOIN areas a ON a.id = p.area_id`;

function mapProperty(p, media = []) {
  return {
    ...p,
    photos: media.filter((m) => m.media_type === 'image').map((m) => toPublicUrl(m.file_path)),
    videos: media.filter((m) => m.media_type === 'video').map((m) => toPublicUrl(m.file_path)),
    media: media.map((m) => ({ id: m.id, type: m.media_type, url: toPublicUrl(m.file_path), sort_order: m.sort_order })),
  };
}

async function attachMedia(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [media] = await pool.query('SELECT * FROM property_media WHERE property_id IN (?) ORDER BY sort_order, id', [ids]);
  return rows.map((r) => mapProperty(r, media.filter((m) => m.property_id === r.id)));
}

// ---- search / browse (matches image: builder / project / area / sale-rent) ----
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = `WHERE p.status = 'available'`;
    const params = [];
    if (req.query.builder_id) {
      where += ' AND p.builder_id = ?';
      params.push(req.query.builder_id);
    }
    if (req.query.builder_name) {
      where += ' AND b.name LIKE ?';
      params.push(`%${req.query.builder_name}%`);
    }
    if (req.query.project_id) {
      where += ' AND p.project_id = ?';
      params.push(req.query.project_id);
    }
    if (req.query.project_name) {
      where += ' AND pr.name LIKE ?';
      params.push(`%${req.query.project_name}%`);
    }
    if (req.query.area_id) {
      where += ' AND p.area_id = ?';
      params.push(req.query.area_id);
    }
    if (req.query.city) {
      where += ' AND a.city LIKE ?';
      params.push(`%${req.query.city}%`);
    }
    if (req.query.listing_type && ['sale', 'rent'].includes(req.query.listing_type)) {
      where += ' AND p.listing_type = ?';
      params.push(req.query.listing_type);
    }
    if (req.query.property_type) {
      where += ' AND p.property_type = ?';
      params.push(req.query.property_type);
    }
    if (req.query.min_amount) {
      where += ' AND p.total_amount >= ?';
      params.push(req.query.min_amount);
    }
    if (req.query.max_amount) {
      where += ' AND p.total_amount <= ?';
      params.push(req.query.max_amount);
    }
    if (req.query.featured === '1') where += ' AND p.is_featured = 1';
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.address LIKE ? OR b.name LIKE ? OR pr.name LIKE ? OR a.name LIKE ?)';
      params.push(s, s, s, s, s, s);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM properties p
        JOIN builders b ON b.id = p.builder_id
        LEFT JOIN projects pr ON pr.id = p.project_id
        JOIN areas a ON a.id = p.area_id ${where}`,
      params
    );
    const [rows] = await pool.query(`${PROP_SELECT} ${where} ORDER BY p.is_featured DESC, p.updated_at DESC LIMIT ? OFFSET ?`, [
      ...params, limit, offset,
    ]);
    sendPaginated(res, { items: await attachMedia(rows), total, page, limit });
  })
);

// ---- filter options for app dropdowns ----
router.get(
  '/filters',
  asyncHandler(async (req, res) => {
    const [builders] = await pool.query(
      `SELECT b.id, b.name, b.slug, COUNT(p.id) AS property_count
         FROM builders b LEFT JOIN properties p ON p.builder_id = b.id AND p.status = 'available'
        WHERE b.status = 1 GROUP BY b.id ORDER BY b.name`
    );
    const [projects] = await pool.query(
      `SELECT pr.id, pr.name, pr.slug, pr.builder_id, COUNT(p.id) AS property_count
         FROM projects pr LEFT JOIN properties p ON p.project_id = pr.id AND p.status = 'available'
        WHERE pr.status = 1 GROUP BY pr.id ORDER BY pr.name`
    );
    const [areas] = await pool.query(
      `SELECT a.id, a.name, a.locality, a.city, COUNT(p.id) AS property_count
         FROM areas a LEFT JOIN properties p ON p.area_id = a.id AND p.status = 'available'
        WHERE a.status = 1 GROUP BY a.id ORDER BY a.city, a.name`
    );
    sendSuccess(res, { builders, projects, areas });
  })
);

// ---- detail (increments view count) ----
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${PROP_SELECT} WHERE p.id = ? OR p.property_code = ?`, [req.params.id, req.params.id]);
    if (!rows.length) throw ApiError.notFound('Property not found');
    await pool.query('UPDATE properties SET view_count = view_count + 1 WHERE id = ?', [rows[0].id]);
    const [media] = await pool.query('SELECT * FROM property_media WHERE property_id = ? ORDER BY sort_order, id', [rows[0].id]);
    const [enquiries] = await pool.query(
      `SELECT id, ticket_no, status, created_at FROM property_enquiries WHERE property_id = ? ORDER BY created_at DESC LIMIT 10`,
      [rows[0].id]
    );
    sendSuccess(res, { ...mapProperty(rows[0], media), recent_enquiries: [] });
  })
);

// ---- submit enquiry → generates V-COM ticket ----
router.post(
  '/:id/enquiry',
  asyncHandler(async (req, res) => {
    const { name, email, phone, message } = req.body;
    if (!name || !phone) throw ApiError.badRequest('Name and phone are required');
    const [props] = await pool.query(`SELECT * FROM properties WHERE id = ? OR property_code = ?`, [req.params.id, req.params.id]);
    if (!props.length) throw ApiError.notFound('Property not found');
    const property = props[0];

    const ticketNo = await generateTicketNo(pool, 'propertyEnquiry');
    const [result] = await pool.query(
      `INSERT INTO property_enquiries (ticket_no, property_id, name, email, phone, message, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketNo, property.id, name, email || null, phone, message || null, req.user ? 'app' : 'web']
    );
    const staff = await staffWithPermission('properties.enquiries');
    for (const sid of staff) {
      await notify({
        userId: sid,
        event: 'property_enquiry',
        type: 'property',
        title: `Property enquiry ${ticketNo}`,
        body: `New enquiry for: ${property.title}`,
        data: { ticket_no: ticketNo, property_title: property.title, property_id: property.id },
      });
    }
    sendSuccess(res, { id: result.insertId, ticket_no: ticketNo }, 'Enquiry submitted successfully — you will be contacted soon', 201);
  })
);

module.exports = router;
