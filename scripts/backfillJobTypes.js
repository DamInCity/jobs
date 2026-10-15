#!/usr/bin/env node
/**
 * Reclassify active jobs that were labelled remote by missing-location
 * fallbacks or noisy API flags. Uses the same inferJobType() as ingest.
 *
 *   node scripts/backfillJobTypes.js
 *   node scripts/backfillJobTypes.js --dry-run
 */

require('dotenv').config();

const db = require('../src/db');
const { inferJobType, isRemotePlaceholder } = require('../src/scrapers/preprocessJob');

const dryRun = process.argv.includes('--dry-run');

function nextLocation(row, jobType) {
  const loc = String(row.location || '').trim();
  if (jobType === 'remote') {
    return loc || 'Remote';
  }
  if (isRemotePlaceholder(loc)) {
    if (row.county) {
      return /kenya/i.test(row.county) ? row.county : `${row.county}, Kenya`;
    }
    return 'Not specified';
  }
  return loc || 'Not specified';
}

async function main() {
  const { rows } = await db.query(
    `SELECT id, title, location, county, description, job_type
     FROM jobs
     WHERE status = 'active'`
  );

  const stats = { scanned: rows.length, typeChanged: 0, locationChanged: 0, unchanged: 0 };
  const samples = [];

  for (const row of rows) {
    const jobType = inferJobType(row);
    const location = nextLocation(row, jobType);
    const typeChanged = jobType !== row.job_type;
    const locationChanged = location !== row.location;

    if (!typeChanged && !locationChanged) {
      stats.unchanged += 1;
      continue;
    }
    if (typeChanged) stats.typeChanged += 1;
    if (locationChanged) stats.locationChanged += 1;

    if (samples.length < 15) {
      samples.push({
        title: row.title,
        from: `${row.job_type} / ${row.location}`,
        to: `${jobType} / ${location}`,
      });
    }

    if (!dryRun) {
      await db.query(
        `UPDATE jobs
         SET job_type = $1, location = $2, updated_at = NOW()
         WHERE id = $3`,
        [jobType, location, row.id]
      );
    }
  }

  console.log(dryRun ? 'Dry run — no rows written' : 'Backfill complete');
  console.log(stats);
  if (samples.length) {
    console.log('Sample changes:');
    for (const s of samples) {
      console.log(`  - ${s.title}: ${s.from} → ${s.to}`);
    }
  }

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
