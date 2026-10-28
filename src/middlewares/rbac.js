const ApiError = require('../utils/ApiError');

const hasPermission = (user, code) => {
  if (!user || !Array.isArray(user.permissions)) return false;
  return user.permissions.includes(code);
};

const requirePermission = (code) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!hasPermission(req.user, code)) {
    return next(ApiError.forbidden(`Missing permission: ${code}`));
  }
  next();
};

const requireAnyPermission = (...codes) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!codes.some((c) => hasPermission(req.user, c))) {
    return next(ApiError.forbidden(`Missing permission: ${codes.join(' or ')}`));
  }
  next();
};

const requireRole = (...slugs) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!slugs.includes(req.user.role_slug)) {
    return next(ApiError.forbidden('Access restricted to your role'));
  }
  next();
};

/**
 * True if user is super admin or has module.<code>.access permission.
 */
const canAccessModule = (user, moduleCode) => {
  if (!user) return false;
  if (hasPermission(user, 'modules.all')) return true;
  return hasPermission(user, `module.${moduleCode}.access`);
};

const requireModuleAccess = (getModuleCode = () => null) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (hasPermission(req.user, 'modules.all')) return next();
  const code = getModuleCode(req);
  if (!code || !canAccessModule(req.user, code)) {
    return next(ApiError.forbidden('You do not have access to this service module'));
  }
  next();
};

/** Returns SQL fragment + params to restrict requests by module access. */
function moduleFilterSql(user, alias = 'r') {
  if (!user || hasPermission(user, 'modules.all')) return { sql: '', params: [] };
  const codes = (user.permissions || [])
    .filter((p) => p.startsWith('module.') && p.endsWith('.access'))
    .map((p) => p.replace('module.', '').replace('.access', ''));
  if (!codes.length) return { sql: ` AND 1=0 `, params: [] };
  const placeholders = codes.map(() => '?').join(',');
  return {
    sql: ` AND ${alias}.module_id IN (SELECT id FROM service_modules WHERE code IN (${placeholders})) `,
    params: codes,
  };
}

module.exports = {
  hasPermission,
  requirePermission,
  requireAnyPermission,
  requireRole,
  canAccessModule,
  requireModuleAccess,
  moduleFilterSql,
};
