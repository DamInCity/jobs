const express = require('express');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const db = require('../db');
const { authenticate, requireAdmin, generateToken } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { jobValidation, categoryValidation, adminUserValidation } = require('../middleware/validation');
const config = require('../config');

const router = express.Router();

// ============================================
// AUTHENTICATION
// ============================================

// Admin login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const result = await db.query(
    'SELECT id, email, password_hash, name, role FROM users WHERE email = $1 AND role = $2',
    [email.toLowerCase(), 'admin']
  );

  if (result.rows.length === 0) {
    throw new AppError('Invalid credentials', 401);
  }

  const user = result.rows[0];
  const isValidPassword = await bcrypt.compare(password, user.password_hash);

  if (!isValidPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  // Update last login
  await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

  const token = generateToken(user);

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
}));

// Get current admin user
router.get('/me', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
}));

// Change the signed-in administrator's password. No default or demo password is accepted.
router.post('/change-password', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    throw new AppError('Current password and new password are required', 400);
  }
  if (newPassword.length < 8 || newPassword.length > 200) {
    throw new AppError('New password must be between 8 and 200 characters', 400);
  }
  const result = await db.query('SELECT password_hash FROM users WHERE id = $1 AND role = $2', [req.user.id, 'admin']);
  if (result.rows.length === 0 || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
    throw new AppError('Current password is incorrect', 400);
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, req.user.id]);
  res.json({ success: true, message: 'Password updated successfully' });
}));

// ============================================
// DASHBOARD STATS
// ============================================

router.get('/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [
    totalJobs,
    activeJobs,
    expiredJobs,
    featuredJobs,
    totalUsers,
    totalViews,
    totalClicks,
    recentJobs,
    topViewedJobs,
    topClickedJobs,
    categoryStats,
  ] = await Promise.all([
    db.query('SELECT COUNT(*) FROM jobs'),
    db.query("SELECT COUNT(*) FROM jobs WHERE status = 'active'"),
    db.query("SELECT COUNT(*) FROM jobs WHERE status = 'expired'"),
    db.query('SELECT COUNT(*) FROM jobs WHERE is_featured = true'),
    db.query("SELECT COUNT(*) FROM users WHERE role = 'user'"),
    db.query('SELECT COALESCE(SUM(view_count), 0) as total FROM jobs'),
    db.query('SELECT COALESCE(SUM(click_count), 0) as total FROM jobs'),
    db.query(`
      SELECT id, title, company_name, status, is_featured, created_at 
      FROM jobs ORDER BY created_at DESC LIMIT 5
    `),
    db.query(`
      SELECT id, title, company_name, view_count 
      FROM jobs WHERE status = 'active' 
      ORDER BY view_count DESC LIMIT 5
    `),
    db.query(`
      SELECT id, title, company_name, click_count 
      FROM jobs WHERE status = 'active' 
      ORDER BY click_count DESC LIMIT 5
    `),
    db.query(`
      SELECT c.name, c.slug, COUNT(j.id) as job_count 
      FROM categories c 
      LEFT JOIN jobs j ON c.id = j.category_id AND j.status = 'active'
      GROUP BY c.id, c.name, c.slug
      ORDER BY job_count DESC
    `),
  ]);

  res.json({
    success: true,
    data: {
      overview: {
        totalJobs: parseInt(totalJobs.rows[0].count),
        activeJobs: parseInt(activeJobs.rows[0].count),
        expiredJobs: parseInt(expiredJobs.rows[0].count),
        featuredJobs: parseInt(featuredJobs.rows[0].count),
        totalUsers: parseInt(totalUsers.rows[0].count),
        totalViews: parseInt(totalViews.rows[0].total),
        totalClicks: parseInt(totalClicks.rows[0].total),
      },
      recentJobs: recentJobs.rows,
      topViewedJobs: topViewedJobs.rows,
      topClickedJobs: topClickedJobs.rows,
      categoryStats: categoryStats.rows,
    },
  });
}));

// ============================================
// JOBS MANAGEMENT
// ============================================

