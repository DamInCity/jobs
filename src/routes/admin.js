const express = require('express');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const db = require('../db');
const { authenticate, requireAdmin, generateToken } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { jobValidation, categoryValidation } = require('../middleware/validation');
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
  const { page = 1, limit = 20, status, category, search, sort = 'created_at', order = 'desc' } = req.query;
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

  if (search) {
    whereConditions.push(`(j.title ILIKE $${paramIndex} OR j.company_name ILIKE $${paramIndex})`);
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
  const {
    title, company_name, company_logo_url, company_website, description, requirements, benefits,
    location, job_type, category_id, salary_min, salary_max, salary_currency, salary_period,
    external_link, expiry_date, is_featured, meta_title, meta_description, status = 'active'
  } = req.body;

  const slug = slugify(`${title}-${company_name}-${Date.now()}`, { lower: true, strict: true });
  
  // Set default expiry date to 30 days if not provided
  const expiryDateValue = expiry_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const result = await db.query(`
    INSERT INTO jobs (
      title, slug, company_name, company_logo_url, company_website, description, requirements, benefits,
      location, job_type, category_id, salary_min, salary_max, salary_currency, salary_period,
      external_link, expiry_date, is_featured, meta_title, meta_description, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING *
  `, [
    title, slug, company_name, company_logo_url, company_website, description, requirements, benefits,
    location, job_type, category_id || null, salary_min, salary_max, salary_currency || 'USD', salary_period || 'yearly',
    external_link, expiryDateValue, is_featured || false, meta_title, meta_description, status
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
  const existingJob = await db.query('SELECT id FROM jobs WHERE id = $1', [id]);
  if (existingJob.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  // Build update query dynamically
  const allowedFields = [
    'title', 'company_name', 'company_logo_url', 'company_website', 'description', 'requirements', 'benefits',
    'location', 'job_type', 'category_id', 'salary_min', 'salary_max', 'salary_currency', 'salary_period',
    'external_link', 'expiry_date', 'is_featured', 'meta_title', 'meta_description', 'status'
  ];

  const updateFields = [];
  const params = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      updateFields.push(`${field} = $${paramIndex++}`);
      params.push(updates[field]);
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

router.get('/users', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [usersResult, countResult] = await Promise.all([
    db.query(`
      SELECT id, email, name, role, email_verified, last_login, created_at,
        (SELECT COUNT(*) FROM saved_jobs sj WHERE sj.user_id = users.id) as saved_jobs_count,
        (SELECT COUNT(*) FROM job_alerts ja WHERE ja.user_id = users.id) as alerts_count
      FROM users
      WHERE role = 'user'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), offset]),
    db.query("SELECT COUNT(*) FROM users WHERE role = 'user'"),
  ]);

  res.json({
    success: true,
    data: {
      users: usersResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
      },
    },
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

module.exports = router;
