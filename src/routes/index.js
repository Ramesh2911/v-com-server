const router = require('express').Router();

router.use('/auth', require('../modules/auth/routes'));
router.use('/me', require('../modules/users/routes.me'));

// Shared / customer-facing
router.use('/services', require('../modules/services/routes.public'));
router.use('/categories', require('../modules/services/routes.categories'));
router.use('/events', require('../modules/events/routes.public'));
router.use('/offers', require('../modules/offers/routes.public').offers);
router.use('/coupons', require('../modules/offers/routes.public').coupons);
router.use('/banners', require('../modules/banners/routes.public'));
router.use('/properties', require('../modules/properties/routes.public'));
router.use('/sos', require('../modules/sos/routes.public'));
router.use('/legal-advisory', require('../modules/legal/routes.public'));

// Customer app
router.use('/customer', require('../modules/requests/routes.customer'));
router.use('/customer', require('../modules/quotations/routes.customer'));
router.use('/customer/hr', require('../modules/hr/routes.customer'));
router.use('/customer/notifications', require('../modules/notifications/routes.customer'));
router.use('/customer/support', require('../modules/support/routes.customer'));
router.use('/customer/addresses', require('../modules/addresses/routes.customer'));
router.use('/customer/reviews', require('../modules/reviews/routes.customer'));
router.use('/customer/job-applications', require('../modules/hr/routes.applications'));

// Vendor app
router.use('/vendor', require('../modules/vendors/routes.vendor'));
router.use('/vendor', require('../modules/vendors/routes.vendor.tech'));
router.use('/vendor', require('../modules/vendors/routes.bookings'));
router.use('/vendor', require('../modules/requests/routes.vendor'));
router.use('/vendor', require('../modules/quotations/routes.vendor'));
router.use('/vendor', require('../modules/jobs/routes.vendor'));
  router.use('/vendor/notifications', require('../modules/notifications/routes.vendor'));
  router.use('/vendor/support', require('../modules/support/routes.customer'));
  router.use('/vendor/support/messages', require('../modules/support/routes.customer'));

  // Field Technician app
  router.use('/technician', require('../modules/technicians/routes'));

// Web admin
router.use('/admin/dashboard', require('../modules/dashboard/routes'));
router.use('/admin/customers', require('../modules/users/routes.customers'));
router.use('/admin/vendors', require('../modules/vendors/routes.admin').router);
router.use('/admin/requests', require('../modules/requests/routes.admin'));
router.use('/admin/quotations', require('../modules/quotations/routes.admin'));
router.use('/admin/jobs', require('../modules/jobs/routes.admin'));
router.use('/admin/sos', require('../modules/sos/routes.admin'));
router.use('/admin/legal', require('../modules/legal/routes.admin'));
router.use('/admin/services', require('../modules/services/routes.admin'));
router.use('/admin/offers', require('../modules/offers/routes.admin').offers);
router.use('/admin/coupons', require('../modules/offers/routes.admin').coupons);
router.use('/admin/banners', require('../modules/banners/routes.admin').banners);
router.use('/admin/events', require('../modules/events/routes.admin').eventsAdmin);
router.use('/admin/payouts', require('../modules/payouts/routes.admin').payouts);
router.use('/admin/reviews', require('../modules/reviews/routes.admin'));
router.use('/admin/properties', require('../modules/properties/routes.admin'));
router.use('/admin/hr', require('../modules/hr/routes.admin'));
router.use('/admin/notifications', require('../modules/notifications/routes.admin'));
router.use('/admin/reports', require('../modules/reports/routes'));
router.use('/admin/roles', require('../modules/roles/routes'));
router.use('/admin/staff', require('../modules/users/routes.staff'));
router.use('/admin/support', require('../modules/support/routes.admin'));
router.use('/admin/audit', require('../modules/audit/routes'));
router.use('/admin/settings', require('../modules/settings/routes'));

module.exports = router;