// List all jobs (admin view)
router.get('/jobs', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 20, status, category, search,
    source_type, verification_status, county,
    sort = 'created_at', order = 'desc',
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let whereConditions = [];
  let params = [];
  let paramIndex = 1;

  if (status) {
    whereConditions.push(`j.status = $${paramIndex++}`);
    params.push(status);
  }

  if (category) {
    whereConditions.push(`j.category_id = $${paramIndex++}`);
    params.push(category);
  }

  if (source_type) {
    whereConditions.push(`UPPER(j.source_type) = UPPER($${paramIndex++})`);
    params.push(source_type);
  }

  if (verification_status) {
    whereConditions.push(`j.verification_status = $${paramIndex++}`);
    params.push(verification_status);
  }

  if (county) {
    whereConditions.push(`j.county ILIKE $${paramIndex++}`);
    params.push(county);
  }

  if (search) {
    whereConditions.push(`(j.title ILIKE $${paramIndex} OR j.company_name ILIKE $${paramIndex} OR j.location ILIKE $${paramIndex})`);
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
  const allowedSorts = ['created_at', 'title', 'company_name', 'view_count', 'click_count', 'posted_date'];
  const sortField = allowedSorts.includes(sort) ? sort : 'created_at';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const [jobsResult, countResult] = await Promise.all([
    db.query(`
      SELECT j.*, c.name as category_name, c.slug as category_slug
      FROM jobs j
      LEFT JOIN categories c ON j.category_id = c.id
      ${whereClause}
      ORDER BY j.${sortField} ${sortOrder}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, parseInt(limit), offset]),
    db.query(`SELECT COUNT(*) FROM jobs j ${whereClause}`, params),
  ]);

  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / parseInt(limit));

  res.json({
    success: true,
    data: {
      jobs: jobsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1,
      },
    },
  });
}));

// Get single job
router.get('/jobs/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await db.query(`
    SELECT j.*, c.name as category_name, c.slug as category_slug
    FROM jobs j
    LEFT JOIN categories c ON j.category_id = c.id
    WHERE j.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  res.json({
    success: true,
    data: result.rows[0],
  });
}));

// Create job
router.post('/jobs', authenticate, requireAdmin, jobValidation.create, asyncHandler(async (req, res) => {
  const b = req.body;
  const slug = slugify(`${b.title}-${b.company_name}-${Date.now()}`, { lower: true, strict: true }).slice(0, 300);
  const expiryDateValue = b.expiry_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const result = await db.query(`
    INSERT INTO jobs (
      title, slug, company_name, company_logo_url, company_website, description, requirements, benefits,
      location, county, country_code, job_type, category_id,
      salary_min, salary_max, salary_currency, salary_period,
      external_link, application_url, source_url, source, source_type,
      verification_status, is_aggregated, job_source_id, deadline,
      posted_date, expiry_date, featured_until, is_featured,
      meta_title, meta_description, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26,
      $27, $28, $29, $30,
      $31, $32, $33
    )
    RETURNING *
  `, [
    b.title, slug, b.company_name, emptyToNull(b.company_logo_url), emptyToNull(b.company_website),
    b.description, emptyToNull(b.requirements), emptyToNull(b.benefits),
    b.location, emptyToNull(b.county), (b.country_code || 'KE').toUpperCase().slice(0, 2),
    b.job_type, emptyToNull(b.category_id),
    b.salary_min || null, b.salary_max || null, b.salary_currency || 'KES', b.salary_period || 'monthly',
    b.external_link, emptyToNull(b.application_url), emptyToNull(b.source_url),
    emptyToNull(b.source) || 'manual', b.source_type || 'DIRECT',
    b.verification_status || 'verified', b.is_aggregated === true,
    emptyToNull(b.job_source_id), emptyToNull(b.deadline),
    emptyToNull(b.posted_date) || new Date(), expiryDateValue, emptyToNull(b.featured_until),
    b.is_featured === true,
    emptyToNull(b.meta_title), emptyToNull(b.meta_description), b.status || 'active',
  ]);

  res.status(201).json({
    success: true,
    message: 'Job created successfully',
    data: result.rows[0],
  });
}));

// Update job
router.put('/jobs/:id', authenticate, requireAdmin, jobValidation.update, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Check job exists
  const existingJob = await db.query('SELECT id, title, company_name FROM jobs WHERE id = $1', [id]);
  if (existingJob.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  // Build update query dynamically
  const allowedFields = [
    'title', 'company_name', 'company_logo_url', 'company_website', 'description', 'requirements', 'benefits',
    'location', 'county', 'country_code', 'job_type', 'category_id',
    'salary_min', 'salary_max', 'salary_currency', 'salary_period',
    'external_link', 'application_url', 'source_url', 'source', 'source_type',
    'verification_status', 'is_aggregated', 'job_source_id', 'deadline',
    'posted_date', 'expiry_date', 'featured_until', 'is_featured',
    'meta_title', 'meta_description', 'status',
  ];

  const nullableFields = new Set([
    'company_logo_url', 'company_website', 'requirements', 'benefits', 'county',
    'category_id', 'salary_min', 'salary_max', 'application_url', 'source_url',
    'job_source_id', 'deadline', 'featured_until', 'meta_title', 'meta_description',
  ]);

  const updateFields = [];
  const params = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      let value = updates[field];
      if (nullableFields.has(field)) value = emptyToNull(value);
      if (field === 'country_code' && value) value = String(value).toUpperCase().slice(0, 2);
      updateFields.push(`${field} = $${paramIndex++}`);
      params.push(value);
    }
  }

  // Update slug if title or company changed
  if (updates.title || updates.company_name) {
    const newTitle = updates.title || existingJob.rows[0].title;
    const newCompany = updates.company_name || existingJob.rows[0].company_name;
    updateFields.push(`slug = $${paramIndex++}`);
    params.push(slugify(`${newTitle}-${newCompany}-${Date.now()}`, { lower: true, strict: true }));
  }

  if (updateFields.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  params.push(id);

  const result = await db.query(`
    UPDATE jobs SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *
  `, params);

  res.json({
    success: true,
    message: 'Job updated successfully',
    data: result.rows[0],
  });
}));

