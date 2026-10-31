const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const env = require('./config');
const { notFound, errorHandler } = require('./middlewares/error');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.nodeEnv !== 'test') {
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/api/v1/auth', authLimiter);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/v1/health', (req, res) =>
  res.json({ success: true, message: `${env.appName} API is running`, data: { time: new Date().toISOString() } })
);

app.get('/api/v1', (req, res) =>
  res.json({
    success: true,
    message: `${env.appName} API v1`,
    data: {
      version: 'v1',
      status: 'online',
      health: '/api/v1/health',
      docs: 'server/docs/API.md',
      collections: {
        public: ['/api/v1/services', '/api/v1/properties'],
        auth: ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/forgot-password', '/api/v1/auth/reset-password'],
        me: '/api/v1/me',
        customer: '/api/v1/customer/*',
        vendor: '/api/v1/vendor/*',
        admin: '/api/v1/admin/* (dashboard, customers, vendors, requests, quotations, jobs, sos, services, properties, hr, notifications, reports, roles, staff, support, audit, settings)',
      },
    },
  })
);

app.use('/api/v1', require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
