const app = require('./app');
const env = require('./config');
const pool = require('./config/db');

const server = app.listen(env.port, () => {
  console.log(`\n  ${env.appName} API listening on http://localhost:${env.port}`);
  console.log(`  Health: http://localhost:${env.port}/api/v1/health\n`);
});

pool.query('SELECT 1')
  .then(() => console.log('  MySQL connected.'))
  .catch((err) => console.error('  MySQL connection failed:', err.message));

const shutdown = () => {
  console.log('\nShutting down...');
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
