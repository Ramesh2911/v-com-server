const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess, sendPaginated } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { getPagination } = require('../../utils/pagination');

router.use(authMiddleware, requirePermission('audit.view'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = getPagination(req.query);
    let where = 'WHERE 1=1';
    const params = [];
    if (req.query.action) {
      where += ' AND a.action LIKE ?';
      params.push(`${req.query.action}%`);
    }
    if (req.query.entity) {
      where += ' AND a.entity = ?';
      params.push(req.query.entity);
    }
    if (req.query.actor_id) {
      where += ' AND a.actor_id = ?';
      params.push(req.query.actor_id);
    }
    if (req.query.search) {
      const s = `%${req.query.search}%`;
      where += ' AND (a.action LIKE ? OR a.actor_name LIKE ? OR a.entity LIKE ?)';
      params.push(s, s, s);
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params);
    const [rows] = await pool.query(
      `SELECT a.* FROM audit_logs a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    sendPaginated(res, {
      items: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })),
      total, page, limit,
    });
  })
);

module.exports = router;