// Delete job
router.delete('/jobs/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await db.query('DELETE FROM jobs WHERE id = $1 RETURNING id, title', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  res.json({
    success: true,
    message: 'Job deleted successfully',
    data: result.rows[0],
  });
}));

// Bulk actions
router.post('/jobs/bulk', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { action, jobIds } = req.body;

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw new AppError('Job IDs array is required', 400);
  }

  let result;
  switch (action) {
    case 'activate':
      result = await db.query(
        "UPDATE jobs SET status = 'active' WHERE id = ANY($1) RETURNING id",
        [jobIds]
      );
      break;
    case 'deactivate':
      result = await db.query(
        "UPDATE jobs SET status = 'expired' WHERE id = ANY($1) RETURNING id",
        [jobIds]
      );
      break;
    case 'feature':
      result = await db.query(
        'UPDATE jobs SET is_featured = true WHERE id = ANY($1) RETURNING id',
        [jobIds]
      );
      break;
    case 'unfeature':
      result = await db.query(
        'UPDATE jobs SET is_featured = false WHERE id = ANY($1) RETURNING id',
        [jobIds]
      );
      break;
    case 'delete':
      result = await db.query(
        'DELETE FROM jobs WHERE id = ANY($1) RETURNING id',
        [jobIds]
      );
      break;
    default:
      throw new AppError('Invalid action. Use: activate, deactivate, feature, unfeature, or delete', 400);
  }

  res.json({
    success: true,
    message: `${action} action completed on ${result.rowCount} jobs`,
    data: { affected: result.rowCount },
  });
}));

// ============================================
// CATEGORIES MANAGEMENT
// ============================================

// List categories
router.get('/categories', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT c.*, 
      (SELECT COUNT(*) FROM jobs j WHERE j.category_id = c.id) as job_count
    FROM categories c
    ORDER BY c.name
  `);

  res.json({
    success: true,
    data: result.rows,
  });
}));

// Create category
router.post('/categories', authenticate, requireAdmin, categoryValidation.create, asyncHandler(async (req, res) => {
  const { name, icon, description } = req.body;
  const slug = slugify(name, { lower: true, strict: true });

  const result = await db.query(`
    INSERT INTO categories (name, slug, icon, description)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [name, slug, icon, description]);

  res.status(201).json({
    success: true,
    message: 'Category created successfully',
    data: result.rows[0],
  });
}));

