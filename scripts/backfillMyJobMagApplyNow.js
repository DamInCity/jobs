/**
 * Re-fetch MyJobMag listing pages and fill application_url from
 * Method of Application (first-hop /apply-now → employer form/email).
 *
 * Usage: node scripts/backfillMyJobMagApplyNow.js [--limit=N] [--dry-run]
 */
require('dotenv').config();
const cheerio = require('cheerio');
const db = require('../src/db');
const {
  extractApplyFromCheerio,
  isEmployerHttpUrl,
  resolveApplyNowFirstHop,
} = require('../src/scrapers/myjobmagHtml');

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveApply(externalLink) {
  const html = await fetchHtml(externalLink);
  const $ = cheerio.load(html);
  const { applyUrl, needsResolution, email } = extractApplyFromCheerio($, 'https://www.myjobmag.co.ke');
  let applicationUrl = null;
  if (applyUrl && needsResolution) {
    applicationUrl = await resolveApplyNowFirstHop(applyUrl);
  } else if (applyUrl && isEmployerHttpUrl(applyUrl)) {
    applicationUrl = applyUrl;
  }
  if (!applicationUrl && email) applicationUrl = `mailto:${email}`;
  return applicationUrl;
}

async function main() {
  const args = parseArgs(process.argv);
  const { rows } = await db.query(
    `SELECT id, title, company_name, external_link
     FROM jobs
     WHERE source = 'MyJobMag'
       AND (
         application_url IS NULL
         OR application_url ILIKE '%accounts.google.com%'
         OR application_url ILIKE '%login.microsoftonline.com%'
       )
     ORDER BY posted_date DESC NULLS LAST
     LIMIT $1`,
    [Number.isFinite(args.limit) ? args.limit : 5000]
  );

  console.log(`${rows.length} jobs to resolve${args.dryRun ? ' (DRY RUN)' : ''}`);
  let updated = 0;
  let found = 0;
  let unchanged = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `${String(i + 1).padStart(3)}/${rows.length}`;
    try {
      const next = await resolveApply(row.external_link);
      if (next) {
        found += 1;
        console.log(`${label} ${row.company_name}: ${next}`);
        if (!args.dryRun) {
          await db.query('UPDATE jobs SET application_url = $1 WHERE id = $2', [next, row.id]);
          updated += 1;
        }
      } else {
        unchanged += 1;
        console.log(`${label} ${row.company_name}: no apply target`);
      }
    } catch (err) {
      errors += 1;
      console.error(`${label} ${row.external_link}: ${err.message}`);
    }
    await delay(700 + Math.random() * 500);
  }

  console.log(JSON.stringify({ found, updated, unchanged, errors }));
  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
