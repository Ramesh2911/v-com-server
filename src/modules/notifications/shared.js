const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { toPublicUrl } = require('../../middlewares/upload');

exports.listMine = asyncHandler(async (req, res) => {
  const unreadOnly = req.query.unread === '1';
  const [rows] = await pool.query(
    `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  const [[{ unread }]] = await pool.query(
    `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [req.user.id]
  );
  const [[profile]] = await pool.query('SELECT avatar FROM users WHERE id = ?', [req.user.id]);
  sendSuccess(res, {
    items: rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null })),
    unread,
    avatar: toPublicUrl(profile ? profile.avatar : null),
  });
});

exports.markRead = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids) && ids.length) {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND id IN (?)', [req.user.id, ids]);
  } else {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  }
  sendSuccess(res, null, 'Marked as read');
});

exports.remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
  sendSuccess(res, null, 'Notifications cleared');
});