// Update category
router.put('/categories/:id', authenticate, requireAdmin, categoryValidation.update, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, icon, description } = req.body;

  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (name) {
    updates.push(`name = $${paramIndex++}`, `slug = $${paramIndex++}`);
    params.push(name, slugify(name, { lower: true, strict: true }));
  }
  if (icon !== undefined) {
    updates.push(`icon = $${paramIndex++}`);
    params.push(icon);
  }
  if (description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(description);
  }

  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  params.push(id);

  const result = await db.query(`
    UPDATE categories SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *
  `, params);

  if (result.rows.length === 0) {
    throw new AppError('Category not found', 404);
  }

  res.json({
    success: true,
    message: 'Category updated successfully',
    data: result.rows[0],
  });
}));

// Delete category
router.delete('/categories/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if category has jobs
  const jobCount = await db.query('SELECT COUNT(*) FROM jobs WHERE category_id = $1', [id]);
  if (parseInt(jobCount.rows[0].count) > 0) {
    throw new AppError('Cannot delete category with associated jobs. Reassign jobs first.', 400);
  }

  const result = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id, name', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Category not found', 404);
  }

  res.json({
    success: true,
    message: 'Category deleted successfully',
    data: result.rows[0],
  });
}));

// ============================================
// USERS MANAGEMENT (Admin view)
// ============================================

const USER_SAFE_COLUMNS = `
  id, email, name, role, avatar_url, email_verified,
  preferred_locations, preferred_job_types, preferred_categories,
  telegram_chat_id, telegram_username, whatsapp_number, notify_channels,
  cv_original_name, cv_uploaded_at,
  skills, profile_summary, profile_seniority, profile_keywords,
  profile_status, profiled_at,
  (cv_path IS NOT NULL) AS has_cv,
  (telegram_chat_id IS NOT NULL) AS telegram_linked,
  last_login, created_at, updated_at
`;

