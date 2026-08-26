/**
 * Backfill MyJobMag stored descriptions: strip board chrome and fill
 * application_url from method-of-application email when missing.
 *
 * Usage: node scripts/backfillMyJobMagChrome.js [--limit=N] [--dry-run]
 */
require('dotenv').config();
const cheerio = require('cheerio');
const db = require('../src/db');
const { sanitizeListingHtml, extractApplyFromCheerio, isEmployerHttpUrl } = require('../src/scrapers/myjobmagHtml');

function parseArgs(argv) {
  const args = { limit: Infinity, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { rows } = await db.query(
    `SELECT id, description, application_url
     FROM jobs
     WHERE source = 'MyJobMag'
     ORDER BY posted_date DESC
     LIMIT $1`,
    [Number.isFinite(args.limit) ? args.limit : null]
  );

  console.log(`📋 ${rows.length} MyJobMag jobs${args.dryRun ? ' (DRY RUN)' : ''}\n`);

  let cleaned = 0;
  let emails = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const html = row.description || '';
      const nextHtml = sanitizeListingHtml(html, cheerio, 'https://www.myjobmag.co.ke');
      const $ = cheerio.load(`<div id="__root">${html}</div>`, { decodeEntities: false });
      const extracted = extractApplyFromCheerio($, 'https://www.myjobmag.co.ke');

      let nextApply = row.application_url;
      if (!isEmployerHttpUrl(nextApply) && !/^mailto:/i.test(String(nextApply || ''))) {
        if (extracted.email) {
          nextApply = `mailto:${extracted.email}`;
        } else {
          nextApply = null;
        }
      }
      if (isEmployerHttpUrl(row.application_url)) nextApply = row.application_url;
      if (/^mailto:/i.test(String(row.application_url || ''))) nextApply = row.application_url;

      const htmlChanged = nextHtml !== html;
      const applyChanged = nextApply !== row.application_url;

      if (!htmlChanged && !applyChanged) {
        unchanged++;
        continue;
      }

      const label = `${(i + 1).toString().padStart(4)}/${rows.length}`;
      if (applyChanged && /^mailto:/i.test(nextApply || '')) {
        emails++;
        console.log(`${label} ✉️  ${nextApply}`);
      } else if (htmlChanged) {
        cleaned++;
        if (cleaned <= 8 || i === rows.length - 1) console.log(`${label} 🧹 description chrome stripped`);
      }

      if (!args.dryRun) {
        await db.query(
          'UPDATE jobs SET description = $1, application_url = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [nextHtml, nextApply, row.id]
        );
      }
    } catch (err) {
      errors++;
      console.error(`   ❌ ${row.id}: ${err.message}`);
    }
  }

  console.log('\n════════════════════════════════════');
  console.log(`🧹 Descriptions cleaned : ${cleaned}`);
  console.log(`✉️  Emails filled       : ${emails}`);
  console.log(`⏭️  Unchanged           : ${unchanged}`);
  console.log(`❌ Errors              : ${errors}`);
  console.log('════════════════════════════════════');

  await db.pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
