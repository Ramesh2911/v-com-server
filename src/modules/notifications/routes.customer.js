const router = require('express').Router();
const { authMiddleware } = require('../../middlewares/auth');
const shared = require('./shared');

router.use(authMiddleware);
router.get('/', shared.listMine);
router.post('/read', shared.markRead);
router.delete('/', shared.remove);

module.exports = router;
