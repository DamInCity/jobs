/**
 * Sync sources.json into job_sources table (upsert by slug).
 */

const fs = require('fs');
const path = require('path');
const db = require('../../db');

const SOURCES_PATH = path.join(__dirname, 'sources.json');

function loadSourcesFile() {
  const raw = fs.readFileSync(SOURCES_PATH, 'utf8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('sources.json must be an array');
  return list;
}

async function syncJobSources({ deactivateMissing = false } = {}) {
  const list = loadSourcesFile();
  let upserted = 0;

  for (const s of list) {
    if (!s.slug || !s.name || !s.base_url) {
      console.warn('Skipping invalid source entry', s);
      continue;
    }
    await db.query(
      `INSERT INTO job_sources (
         slug, name, source_type, base_url, parser_key, parser_config,
         county_hint, country_code, crawl_frequency_hours, status, robots_ok, notes
       ) VALUES (
         $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,'active', COALESCE($10, TRUE), $11
       )
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         source_type = EXCLUDED.source_type,
         base_url = EXCLUDED.base_url,
         parser_key = EXCLUDED.parser_key,
         parser_config = EXCLUDED.parser_config,
         county_hint = EXCLUDED.county_hint,
         country_code = EXCLUDED.country_code,
         crawl_frequency_hours = EXCLUDED.crawl_frequency_hours,
         robots_ok = EXCLUDED.robots_ok,
         notes = EXCLUDED.notes,
         status = CASE
           WHEN job_sources.status = 'disabled' THEN job_sources.status
           ELSE 'active'
         END,
         updated_at = CURRENT_TIMESTAMP`,
      [
        s.slug,
        s.name,
        s.source_type || 'COMPANY_CAREER',
        s.base_url,
        s.parser_key || 'generic-html',
        JSON.stringify(s.parser_config || {}),
        s.county_hint || null,
        s.country_code || 'KE',
        s.crawl_frequency_hours || 12,
        s.robots_ok != null ? s.robots_ok : true,
        s.notes || null,
      ]
    );
    upserted += 1;
  }

  let deactivated = 0;
  if (deactivateMissing) {
    const slugs = list.map((s) => s.slug);
    const res = await db.query(
      `UPDATE job_sources
       SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
       WHERE slug <> ALL($1::text[])
         AND status = 'active'
       RETURNING slug`,
      [slugs]
    );
    deactivated = res.rowCount;
  }

  return { upserted, deactivated, totalFile: list.length };
}

async function getActiveSources({ dueOnly = false } = {}) {
  const params = [];
  let sql = `SELECT * FROM job_sources WHERE status = 'active'`;
  if (dueOnly) {
    sql += ` AND (
      last_crawled_at IS NULL
      OR last_crawled_at < NOW() - (crawl_frequency_hours || ' hours')::interval
    )`;
  }
  sql += ' ORDER BY source_type, name';
  const res = await db.query(sql, params);
  return res.rows.map((row) => ({
    ...row,
    parser_config:
      typeof row.parser_config === 'string'
        ? JSON.parse(row.parser_config)
        : row.parser_config || {},
  }));
}

async function markSourceResult(id, { found, saved, error }) {
  await db.query(
    `UPDATE job_sources SET
       last_crawled_at = CURRENT_TIMESTAMP,
       last_success_at = CASE WHEN $2::text IS NULL THEN CURRENT_TIMESTAMP ELSE last_success_at END,
       last_error = $2,
       jobs_found_last = $3,
       jobs_saved_last = $4,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, error || null, found || 0, saved || 0]
  );
}

async function main() {
  require('dotenv').config();
  const { runMigrationsInProcess } = require('../../db/migrate');
  await runMigrationsInProcess();
  const result = await syncJobSources({
    deactivateMissing: process.argv.includes('--deactivate-missing'),
  });
  console.log('job_sources sync:', result);
  await db.pool.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  loadSourcesFile,
  syncJobSources,
  getActiveSources,
  markSourceResult,
  SOURCES_PATH,
};
