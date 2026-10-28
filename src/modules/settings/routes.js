const router = require('express').Router();
const pool = require('../../config/db');
const asyncHandler = require('../../utils/asyncHandler');
const { sendSuccess } = require('../../utils/response');
const { authMiddleware } = require('../../middlewares/auth');
const { requirePermission } = require('../../middlewares/rbac');
const { writeAudit } = require('../../utils/audit');

router.use(authMiddleware, requirePermission('settings.manage'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM settings ORDER BY setting_group, setting_key');
    sendSuccess(res, rows);
  })
);

router.put(
  '/',
  asyncHandler(async (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return sendSuccess(res, null, 'settings object required', 400);
    }
    const changed = [];
    for (const [key, value] of Object.entries(settings)) {
      const [result] = await pool.query(
        `UPDATE settings SET setting_value = ? WHERE setting_key = ?`,
        [String(value), key]
      );
      if (result.affectedRows) changed.push(key);
    }
    await writeAudit({ actor: req.user, action: 'settings.update', entity: 'settings', details: { changed }, req });
    sendSuccess(res, { changed }, 'Settings updated');
  })
);

module.exports = router;
