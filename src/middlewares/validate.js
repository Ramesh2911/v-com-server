const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array().map((e) => ({
    field: e.path || e.param,
    message: e.msg,
  }));
  next(ApiError.badRequest('Validation failed', errors));
};

module.exports = validate;
