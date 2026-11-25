const { ok, okPaginated, created, noContent, body, security } = require('../components');

const paths = {
  // ---- Requests ----
  '/customer/requests': {
    get: {
      tags: ['Customer'], summary: 'My service requests', security: security(),
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'module', in: 'query', schema: { type: 'string' } },
        { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' },
      ],
      responses: { 200: okPaginated('#/components/schemas/ServiceRequest') },
    },
    post: {
      tags: ['Customer'], summary: 'Create service request', security: security(),
      requestBody: body({
        type: 'object',
        required: ['category_id', 'address_id'],
        properties: {
          category_id: { type: 'integer' },
          address_id: { type: 'integer' },
          notes: { type: 'string' },
          scheduled_time: { type: 'string' },
          priority: { type: 'string' },
          sub_services: { type: 'string', description: 'JSON array of sub-service ids' },
          attachments: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'multipart files' },
        },
      }),
      responses: { 201: created('#/components/schemas/ServiceRequest'), 400: { $ref: '#/components/responses/ValidationError' } },
    },
  },
  '/customer/requests/{id}': {
    get: {
      tags: ['Customer'], summary: 'Request detail (with quotations)', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/ServiceRequest'), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/customer/requests/{id}/cancel': {
    patch: {
      tags: ['Customer'], summary: 'Cancel request', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    },
    post: {
      tags: ['Customer'], summary: 'Cancel request (POST alias)', security: security(),
      description: 'Backward-compat alias of PATCH.',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/ServiceRequest') },
    },
  },

  // ---- Quotations ----
  '/customer/quotations': {
    get: {
      tags: ['Customer'], summary: 'Quotations on my requests', security: security(),
      parameters: [{ name: 'request_id', in: 'query', schema: { type: 'integer' } }, { $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated('#/components/schemas/Quotation') },
    },
  },
  '/customer/quotations/{id}': {
    get: {
      tags: ['Customer'], summary: 'Quotation detail', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/Quotation') },
    },
  },
  '/customer/quotations/{id}/decision': {
    post: {
      tags: ['Customer'], summary: 'Accept / reject quotation', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ["accepted", "rejected"] }, notes: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Quotation'), 409: { $ref: '#/components/responses/Conflict' } },
    },
  },

  // ---- Addresses ----
  '/customer/addresses': {
    get: { tags: ['Customer'], summary: 'List addresses', security: security(), responses: { 200: ok(null, [{ $ref: '#/components/schemas/Address' }]) } },
    post: {
      tags: ['Customer'], summary: 'Add address', security: security(),
      requestBody: body({ type: 'object', required: ['label', 'line1', 'city'], properties: { label: { type: 'string' }, line1: { type: 'string' }, line2: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, pincode: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, is_default: { type: 'boolean' } } }),
      responses: { 201: created('#/components/schemas/Address') },
    },
  },
  '/customer/addresses/{id}': {
    put: {
      tags: ['Customer'], summary: 'Update address', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { label: { type: 'string' }, line1: { type: 'string' }, city: { type: 'string' }, is_default: { type: 'boolean' } } }),
      responses: { 200: ok('#/components/schemas/Address') },
    },
    delete: {
      tags: ['Customer'], summary: 'Delete address', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: noContent('Deleted'), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/customer/addresses/{id}/default': {
    patch: {
      tags: ['Customer'], summary: 'Set as default address', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/Address') },
    },
  },

  // ---- SOS ----
  '/customer/sos': {
    get: { tags: ['Customer'], summary: 'My SOS history', security: security(), parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated('#/components/schemas/SOS') } },
    post: {
      tags: ['Customer'], summary: 'Raise SOS', security: security(),
      requestBody: body({ type: 'object', properties: { location: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, notes: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/SOS') },
    },
  },
  '/customer/sos/{id}': {
    get: { tags: ['Customer'], summary: 'SOS detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/SOS') } },
  },

  // ---- HR (attendance / leaves / profile) ----
  '/customer/hr/me': {
    get: { tags: ['Customer'], summary: 'My HR profile', security: security(), responses: { 200: ok(null) } },
  },
  '/customer/hr/attendance/check-in': {
    post: {
      tags: ['Customer'], summary: 'Check in', security: security(),
      requestBody: body({ type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } }),
      responses: { 200: ok('#/components/schemas/Attendance') },
    },
  },
  '/customer/hr/attendance/check-out': {
    post: {
      tags: ['Customer'], summary: 'Check out', security: security(),
      requestBody: body({ type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } }),
      responses: { 200: ok('#/components/schemas/Attendance') },
    },
  },
  '/customer/hr/attendance': {
    get: {
      tags: ['Customer'], summary: 'My attendance', security: security(),
      parameters: [{ name: 'month', in: 'query', schema: { type: 'string' } }],
      responses: { 200: okPaginated('#/components/schemas/Attendance') },
    },
  },
  '/customer/hr/leaves': {
    get: { tags: ['Customer'], summary: 'My leaves', security: security(), responses: { 200: okPaginated('#/components/schemas/Leave') } },
    post: {
      tags: ['Customer'], summary: 'Apply for leave', security: security(),
      requestBody: body({ type: 'object', required: ['type', 'from_date', 'to_date'], properties: { type: { type: 'string' }, from_date: { type: 'string', format: 'date' }, to_date: { type: 'string', format: 'date' }, reason: { type: 'string' } } }),
      responses: { 201: created('#/components/schemas/Leave') },
    },
  },

  // ---- Job applications ----
  '/customer/job-applications': {
    get: {
      tags: ['Customer'], summary: 'My job applications', security: security(),
      parameters: [{ $ref: '#/components/parameters/page' }],
      responses: { 200: okPaginated(null) },
    },
    post: {
      tags: ['Customer'], summary: 'Submit job application', security: security(),
      requestBody: body({ type: 'object', required: ['title'], properties: { title: { type: 'string' }, message: { type: 'string' }, resume: { type: 'string', format: 'binary' } } }),
      responses: { 201: created(null) },
    },
  },
  '/customer/job-applications/{id}': {
    get: {
      tags: ['Customer'], summary: 'Job application detail', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null) },
    },
  },

  // ---- Notifications ----
  '/customer/notifications': {
    get: {
      tags: ['Customer'], summary: 'My notifications', security: security(),
      parameters: [{ $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' }],
      responses: { 200: okPaginated('#/components/schemas/Notification') },
    },
    delete: { tags: ['Customer'], summary: 'Clear notifications', security: security(), responses: { 200: noContent('Cleared') } },
  },
  '/customer/notifications/read': {
    post: {
      tags: ['Customer'], summary: 'Mark notifications read', security: security(),
      requestBody: body({ type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } } } }),
      responses: { 200: noContent('Read') },
    },
  },

  // ---- Support ----
  '/customer/support': {
    get: { tags: ['Customer'], summary: 'My support tickets', security: security(), parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated(null) } },
    post: {
      tags: ['Customer'], summary: 'Create support ticket', security: security(),
      requestBody: body({ type: 'object', required: ['subject'], properties: { subject: { type: 'string' }, message: { type: 'string' }, category: { type: 'string' } } }),
      responses: { 201: created(null) },
    },
  },
  '/customer/support/{id}': {
    get: { tags: ['Customer'], summary: 'Support ticket detail (thread)', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok(null) } },
  },

  // ---- Reviews ----
  '/customer/reviews': {
    post: {
      tags: ['Customer'], summary: 'Submit service review', security: security(),
      requestBody: body({
        type: 'object',
        required: ['request_id', 'service_rating'],
        properties: {
          request_id: { type: 'integer' },
          service_rating: { type: 'integer', minimum: 1, maximum: 5 },
          service_comment: { type: 'string' },
          technician_rating: { type: 'integer', minimum: 1, maximum: 5 },
          technician_comment: { type: 'string' },
        },
      }),
      responses: { 201: created('#/components/schemas/Review'), 409: { $ref: '#/components/responses/Conflict' } },
    },
  },
  '/customer/reviews/{id}': {
    put: {
      tags: ['Customer'], summary: 'Update my review', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { service_rating: { type: 'integer' }, service_comment: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Review') },
    },
  },
  '/customer/reviews/request/{requestId}': {
    get: {
      tags: ['Customer'], summary: 'My review for a request', security: security(),
      parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: { 200: ok('#/components/schemas/Review') },
    },
  },
};

module.exports = paths;
