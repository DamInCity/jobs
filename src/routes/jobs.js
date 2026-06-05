const express = require('express');
const db = require('../db');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { optionalAuth } = require('../middleware/auth');
const { searchValidation } = require('../middleware/validation');
const config = require('../config');

const router = express.Router();

// ============================================
// PUBLIC JOB LISTINGS
// ============================================

// Get all jobs with filtering and pagination
router.get('/', optionalAuth, searchValidation.jobs, asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = config.pagination.defaultPageSize,
    search,
    category,
    location,
    job_type,
    salary_min,
    salary_max,
    posted_after, // e.g., 'today', '3days', 'week', 'month'
    featured_only,
    remote_only,
    sort = 'posted_date',
    order = 'desc',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(parseInt(limit) || config.pagination.defaultPageSize, config.pagination.maxPageSize);
  const offset = (pageNum - 1) * limitNum;

  let whereConditions = ["j.status = 'active'"];
  let params = [];
  let paramIndex = 1;

  // Full-text search
  if (search) {
    whereConditions.push(`
      to_tsvector('english', coalesce(j.title, '') || ' ' || coalesce(j.company_name, '') || ' ' || coalesce(j.description, '') || ' ' || coalesce(j.location, ''))
      @@ plainto_tsquery('english', $${paramIndex++})
    `);
    params.push(search);
  }

  // Category filter
  if (category) {
    whereConditions.push(`(c.slug = $${paramIndex} OR c.id::text = $${paramIndex})`);
    params.push(category);
    paramIndex++;
  }

  // Location filter (partial match)
  if (location) {
    whereConditions.push(`j.location ILIKE $${paramIndex++}`);
    params.push(`%${location}%`);
  }

  // Job type filter (can be comma-separated)
  if (job_type) {
    const types = job_type.split(',').map(t => t.trim());
    whereConditions.push(`j.job_type = ANY($${paramIndex++})`);
    params.push(types);
  }

  // Remote only filter
  if (remote_only === 'true') {
    whereConditions.push("j.job_type = 'remote'");
  }

  // Salary filters
  if (salary_min) {
    whereConditions.push(`j.salary_max >= $${paramIndex++}`);
    params.push(parseInt(salary_min));
  }

  if (salary_max) {
    whereConditions.push(`j.salary_min <= $${paramIndex++}`);
    params.push(parseInt(salary_max));
  }

  // Date posted filter
  if (posted_after) {
    let dateFilter;
    switch (posted_after) {
      case 'today':
        dateFilter = "j.posted_date >= CURRENT_DATE";
        break;
      case '3days':
        dateFilter = "j.posted_date >= CURRENT_DATE - INTERVAL '3 days'";
        break;
      case 'week':
        dateFilter = "j.posted_date >= CURRENT_DATE - INTERVAL '7 days'";
        break;
      case 'month':
        dateFilter = "j.posted_date >= CURRENT_DATE - INTERVAL '30 days'";
        break;
    }
    if (dateFilter) {
      whereConditions.push(dateFilter);
    }
  }

  // Featured only
  if (featured_only === 'true') {
    whereConditions.push('j.is_featured = true');
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

  // Sort options
  const allowedSorts = {
    posted_date: 'j.posted_date',
    title: 'j.title',
    company: 'j.company_name',
    salary: 'j.salary_max',
    views: 'j.view_count',
  };
  const sortField = allowedSorts[sort] || 'j.posted_date';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  // Featured jobs first, then by sort field
  const orderClause = `ORDER BY j.is_featured DESC, ${sortField} ${sortOrder}`;

  const [jobsResult, countResult] = await Promise.all([
    db.query(`
      SELECT 
        j.id, j.title, j.slug, j.company_name, j.company_logo_url, 
        j.location, j.job_type, j.salary_min, j.salary_max, j.salary_currency, j.salary_period,
        j.posted_date, j.expiry_date, j.view_count, j.is_featured,
        c.name as category_name, c.slug as category_slug,
        CASE 
          WHEN j.expiry_date <= CURRENT_TIMESTAMP + INTERVAL '3 days' THEN true 
          ELSE false 
        END as expiring_soon,
        CASE 
          WHEN j.posted_date >= CURRENT_DATE THEN true 
          ELSE false 
        END as is_new
      FROM jobs j
      LEFT JOIN categories c ON j.category_id = c.id
      ${whereClause}
      ${orderClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limitNum, offset]),
    db.query(`
      SELECT COUNT(*) FROM jobs j 
      LEFT JOIN categories c ON j.category_id = c.id
      ${whereClause}
    `, params),
  ]);

  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / limitNum);

  res.json({
    success: true,
    data: {
      jobs: jobsResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      filters: {
        search,
        category,
        location,
        job_type,
        salary_min,
        salary_max,
        posted_after,
        featured_only,
        remote_only,
      },
    },
  });
}));

// Get trending jobs (most viewed in last 48 hours)
router.get('/trending', asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT 
      j.id, j.title, j.slug, j.company_name, j.company_logo_url, 
      j.location, j.job_type, j.view_count, j.is_featured,
      c.name as category_name, c.slug as category_slug
    FROM jobs j
    LEFT JOIN categories c ON j.category_id = c.id
    WHERE j.status = 'active'
      AND j.posted_date >= CURRENT_TIMESTAMP - INTERVAL '48 hours'
    ORDER BY j.view_count DESC
    LIMIT 10
  `);

  res.json({
    success: true,
    data: result.rows,
  });
}));

// Get featured jobs
router.get('/featured', asyncHandler(async (req, res) => {
  const result = await db.query(`
    SELECT 
      j.id, j.title, j.slug, j.company_name, j.company_logo_url, 
      j.location, j.job_type, j.salary_min, j.salary_max, j.salary_currency,
      j.posted_date, j.is_featured,
      c.name as category_name, c.slug as category_slug
    FROM jobs j
    LEFT JOIN categories c ON j.category_id = c.id
    WHERE j.status = 'active' AND j.is_featured = true
    ORDER BY j.posted_date DESC
    LIMIT 6
  `);

  res.json({
    success: true,
    data: result.rows,
  });
}));

// Get single job by ID or slug
router.get('/:identifier', optionalAuth, asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  // Check if it's a UUID or slug
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  const result = await db.query(`
    SELECT 
      j.*,
      c.name as category_name, c.slug as category_slug
    FROM jobs j
    LEFT JOIN categories c ON j.category_id = c.id
    WHERE ${isUUID ? 'j.id' : 'j.slug'} = $1 AND j.status = 'active'
  `, [identifier]);

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  const job = result.rows[0];

  // Get related jobs (same category or company)
  const relatedResult = await db.query(`
    SELECT 
      j.id, j.title, j.slug, j.company_name, j.company_logo_url, 
      j.location, j.job_type, j.posted_date,
      c.name as category_name
    FROM jobs j
    LEFT JOIN categories c ON j.category_id = c.id
    WHERE j.status = 'active' 
      AND j.id != $1
      AND (j.category_id = $2 OR j.company_name = $3)
    ORDER BY 
      CASE WHEN j.company_name = $3 THEN 0 ELSE 1 END,
      j.posted_date DESC
    LIMIT 4
  `, [job.id, job.category_id, job.company_name]);

  res.json({
    success: true,
    data: {
      job,
      relatedJobs: relatedResult.rows,
    },
  });
}));

