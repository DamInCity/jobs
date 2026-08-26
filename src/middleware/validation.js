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

const SOURCE_TYPES = [
  'DIRECT', 'COMPANY_CAREER', 'RECRUITMENT_AGENCY', 'GOVERNMENT',
  'NGO', 'BOARD', 'API', 'PARTNER', 'USER_SUBMITTED',
];

const jobExtraFieldRules = [
  body('county')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 100 }).withMessage('County must not exceed 100 characters'),
  body('country_code')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 2 }).withMessage('country_code must be 2 letters'),
  body('source')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 100 }).withMessage('Source must not exceed 100 characters'),
  body('source_type')
    .optional({ values: 'falsy' })
    .isIn(SOURCE_TYPES).withMessage(`source_type must be one of: ${SOURCE_TYPES.join(', ')}`),
  body('source_url')
    .optional({ values: 'falsy' })
    .trim()
    .isURL().withMessage('source_url must be a valid URL'),
  body('application_url')
    .optional({ values: 'falsy' })
    .trim()
    .isURL().withMessage('application_url must be a valid URL'),
  body('verification_status')
    .optional({ values: 'falsy' })
    .isIn(['verified', 'aggregated', 'expired', 'rejected'])
    .withMessage('verification_status must be verified, aggregated, expired, or rejected'),
  body('is_aggregated')
    .optional()
    .isBoolean().withMessage('is_aggregated must be a boolean'),
  body('deadline')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('deadline must be a valid date'),
  body('job_source_id')
    .optional({ values: 'falsy' })
    .isUUID().withMessage('job_source_id must be a valid UUID'),
  body('featured_until')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('featured_until must be a valid date'),
  body('posted_date')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('posted_date must be a valid date'),
  body('meta_title')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 255 }).withMessage('meta_title must not exceed 255 characters'),
  body('meta_description')
    .optional({ values: 'null' })
    .trim(),
];

const adminUserFieldRules = [
  body('email_verified')
    .optional()
    .isBoolean().withMessage('email_verified must be a boolean'),
  body('avatar_url')
    .optional({ values: 'falsy' })
    .trim()
    .isURL().withMessage('avatar_url must be a valid URL'),
  body('preferred_locations')
    .optional()
    .isArray().withMessage('preferred_locations must be an array'),
  body('preferred_job_types')
    .optional()
    .isArray().withMessage('preferred_job_types must be an array'),
  body('preferred_categories')
    .optional()
    .isArray().withMessage('preferred_categories must be an array'),
  body('notify_channels')
    .optional()
    .isArray().withMessage('notify_channels must be an array'),
  body('whatsapp_number')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 32 }).withMessage('whatsapp_number must not exceed 32 characters'),
  body('telegram_username')
    .optional({ values: 'falsy' })
    .trim()
    .customSanitizer((v) => String(v || '').replace(/^@/, ''))
    .isLength({ min: 5, max: 64 }).withMessage('Telegram username must be 5–64 characters')
    .matches(/^[A-Za-z0-9_]+$/).withMessage('Telegram username may only contain letters, numbers, and underscores'),
  body('skills')
    .optional()
    .isArray().withMessage('skills must be an array'),
  body('profile_summary')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 1000 }).withMessage('profile_summary must not exceed 1000 characters'),
  body('profile_seniority')
    .optional({ values: 'null' })
    .trim()
    .isLength({ max: 50 }).withMessage('profile_seniority must not exceed 50 characters'),
  body('profile_keywords')
    .optional()
    .isArray().withMessage('profile_keywords must be an array'),
  body('profile_status')
    .optional()
    .isIn(['none', 'pending_confirm', 'confirmed']).withMessage('Invalid profile_status'),
];

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
    ...jobExtraFieldRules,
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
      .optional({ values: 'falsy' })
      .isUUID().withMessage('Category ID must be a valid UUID'),
    body('status')
      .optional()
      .isIn(['active', 'expired', 'draft']).withMessage('Status must be active, expired, or draft'),
    ...jobExtraFieldRules,
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
  forgotPassword: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    validate,
  ],
  resetPassword: [
    body('token')
      .trim()
      .notEmpty().withMessage('Reset token is required')
      .isLength({ min: 32, max: 128 }).withMessage('Invalid reset token'),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
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
  changeEmail: [
    body('email')
      .trim()
      .notEmpty().withMessage('New email is required')
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Current password is required'),
    validate,
  ],
};

// Admin user management
const adminUserValidation = {
  create: [
    body('email')
      .trim()
      .notEmpty().withMessage('Email is required')
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    body('password')
      .notEmpty().withMessage('Password is required')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('role')
      .optional()
      .isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    ...adminUserFieldRules,
    validate,
  ],
  update: [
    param('id').isUUID().withMessage('Invalid user ID'),
    body('email')
      .optional()
      .trim()
      .isEmail().withMessage('Must be a valid email address')
      .normalizeEmail(),
    body('password')
      .optional({ values: 'falsy' })
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name')
      .optional({ values: 'null' })
      .trim()
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('role')
      .optional()
      .isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    ...adminUserFieldRules,
    validate,
  ],
  idParam: [
    param('id').isUUID().withMessage('Invalid user ID'),
    validate,
  ],
  alertParam: [
    param('id').isUUID().withMessage('Invalid user ID'),
    param('alertId').isUUID().withMessage('Invalid alert ID'),
    validate,
  ],
  alertUpdate: [
    param('id').isUUID().withMessage('Invalid user ID'),
    param('alertId').isUUID().withMessage('Invalid alert ID'),
    body('is_active')
      .optional()
      .isBoolean().withMessage('is_active must be a boolean'),
    body('frequency')
      .optional()
      .isIn(['daily', 'weekly']).withMessage('Frequency must be daily or weekly'),
    body('name')
      .optional({ values: 'null' })
      .trim()
      .isLength({ max: 255 }).withMessage('Name must not exceed 255 characters'),
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
      .custom((value) => {
        const parts = String(value).split(',').map((t) => t.trim()).filter(Boolean);
        return parts.every((t) => ['remote', 'hybrid', 'onsite'].includes(t));
      }).withMessage('Invalid job type'),
    query('category')
      .optional()
      .isString()
      .isLength({ min: 1, max: 120 }).withMessage('Invalid category'),
    query('county')
      .optional()
      .isString()
      .isLength({ min: 2, max: 100 }).withMessage('Invalid county'),
    query('country_code')
      .optional()
      .isString()
      .isLength({ min: 2, max: 2 }).withMessage('country_code must be 2 letters'),
    query('source_type')
      .optional()
      .isString()
      .isLength({ min: 2, max: 40 }).withMessage('Invalid source_type'),
    query('kenya_only')
      .optional()
      .isIn(['true', 'false', '1', '0']).withMessage('kenya_only must be boolean-like'),
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
  adminUserValidation,
  categoryValidation,
  searchValidation,
  SOURCE_TYPES,
};
