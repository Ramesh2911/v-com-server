const { ok, okPaginated, created, noContent, body, security, noSecurity } = require('../components');

const paths = {
  // ===================== SERVICES =====================
  '/services': {
    get: {
      tags: ['Public'],
      summary: 'Service modules with active categories',
      description: 'Public. Professional (18) / Quick (7) / Special (6) modules — hidden (status=0) categories excluded.',
      security: noSecurity,
      responses: {
        200: ok(null, [
          { id: 1, code: 'special-service', name: 'Professional Service', status: 1, categories: [{ id: 1, name: 'CCTV and Automation', status: 1 }] },
        ]),
      },
    },
  },
  '/services/featured': {
    get: { tags: ['Public'], summary: 'Featured services/categories', security: noSecurity, responses: { 200: ok(null, []) } },
  },
  '/services/search': {
    get: {
      tags: ['Public'], summary: 'Search services', security: noSecurity,
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { 200: ok(null, [{ id: 1, name: 'CCTV Installation' }]) },
    },
  },
  '/services/category/{id}': {
    get: {
      tags: ['Public'], summary: 'Category detail (module or category id)', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null, { id: 1, name: 'CCTV and Automation', review_summary: { service_avg: 4.5, service_count: 10 } }), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/services/{id}': {
    get: {
      tags: ['Public'], summary: 'Service detail (module or category)', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null, { id: 1, name: 'CCTV and Automation' }), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/services/{id}/reviews': {
    get: {
      tags: ['Public'], summary: 'Public reviews for a service', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }, { $ref: '#/components/parameters/page' }],
      responses: { 200: ok(null, { review_summary: { service_avg: 4.5, service_count: 10, distribution: {} }, reviews: [] }) },
    },
  },
  '/categories/{id}/sub-services': {
    get: {
      tags: ['Public'], summary: 'Sub-services of a category', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null, [{ $ref: '#/components/schemas/SubService' }]) },
    },
  },

  // ===================== PROPERTIES =====================
  '/properties': {
    get: {
      tags: ['Public'], summary: 'List properties (sale/rent)', security: noSecurity,
      parameters: [
        { name: 'listing_type', in: 'query', schema: { type: 'string', enum: ["sale", "rent"] } },
        { name: 'city', in: 'query', schema: { type: 'string' } },
        { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' },
      ],
      responses: { 200: okPaginated('#/components/schemas/Property') },
    },
  },
  '/properties/filters': {
    get: {
      tags: ['Public'], summary: 'Property filter options (cities/types)', security: noSecurity,
      responses: { 200: ok(null, { cities: [], property_types: [] }) },
    },
  },
  '/properties/{id}': {
    get: {
      tags: ['Public'], summary: 'Property detail', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/Property'), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
  '/properties/{id}/enquiry': {
    post: {
      tags: ['Public'], summary: 'Submit property enquiry', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['name', 'phone'], properties: { name: { type: 'string' }, phone: { type: 'string' }, message: { type: 'string' } } }),
      responses: { 201: created(null) },
    },
  },

  // ===================== BANNERS / OFFERS / COUPONS =====================
  '/banners': {
    get: {
      tags: ['Public'], summary: 'Active banners (hero carousel)', security: noSecurity,
      responses: { 200: ok(null, [{ id: 1, title: 'Diwali Offer', image: 'https://…', slot: 1 }]) },
    },
  },
  '/offers': {
    get: {
      tags: ['Public'], summary: 'Active-now offers', security: noSecurity,
      responses: { 200: ok(null, [{ id: 1, title: '20% Off', discount_type: 'percent', discount_value: '20' }]) },
    },
  },
  '/coupons/validate': {
    post: {
      tags: ['Public'], summary: 'Validate coupon code', security: noSecurity,
      requestBody: body({ type: 'object', required: ['code'], properties: { code: { type: 'string', example: 'SAVE10' }, amount: { type: 'number', description: 'Optional — compute discount' } } }),
      responses: {
        200: ok(null, { code: 'SAVE10', discount_type: 'percent', discount_value: 10, computed_discount: 50 }),
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ===================== EVENTS =====================
  '/events': {
    get: {
      tags: ['Public'], summary: 'Published events', security: noSecurity,
      parameters: [
        { name: 'city', in: 'query', schema: { type: 'string' } },
        { $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' },
      ],
      responses: { 200: okPaginated('#/components/schemas/Event') },
    },
  },
  '/events/locations': {
    get: {
      tags: ['Public'], summary: 'Event locations (cities/venues)', security: noSecurity,
      responses: { 200: ok(null, [{ city: 'Dhaka', count: 3 }]) },
    },
  },
  '/events/locations/search': {
    post: {
      tags: ['Public'], summary: 'Search event locations', security: noSecurity,
      requestBody: body({ type: 'object', required: ['q'], properties: { q: { type: 'string' } } }),
      responses: { 200: ok(null, []) },
    },
  },
  '/events/{id}': {
    get: {
      tags: ['Public'], summary: 'Event detail', security: noSecurity,
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/Event'), 404: { $ref: '#/components/responses/NotFound' } },
    },
  },
};

module.exports = paths;
