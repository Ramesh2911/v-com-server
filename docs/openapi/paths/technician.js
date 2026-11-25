const { ok, okPaginated, noContent, body, security } = require('../components');

const paths = {
  '/technician/profile': {
    get: { tags: ['Technician'], summary: 'Technician profile', security: security(), responses: { 200: ok(null, { id: 1, name: 'Karim' }) } },
  },
  '/technician/status/duty': {
    put: {
      tags: ['Technician'], summary: 'Toggle on/off duty', security: security(),
      requestBody: body({ type: 'object', properties: { on_duty: { type: 'boolean' } } }),
      responses: { 200: ok(null, { on_duty: true }) },
    },
  },
  '/technician/skills': {
    get: { tags: ['Technician'], summary: 'My skills', security: security(), responses: { 200: ok(null, ['CCTV', 'Networking']) } },
  },
  '/technician/dashboard': {
    get: { tags: ['Technician'], summary: 'Technician dashboard', security: security(), responses: { 200: ok(null, { today_jobs: 3, active: 1, earnings: 2500 }) } },
  },
  '/technician/jobs': {
    get: {
      tags: ['Technician'], summary: 'Assigned jobs', security: security(),
      parameters: [{ name: 'stage', in: 'query', schema: { type: 'string' } }],
      responses: { 200: okPaginated('#/components/schemas/Job') },
    },
  },
  '/technician/jobs/{id}': {
    get: { tags: ['Technician'], summary: 'Job detail', security: security(), parameters: [{ $ref: '#/components/parameters/idPath' }], responses: { 200: ok('#/components/schemas/Job') } },
  },
  '/technician/jobs/{id}/status': {
    put: {
      tags: ['Technician'], summary: 'Update job stage', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['stage'], properties: { stage: { type: 'string' } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    },
  },
  '/technician/jobs/{id}/verify-otp': {
    post: {
      tags: ['Technician'], summary: 'Verify customer OTP at site', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', required: ['otp'], properties: { otp: { type: 'string' } } }),
      responses: { 200: ok(null, { verified: true }), 400: { $ref: '#/components/responses/ValidationError' } },
    },
  },
  '/technician/jobs/{id}/complete': {
    post: {
      tags: ['Technician'], summary: 'Mark job complete', security: security(),
      parameters: [{ $ref: '#/components/parameters/idPath' }],
      requestBody: body({ type: 'object', properties: { notes: { type: 'string' }, service_rating_request: { type: 'boolean' } } }),
      responses: { 200: ok('#/components/schemas/Job') },
    },
  },
  '/technician/attendance': {
    get: { tags: ['Technician'], summary: 'My attendance', security: security(), responses: { 200: okPaginated('#/components/schemas/Attendance') } },
    post: {
      tags: ['Technician'], summary: 'Clock in/out', security: security(),
      requestBody: body({ type: 'object', properties: { action: { type: 'string', enum: ["in", "out"] }, latitude: { type: 'number' }, longitude: { type: 'number' } } }),
      responses: { 200: ok('#/components/schemas/Attendance') },
    },
  },
  '/technician/location/update': {
    post: {
      tags: ['Technician'], summary: 'Update live location', security: security(),
      requestBody: body({ type: 'object', required: ['latitude', 'longitude'], properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, job_id: { type: 'integer' } } }),
      responses: { 200: noContent('Location updated') },
    },
  },
  '/technician/earnings': {
    get: { tags: ['Technician'], summary: 'Earnings summary', security: security(), responses: { 200: ok(null, { total: 45000, this_month: 8000 }) } },
  },
  '/technician/earnings/history': {
    get: { tags: ['Technician'], summary: 'Earnings history', security: security(), parameters: [{ $ref: '#/components/parameters/page' }], responses: { 200: okPaginated(null) } },
  },
  '/technician/safety-guidelines': {
    get: { tags: ['Technician'], summary: 'Safety guidelines content', security: security(), responses: { 200: ok(null, { text: '…' }) } },
  },
  '/technician/support/messages': {
    post: {
      tags: ['Technician'], summary: 'Send support message', security: security(),
      requestBody: body({ type: 'object', required: ['message'], properties: { message: { type: 'string' }, subject: { type: 'string' } } }),
      responses: { 201: ok(null, { sent: true }) },
    },
  },
};

module.exports = paths;