// Track job view
router.post('/:id/view', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || null;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];
  const referrer = req.headers['referer'] || req.headers['referrer'];

  // Increment view count
  await db.query('UPDATE jobs SET view_count = view_count + 1 WHERE id = $1', [id]);

  // Log detailed view (for analytics)
  await db.query(`
    INSERT INTO job_views (job_id, user_id, ip_address, user_agent, referrer)
    VALUES ($1, $2, $3, $4, $5)
  `, [id, userId, ipAddress, userAgent, referrer]);

  res.json({ success: true });
}));

// Track external link click
router.post('/:id/click', optionalAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id || null;
  const ipAddress = req.ip || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'];

  // Increment click count
  await db.query('UPDATE jobs SET click_count = click_count + 1 WHERE id = $1', [id]);

  // Log click (for analytics)
  await db.query(`
    INSERT INTO job_clicks (job_id, user_id, ip_address, user_agent)
    VALUES ($1, $2, $3, $4)
  `, [id, userId, ipAddress, userAgent]);

  // Get the external link to redirect to
  const result = await db.query('SELECT external_link FROM jobs WHERE id = $1', [id]);
  
  res.json({ 
    success: true,
    data: {
      redirectUrl: result.rows[0]?.external_link,
    },
  });
}));

module.exports = router;
