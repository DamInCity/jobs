/**
 * Shared job expiry + category count maintenance.
 * Used by app boot, scraper scheduler, and supply heartbeat.
 */

const db = require('../db');

/** SQL fragment: row is publicly listable */
const ACTIVE_LISTING_SQL = `
  status = 'active'
  AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
`.trim();

const ACTIVE_LISTING_SQL_J = `
  j.status = 'active'
  AND (j.expiry_date IS NULL OR j.expiry_date > CURRENT_TIMESTAMP)
`.trim();

/**
 * Expire past-due and over-age aggregated listings, then recompute category counts.
 * @param {object} [opts]
 * @param {number} [opts.maxAggregatedAgeDays=45] - age cap for aggregated board/API rows
 * @param {boolean} [opts.skipAgeCap=false]
 */
async function expirePastDueJobs(opts = {}) {
  const maxAggregatedAgeDays = Number(opts.maxAggregatedAgeDays ?? process.env.MAX_AGGREGATED_JOB_AGE_DAYS ?? 45);
  const skipAgeCap = opts.skipAgeCap === true;

  const expired = await db.query(`
    UPDATE jobs
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'active'
      AND expiry_date IS NOT NULL
      AND expiry_date < CURRENT_TIMESTAMP
    RETURNING id
  `);

  let expiredByAge = 0;
  if (!skipAgeCap && maxAggregatedAgeDays > 0) {
    // Board/API scrapes go stale; keep career/gov/ngo longer via source_type exemption
    const stale = await db.query(
      `
      UPDATE jobs
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND COALESCE(is_aggregated, true) = true
        AND UPPER(COALESCE(source_type, 'BOARD')) IN ('BOARD', 'API', 'AGGREGATOR', '')
        AND COALESCE(posted_date, created_at) < NOW() - ($1::text || ' days')::interval
      RETURNING id
      `,
      [String(maxAggregatedAgeDays)]
    );
    expiredByAge = stale.rowCount;
  }

  // Junk listing titles that slipped in before preprocess rules
  const junk = await db.query(`
    UPDATE jobs
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'active'
      AND title ~* '^(careers?|jobs?|job openings?|fresh jobs?|vacancies|we are hiring|hiring|opportunities|view all jobs|see all)$'
    RETURNING id
  `);

  await recomputeAllCategoryCounts();

  return {
    expiredByDate: expired.rowCount,
    expiredByAge,
    expiredJunkTitles: junk.rowCount,
  };
}

async function recomputeAllCategoryCounts() {
  await db.query(`
    UPDATE categories c
    SET job_count = (
      SELECT COUNT(*)::int
      FROM jobs j
      WHERE j.category_id = c.id
        AND j.status = 'active'
        AND (j.expiry_date IS NULL OR j.expiry_date > CURRENT_TIMESTAMP)
    ),
    updated_at = CURRENT_TIMESTAMP
  `);
}

/**
 * Snapshot for health / n8n / Telegram automation.
 */
async function getSupplySnapshot() {
  const [totals, bySource, cats, lastIngest] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active'
          AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP))::int AS active,
        COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
        COUNT(*) FILTER (
          WHERE status = 'active'
            AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
            AND (
              UPPER(COALESCE(country_code,'')) = 'KE'
              OR location ILIKE '%kenya%'
              OR county IS NOT NULL
              OR source ILIKE '%myjobmag%'
              OR source ILIKE 'kenya:%'
            )
        )::int AS kenya_active,
        COUNT(*) FILTER (
          WHERE created_at > NOW() - INTERVAL '36 hours'
        )::int AS created_36h,
        COUNT(*) FILTER (
          WHERE status = 'active'
            AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
            AND category_id IS NOT NULL
        )::int AS active_categorized
      FROM jobs
    `),
    db.query(`
      SELECT COALESCE(source, '?') AS source,
             COUNT(*) FILTER (
               WHERE status = 'active'
                 AND (expiry_date IS NULL OR expiry_date > CURRENT_TIMESTAMP)
             )::int AS active,
             MAX(created_at) AS last_in
      FROM jobs
      GROUP BY 1
      ORDER BY active DESC, last_in DESC NULLS LAST
      LIMIT 20
    `),
    db.query(`
      SELECT COUNT(*)::int AS with_jobs
      FROM categories
      WHERE COALESCE(job_count, 0) > 0
    `),
    db.query(`SELECT MAX(created_at) AS last_ingest FROM jobs`),
  ]);

  const t = totals.rows[0] || {};
  const last = lastIngest.rows[0]?.last_ingest || null;
  const hoursSinceIngest = last
    ? (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60)
    : null;

  const minActive = parseInt(process.env.SUPPLY_MIN_ACTIVE || '30', 10);
  const maxStaleHours = parseFloat(process.env.SUPPLY_MAX_STALE_HOURS || '36');
  const minCategories = parseInt(process.env.SUPPLY_MIN_CATEGORIES || '5', 10);

  const gates = {
    active_min: (t.active || 0) >= minActive,
    ingest_fresh: hoursSinceIngest == null ? false : hoursSinceIngest <= maxStaleHours,
    categories_min: (cats.rows[0]?.with_jobs || 0) >= minCategories,
    kenya_present: (t.kenya_active || 0) >= 5,
  };

  return {
    active: t.active || 0,
    expired: t.expired || 0,
    kenya_active: t.kenya_active || 0,
    created_36h: t.created_36h || 0,
    active_categorized: t.active_categorized || 0,
    categories_with_jobs: cats.rows[0]?.with_jobs || 0,
    last_ingest: last,
    hours_since_ingest: hoursSinceIngest == null ? null : Math.round(hoursSinceIngest * 10) / 10,
    by_source: bySource.rows,
    gates,
    gates_passed: Object.values(gates).every(Boolean),
    thresholds: { minActive, maxStaleHours, minCategories },
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  ACTIVE_LISTING_SQL,
  ACTIVE_LISTING_SQL_J,
  expirePastDueJobs,
  recomputeAllCategoryCounts,
  getSupplySnapshot,
};
