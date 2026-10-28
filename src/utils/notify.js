const pool = require('../config/db');

/**
 * Create an in-app notification.
 * Falls back to generic title/body when no template matches the event.
 */
async function notify({ userId, type = 'general', event = null, title, body = null, data = null }) {
  if (!userId) return;
  let finalTitle = title;
  let finalBody = body;

  if (event) {
    const [tpl] = await pool.query(
      `SELECT title_template, body_template FROM notification_templates
        WHERE event_code = ? AND channel = 'in_app' AND is_active = 1 LIMIT 1`,
      [event]
    );
    if (tpl[0]) {
      finalTitle = render(tpl[0].title_template, data) || finalTitle;
      finalBody = tpl[0].body_template ? render(tpl[0].body_template, data) : finalBody;
    }
  }

  await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)`,
    [userId, type, finalTitle, finalBody, data ? JSON.stringify(data) : null]
  );
}

function render(template, data) {
  if (!template) return template;
  if (!data) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (m, key) =>
    data[key] != null ? String(data[key]) : m
  );
}

async function notifyMany(userIds, payload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const id of unique) {
    await notify({ ...payload, userId: id });
  }
}

/** Staff users with a given permission (or super admin) */
async function staffWithPermission(code) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE u.user_type IN ('staff','employee') AND u.status = 'active'
        AND (p.code = ? OR p.code = 'modules.all')`,
    [code]
  );
  return rows.map((r) => r.id);
}

module.exports = { notify, notifyMany, staffWithPermission };
