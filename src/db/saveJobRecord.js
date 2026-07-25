/**
 * Shared job persistence used by scrapers and ingest API.
 */

const slugify = require('slugify');
const db = require('./index');
const { preprocessJob } = require('../scrapers/preprocessJob');

/**
 * @param {object} rawJob
 * @param {object} [options]
 * @param {string} [options.source]
 * @param {boolean} [options.skipPreprocess]
 * @returns {Promise<{ saved: boolean, id?: string, reason?: string }>}
 */
async function saveJobRecord(rawJob, options = {}) {
  let job = rawJob;

  if (!options.skipPreprocess) {
    const result = preprocessJob(rawJob, {
      defaultSource: options.source || rawJob.source || 'manual',
      maxAgeDays: options.maxAgeDays,
    });
    if (!result.ok) {
      return { saved: false, reason: result.reason };
    }
    job = result.job;
  }

  if (options.source) {
    job.source = options.source;
  }

  try {
    const existing = await db.query(
      'SELECT id FROM jobs WHERE external_link = $1',
      [job.external_link]
    );
    if (existing.rows.length > 0) {
      return { saved: false, reason: 'duplicate', id: existing.rows[0].id };
    }

    const slug = slugify(`${job.title}-${job.company_name}-${Date.now()}`, {
      lower: true,
      strict: true,
    }).slice(0, 300);

    let categoryId = null;
    if (job.category) {
      const catResult = await db.query(
        `SELECT id FROM categories
         WHERE LOWER(name) = LOWER($1)
            OR LOWER(slug) = LOWER($1)
            OR LOWER(slug) = LOWER(REPLACE($1, ' ', '-'))
         LIMIT 1`,
        [job.category]
      );
      if (catResult.rows.length > 0) {
        categoryId = catResult.rows[0].id;
      }
    }

    const result = await db.query(
      `INSERT INTO jobs (
        title, slug, company_name, company_logo_url, company_website, description,
        requirements, benefits, location, job_type, category_id,
        salary_min, salary_max, salary_currency, salary_period, external_link,
        posted_date, expiry_date, status, source
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'active', $19
      )
      ON CONFLICT (external_link) DO NOTHING
      RETURNING id`,
      [
        job.title,
        slug,
        job.company_name,
        job.company_logo_url || null,
        job.company_website || null,
        job.description || '',
        job.requirements || null,
        job.benefits || null,
        job.location || 'Remote',
        job.job_type || 'onsite',
        categoryId,
        job.salary_min ?? null,
        job.salary_max ?? null,
        job.salary_currency || 'USD',
        job.salary_period || 'yearly',
        job.external_link,
        job.posted_date || new Date(),
        job.expiry_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        job.source || options.source || 'manual',
      ]
    );

    if (result.rowCount === 0) {
      return { saved: false, reason: 'duplicate' };
    }

    // Keep category job_count roughly in sync
    if (categoryId) {
      await db.query(
        `UPDATE categories SET job_count = (
           SELECT COUNT(*) FROM jobs WHERE category_id = $1 AND status = 'active'
         ), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [categoryId]
      ).catch(() => {});
    }

    return { saved: true, id: result.rows[0].id };
  } catch (error) {
    return { saved: false, reason: error.message };
  }
}

module.exports = { saveJobRecord };
