const { ok, okPaginated, created, body, security, noSecurity } = require('../components');

const admin = (s) => ({ ...s, tags: ['Admin'], security: security() });

const paths = {
  // ===================== PUBLIC LEGAL & ADVISORY =====================

  '/legal-advisory/categories': {
    get: {
      tags: ['Legal'],
      summary: 'List legal categories (8)',
      description: 'Hardcoded legal advisory categories. id=8 (OTHER) requires `other_query` on POST /request.',
      security: noSecurity,
      responses: {
        200: ok(null, {
          success: true,
          message: 'Legal categories retrieved successfully',
          data: [
            { id: 1, code: 'CRIMINAL', title: 'Criminal Law', subtitle: 'Criminal cases, bail, complaints', icon: 'Icons.gavel_rounded', theme_color: '#DC2626' },
            { id: 8, code: 'OTHER', title: 'Other Legal Advisory', subtitle: 'Any other legal assistance', icon: 'Icons.more_horiz_rounded', theme_color: '#1E293B', requires_custom_input: true },
          ],
        }),
      },
    },
  },

  '/legal-advisory/request': {
    post: {
      tags: ['Legal'],
      summary: 'Submit legal assistance request',
      description:
        'Requires Bearer token. Returns 201 with `ticket_no` (`VLA-<year>-<5digit>`), status `REQUEST_RECEIVED`. ' +
        'Category 8 (Other Legal Advisory) requires `other_query`.',
      security: security(),
      requestBody: body(
        {
          type: 'object',
          required: ['category_id', 'location'],
          properties: {
            category_id: { type: 'integer', example: 1 },
            location: { type: 'string', example: 'Banani, Dhaka' },
            latitude: { type: 'number', nullable: true },
            longitude: { type: 'number', nullable: true },
            other_query: { type: 'string', nullable: true, description: 'Required when category_id = 8', example: 'Tenancy agreement dispute' },
          },
        },
        { category_id: 1, location: 'Banani, Dhaka', latitude: 23.7937, longitude: 90.4066 }
      ),
      responses: {
        201: {
          description: 'Legal request submitted',
          content: {
            'application/json': {
              schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/LegalTicketPublic' } } }] },
              example: {
                success: true,
                message: 'Legal assistance request submitted successfully',
                data: {
                  ticket_no: 'VLA-2026-90412',
                  category: 'Criminal Law',
                  location: 'Banani, Dhaka',
                  other_query: null,
                  status: 'REQUEST_RECEIVED',
                  submitted_at: '2026-11-25T10:30:00.000Z',
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/legal-advisory/track/{ticket_no}': {
    get: {
      tags: ['Legal'],
      summary: 'Track legal request by ticket_no',
      description: 'Owner only (404 for other users). Returns status + assigned_advocate when assigned.',
      security: security(),
      parameters: [{ name: 'ticket_no', in: 'path', required: true, schema: { type: 'string' }, example: 'VLA-2026-90412' }],
      responses: {
        200: {
          description: 'Tracked',
          content: {
            'application/json': {
              schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/LegalTicketPublic' } } }] },
              example: {
                success: true,
                message: 'Legal request tracked successfully',
                data: {
                  ticket_no: 'VLA-2026-90412',
                  category: 'Criminal Law',
                  location: 'Banani, Dhaka',
                  status: 'ADVOCATE_ASSIGNED',
                  assigned_advocate: { name: 'Adv. Rajesh Menon', specialization: 'Criminal Law — bail, trials, complaints', contact_status: 'Will call at registered number', phone: '+91 9000000101' },
                  created_at: '2026-11-25T10:30:00.000Z',
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/legal-advisory/history': {
    get: {
      tags: ['Legal'],
      summary: "Legal request history (owner's own, paginated)",
      security: security(),
      parameters: [{ $ref: '#/components/parameters/page' }, { $ref: '#/components/parameters/limit' }],
      responses: {
        200: okPaginated('#/components/schemas/LegalHistoryItem'),
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  // ===================== ADMIN LEGAL =====================

  '/admin/legal/tickets': {
    get: admin({
      summary: 'List legal tickets (admin)',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['request_received', 'advocate_assigned', 'in_consultation', 'resolved', 'cancelled'] } },
        { name: 'category_id', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'ticket_no / customer name / phone / category' },
        { $ref: '#/components/parameters/page' },
      ],
      responses: { 200: okPaginated('#/components/schemas/LegalTicket') },
    }),
  },

  '/admin/legal/tickets/{id}': {
    get: admin({
      summary: 'Legal ticket detail (id or ticket_no) + history',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok('#/components/schemas/LegalTicket'), 404: { $ref: '#/components/responses/NotFound' } },
    }),
  },

  '/admin/legal/tickets/{id}/status': {
    post: admin({
      summary: 'Update legal ticket status (with advocate assignment)',
      description:
        'Transitions: request_received → advocate_assigned (advocate_id required) → in_consultation → resolved | cancelled. ' +
        'Invalid transitions return 400.',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['advocate_assigned', 'in_consultation', 'resolved', 'cancelled'] },
          advocate_id: { type: 'integer', nullable: true, description: 'Required for advocate_assigned' },
          note: { type: 'string', nullable: true },
        },
      }),
      responses: { 200: ok(null, null), 400: { $ref: '#/components/responses/ValidationError' }, 404: { $ref: '#/components/responses/NotFound' } },
    }),
  },

  '/admin/legal/stats': {
    get: admin({
      summary: 'Legal ticket counts by status',
      responses: {
        200: ok(null, { by_status: [{ status: 'request_received', count: 3 }, { status: 'advocate_assigned', count: 1 }], active: 4 }),
      },
    }),
  },

  '/admin/legal/advocates': {
    get: admin({
      summary: 'List legal advocates',
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } },
        { name: 'category_id', in: 'query', schema: { type: 'integer' } },
        { $ref: '#/components/parameters/page' },
      ],
      responses: { 200: okPaginated('#/components/schemas/LegalAdvocate') },
    }),
    post: admin({
      summary: 'Create advocate',
      requestBody: body({
        type: 'object',
        required: ['name', 'specialization'],
        properties: {
          name: { type: 'string', example: 'Adv. Rajesh Menon' },
          specialization: { type: 'string', example: 'Criminal Law — bail, trials, complaints' },
          category_id: { type: 'integer', nullable: true, description: 'null = general' },
          contact_status: { type: 'string', default: 'Will call at registered number' },
          phone: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      }),
      responses: { 201: created('#/components/schemas/LegalAdvocate') },
    }),
  },

  '/admin/legal/advocates/{id}': {
    put: admin({
      summary: 'Update advocate',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({
        type: 'object',
        properties: {
          name: { type: 'string' },
          specialization: { type: 'string' },
          category_id: { type: 'integer', nullable: true },
          contact_status: { type: 'string' },
          phone: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      }),
      responses: { 200: ok('#/components/schemas/LegalAdvocate') },
    }),
    delete: admin({
      summary: 'Delete advocate',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      responses: { 200: ok(null, null) },
    }),
  },

  '/admin/legal/advocates/{id}/status': {
    patch: admin({
      summary: 'Activate / deactivate advocate',
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['active', 'inactive'] } } }),
      responses: { 200: ok(null, null) },
    }),
  },
};

module.exports = paths;
