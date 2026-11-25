const { ok, okPaginated, created, noContent, body, security, noSecurity } = require('../components');

const paths = {
  // ===================== HEALTH =====================
  '/health': {
    get: {
      tags: ['Health'],
      summary: 'Health check',
      security: noSecurity,
      responses: {
        200: {
          description: 'API is running',
          content: { 'application/json': { example: { success: true, message: 'V_COM API is running', data: { time: '2026-01-01T00:00:00.000Z' } } } },
        },
      },
    },
  },

  // ===================== AUTH =====================
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register new user',
      description: 'JSON body for customer self-register, or multipart with KYC docs (vendor/technician).',
      security: noSecurity,
      requestBody: body({
        type: 'object',
        required: ['name', 'phone', 'password'],
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password' },
          client: { type: 'string', enum: ["customer", "vendor", "technician"], default: 'customer' },
          role: { type: 'string', nullable: true, description: 'Role slug (staff registration)' },
          verifyToken: { type: 'string', nullable: true, description: 'From OTP verify (new user flow)' },
        },
      }, { name: 'Rahim', phone: '01700000000', password: 'secret123', client: 'customer' }),
      responses: {
        201: created('#/components/schemas/User'),
        400: { $ref: '#/components/responses/ValidationError' },
        409: { $ref: '#/components/responses/Conflict' },
        429: { description: 'Rate limited (20/hour)' },
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Email + password login (admin web)',
      security: noSecurity,
      requestBody: body({
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } },
      }, { email: 'admin@vcom.com', password: 'Admin@123' }),
      responses: {
        200: { description: 'Tokens issued', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/AuthTokens' } } }] } } } },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { description: 'Rate limited' },
      },
    },
  },
  '/auth/otp/send': {
    post: {
      tags: ['Auth'],
      summary: 'Send OTP to phone',
      security: noSecurity,
      requestBody: body({ type: 'object', required: ['phone'], properties: { phone: { type: 'string' } } }, { phone: '01700000000' }),
      responses: { 200: noContent('OTP sent'), 429: { description: 'Rate limited' } },
    },
  },
  '/auth/otp/verify': {
    post: {
      tags: ['Auth'],
      summary: 'Verify OTP',
      description: 'Existing user → returns tokens. New user → returns verifyToken for /auth/register.',
      security: noSecurity,
      requestBody: body({ type: 'object', required: ['phone', 'otp'], properties: { phone: { type: 'string' }, otp: { type: 'string' } } }, { phone: '01700000000', otp: '123456' }),
      responses: { 200: { description: 'Tokens or verifyToken', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } }, 400: { $ref: '#/components/responses/ValidationError' } },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Refresh access token',
      security: noSecurity,
      requestBody: body({ type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } }),
      responses: { 200: { description: 'New tokens', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/SuccessEnvelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/AuthTokens' } } }] } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Logout (invalidate refresh token)',
      security: security(),
      responses: { 200: noContent('Logged out'), 401: { $ref: '#/components/responses/Unauthorized' } },
    },
  },
  '/auth/forgot-password': {
    post: {
      tags: ['Auth'],
      summary: 'Request password reset email',
      security: noSecurity,
      requestBody: body({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } }),
      responses: { 200: noContent('If the email exists, a reset link was sent') },
    },
  },
  '/auth/reset-password': {
    post: {
      tags: ['Auth'],
      summary: 'Complete password reset',
      security: noSecurity,
      requestBody: body({ type: 'object', required: ['token', 'password'], properties: { token: { type: 'string' }, password: { type: 'string', format: 'password' } } }),
      responses: { 200: noContent('Password updated'), 400: { $ref: '#/components/responses/ValidationError' } },
    },
  },
  '/auth/change-password': {
    post: {
      tags: ['Auth'],
      summary: 'Change password (logged in)',
      security: security(),
      requestBody: body({ type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password' } } }),
      responses: { 200: noContent('Password changed'), 401: { $ref: '#/components/responses/Unauthorized' } },
    },
  },

  // ===================== ME =====================
  '/me': {
    get: {
      tags: ['Me'],
      summary: 'Get current user profile',
      security: security(),
      responses: { 200: ok('#/components/schemas/User'), 401: { $ref: '#/components/responses/Unauthorized' } },
    },
    put: {
      tags: ['Me'],
      summary: 'Update current user profile',
      security: security(),
      requestBody: body({ type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, avatar: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/User'), 400: { $ref: '#/components/responses/ValidationError' } },
    },
  },
};

module.exports = paths;
