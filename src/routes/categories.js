const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { ACTIVE_LISTING_SQL_J } = require('../jobs/expiryMaintenance');

const router = express.Router();

// Get all categories with live job counts
// Default: only categories with at least one active (non-expired) job
// Pass ?include_empty=1 to return the full catalog with job_count: 0
router.get('/', asyncHandler(async (req, res) => {
  const includeEmpty =
    req.query.include_empty === '1' ||
    req.query.include_empty === 'true';

  const result = await db.query(`
    SELECT
      c.id, c.name, c.slug, c.icon, c.description,
      COUNT(j.id) FILTER (WHERE ${ACTIVE_LISTING_SQL_J})::int AS job_count
    FROM categories c
    LEFT JOIN jobs j ON c.id = j.category_id
    GROUP BY c.id, c.name, c.slug, c.icon, c.description
    ${includeEmpty ? '' : 'HAVING COUNT(j.id) FILTER (WHERE ' + ACTIVE_LISTING_SQL_J + ') > 0'}
    ORDER BY job_count DESC, c.name
  `);

  res.json({
    success: true,
    data: result.rows,
    meta: {
      include_empty: includeEmpty,
      total: result.rows.length,
    },
  });
}));

// Get category by slug with jobs
router.get('/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const categoryResult = await db.query(
    'SELECT * FROM categories WHERE slug = $1',
    [slug]
  );

  if (categoryResult.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message: 'Category not found',
    });
  }

  const category = categoryResult.rows[0];

  const [jobsResult, countResult] = await Promise.all([
    db.query(
      `
      SELECT
        j.id, j.title, j.slug, j.company_name, j.company_logo_url,
        j.location, j.job_type, j.salary_min, j.salary_max, j.salary_currency,
        j.posted_date, j.is_featured, j.view_count
      FROM jobs j
      WHERE j.category_id = $1
        AND ${ACTIVE_LISTING_SQL_J}
      ORDER BY j.is_featured DESC, j.posted_date DESC
      LIMIT $2 OFFSET $3
    `,
      [category.id, parseInt(limit), offset]
    ),
    db.query(
      `
      SELECT COUNT(*)::int AS count FROM jobs j
      WHERE j.category_id = $1
        AND ${ACTIVE_LISTING_SQL_J}
    `,
      [category.id]
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10) || 0;
  category.job_count = total;

  res.json({
    success: true,
    data: {
      category,
      jobs: jobsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)) || 0,
      },
    },
  });
}));

module.exports = router;
