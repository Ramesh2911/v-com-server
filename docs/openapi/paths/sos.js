const { ok, okPaginated, created, body, security, noSecurity } = require('../components');

// multipart/form-data request body helper
const multipart = (schema, example) => ({
  required: true,
  content: { 'multipart/form-data': { schema, example } },
});

const paths = {
  // ===================== PUBLIC SOS =====================
  '/sos/categories': {
    get: {
      tags: ['SOS'],
      summary: 'List emergency categories (10)',
      description: 'Hardcoded emergency categories with helpline, theme color and image.',
      security: noSecurity,
      responses: {
        200: ok(null, {
          success: true,
          message: 'Emergency categories fetched successfully',
          data: [
            { id: 1, code: 'MEDICAL', name: 'Medical Emergency', subtitle: 'Ambulance, first aid, medical assistance and emergency transport', helpline: '108', theme_color: '#DC2626', image_url: 'https://images.unsplash.com/photo-1587745416684-47b88f3ce0b6?w=700' },
          ],
        }),
      },
    },
  },

  '/sos/send-otp': {
    post: {
      tags: ['SOS'],
      summary: 'Send 4-digit SOS verification OTP',
      description: 'Anti-hoax OTP for emergency dispatch. Mock provider returns `default_test_otp`.',
      security: noSecurity,
      requestBody: body(
        { type: 'object', required: ['phone'], properties: { phone: { type: 'string', example: '9876543210' } } },
        { phone: '9876543210' }
      ),
      responses: {
        200: ok(null, { phone: '9876543210', otp_length: 4, resend_in_seconds: 30, default_test_otp: '1234' }),
        429: { description: 'Rate limited' },
      },
    },
  },

  '/sos/verify-otp': {
    post: {
      tags: ['SOS'],
      summary: 'Verify 4-digit OTP → verification_token',
      description: 'Returns `verification_token` (JWT, 15 min) required by POST /sos/dispatch.',
      security: noSecurity,
      requestBody: body(
        {
          type: 'object',
          required: ['phone', 'otp'],
          properties: { phone: { type: 'string' }, otp: { type: 'string', description: '4-digit code', example: '1234' } },
        },
        { phone: '9876543210', otp: '1234' }
      ),
      responses: {
        200: ok(null, { is_verified: true, phone: '9876543210', verification_token: 'eyJhbGciOi...' }),
        400: { $ref: '#/components/responses/ValidationError' },
        429: { description: 'Rate limited' },
      },
    },
  },

  '/sos/dispatch': {
    post: {
      tags: ['SOS'],
      summary: 'Dispatch emergency SOS (multipart, photo required)',
      description:
        'Auth optional (Bearer). Requires valid `verification_token` matching `requester_phone`. ' +
        'Assigns nearest active responder for the category. Returns 201 with full ticket + assigned_responder.',
      security: [{}, { BearerAuth: [] }],
      requestBody: multipart(
        {
          type: 'object',
          required: ['category_id', 'photo', 'requester_phone', 'requester_location', 'is_for_other', 'description', 'verification_token'],
          properties: {
            category_id: { type: 'integer', example: 1 },
            photo: { type: 'string', format: 'binary', description: 'Camera photo (.jpg/.png)' },
            requester_phone: { type: 'string', example: '9876543210' },
            requester_location: { type: 'string', example: 'Bejai, Mangalore' },
            latitude: { type: 'number', nullable: true },
            longitude: { type: 'number', nullable: true },
            is_for_other: { type: 'string', enum: ['true', 'false'], example: 'true' },
            other_person_name: { type: 'string', nullable: true, description: 'Required when is_for_other=true' },
            relationship: { type: 'string', nullable: true, example: 'Parents' },
            other_person_phone: { type: 'string', nullable: true },
            patient_location: { type: 'string', nullable: true },
            description: { type: 'string', example: 'Patient chest pain, breathing difficulty' },
            special_instructions: { type: 'string', nullable: true },
            verification_token: { type: 'string' },
          },
        },
        undefined
      ),
      responses: {
        201: {
          description: 'SOS dispatched',
          content: {
            'application/json': {
              schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/SOSPublic' } } }] },
              example: {
                success: true,
                message: 'Emergency SOS Dispatched Successfully',
                data: {
                  ticket_no: 'VCOM-SOS-000001',
                  category: 'Medical Emergency',
                  status: 'DISPATCHED',
                  priority: 'HIGH_CRITICAL',
                  requester: { phone: '9876543210', location: 'Bejai, Mangalore' },
                  patient: { is_for_other: true, name: 'Ramesh Kumar (Parents)', phone: '9876500000', exact_location: 'Flat 302' },
                  photo_url: 'https://res.cloudinary.com/.../photo.png',
                  special_instructions: 'Gate code 1234',
                  assigned_responder: {
                    unit_name: 'Apollo Medical Response Unit 1',
                    contact_no: '+91 8000000108',
                    vehicle_no: 'KA-19-EM-9921',
                    driver_name: 'Suresh Gowda',
                    estimated_eta: '10 mins',
                  },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        429: { description: 'Rate limited' },
      },
    },
  },

  '/sos/track/{ticket_no}': {
    get: {
      tags: ['SOS'],
      summary: 'Live track SOS by ticket_no',
      description: 'Public. Returns ticket status, history and assigned responder with ETA.',
      security: noSecurity,
      parameters: [{ name: 'ticket_no', in: 'path', required: true, schema: { type: 'string' }, example: 'VCOM-SOS-000001' }],
      responses: {
        200: ok('#/components/schemas/SOSPublic'),
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/sos/cancel/{ticket_no}': {
    post: {
      tags: ['SOS'],
      summary: 'Cancel SOS ticket',
      description: 'Login token (owner) OR `phone` in body matching the ticket. Only open/acknowledged/dispatched/in_progress.',
      security: [{}, { BearerAuth: [] }],
      parameters: [{ name: 'ticket_no', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: body({ type: 'object', properties: { phone: { type: 'string', description: 'Required when not logged in' } } }, { phone: '9876543210' }),
      responses: {
        200: ok('#/components/schemas/SOSPublic'),
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },

  '/sos/history': {
    get: {
      tags: ['SOS'],
      summary: 'SOS history (paginated)',
      description: 'Login token scopes to user; otherwise `phone` query param required.',
      security: [{}, { BearerAuth: [] }],
      parameters: [
        { name: 'phone', in: 'query', schema: { type: 'string' }, description: 'Required when not logged in' },
        { $ref: '#/components/parameters/page' },
        { $ref: '#/components/parameters/limit' },
      ],
      responses: {
        200: okPaginated('#/components/schemas/SOSHistoryItem'),
        400: { $ref: '#/components/responses/ValidationError' },
      },
    },
  },
};

module.exports = paths;
