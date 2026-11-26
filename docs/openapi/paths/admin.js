const { ok, okPaginated, created, noContent, csv, body, security, multipart } = require('../components');

const admin = (s) => ({ ...s, tags: ['Admin'], security: security() });

const paths = {
  // ================= DASHBOARD =================
  '/admin/dashboard': {
    get: admin({
      summary: 'Admin dashboard stats',
      parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 7 }, description: 'Days for module_daily trend' }],
      responses: { 200: ok('#/components/schemas/DashboardStats') },
    }),
  },

  // ================= CUSTOMERS =================
  '/admin/customers': {
    get: admin({
      summary: 'List customers',
      parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' }],
      responses: { 200: okPaginated('#/components/schemas/User') },
    }),
  },
  '/admin/customers/{id}': {
    get: admin({ summary: 'Customer detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/User'), 404: { $ref: '#/components/responses/NotFound' } } }),
  },
  '/admin/customers/{id}/status': {
    patch: admin({
      summary: 'Change customer status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["active", "inactive", "blocked", "pending"] } } }),
      responses: { 200: ok('#/components/schemas/User') },
    }),
  },

  // ================= VENDORS =================
  '/admin/vendors': {
    get: admin({
      summary: 'List vendors',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'search', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Vendor') },
    }),
    post: admin({
      summary: 'Create vendor',
      requestBody: body({ type: 'object', required: ['business_name', 'phone'], properties: { business_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, city: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Vendor') },
    }),
  },
  '/admin/vendors/stats': {
    get: admin({ summary: 'Vendor counts by status', responses: { 200: ok(null, { total: 40, pending: 5, approved: 30 }) } }),
  },
  '/admin/vendors/{id}': {
    get: admin({ summary: 'Vendor detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Vendor') } }),
    put: admin({
      summary: 'Update vendor',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { business_name: { type: 'string' }, city: { type: 'string' }, status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Vendor') },
    }),
  },
  '/admin/vendors/{id}/approve': {
    post: admin({ summary: 'Approve vendor', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Vendor') } }),
  },
  '/admin/vendors/{id}/reject': {
    post: admin({
      summary: 'Reject vendor',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { reason: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Vendor') },
    }),
  },
  '/admin/vendors/{id}/status': {
    patch: admin({
      summary: 'Change vendor status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Vendor') },
    }),
  },
  '/admin/vendors/{id}/assignments': {
    get: admin({ summary: 'Vendor job assignments', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: okPaginated('#/components/schemas/Job') } }),
  },
  '/admin/vendors/{id}/technicians': {
    get: admin({ summary: "Vendor's technicians", parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok(null, []) } }),
  },

  // ================= REQUESTS =================
  '/admin/requests': {
    get: admin({
      summary: 'List all service requests',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'module', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } },
        { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } },
        { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' },
      ],
      responses: { 200: okPaginated('#/components/schemas/ServiceRequest') },
    }),
    post: admin({
      summary: 'Create request on behalf of customer',
      requestBody: multipart({ type: 'object', required: ['customer_id', 'category_id', 'address_id'], properties: { customer_id: { type: 'integer' }, category_id: { type: 'integer' }, address_id: { type: 'integer' }, notes: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/ServiceRequest') },
    }),
  },
  '/admin/requests/stats': {
    get: admin({ summary: 'Request counts by status', responses: { 200: ok(null, { pending_review: 4, assigned: 6, in_progress: 3, completed: 120 }) } }),
  },
  '/admin/requests/{id}': {
    get: admin({ summary: 'Request detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/ServiceRequest') } }),
    delete: admin({ summary: 'Delete request', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/requests/{id}/assign': {
    post: admin({
      summary: 'Assign request to vendor',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['vendor_id'], properties: { vendor_id: { type: 'integer' }, technician_id: { type: 'integer' } } }),
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    }),
  },
  '/admin/requests/{id}/status': {
    patch: admin({
      summary: 'Update request status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["pending_review", "assigned", "in_progress", "completed", "cancelled", "rejected"] }, notes: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    }),
  },
  '/admin/requests/{id}/close': {
    post: admin({ summary: 'Close request', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/ServiceRequest') } }),
  },
  '/admin/requests/{id}/escalate': {
    post: admin({
      summary: 'Escalate request',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { reason: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    }),
  },

  // ================= QUOTATIONS =================
  '/admin/quotations': {
    get: admin({
      summary: 'List quotations',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Quotation') },
    }),
    post: admin({
      summary: 'Create quotation (admin behalf)',
      requestBody: body({ type: 'object', required: ['request_id', 'vendor_id', 'amount'], properties: { request_id: { type: 'integer' }, vendor_id: { type: 'integer' }, amount: { type: 'number' }, notes: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Quotation') },
    }),
  },
  '/admin/quotations/{id}': {
    get: admin({ summary: 'Quotation detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Quotation') } }),
  },
  '/admin/quotations/{id}/review': {
    post: admin({
      summary: 'Review (approve/reject) quotation',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ["approved", "rejected", "needs_clarification"] }, notes: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Quotation') },
    }),
  },

  // ================= JOBS =================
  '/admin/jobs': {
    get: admin({
      summary: 'List jobs',
      parameters: [{ name: 'stage', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Job') },
    }),
    post: admin({
      summary: 'Create job',
      requestBody: body({ type: 'object', required: ['request_id', 'vendor_id'], properties: { request_id: { type: 'integer' }, vendor_id: { type: 'integer' }, technician_id: { type: 'integer' } } }),
      responses: { 201: created('#/components/schemas/Job') },
    }),
  },
  '/admin/jobs/stats': {
    get: admin({ summary: 'Job counts by stage', responses: { 200: ok(null, { assigned: 5, in_progress: 3, completed: 90 }) } }),
  },
  '/admin/jobs/{id}': {
    get: admin({ summary: 'Job detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Job') } }),
  },
  '/admin/jobs/{id}/stage': {
    patch: admin({
      summary: 'Update job stage',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['stage'], properties: { stage: { type: 'string', enum: ["assigned", "in_progress", "completed", "cancelled"] } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    }),
  },

  // ================= SOS =================
  '/admin/sos': {
    get: admin({
      summary: 'List SOS alerts',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ["open", "acknowledged", "dispatched", "in_progress", "resolved", "closed", "cancelled"] } },
        { name: 'category_id', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { $ref: '#/components/parameters/page' },
      ],
      responses: { 200: okPaginated('#/components/schemas/SOS') },
    }),
  },
  '/admin/sos/stats': {
    get: admin({ summary: 'SOS counts', responses: { 200: ok(null, { by_status: [{ status: 'open', count: 2 }, { status: 'resolved', count: 30 }], active: 5 }) } }),
  },
  '/admin/sos/{id}': {
    get: admin({ summary: 'SOS detail (id or ticket_no)', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/SOS') } }),
  },
  '/admin/sos/{id}/status': {
    post: admin({
      summary: 'Update SOS status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ["open", "acknowledged", "dispatched", "in_progress", "resolved", "closed", "cancelled"] },
          note: { type: 'string', nullable: true },
          assign_to: { type: 'integer', nullable: true },
          resolution_notes: { type: 'string', nullable: true },
        },
      }),
      responses: { 200: ok(null, null) },
    }),
  },

  // ---- SOS responders (admin CRUD) ----
  '/admin/sos/responders': {
    get: admin({
      summary: 'List SOS responders',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ["active", "inactive"] } },
        { name: 'category_id', in: 'query', schema: { type: 'integer' } },
        { $ref: '#/components/parameters/page' },
      ],
      responses: { 200: okPaginated('#/components/schemas/SOSResponder') },
    }),
    post: admin({
      summary: 'Create responder',
      requestBody: body({
        type: 'object',
        required: ['unit_name', 'contact_no'],
        properties: {
          unit_name: { type: 'string' },
          contact_no: { type: 'string' },
          category_id: { type: 'integer', nullable: true, description: 'null = general' },
          vehicle_no: { type: 'string', nullable: true },
          driver_name: { type: 'string', nullable: true },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
          status: { type: 'string', enum: ["active", "inactive"] },
        },
      }),
      responses: { 201: created('#/components/schemas/SOSResponder') },
    }),
  },
  '/admin/sos/responders/{id}': {
    put: admin({
      summary: 'Update responder',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { unit_name: { type: 'string' }, contact_no: { type: 'string' }, category_id: { type: 'integer', nullable: true }, status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/SOSResponder') },
    }),
    delete: admin({
      summary: 'Delete responder',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null, null) },
    }),
  },
  '/admin/sos/responders/{id}/status': {
    patch: admin({
      summary: 'Activate / deactivate responder',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["active", "inactive"] } } }),
      responses: { 200: ok(null, null) },
    }),
  },

  // ================= SERVICES (modules + categories) =================
  '/admin/services/modules': {
    get: admin({
      summary: 'List service modules (with counts)',
      description: 'category_count / request_count — active-only.',
      responses: { 200: ok(null, [{ id: 1, code: 'special-service', name: 'Professional Service', category_count: 18, request_count: 40 }]) },
    }),
    post: admin({
      summary: 'Create service module',
      requestBody: body({ type: 'object', required: ['code', 'name'], properties: { code: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, sort_order: { type: 'integer' } } }),
      responses: { 201: created(null), 409: { $ref: '#/components/responses/Conflict' } },
    }),
  },
  '/admin/services/modules/{id}': {
    put: admin({
      summary: 'Update service module',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, status: { type: 'integer' }, sort_order: { type: 'integer' } } }),
      responses: { 200: ok(null, { updated: true }) },
    }),
    delete: admin({ summary: 'Delete service module', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/services/categories': {
    get: admin({
      summary: 'List categories (admin — includes hidden)',
      parameters: [{ name: 'module_id', in: 'query', schema: { type: 'integer' } }, { name: 'status', in: 'query', schema: { type: 'integer', enum: ["0", "1"] } }, { name: 'search', in: 'query', schema: { type: 'string' } }],
      responses: { 200: ok(null, [{ id: 1, name: 'CCTV and Automation', status: 1, module_code: 'special-service' }]) },
    }),
    post: admin({
      summary: 'Create category',
      requestBody: multipart({ type: 'object', required: ['module_id', 'name'], properties: { module_id: { type: 'integer' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'string' }, status: { type: 'integer' }, image: { type: 'string', format: 'binary' } } }),
      responses: { 201: created('#/components/schemas/ServiceCategory') },
    }),
  },
  '/admin/services/categories/{id}': {
    put: admin({
      summary: 'Update category (rename/hide/price…)',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: multipart({ type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, price: { type: 'string' }, status: { type: 'integer', enum: ["0", "1"] }, image: { type: 'string', format: 'binary' } } }),
      responses: { 200: ok('#/components/schemas/ServiceCategory') },
    }),
    delete: admin({ summary: 'Delete category', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },

  // ================= OFFERS / COUPONS =================
  '/admin/offers': {
    get: admin({
      summary: 'List offers',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'integer' } }, { name: 'category_id', in: 'query', schema: { type: 'integer' } }, { name: 'module_id', in: 'query', schema: { type: 'integer' } }],
      responses: { 200: ok(null, [{ $ref: '#/components/schemas/Offer' }]) },
    }),
    post: admin({
      summary: 'Create offer',
      requestBody: multipart({ type: 'object', required: ['category_id', 'title', 'discount_value'], properties: { category_id: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, discount_type: { type: 'string', enum: ["percent", "flat"] }, discount_value: { type: 'number' }, starts_at: { type: 'string' }, ends_at: { type: 'string' }, status: { type: 'integer' }, image: { type: 'string', format: 'binary' } } }),
      responses: { 201: ok(null, { id: 1 }, 'Offer created') },
    }),
  },
  '/admin/offers/{id}': {
    put: admin({
      summary: 'Update offer',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: multipart({ type: 'object', properties: { title: { type: 'string' }, discount_type: { type: 'string' }, discount_value: { type: 'number' }, status: { type: 'integer' }, image: { type: 'string', format: 'binary' } } }),
      responses: { 200: noContent('Offer updated') },
    }),
    delete: admin({ summary: 'Delete offer', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Offer deleted') } }),
  },
  '/admin/coupons': {
    get: admin({
      summary: 'List coupons',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'integer' } }, { name: 'search', in: 'query', schema: { type: 'string' } }],
      responses: { 200: ok(null, [{ $ref: '#/components/schemas/Coupon' }]) },
    }),
    post: admin({
      summary: 'Create coupon',
      requestBody: body({ type: 'object', required: ['code', 'discount_value'], properties: { code: { type: 'string' }, title: { type: 'string' }, discount_type: { type: 'string', enum: ["percent", "flat"] }, discount_value: { type: 'number' }, max_discount: { type: 'number' }, min_amount: { type: 'number' }, usage_limit: { type: 'integer' }, per_user_limit: { type: 'integer' }, applies_to: { type: 'string', enum: ["all", "category"] }, category_id: { type: 'integer' }, starts_at: { type: 'string' }, ends_at: { type: 'string' }, status: { type: 'integer' } } }),
      responses: { 201: ok(null, { id: 1, code: 'SAVE10' }, 'Coupon created'), 409: { $ref: '#/components/responses/Conflict' } },
    }),
  },
  '/admin/coupons/{id}': {
    put: admin({
      summary: 'Update coupon',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { code: { type: 'string' }, discount_value: { type: 'number' }, status: { type: 'integer' }, usage_limit: { type: 'integer' } } }),
      responses: { 200: noContent('Coupon updated') },
    }),
    delete: admin({ summary: 'Delete coupon', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Coupon deleted') } }),
  },

  // ================= BANNERS =================
  '/admin/banners': {
    get: admin({ summary: 'List banners (slot order)', responses: { 200: ok(null, [{ $ref: '#/components/schemas/Banner' }]) } }),
    post: admin({
      summary: 'Create banner',
      requestBody: multipart({ type: 'object', required: ['title', 'image'], properties: { title: { type: 'string' }, subtitle: { type: 'string' }, image: { type: 'string', format: 'binary' }, slot: { type: 'integer' }, starts_at: { type: 'string' }, ends_at: { type: 'string' }, status: { type: 'integer' } } }),
      responses: { 201: created('#/components/schemas/Banner') },
    }),
  },
  '/admin/banners/{id}': {
    put: admin({
      summary: 'Update banner',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: multipart({ type: 'object', properties: { title: { type: 'string' }, image: { type: 'string', format: 'binary' }, slot: { type: 'integer' }, status: { type: 'integer' } } }),
      responses: { 200: ok('#/components/schemas/Banner') },
    }),
    delete: admin({ summary: 'Delete banner', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Banner deleted') } }),
  },

  // ================= EVENTS =================
  '/admin/events': {
    get: admin({
      summary: 'List events (any status)',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Event') },
    }),
    post: admin({
      summary: 'Create event',
      requestBody: multipart({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, description: { type: 'string' }, image: { type: 'string', format: 'binary' }, location: { type: 'string' }, city: { type: 'string' }, starts_at: { type: 'string' }, ends_at: { type: 'string' }, status: { type: 'string', enum: ["draft", "published", "cancelled"] }, is_featured: { type: 'boolean' } } }),
      responses: { 201: created('#/components/schemas/Event') },
    }),
  },
  '/admin/events/{id}': {
    put: admin({
      summary: 'Update event',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: multipart({ type: 'object', properties: { title: { type: 'string' }, status: { type: 'string' }, image: { type: 'string', format: 'binary' } } }),
      responses: { 200: ok('#/components/schemas/Event') },
    }),
    delete: admin({ summary: 'Delete event', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Event deleted') } }),
  },

  // ================= PAYOUTS =================
  '/admin/payouts': {
    get: admin({
      summary: 'List payouts (alt pagination)',
      description: 'Uses current_page/total_pages/total_items/per_page shape.',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ["pending", "processed"] } }, { name: 'vendor_id', in: 'query', schema: { type: 'integer' } }, { $ref: '#/components/parameters/page' }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
      responses: {
        200: {
          description: 'Payouts',
          content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Payout' } }, pagination: { $ref: '#/components/schemas/PaginationAlt' } } } } }] } } },
        },
      },
    }),
    post: admin({
      summary: 'Create manual payout',
      requestBody: body({ type: 'object', required: ['vendor_id', 'amount'], properties: { vendor_id: { type: 'integer' }, amount: { type: 'number' }, job_id: { type: 'integer' }, note: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Payout') },
    }),
  },
  '/admin/payouts/export': {
    get: admin({
      summary: 'Export payouts CSV (no envelope)',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
      responses: { 200: csv('Payouts CSV attachment') },
    }),
  },
  '/admin/payouts/summary': {
    get: admin({
      summary: 'Payout totals',
      responses: { 200: ok(null, { pending_amount: 5000, processed_amount: 20000, total_amount: 25000, pending_count: 3, processed_count: 12 }) },
    }),
  },
  '/admin/payouts/{id}/status': {
    patch: admin({
      summary: 'Mark payout processed (one-way)',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'processed' } } }),
      responses: { 200: ok('#/components/schemas/Payout') },
    }),
  },

  // ================= REVIEWS =================
  '/admin/reviews': {
    get: admin({
      summary: 'List service reviews',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ["visible", "hidden"] } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Review') },
    }),
  },
  '/admin/reviews/{id}': {
    patch: admin({
      summary: 'Hide/show review',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["visible", "hidden"] } } }),
      responses: { 200: ok('#/components/schemas/Review') },
    }),
    delete: admin({ summary: 'Delete review', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },

  // ================= PROPERTIES =================
  '/admin/properties/stats': {
    get: admin({ summary: 'Property counts', responses: { 200: ok(null, { total: 60, sale: 30, rent: 30 }) } }),
  },
  '/admin/properties': {
    get: admin({
      summary: 'List properties (admin)',
      parameters: [{ name: 'listing_type', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Property') },
    }),
    post: admin({
      summary: 'Create property',
      requestBody: body({ type: 'object', required: ['title', 'listing_type'], properties: { title: { type: 'string' }, listing_type: { type: 'string', enum: ["sale", "rent"] }, property_type: { type: 'string' }, city: { type: 'string' }, price: { type: 'number' } } }),
      responses: { 201: created('#/components/schemas/Property') },
    }),
  },
  '/admin/properties/{id}': {
    get: admin({ summary: 'Property detail', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Property') } }),
    put: admin({
      summary: 'Update property',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { title: { type: 'string' }, price: { type: 'number' }, status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Property') },
    }),
    delete: admin({ summary: 'Delete property', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/properties/media/{mediaId}': {
    delete: admin({ summary: 'Delete property media', parameters: [{ name: 'mediaId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/properties/builders': {
    get: admin({ summary: 'List builders', responses: { 200: ok(null, []) } }),
    post: admin({ summary: 'Create builder', requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }), responses: { 201: created(null) } }),
  },
  '/admin/properties/builders/{id}': {
    put: admin({ summary: 'Update builder', parameters: [{ $ref: '#/components/parameters/idPath' }], requestBody: body({ type: 'object', properties: { name: { type: 'string' } } }), responses: { 200: ok(null) } }),
    delete: admin({ summary: 'Delete builder', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/properties/projects': {
    get: admin({ summary: 'List projects', responses: { 200: ok(null, []) } }),
    post: admin({ summary: 'Create project', requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, builder_id: { type: 'integer' } } }), responses: { 201: created(null) } }),
  },
  '/admin/properties/projects/{id}': {
    put: admin({ summary: 'Update project', parameters: [{ $ref: '#/components/parameters/idPath' }], requestBody: body({ type: 'object', properties: { name: { type: 'string' } } }), responses: { 200: ok(null) } }),
    delete: admin({ summary: 'Delete project', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/properties/areas': {
    get: admin({ summary: 'List areas', responses: { 200: ok(null, []) } }),
    post: admin({ summary: 'Create area', requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, city: { type: 'string' } } }), responses: { 201: created(null) } }),
  },
  '/admin/properties/areas/{id}': {
    put: admin({ summary: 'Update area', parameters: [{ $ref: '#/components/parameters/idPath' }], requestBody: body({ type: 'object', properties: { name: { type: 'string' } } }), responses: { 200: ok(null) } }),
    delete: admin({ summary: 'Delete area', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },
  '/admin/properties/enquiries/all': {
    get: admin({ summary: 'All property enquiries', parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated(null) } }),
  },
  '/admin/properties/enquiries/{id}/status': {
    patch: admin({
      summary: 'Update enquiry status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string' } } }),
      responses: { 200: ok(null) },
    }),
  },

  // ================= HR =================
  '/admin/hr/employees': {
    get: admin({ summary: 'List employees', parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated(null) } }),
    post: admin({
      summary: 'Create employee',
      requestBody: body({ type: 'object', required: ['name', 'phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, designation: { type: 'string' }, salary: { type: 'number' } } }),
      responses: { 201: created(null) },
    }),
  },
  '/admin/hr/employees/{id}': {
    put: admin({
      summary: 'Update employee',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, designation: { type: 'string' }, status: { type: 'string' } } }),
      responses: { 200: ok(null) },
    }),
  },
  '/admin/hr/attendance': {
    get: admin({ summary: 'Attendance list', parameters: [{ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }, { $ref: '#/components/parameters/page' }], responses: { 200: okPaginated('#/components/schemas/Attendance') } }),
    post: admin({
      summary: 'Mark attendance',
      requestBody: body({ type: 'object', required: ['employee_id', 'status'], properties: { employee_id: { type: 'integer' }, date: { type: 'string' }, status: { type: 'string' }, check_in: { type: 'string' }, check_out: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Attendance') },
    }),
  },
  '/admin/hr/attendance/summary': {
    get: admin({ summary: 'Attendance summary', responses: { 200: ok(null, { present: 90, absent: 10 }) } }),
  },
  '/admin/hr/leaves': {
    get: admin({ summary: 'List leaves', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }], responses: { 200: okPaginated('#/components/schemas/Leave') } }),
  },
  '/admin/hr/leaves/{id}/review': {
    post: admin({
      summary: 'Approve/reject leave',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["approved", "rejected"] }, remarks: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Leave') },
    }),
  },

  // ---- Job applications (mounted at /customer/job-applications, admin reads via HR) ----
  '/customer/job-applications': {
    get: admin({
      summary: 'List job applications (admin)',
      tags: ['Admin', 'HR'],
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated(null) },
    }),
  },
  '/customer/job-applications/{id}': {
    get: admin({
      summary: 'Job application detail (admin)',
      tags: ['Admin', 'HR'],
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null) },
    }),
  },

  // ================= NOTIFICATIONS =================
  '/admin/notifications/templates': {
    get: admin({ summary: 'Notification templates', responses: { 200: ok(null, []) } }),
  },
  '/admin/notifications/templates/{id}': {
    put: admin({
      summary: 'Update template',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { body: { type: 'string' }, title: { type: 'string' } } }),
      responses: { 200: ok(null) },
    }),
  },
  '/admin/notifications/recent': {
    get: admin({ summary: 'Recent notifications', responses: { 200: ok(null, []) } }),
  },
  '/admin/notifications/broadcast': {
    post: admin({
      summary: 'Broadcast notification',
      requestBody: body({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, body: { type: 'string' }, audience: { type: 'string', enum: ["all", "customers", "vendors", "technicians"] } } }),
      responses: { 200: ok(null, { sent: 120 }) },
    }),
  },

  // ================= REPORTS =================
  '/admin/reports/overview': {
    get: admin({ summary: 'Reports overview (all modules)', responses: { 200: ok(null, { requests: {}, revenue: {}, vendors: {} }) } }),
  },
  '/admin/reports/{type}': {
    get: admin({
      summary: 'Report by type (CSV or JSON)',
      description: "type: requests | vendors | revenue | jobs… — returns CSV when ?format=csv",
      parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string' } }, { name: 'format', in: 'query', schema: { type: 'string', enum: ["json", "csv"] } }, { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'date_to', in: 'query', schema: { type: 'string', format: 'date' } }],
      responses: { 200: { description: 'Report data (JSON or CSV)', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } }, 'text/csv': { schema: { type: 'string' } } } } },
    }),
  },

  // ================= ROLES =================
  '/admin/roles': {
    get: admin({ summary: 'List roles with permissions', responses: { 200: ok(null, [{ $ref: '#/components/schemas/Role' }]) } }),
    post: admin({
      summary: 'Create role',
      requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, description: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } } }),
      responses: { 201: created('#/components/schemas/Role'), 409: { $ref: '#/components/responses/Conflict' } },
    }),
  },
  '/admin/roles/{id}': {
    put: admin({
      summary: 'Update role',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } } }),
      responses: { 200: ok('#/components/schemas/Role') },
    }),
    delete: admin({ summary: 'Delete role', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },

  // ================= STAFF =================
  '/admin/staff': {
    get: admin({ summary: 'List staff users', parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated('#/components/schemas/User') } }),
    post: admin({
      summary: 'Create staff user',
      requestBody: body({ type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' }, role_id: { type: 'integer' }, phone: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/User'), 409: { $ref: '#/components/responses/Conflict' } },
    }),
  },
  '/admin/staff/{id}': {
    put: admin({
      summary: 'Update staff user',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, role_id: { type: 'integer' }, status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/User') },
    }),
    delete: admin({ summary: 'Delete staff user', parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: noContent('Deleted') } }),
  },

  // ================= SUPPORT =================
  '/admin/support': {
    get: admin({
      summary: 'List support tickets',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated(null) },
    }),
  },
  '/admin/support/{id}/reply': {
    post: admin({
      summary: 'Reply to support ticket',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['message'], properties: { message: { type: 'string' } } }),
      responses: { 200: ok(null) },
    }),
  },
  '/admin/support/{id}/status': {
    patch: admin({
      summary: 'Update ticket status',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ["open", "in_progress", "resolved", "closed"] } } }),
      responses: { 200: ok(null) },
    }),
  },

  // ================= AUDIT =================
  '/admin/audit': {
    get: admin({
      summary: 'Audit log',
      parameters: [{ name: 'action', in: 'query', schema: { type: 'string' } }, { name: 'actor_id', in: 'query', schema: { type: 'integer' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated(null) },
    }),
  },

  // ================= SETTINGS =================
  '/admin/settings': {
    get: admin({ summary: 'App settings', responses: { 200: ok(null, { app_name: 'V_COM' }) } }),
    put: admin({
      summary: 'Update settings',
      requestBody: body({ type: 'object', properties: { app_name: { type: 'string' }, support_email: { type: 'string' }, maintenance_mode: { type: 'boolean' } } }),
      responses: { 200: ok(null, { updated: true }) },
    }),
  },
};

module.exports = paths;
