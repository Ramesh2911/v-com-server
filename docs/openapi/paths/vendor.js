const { ok, okPaginated, created, noContent, body, security, multipart } = require('../components');

const paths = {
  // ---- Profile / dashboard ----
  '/vendor/profile': {
    get: { tags: ['Vendor'], summary: 'Vendor profile', security: security(), responses: { 200: ok(null, { id: 1, business_name: 'Acme' }) } },
    put: {
      tags: ['Vendor'], summary: 'Update vendor profile', security: security(),
      requestBody: body({ type: 'object', properties: { business_name: { type: 'string' }, city: { type: 'string' }, categories: { type: 'string' } } }),
      responses: { 200: ok(null, { updated: true }) },
    },
  },
  '/vendor/complete-profile': {
    post: {
      tags: ['Vendor'], summary: 'Complete vendor profile (KYC)', security: security(),
      requestBody: multipart({ type: 'object', properties: { business_name: { type: 'string' }, city: { type: 'string' }, kyc_doc: { type: 'string', format: 'binary' } } }),
      responses: { 200: ok(null, { completed: true }) },
    },
  },
  '/vendor/dashboard': {
    get: { tags: ['Vendor'], summary: 'Vendor dashboard summary', security: security(), responses: { 200: ok(null, { active_jobs: 3, pending_quotations: 2, earnings: 15000 }) } },
  },
  '/vendor/summary': {
    get: { tags: ['Vendor'], summary: 'Vendor stats summary', security: security(), responses: { 200: ok(null, { jobs: 10, technicians: 4 }) } },
  },
  '/vendor/status/toggle': {
    put: { tags: ['Vendor'], summary: 'Toggle vendor active/inactive', security: security(), responses: { 200: ok(null, { status: 'active' }) } },
  },

  // ---- Services / categories ----
  '/vendor/services': {
    get: { tags: ['Vendor'], summary: 'Vendor offered services', security: security(), responses: { 200: ok(null, [{ id: 1, name: 'Plumbing' }]) } },
  },
  '/vendor/available-categories': {
    get: { tags: ['Vendor'], summary: 'Categories available to opt-in', security: security(), responses: { 200: ok(null, [{ id: 2, name: 'Electrical' }]) } },
  },
  '/vendor/service-categories': {
    put: {
      tags: ['Vendor'], summary: 'Set vendor service categories', security: security(),
      requestBody: body({ type: 'object', required: ['category_ids'], properties: { category_ids: { type: 'array', items: { type: 'integer' } } } }),
      responses: { 200: ok(null, { saved: true }) },
    },
  },

  // ---- Technicians ----
  '/vendor/technicians': {
    get: { tags: ['Vendor'], summary: 'List technicians', security: security(), responses: { 200: okPaginated(null) } },
    post: {
      tags: ['Vendor'], summary: 'Add technician', security: security(),
      requestBody: body({ type: 'object', required: ['name', 'phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, skills: { type: 'string' } } }),
      responses: { 201: created(null), 409: { $ref: '#/components/responses/Conflict' } },
    },
  },
  '/vendor/technicians/{id}': {
    put: {
      tags: ['Vendor'], summary: 'Update technician', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, skills: { type: 'string' } } }),
      responses: { 200: ok(null, { updated: true }) },
    },
    delete: {
      tags: ['Vendor'], summary: 'Remove technician', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: noContent('Deleted'), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/vendor/technician-attendance': {
    get: { tags: ['Vendor'], summary: 'Technician attendance list', security: security(), parameters: [{ name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }], responses: { 200: ok(null, []) } },
    post: {
      tags: ['Vendor'], summary: 'Mark technician attendance', security: security(),
      requestBody: body({ type: 'object', required: ['technician_id', 'status'], properties: { technician_id: { type: 'integer' }, date: { type: 'string' }, status: { type: 'string', enum: ["present", "absent", "half_day", "leave"] } } }),
      responses: { 200: ok(null, { marked: true }) },
    },
  },
  '/vendor/technician-attendance/summary': {
    get: { tags: ['Vendor'], summary: 'Attendance summary', security: security(), responses: { 200: ok(null, { present: 20, absent: 2 }) } },
  },

  // ---- Requests (incoming) ----
  '/vendor/requests': {
    get: {
      tags: ['Vendor'], summary: 'Requests assigned/offered to vendor', security: security(),
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' }],
      responses: { 200: okPaginated('#/components/schemas/ServiceRequest') },
    },
  },
  '/vendor/requests/{id}': {
    get: { tags: ['Vendor'], summary: 'Request detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/ServiceRequest') } },
  },
  '/vendor/requests/{id}/accept': {
    post: { tags: ['Vendor'], summary: 'Accept request', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/ServiceRequest') } },
  },
  '/vendor/requests/{id}/decline': {
    post: { tags: ['Vendor'], summary: 'Decline request', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/ServiceRequest') } },
  },
  '/vendor/requests/{id}/status': {
    post: {
      tags: ['Vendor'], summary: 'Update request status', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    },
  },

  // ---- Quotations ----
  '/vendor/quotations': {
    get: {
      tags: ['Vendor'], summary: 'My quotations', security: security(),
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Quotation') },
    },
    post: {
      tags: ['Vendor'], summary: 'Submit quotation', security: security(),
      requestBody: body({ type: 'object', required: ['request_id', 'amount'], properties: { request_id: { type: 'integer' }, amount: { type: 'number' }, notes: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Quotation'), 409: { $ref: '#/components/responses/Conflict' } },
    },
  },
  '/vendor/quotations/{id}': {
    get: { tags: ['Vendor'], summary: 'Quotation detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Quotation') } },
    put: {
      tags: ['Vendor'], summary: 'Update quotation', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { amount: { type: 'number' }, notes: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Quotation') },
    },
  },
  '/vendor/quotations/{id}/withdraw': {
    post: { tags: ['Vendor'], summary: 'Withdraw quotation', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Quotation') } },
  },

  // ---- Jobs / bookings ----
  '/vendor/jobs': {
    get: {
      tags: ['Vendor'], summary: 'My jobs', security: security(),
      parameters: [{ name: 'stage', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Job') },
    },
    post: {
      tags: ['Vendor'], summary: 'Create job from accepted quotation', security: security(),
      requestBody: body({ type: 'object', required: ['quotation_id'], properties: { quotation_id: { type: 'integer' }, technician_id: { type: 'integer' } } }),
      responses: { 201: created('#/components/schemas/Job') },
    },
  },
  '/vendor/jobs/{id}': {
    get: { tags: ['Vendor'], summary: 'Job detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Job') } },
  },
  '/vendor/jobs/{id}/status': {
    post: {
      tags: ['Vendor'], summary: 'Update job status', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['stage'], properties: { stage: { type: 'string', enum: ["assigned", "in_progress", "completed", "cancelled"] } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    },
  },
  '/vendor/jobs/{id}/attachments': {
    post: {
      tags: ['Vendor'], summary: 'Upload job attachment', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: multipart({ type: 'object', properties: { file: { type: 'string', format: 'binary' } } }),
      responses: { 201: created(null) },
    },
  },
  '/vendor/bookings': {
    get: {
      tags: ['Vendor'], summary: 'Bookings list (job view)', security: security(),
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Job') },
    },
  },
  '/vendor/bookings/{id}': {
    get: { tags: ['Vendor'], summary: 'Booking detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Job') } },
  },
  '/vendor/bookings/{id}/action': {
    put: {
      tags: ['Vendor'], summary: 'Booking action (accept/complete…)', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['action'], properties: { action: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    },
  },
  '/vendor/bookings/{id}/assign': {
    post: {
      tags: ['Vendor'], summary: 'Assign technician to booking', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['technician_id'], properties: { technician_id: { type: 'integer' } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    },
  },

  // ---- Notifications / support ----
  '/vendor/notifications': {
    get: { tags: ['Vendor'], summary: 'My notifications', security: security(), responses: { 200: ok(null, []) } },
    post: { tags: ['Vendor'], summary: 'Mark read (body: ids)', security: security(), requestBody: body({ type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } } } }), responses: { 200: noContent('Read') } },
    delete: { tags: ['Vendor'], summary: 'Clear notifications', security: security(), responses: { 200: noContent('Cleared') } },
  },
  '/vendor/support': {
    get: { tags: ['Vendor'], summary: 'Support tickets', security: security(), responses: { 200: okPaginated(null) } },
    post: {
      tags: ['Vendor'], summary: 'Create support ticket', security: security(),
      requestBody: body({ type: 'object', required: ['subject'], properties: { subject: { type: 'string' }, message: { type: 'string' } } }),
      responses: { 201: created(null) },
    },
  },
  '/vendor/support/{id}': {
    get: { tags: ['Vendor'], summary: 'Support ticket detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok(null) } },
  },
  '/vendor/support/messages': {
    get: { tags: ['Vendor'], summary: 'Support messages (alias)', security: security(), responses: { 200: okPaginated(null) } },
    post: {
      tags: ['Vendor'], summary: 'Reply on support ticket', security: security(),
      requestBody: body({ type: 'object', required: ['ticket_id', 'message'], properties: { ticket_id: { type: 'integer' }, message: { type: 'string' } } }),
      responses: { 201: created(null) },
    },
  },
};

module.exports = paths;
