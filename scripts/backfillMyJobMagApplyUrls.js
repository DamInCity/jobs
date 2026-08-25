/**
 * Backfill real application URLs for existing MyJobMag jobs.
 *
 * For each job whose external_link points at myjobmag.co.ke, re-scrape the
 * listing page, extract the Method-of-Application link (direct employer URL or
 * resolved /apply-now/{id} redirect), and store it in jobs.application_url.
 *
 * Usage:
 *   node scripts/backfillMyJobMagApplyUrls.js [--limit=N] [--dry-run] [--only-missing]
 *
 *   --limit=N        Process at most N jobs (default: all)
 *   --dry-run        Report what would change without writing to the DB
 *   --only-missing   Skip rows that already have a non-null application_url
 *
 * Rate-limited (~1 req/sec + jitter) to stay polite with myjobmag.
 */

require('dotenv').config();
const { pool } = require('../src/db');
const MyJobMagScraper = require('../src/scrapers/MyJobMagScraper');

function parseArgs(argv) {
  const args = { limit: Infinity, dryRun: false, onlyMissing: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--only-missing') args.onlyMissing = true;
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv);
  const scraper = new MyJobMagScraper();
  await scraper.init();

  const where = args.onlyMissing
    ? `external_link LIKE '%myjobmag.co.ke%' AND (application_url IS NULL OR application_url = '')`
    : `external_link LIKE '%myjobmag.co.ke%'`;

  const { rows } = await pool.query(`
    SELECT id, external_link
    FROM jobs
    WHERE ${where}
    ORDER BY posted_date DESC
    LIMIT $1
  `, [Number.isFinite(args.limit) ? args.limit : null]);

  console.log(`📋 ${rows.length} MyJobMag jobs to process${args.dryRun ? ' (DRY RUN)' : ''}\n`);

  let updated = 0;
  let found = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const html = await scraper.fetchHtml(row.external_link);
      const $ = scraper.cheerio.load(html);
      const { applyUrl, needsResolution } = scraper.extractApplyUrl($);

      let applicationUrl = null;
      if (applyUrl) {
        applicationUrl = needsResolution ? await scraper.resolveRedirect(applyUrl) : applyUrl;
        try {
          if (new URL(applicationUrl).host === new URL(scraper.baseUrl).host) {
            applicationUrl = null;
          }
        } catch {
          applicationUrl = null;
        }
      }

      const label = `${(i + 1).toString().padStart(4)}/${rows.length}`;
      if (applicationUrl && applicationUrl !== row.application_url) {
        found++;
        console.log(`${label} ✅ ${applicationUrl}`);
        if (!args.dryRun) {
          await pool.query(
            'UPDATE jobs SET application_url = $1 WHERE id = $2',
            [applicationUrl, row.id]
          );
          updated++;
        }
      } else {
        unchanged++;
        console.log(`${label} ⏭️  no direct link (email-based)`);
      }
    } catch (err) {
      errors++;
      console.error(`   ❌ ${(i + 1)}/${rows.length} ${row.external_link}: ${err.message}`);
    }

    // Polite rate limiting: ~1.5s between listing fetches
    await delay(1000 + Math.random() * 1000);
  }

  console.log('\n════════════════════════════════════');
  console.log(`✅ Direct apply links found : ${found}`);
  console.log(`💾 Rows updated             : ${updated}`);
  console.log(`⏭️  No link (email-based)    : ${unchanged}`);
  console.log(`❌ Errors                   : ${errors}`);
  console.log('════════════════════════════════════');

  await scraper.close();
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