router.get('/users', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 20, q, role, profile_status, telegram, has_cv,
  } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const where = [];
  const params = [];
  let i = 1;

  if (q) {
    where.push(`(u.email ILIKE $${i} OR u.name ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }
  if (role === 'admin' || role === 'user') {
    where.push(`u.role = $${i++}`);
    params.push(role);
  }
  if (profile_status) {
    where.push(`COALESCE(u.profile_status, 'none') = $${i++}`);
    params.push(profile_status);
  }
  if (telegram === 'linked') {
    where.push('u.telegram_chat_id IS NOT NULL');
  } else if (telegram === 'unlinked') {
    where.push('u.telegram_chat_id IS NULL');
  }
  if (has_cv === 'true' || has_cv === '1') {
    where.push('u.cv_path IS NOT NULL');
  } else if (has_cv === 'false' || has_cv === '0') {
    where.push('u.cv_path IS NULL');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [usersResult, countResult] = await Promise.all([
    db.query(`
      SELECT ${USER_SAFE_COLUMNS},
        (SELECT COUNT(*)::int FROM saved_jobs sj WHERE sj.user_id = u.id) AS saved_jobs_count,
        (SELECT COUNT(*)::int FROM job_alerts ja WHERE ja.user_id = u.id) AS alerts_count
      FROM users u
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `, [...params, limitNum, offset]),
    db.query(`SELECT COUNT(*) FROM users u ${whereClause}`, params),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const totalPages = Math.max(1, Math.ceil(total / limitNum));

  res.json({
    success: true,
    data: {
      users: usersResult.rows.map(formatAdminUser),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    },
  });
}));

router.get('/users/:id', authenticate, requireAdmin, adminUserValidation.idParam, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(`
    SELECT ${USER_SAFE_COLUMNS},
      (SELECT COUNT(*)::int FROM saved_jobs sj WHERE sj.user_id = u.id) AS saved_jobs_count,
      (SELECT COUNT(*)::int FROM job_alerts ja WHERE ja.user_id = u.id) AS alerts_count
    FROM users u
    WHERE u.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const user = formatAdminUser(result.rows[0]);
  const categoryNames = await resolveCategoryNames(user.preferred_categories);
  const alerts = await db.query(`
    SELECT id, name, search_criteria, frequency, is_active, last_sent_at, created_at
    FROM job_alerts
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [id]);

  res.json({
    success: true,
    data: {
      ...user,
      category_names: categoryNames,
      alerts: alerts.rows,
    },
  });
}));

router.post('/users', authenticate, requireAdmin, adminUserValidation.create, asyncHandler(async (req, res) => {
  const body = req.body;
  const email = String(body.email).toLowerCase();

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new AppError('Email already registered', 409);
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const fields = await buildUserFieldValues(body, { creating: true });

  const columns = ['email', 'password_hash', ...fields.columns];
  const values = [email, passwordHash, ...fields.values];
  const placeholders = columns.map((col, idx) => typedPlaceholder(col, idx + 1));

  const result = await db.query(`
    INSERT INTO users (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING ${USER_SAFE_COLUMNS.replace(/\bu\./g, '')}
  `, values);

  res.status(201).json({
    success: true,
    message: 'User created successfully',
    data: formatAdminUser(result.rows[0]),
  });
}));

router.put('/users/:id', authenticate, requireAdmin, adminUserValidation.update, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const existing = await db.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  if (req.body.role !== undefined && req.body.role !== existing.rows[0].role) {
    await assertAdminRoleChange(id, req.body.role, req.user.id, { deleting: false });
  }

  if (req.body.email) {
    const newEmail = String(req.body.email).toLowerCase();
    const taken = await db.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [newEmail, id]);
    if (taken.rows.length > 0) {
      throw new AppError('Email already registered', 409);
    }
  }

  const fields = await buildUserFieldValues(req.body, { creating: false });
  if (req.body.email !== undefined) {
    fields.columns.push('email');
    fields.values.push(String(req.body.email).toLowerCase());
  }
  if (req.body.password) {
    fields.columns.push('password_hash');
    fields.values.push(await bcrypt.hash(req.body.password, 12));
  }

  if (fields.columns.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  const sets = fields.columns.map((col, idx) => `${col} = ${typedPlaceholder(col, idx + 1)}`);
  fields.values.push(id);

  const result = await db.query(`
    UPDATE users SET ${sets.join(', ')}
    WHERE id = $${fields.values.length}
    RETURNING ${USER_SAFE_COLUMNS.replace(/\bu\./g, '')}
  `, fields.values);

  res.json({
    success: true,
    message: 'User updated successfully',
    data: formatAdminUser(result.rows[0]),
  });
}));

router.delete('/users/:id', authenticate, requireAdmin, adminUserValidation.idParam, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    throw new AppError('You cannot delete your own account', 400);
  }

  const existing = await db.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (existing.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  await assertAdminRoleChange(id, 'user', req.user.id, { deleting: true });

  const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id, email', [id]);
  res.json({
    success: true,
    message: 'User deleted successfully',
    data: result.rows[0],
  });
}));

router.post('/users/:id/unlink-telegram', authenticate, requireAdmin, adminUserValidation.idParam, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await db.query(`
    UPDATE users
    SET telegram_chat_id = NULL,
        telegram_link_token = NULL,
        telegram_link_expires = NULL,
        notify_channels = array_remove(COALESCE(notify_channels, ARRAY['email']::TEXT[]), 'telegram')
    WHERE id = $1
    RETURNING ${USER_SAFE_COLUMNS.replace(/\bu\./g, '')}
  `, [id]);

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  res.json({
    success: true,
    message: 'Telegram unlinked',
    data: formatAdminUser(result.rows[0]),
  });
}));

router.put('/users/:id/alerts/:alertId', authenticate, requireAdmin, adminUserValidation.alertUpdate, asyncHandler(async (req, res) => {
  const { id, alertId } = req.params;
  const { is_active, frequency, name } = req.body;

  const updates = [];
  const params = [];
  let i = 1;

  if (is_active !== undefined) {
    updates.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  if (frequency !== undefined) {
    updates.push(`frequency = $${i++}`);
    params.push(frequency);
  }
  if (name !== undefined) {
    updates.push(`name = $${i++}`);
    params.push(name || null);
  }

  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  params.push(alertId, id);
  const result = await db.query(`
    UPDATE job_alerts SET ${updates.join(', ')}
    WHERE id = $${i++} AND user_id = $${i}
    RETURNING id, name, search_criteria, frequency, is_active, last_sent_at, created_at
  `, params);

  if (result.rows.length === 0) {
    throw new AppError('Job alert not found', 404);
  }

  res.json({
    success: true,
    message: 'Alert updated',
    data: result.rows[0],
  });
}));

router.delete('/users/:id/alerts/:alertId', authenticate, requireAdmin, adminUserValidation.alertParam, asyncHandler(async (req, res) => {
  const { id, alertId } = req.params;
  const result = await db.query(
    'DELETE FROM job_alerts WHERE id = $1 AND user_id = $2 RETURNING id',
    [alertId, id]
  );
  if (result.rows.length === 0) {
    throw new AppError('Job alert not found', 404);
  }
  res.json({
    success: true,
    message: 'Alert deleted',
    data: result.rows[0],
  });
}));

// ============================================
// SCRAPER MANAGEMENT
// ============================================

// Get scraper logs
router.get('/scrapers/logs', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  
  const result = await db.query(`
    SELECT * FROM scraper_logs 
    ORDER BY created_at DESC 
    LIMIT $1
  `, [parseInt(limit)]);

  res.json({
    success: true,
    data: result.rows,
  });
}));

// Get scraper stats
router.get('/scrapers/stats', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [totalBySource, recentJobs, dailyStats] = await Promise.all([
    db.query(`
      SELECT source, COUNT(*) as count 
      FROM jobs 
      GROUP BY source 
      ORDER BY count DESC
    `),
    db.query(`
      SELECT source, COUNT(*) as count 
      FROM jobs 
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY source
    `),
    db.query(`
      SELECT 
        DATE(created_at) as date,
        source,
        COUNT(*) as count
      FROM scraper_logs
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at), source
      ORDER BY date DESC
    `),
  ]);

  res.json({
    success: true,
    data: {
      totalBySource: totalBySource.rows,
      last24Hours: recentJobs.rows,
      dailyStats: dailyStats.rows,
    },
  });
}));

// Trigger scraper manually (spawns as background process)
router.post('/scrapers/run', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { scraper = 'all', maxJobs = 20, dryRun = false } = req.body;
  
  // Use spawn to run scraper in background
  const { spawn } = require('child_process');
  const args = [];
  
  if (dryRun) args.push('--dry-run');
  args.push(`--max-jobs=${maxJobs}`);
  
  const scraperProcess = spawn('node', ['src/scrapers/scheduler.js', ...args], {
    detached: true,
    stdio: 'ignore',
  });
  
  scraperProcess.unref();

  res.json({
    success: true,
    message: `Scraper started in background (PID: ${scraperProcess.pid})`,
    data: {
      pid: scraperProcess.pid,
      scraper,
      maxJobs,
      dryRun,
    },
  });
}));

// ============================================
// HELPERS
// ============================================

function parsePgArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (!s) return [];
  if (s.startsWith('{') && s.endsWith('}')) {
    return s
      .slice(1, -1)
      .split(',')
      .map((part) => part.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return [s];
}

function formatAdminUser(row) {
  if (!row) return row;
  return {
    ...row,
    preferred_locations: parsePgArray(row.preferred_locations),
    preferred_job_types: parsePgArray(row.preferred_job_types),
    preferred_categories: parsePgArray(row.preferred_categories),
    notify_channels: parsePgArray(row.notify_channels).length
      ? parsePgArray(row.notify_channels)
      : ['email'],
    skills: parsePgArray(row.skills),
    profile_keywords: parsePgArray(row.profile_keywords),
  };
}

function typedPlaceholder(column, index) {
  if (column === 'preferred_job_types') return `$${index}::job_type[]`;
  if (column === 'preferred_categories') return `$${index}::uuid[]`;
  return `$${index}`;
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

async function resolveCategoryNames(categoryIds) {
  const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
  if (!ids.length) return [];
  try {
    const result = await db.query(
      'SELECT id, name, slug FROM categories WHERE id = ANY($1::uuid[])',
      [ids]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function assertAdminRoleChange(userId, newRole, _actingUserId, { deleting } = {}) {
  const target = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
  if (!target.rows.length) {
    throw new AppError('User not found', 404);
  }
  const currentlyAdmin = target.rows[0].role === 'admin';
  const losingAdmin = deleting || newRole !== 'admin';
  if (!currentlyAdmin || !losingAdmin) return;

  const count = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
  if (count.rows[0].n <= 1) {
    throw new AppError(
      deleting ? 'Cannot delete the last remaining admin' : 'Cannot demote the last remaining admin',
      400
    );
  }
}

function cleanStringArray(value, { max = 40, lowercase = false } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    let s = String(raw || '').trim();
    if (!s) continue;
    if (lowercase) s = s.toLowerCase();
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

async function buildUserFieldValues(body, { creating }) {
  const columns = [];
  const values = [];
  const assign = (col, val) => {
    columns.push(col);
    values.push(val);
  };

  if (body.name !== undefined) assign('name', emptyToNull(body.name));
  if (body.role !== undefined) {
    assign('role', body.role === 'admin' ? 'admin' : 'user');
  } else if (creating) {
    assign('role', 'user');
  }
  if (body.email_verified !== undefined) assign('email_verified', Boolean(body.email_verified));
  if (body.avatar_url !== undefined) assign('avatar_url', emptyToNull(body.avatar_url));
  if (body.preferred_locations !== undefined) {
    assign('preferred_locations', cleanStringArray(body.preferred_locations, { max: 20 }));
  }
  if (body.preferred_job_types !== undefined) {
    const allowed = new Set(['remote', 'hybrid', 'onsite']);
    assign(
      'preferred_job_types',
      cleanStringArray(body.preferred_job_types).filter((t) => allowed.has(t))
    );
  }
  if (body.preferred_categories !== undefined) {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = (Array.isArray(body.preferred_categories) ? body.preferred_categories : [])
      .map(String)
      .filter((id) => uuidRe.test(id));
    assign('preferred_categories', ids);
  }
  if (body.notify_channels !== undefined) {
    const allowed = new Set(['email', 'telegram', 'whatsapp']);
    const cleaned = cleanStringArray(body.notify_channels, { lowercase: true })
      .filter((c) => allowed.has(c));
    if (cleaned.length === 0) {
      throw new AppError('At least one valid notify channel is required (email, telegram, whatsapp)', 400);
    }
    assign('notify_channels', cleaned);
  }
  if (body.whatsapp_number !== undefined) assign('whatsapp_number', emptyToNull(body.whatsapp_number));
  if (body.telegram_username !== undefined) {
    let tg = body.telegram_username ? String(body.telegram_username).trim().replace(/^@/, '') : null;
    if (tg === '') tg = null;
    assign('telegram_username', tg);
  }
  if (body.skills !== undefined) {
    const skills = cleanStringArray(body.skills, { max: 40 });
    assign('skills', skills.length ? skills : null);
  }
  if (body.profile_summary !== undefined) {
    assign('profile_summary', body.profile_summary ? String(body.profile_summary).slice(0, 1000) : null);
  }
  if (body.profile_seniority !== undefined) {
    assign('profile_seniority', emptyToNull(body.profile_seniority));
  }
  if (body.profile_keywords !== undefined) {
    const kws = cleanStringArray(body.profile_keywords, { max: 12 });
    assign('profile_keywords', kws.length ? kws : null);
  }
  if (body.profile_status !== undefined) assign('profile_status', body.profile_status || 'none');

  return { columns, values };
}

module.exports = router;
