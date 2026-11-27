const { components } = require('./components');

const paths = {
  ...require('./paths/core'),
  ...require('./paths/public'),
  ...require('./paths/sos'),
  ...require('./paths/legal'),
  ...require('./paths/hotel'),
  ...require('./paths/customer'),
  ...require('./paths/vendor'),
  ...require('./paths/technician'),
  ...require('./paths/admin'),
};

const tags = [
  { name: 'Health', description: 'Service health' },
  { name: 'Auth', description: 'Register / login / OTP / tokens' },
  { name: 'Me', description: 'Current user profile' },
  { name: 'Public', description: 'No auth — services, properties, banners, offers, events' },
  { name: 'SOS', description: 'Emergency SOS — categories, OTP, dispatch (photo), track, cancel, history' },
  { name: 'Legal', description: 'Legal & Advisory — categories, submit request, track, history' },
  { name: 'HotelBookings', description: 'Hotels, Resorts & Premium Stays — categories, search, rooms, reservations, voucher, reviews' },
  { name: 'Customer', description: 'Customer app (requests, addresses, HR, support, reviews)' },
  { name: 'Vendor', description: 'Vendor app (profile, technicians, quotations, jobs, bookings)' },
  { name: 'Technician', description: 'Field technician app (jobs, attendance, earnings, location)' },
  { name: 'Admin', description: 'Web admin — dashboard, requests, jobs, services, payouts, HR, reports, settings' },
];

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'V_COM API',
    version: 'v1',
    description:
      'V_COM service marketplace API — Professional Service (18 categories), Quick Service (7), Special Service (6).\n\n' +
      '**Auth:** Bearer JWT (accessToken, 15 min) + refreshToken (7 days). Admin login: POST /auth/login.\n\n' +
      '**Envelope:** `{ success, message, data }`. Paginated: `data.items` + `data.pagination` (events/payouts use `current_page/total_pages/...`).\n\n' +
      '**Rate limit:** /auth/* — 100 requests / 15 min.',
    contact: { name: 'V_COM', url: 'https://v-com-server.onrender.com' },
  },
  servers: [
    { url: 'https://v-com-server.onrender.com/api/v1', description: 'Production' },
    { url: 'http://localhost:8000/api/v1', description: 'Local' },
  ],
  tags,
  components,
  paths,
};

// Spec stats (for /docs.json meta + console)
const methodSet = ['get', 'post', 'put', 'patch', 'delete'];
let opCount = 0;
for (const p of Object.values(paths)) {
  for (const m of methodSet) if (p[m]) opCount++;
}

module.exports = { spec, opCount, pathCount: Object.keys(paths).length };
