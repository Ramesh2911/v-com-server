const router = require('express').Router();
const swaggerUi = require('swagger-ui-express');
const { spec, opCount, pathCount } = require('../../docs/openapi');

// OpenAPI JSON (machine-readable)
router.get('/docs.json', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(spec);
});

// Docs meta — must be registered BEFORE swaggerUi.serve (which swallows /docs/*)
router.get('/docs/index.json', (req, res) => {
  res.json({
    success: true,
    message: 'V_COM API docs',
    data: {
      ui: '/api/v1/docs',
      openapi: '/api/v1/docs.json',
      paths: pathCount,
      operations: opCount,
      markdown: 'server/docs/API.md',
    },
  });
});

// Swagger UI (static assets + HTML)
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    customSiteTitle: 'V_COM API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      deepLinking: true,
      docExpansion: 'none',
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
    },
  })
);

module.exports = router;
