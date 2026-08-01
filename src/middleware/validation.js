const { body, query, param, validationResult } = require('express-validator');
const { AppError } = require('./errorHandler');

// Validation result handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
    }));
    throw new AppError('Validation failed', 400, formattedErrors);
  }
  next();
};

// Job validation rules
const jobValidation = {
  create: [
    body('title')
      .trim()
      .notEmpty().withMessage('Job title is required')
      .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),
    body('company_name')
      .trim()
      .notEmpty().withMessage('Company name is required')
      .isLength({ max: 255 }).withMessage('Company name must not exceed 255 characters'),
    body('description')
      .trim()
      .notEmpty().withMessage('Job description is required'),
    body('location')
      .trim()
      .notEmpty().withMessage('Location is required')
      .isLength({ max: 255 }).withMessage('Location must not exceed 255 characters'),
    body('job_type')
      .isIn(['remote', 'hybrid', 'onsite']).withMessage('Job type must be remote, hybrid, or onsite'),
    body('external_link')
      .trim()
      .notEmpty().withMessage('External application link is required')
      .isURL().withMessage('External link must be a valid URL'),
    body('category_id')
      .optional()
      .isUUID().withMessage('Category ID must be a valid UUID'),
    body('salary_min')
      .optional()
      .isInt({ min: 0 }).withMessage('Minimum salary must be a positive number'),
    body('salary_max')
      .optional()
      .isInt({ min: 0 }).withMessage('Maximum salary must be a positive number'),
    body('expiry_date')
      .optional()
      .isISO8601().withMessage('Expiry date must be a valid date'),
    body('is_featured')
      .optional()
      .isBoolean().withMessage('is_featured must be a boolean'),
    validate,
  ],
  update: [
    param('id').isUUID().withMessage('Invalid job ID'),
    body('title')
      .optional()
      .trim()
      .isLength({ min: 3, max: 255 }).withMessage('Title must be between 3 and 255 characters'),
    body('company_name')
      .optional()
      .trim()
      .isLength({ max: 255 }).withMessage('Company name must not exceed 255 characters'),
    body('job_type')
      .optional()
      .isIn(['remote', 'hybrid', 'onsite']).withMessage('Job type must be remote, hybrid, or onsite'),
    body('external_link')
      .optional()
      .trim()
      .isURL().withMessage('External link must be a valid URL'),
    body('category_id')
      .optional()
      .isUUID().withMessage('Category ID must be a valid UUID'),
    body('status')
      .optional()
      .isIn(['active', 'expired', 'draft']).withMessage('Status must be active, expired, or draft'),
    validate,
  ],
};

// User validation rules
const userValidation = {
  register: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('telegram_username')
      .optional({ values: 'falsy' })
      .trim()
      .customSanitizer((v) => String(v || '').replace(/^@/, ''))
      .isLength({ min: 5, max: 64 }).withMessage('Telegram username must be 5–64 characters')
      .matches(/^[A-Za-z0-9_]+$/).withMessage('Telegram username may only contain letters, numbers, and underscores'),
    validate,
  ],
  login: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required'),
    validate,
  ],
  updateProfile: [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('preferred_locations')
      .optional()
      .isArray().withMessage('Preferred locations must be an array'),
    body('preferred_job_types')
      .optional()
      .isArray().withMessage('Preferred job types must be an array'),
    validate,
  ],
};

// Category validation rules
const categoryValidation = {
  create: [
    body('name')
      .trim()
      .notEmpty().withMessage('Category name is required')
      .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    body('icon')
      .optional()
      .trim()
      .isLength({ max: 50 }).withMessage('Icon must not exceed 50 characters'),
    body('description')
      .optional()
      .trim(),
    validate,
  ],
  update: [
    param('id').isUUID().withMessage('Invalid category ID'),
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    validate,
  ],
};

// Search/filter validation
const searchValidation = {
  jobs: [
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('job_type')
      .optional()
      .isIn(['remote', 'hybrid', 'onsite']).withMessage('Invalid job type'),
    query('category')
      .optional()
      .isUUID().withMessage('Category must be a valid UUID'),
    query('salary_min')
      .optional()
      .isInt({ min: 0 }).withMessage('Minimum salary must be a positive number'),
    query('salary_max')
      .optional()
      .isInt({ min: 0 }).withMessage('Maximum salary must be a positive number'),
    validate,
  ],
};

module.exports = {
  validate,
  jobValidation,
  userValidation,
  categoryValidation,
  searchValidation,
};
