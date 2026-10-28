const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const ApiError = require('../../utils/ApiError');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { notify } = require('../../utils/notify');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('notifications.manage'));

router.get(
  '/templates',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM notification_templates ORDER BY event_code, channel');
    sendSuccess(res, rows);
  })
);

router.put(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const { title_template, body_template, is_active } = req.body;
    const [rows] = await pool.query('SELECT * FROM notification_templates WHERE id = ?', [req.params.id]);
    if (!rows.length) throw ApiError.notFound('Template not found');
    await pool.query(
      `UPDATE notification_templates SET title_template = COALESCE(?, title_template),
              body_template = COALESCE(?, body_template), is_active = COALESCE(?, is_active)
        WHERE id = ?`,
      [title_template || null, body_template ?? null, is_active ?? null, req.params.id]
    );
    await writeAudit({ actor: req.user, action: 'notification.template.update', entity: 'notification_templates', entityId: req.params.id, req });
    sendSuccess(res, null, 'Template updated');
  })
);

router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT n.*, u.name AS user_name, u.email AS user_email
         FROM notifications n JOIN users u ON u.id = n.user_id
        ORDER BY n.created_at DESC LIMIT 50`
    );
    sendSuccess(res, rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })));
  })
);

router.post(
  '/broadcast',
  asyncHandler(async (req, res) => {
    const { title, body, user_type } = req.body;
    if (!title) throw ApiError.badRequest('Title is required');
    let where = `status = 'active'`;
    const params = [];
    if (user_type) {
      where += ' AND user_type = ?';
      params.push(user_type);
    }
    const [users] = await pool.query(`SELECT id FROM users WHERE ${where}`, params);
    for (const u of users) {
      await notify({ userId: u.id, title, body: body || null, type: 'broadcast' });
    }
    await writeAudit({ actor: req.user, action: 'notification.broadcast', details: { count: users.length }, req });
    sendSuccess(res, { count: users.length }, `Broadcast sent to ${users.length} users`);
  })
);

module.exports = router;
