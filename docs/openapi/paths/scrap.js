const { ok, okPaginated, created, body, multipart, security, noSecurity } = require('../components');

const admin = (s) => ({ ...s, tags: ['Admin'], security: security() });

const codePath = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Request code VSW-YYYY-NNNNN (numeric id also accepted on admin routes)', example: 'VSW-2026-90412' };

const paths = {
  // ===================== PUBLIC — SCRAP & WASTE =====================

  '/scrap-waste/categories': {
    get: {
      tags: ['ScrapWaste'],
      summary: 'List scrap categories (8)',
      description: 'Hardcoded: Paper, Cardboard, Iron & Steel, Copper/Brass/Aluminium, Plastic, E-Waste, Rubber, Mixed.',
      security: noSecurity,
      responses: {
        200: ok('#/components/schemas/ScrapCategory', [
          { id: 1, code: 'PAPER', name: 'Paper & Newspapers', description: 'Old newspapers, books, cartons', image: 'imageling', theme_color: '#0284C7' },
          { id: 8, code: 'MIXED', name: 'Mixed Household Scrap', description: 'Combined household clutter', image: 'imageling', theme_color: '#0F766E' },
        ]),
      },
    },
  },

  '/scrap-waste/pickup-slots': {
    get: {
      tags: ['ScrapWaste'],
      summary: 'Pickup weight ranges, types, dates & time slots',
      security: noSecurity,
      responses: {
        200: ok('#/components/schemas/ScrapPickupSlots', {
          weight_ranges: ['< 15 kg (Light)', '15 - 50 kg (Standard)', '50 - 150 kg (Heavy)', '> 150 kg (Commercial Bulk)'],
          pickup_types: [
            { type: 'Doorstep', title: 'Doorstep Pickup', description: 'Homes, Flats & Apartments' },
            { type: 'Bulk', title: 'Bulk / Commercial', description: 'Offices, Shops & Warehouses' },
          ],
          date_options: ['Today', 'Tomorrow', 'Day After Tomorrow'],
          time_slots: ['09:00 AM - 12:00 PM', '10:00 AM - 01:00 PM', '02:00 PM - 05:00 PM', '05:00 PM - 07:30 PM'],
        }),
      },
    },
  },

  '/scrap-waste/pickup-request': {
    post: {
      tags: ['ScrapWaste'],
      summary: 'Submit scrap pickup request (multipart, photo optional)',
      description:
        'Requires Bearer token. `multipart/form-data`. `scrap_photo` optional (jpg/png) — uploaded to Cloudinary ' +
        '(local /uploads/scrap fallback). **Buyer assignment is manual (admin)**: response `status: REQUEST_PLACED`, ' +
        '`assigned_buyer: null`; admin assigns later via `PATCH /admin/scrap/requests/{id}/assign`.',
      security: security(),
      requestBody: multipart({
        type: 'object',
        required: ['material_categories', 'approx_weight_range', 'pickup_type', 'pickup_address', 'contact_phone', 'preferred_date', 'preferred_time_slot'],
        properties: {
          material_categories: { type: 'string', description: 'JSON array (or comma string) of category names', example: '["Paper & Newspapers","Iron & Steel Scraps"]' },
          approx_weight_range: { type: 'string', enum: ['< 15 kg (Light)', '15 - 50 kg (Standard)', '50 - 150 kg (Heavy)', '> 150 kg (Commercial Bulk)'], example: '15 - 50 kg (Standard)' },
          pickup_type: { type: 'string', enum: ['Doorstep', 'Bulk'], example: 'Doorstep' },
          pickup_address: { type: 'string', example: 'Bejai Main Road, Mangalore - 575004' },
          latitude: { type: 'string', description: 'Optional GPS', example: '12.9141' },
          longitude: { type: 'string', example: '74.8560' },
          contact_phone: { type: 'string', description: '10-digit mobile', example: '9876543210' },
          preferred_date: { type: 'string', enum: ['Today', 'Tomorrow', 'Day After Tomorrow'], example: 'Tomorrow' },
          preferred_time_slot: { type: 'string', enum: ['09:00 AM - 12:00 PM', '10:00 AM - 01:00 PM', '02:00 PM - 05:00 PM', '05:00 PM - 07:30 PM'], example: '10:00 AM - 01:00 PM' },
          special_instructions: { type: 'string', example: 'Lift available' },
          scrap_photo: { type: 'string', format: 'binary', description: 'Optional jpg/png of the scrap load' },
        },
      }),
      responses: {
        201: created('#/components/schemas/ScrapRequestCreated'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/scrap-waste/requests/{id}/track': {
    get: {
      tags: ['ScrapWaste'],
      summary: 'Track pickup status & timeline (owner only)',
      description: 'Owner only — 404 for other users. Times rendered as h:mm AM/PM.',
      security: security(),
      parameters: [codePath],
      responses: {
        200: ok('#/components/schemas/ScrapTrack', {
          request_id: 'VSW-2026-90412',
          status: 'OUT_FOR_PICKUP',
          materials: ['Iron & Steel Scraps', 'Mixed Household Scrap'],
          pickup_slot: 'Today, 02:00 PM - 05:00 PM',
          address: 'Bejai Main Road, Mangalore - 575004',
          buyer: { name: 'Suresh Gowda', phone: '9876512345', vehicle_no: 'KA-19-E-4421' },
          timeline: [
            { status: 'REQUEST_PLACED', time: '9:05 AM', done: true },
            { status: 'BUYER_ASSIGNED', time: '9:20 AM', done: true },
            { status: 'OUT_FOR_PICKUP', time: '2:10 PM', done: true },
            { status: 'WEIGHING_COMPLETED', time: null, done: false },
            { status: 'PAYMENT_COMPLETED', time: null, done: false },
          ],
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/scrap-waste/my-pickups': {
    get: {
      tags: ['ScrapWaste'],
      summary: "User's pickup requests",
      description: 'Response: `data: { total, items }` (flat, not paginated envelope).',
      security: security(),
      parameters: [
        { name: 'status', in: 'query', schema: { type: 'string', description: 'Uppercase status or ALL', example: 'OUT_FOR_PICKUP' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 15 } },
      ],
      responses: {
        200: ok(null, {
          success: true,
          message: 'Pickups fetched successfully',
          data: {
            total: 2,
            items: [
              { request_id: 'VSW-2026-90412', materials: 'Iron & Steel Scraps, Mixed Household Scrap', scheduled_date: 'Today, 02:00 PM - 05:00 PM', status: 'OUT_FOR_PICKUP', created_at: '2026-11-27T09:05:00.000Z' },
            ],
          },
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/scrap-waste/requests/{id}/cancel': {
    post: {
      tags: ['ScrapWaste'],
      summary: 'Cancel pickup request (owner only)',
      description: 'Allowed from REQUEST_PLACED / BUYER_ASSIGNED / OUT_FOR_PICKUP / WEIGHING_COMPLETED. 400 if PAYMENT_COMPLETED or already CANCELLED.',
      security: security(),
      parameters: [codePath],
      requestBody: body({ type: 'object', properties: { cancellation_reason: { type: 'string', nullable: true, example: 'plans changed' } } }, { cancellation_reason: 'plans changed' }),
      responses: {
        200: ok(null, {
          success: true,
          message: 'Scrap pickup request cancelled successfully.',
          data: { request_id: 'VSW-2026-00042', status: 'CANCELLED' },
        }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  // ===================== ADMIN — SCRAP & WASTE =====================

  '/admin/scrap/requests': {
    get: admin({
      summary: 'List scrap requests (admin)',
      parameters: [
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'REQUEST_PLACED', 'BUYER_ASSIGNED', 'OUT_FOR_PICKUP', 'WEIGHING_COMPLETED', 'PAYMENT_COMPLETED', 'CANCELLED'] } },
        { name: 'pickup_type', in: 'query', schema: { type: 'string', enum: ['Doorstep', 'Bulk'] } },
        { name: 'buyer_id', in: 'query', schema: { type: 'integer' } },
        { name: 'search', in: 'query', schema: { type: 'string' }, description: 'code / address / phone / customer name' },
      ],
      responses: {
        200: okPaginated('#/components/schemas/ScrapRequestAdmin', [
          {
            id: 1, request_code: 'VSW-2026-90412', user_id: 6, customer_name: 'Demo Customer',
            materials: ['Iron & Steel Scraps', 'Mixed Household Scrap'],
            approx_weight_range: '50 - 150 kg (Heavy)', pickup_type: 'Doorstep',
            pickup_address: 'Bejai Main Road, Mangalore - 575004', contact_phone: '9876543210',
            preferred_date: 'Today', preferred_time_slot: '02:00 PM - 05:00 PM',
            status: 'OUT_FOR_PICKUP', assigned_buyer_id: 1, buyer_name: 'Suresh Gowda', buyer_vehicle_no: 'KA-19-E-4421',
            actual_weight_kg: null, final_amount: null, payment_mode: null,
            created_at: '2026-11-27T09:05:00.000Z',
          },
        ]),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },

  '/admin/scrap/requests/{id}': {
    get: admin({
      summary: 'Scrap request detail (admin, by id or code)',
      parameters: [codePath],
      responses: {
        200: ok('#/components/schemas/ScrapRequestAdmin', { id: 1, request_code: 'VSW-2026-90412', status: 'OUT_FOR_PICKUP', buyer_name: 'Suresh Gowda', customer_name: 'Demo Customer' }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/scrap/requests/{id}/assign': {
    patch: admin({
      summary: 'Assign buyer to request (manual)',
      description:
        'Requires `scrap.manage`. Only REQUEST_PLACED requests (400 otherwise). Buyer must exist and be active. ' +
        'Moves status to BUYER_ASSIGNED and stamps `assigned_at`.',
      parameters: [codePath],
      requestBody: body({ type: 'object', required: ['buyer_id'], properties: { buyer_id: { type: 'integer', example: 1 } } }, { buyer_id: 1 }),
      responses: {
        200: ok('#/components/schemas/ScrapRequestAdmin', { request_code: 'VSW-2026-00042', status: 'BUYER_ASSIGNED', assigned_buyer_id: 1, buyer_name: 'Suresh Gowda' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/scrap/requests/{id}/status': {
    patch: admin({
      summary: 'Advance request status (out / weigh / pay / cancel)',
      description:
        'Requires `scrap.manage`. Legal transitions only: ' +
        'BUYER_ASSIGNED→OUT_FOR_PICKUP; OUT_FOR_PICKUP→WEIGHING_COMPLETED (needs `actual_weight_kg` + `final_amount`, both > 0); ' +
        'WEIGHING_COMPLETED→PAYMENT_COMPLETED (needs `payment_mode`); REQUEST_PLACED..WEIGHING_COMPLETED→CANCELLED.',
      parameters: [codePath],
      requestBody: body(
        {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['OUT_FOR_PICKUP', 'WEIGHING_COMPLETED', 'PAYMENT_COMPLETED', 'CANCELLED'], example: 'WEIGHING_COMPLETED' },
            actual_weight_kg: { type: 'number', description: 'Required for WEIGHING_COMPLETED', example: 62.5 },
            final_amount: { type: 'number', description: 'Required for WEIGHING_COMPLETED', example: 1875 },
            payment_mode: { type: 'string', enum: ['Cash', 'UPI', 'Bank Transfer', 'Wallet'], description: 'Required for PAYMENT_COMPLETED', example: 'UPI' },
            cancellation_reason: { type: 'string', description: 'Optional for CANCELLED' },
          },
        },
        { status: 'WEIGHING_COMPLETED', actual_weight_kg: 62.5, final_amount: 1875 }
      ),
      responses: {
        200: ok('#/components/schemas/ScrapRequestAdmin', { request_code: 'VSW-2026-00042', status: 'WEIGHING_COMPLETED', actual_weight_kg: 62.5, final_amount: 1875 }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
  },

  '/admin/scrap/buyers': {
    get: admin({
      summary: 'List scrap buyers',
      parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive'] } }],
      responses: {
        200: ok(null, {
          success: true,
          message: 'Buyers fetched successfully',
          data: [
            { id: 1, name: 'Suresh Gowda', phone: '9876512345', vehicle_no: 'KA-19-E-4421', scale_type: 'Digital Weighing Scale', status: 'active', assigned_requests: 1, created_at: '2026-11-27T06:00:00.000Z' },
          ],
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
    post: admin({
      summary: 'Create buyer',
      description: 'Requires `scrap.manage`.',
      requestBody: body(
        {
          type: 'object',
          required: ['name', 'phone'],
          properties: {
            name: { type: 'string', example: 'Imran Sheikh' },
            phone: { type: 'string', example: '9845012345' },
            vehicle_no: { type: 'string', nullable: true, example: 'KA-19-E-7788' },
            scale_type: { type: 'string', nullable: true, example: 'Digital Weighing Scale' },
            status: { type: 'string', enum: ['active', 'inactive'], default: 'active' },
          },
        },
        { name: 'Imran Sheikh', phone: '9845012345', vehicle_no: 'KA-19-E-7788', scale_type: 'Digital Weighing Scale' }
      ),
      responses: {
        201: created('#/components/schemas/ScrapBuyer'),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },

  '/admin/scrap/buyers/{id}': {
    put: admin({
      summary: 'Update buyer (partial)',
      description: 'Requires `scrap.manage`.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1 }],
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, vehicle_no: { type: 'string' }, scale_type: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] } } }, { vehicle_no: 'KA-19-E-4421', status: 'inactive' }),
      responses: {
        200: ok('#/components/schemas/ScrapBuyer', { id: 1, name: 'Suresh Gowda', vehicle_no: 'KA-19-E-4421', status: 'inactive' }),
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    }),
    delete: admin({
      summary: 'Delete buyer',
      description: 'Requires `scrap.manage`. 409 if the buyer has any assigned requests.',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 2 }],
      responses: {
        200: ok(null, { success: true, message: 'Buyer deleted successfully', data: { id: 2 } }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    }),
  },

  '/admin/scrap/stats': {
    get: admin({
      summary: 'Scrap & waste stats (admin)',
      responses: {
        200: ok('#/components/schemas/ScrapStats', {
          total_requests: 12, placed: 2, assigned: 2, out_for_pickup: 3, weighed: 1, paid: 3, cancelled: 1,
          total_revenue: 6840, total_buyers: 4, active_buyers: 4,
        }),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    }),
  },
};

module.exports = paths;
