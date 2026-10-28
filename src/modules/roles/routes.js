const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('roles.manage'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [roles] = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count,
              (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
         FROM roles r ORDER BY r.is_system DESC, r.name`
    );
    const [perms] = await pool.query('SELECT * FROM permissions ORDER BY module, code');
    const [assignments] = await pool.query('SELECT role_id, permission_id FROM role_permissions');
    const grouped = {};
    for (const p of perms) {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push(p);
    }
    sendSuccess(res, {
      roles: roles.map((r) => ({
        ...r,
        permission_ids: assignments.filter((a) => a.role_id === r.id).map((a) => a.permission_id),
      })),
      permissions: perms,
      permission_groups: grouped,
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, slug, description, permission_ids } = req.body;
    if (!name || !slug) throw ApiError.badRequest('name and slug are required');
    const [dup] = await pool.query('SELECT id FROM roles WHERE slug = ?', [slug]);
    if (dup.length) throw ApiError.conflict('Role slug already exists');
    const [result] = await pool.query(
      `INSERT INTO roles (name, slug, description) VALUES (?, ?, ?)`,
      [name, slug, description || null]
    );
    await savePermissions(result.insertId, permission_ids);
    await writeAudit({ actor: req.user, action: 'role.create', entity: 'roles', entityId: result.insertId, req });
    sendSuccess(res, { id: result.insertId }, 'Role created', 201);
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Role not found');
    if (rows[0].is_system) throw ApiError.badRequest('System roles cannot be edited — clone instead');
    const { name, description, permission_ids } = req.body;
    await pool.query('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?', [
      name || null, description ?? null, req.params.id,
    ]);
    if (permission_ids !== undefined) await savePermissions(req.params.id, permission_ids);
    await writeAudit({ actor: req.user, action: 'role.update', entity: 'roles', entityId: req.params.id, req });
    sendSuccess(res, null, 'Role updated');
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Role not found');
    if (rows[0].is_system) throw ApiError.badRequest('System roles cannot be deleted');
    const [[{ cnt }]] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE role_id = ?', [req.params.id]);
    if (cnt) throw ApiError.badRequest('Role is assigned to users — reassign them first');
    await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    await writeAudit({ actor: req.user, action: 'role.delete', entity: 'roles', entityId: req.params.id, req });
    sendSuccess(res, null, 'Role deleted');
  })
);

async function savePermissions(roleId, permissionIds) {
  let ids = permissionIds;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch (_) { ids = ids.split(','); }
  }
  if (!Array.isArray(ids)) return;
  await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  for (const pid of ids) {
    await pool.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, Number(pid)]);
  }
}

module.exports = router;
