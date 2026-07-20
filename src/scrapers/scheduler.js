/**
 * Job Scraper / Importer Scheduler
 * Runs enabled sources on a schedule and reports results
 *
 * Usage:
 *   node src/scrapers/scheduler.js           # Run once
 *   node src/scrapers/scheduler.js --cron    # Run with cron schedule
 *   node src/scrapers/scheduler.js --dry-run # Test without saving
 *   node src/scrapers/scheduler.js --max-jobs=50
 */

require('dotenv').config();

const cron = require('node-cron');
const db = require('../db');
const config = require('../config');

// HTML scrapers (optional — need Puppeteer/Cheerio)
const BrighterMondayScraper = require('./BrighterMondayScraper');
const MyJobMagScraper = require('./MyJobMagScraper');

// RapidAPI importers
const JSearchImporter = require('./rapidapi/JSearchImporter');
const LinkedInImporter = require('./rapidapi/LinkedInImporter');
const JobsApi14Importer = require('./rapidapi/JobsApi14Importer');

const CONFIG = {
  // 6 AM and 6 PM Kenya time (EAT = UTC+3)
  cronSchedule: '0 3,15 * * *',
  maxJobsPerScraper: config.rapidapi?.maxJobsPerSource || 100,
  concurrency: 1,
};

// HTML scrapers disabled by default (heavy / brittle in Docker).
// RapidAPI importers are the primary bulk sources.
const SCRAPERS = [
  { name: 'JSearch', Class: JSearchImporter, enabled: true },
  { name: 'LinkedIn', Class: LinkedInImporter, enabled: true },
  { name: 'JobsAPI14', Class: JobsApi14Importer, enabled: true },
  { name: 'BrighterMonday', Class: BrighterMondayScraper, enabled: false },
  { name: 'MyJobMag', Class: MyJobMagScraper, enabled: false },
];

async function runAllScrapers(options = {}) {
  const { dryRun = false, maxJobs = CONFIG.maxJobsPerScraper, only } = options;

  console.log('\n' + '='.repeat(60));
  console.log('🕷️  JOB SCRAPER / IMPORTER SCHEDULER');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Max jobs per source: ${maxJobs}`);
  console.log('='.repeat(60));

  const results = [];
  let enabledScrapers = SCRAPERS.filter((s) => s.enabled);

  if (only) {
    const name = only.toLowerCase();
    enabledScrapers = SCRAPERS.filter((s) => s.name.toLowerCase() === name);
    if (enabledScrapers.length === 0) {
      console.error(`Unknown scraper: ${only}. Available: ${SCRAPERS.map((s) => s.name).join(', ')}`);
      process.exit(1);
    }
    // Allow running even if disabled when explicitly requested
    enabledScrapers = enabledScrapers.map((s) => ({ ...s, enabled: true }));
  }

  console.log(`\nRunning ${enabledScrapers.length} source(s)...\n`);

  for (const { name, Class } of enabledScrapers) {
    console.log(`\n${'─'.repeat(50)}`);

    try {
      const scraper = new Class();
      const result = await scraper.run({ maxJobs, dryRun });
      results.push(result);
    } catch (error) {
      console.error(`❌ Fatal error in ${name} scraper:`, error.message);
      results.push({
        scraper: name,
        jobsScraped: 0,
        jobsSaved: 0,
        errors: 1,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  printSummary(results);
  await logScraperRun(results);

  // Notify subscribers (email / Telegram) when new jobs were saved
  if (!dryRun) {
    await notifyJobSubscribers(results);
  }

  return results;
}

/**
 * After ingestion, run daily alert matching (Telegram + email).
 * Uses processAlertsInProcess so the shared DB pool stays open.
 */
async function notifyJobSubscribers(results) {
  const totalSaved = results.reduce((sum, r) => sum + (r.jobsSaved || 0), 0);
  if (totalSaved <= 0) {
    console.log('\n📣 No new jobs saved — skipping alert notifications');
    return;
  }

  console.log(`\n📣 ${totalSaved} job(s) saved — running preference-based alerts...`);
  try {
    const { processAlertsInProcess } = require('../jobs/emailAlerts');
    await processAlertsInProcess('daily');
    console.log('📣 Alert notifications finished');
  } catch (error) {
    console.error('⚠️ Alert notifications after scrape failed:', error.message);
  }
}

function printSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SCRAPER RUN SUMMARY');
  console.log('='.repeat(60));

  let totalScraped = 0;
  let totalSaved = 0;
  let totalErrors = 0;

  console.log('\n' + '─'.repeat(60));
  console.log('Scraper              | Scraped | Saved | Errors | Duration');
  console.log('─'.repeat(60));

  for (const result of results) {
    const name = String(result.scraper || '').padEnd(20);
    const scraped = String(result.jobsScraped ?? 0).padStart(7);
    const saved = String(result.jobsSaved ?? 0).padStart(5);
    const errors = String(result.errors ?? 0).padStart(6);
    const duration = String(result.duration || 'N/A').padStart(8);

    console.log(`${name} | ${scraped} | ${saved} | ${errors} | ${duration}`);

    totalScraped += result.jobsScraped || 0;
    totalSaved += result.jobsSaved || 0;
    totalErrors += result.errors || 0;
  }

  console.log('─'.repeat(60));
  console.log(
    `${'TOTAL'.padEnd(20)} | ${String(totalScraped).padStart(7)} | ${String(totalSaved).padStart(5)} | ${String(totalErrors).padStart(6)} |`
  );
  console.log('─'.repeat(60));

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');
}

async function logScraperRun(results) {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS scraper_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        scraper_name VARCHAR(100) NOT NULL,
        jobs_scraped INTEGER DEFAULT 0,
        jobs_saved INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        duration VARCHAR(50),
        error_details TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    for (const result of results) {
      await db.query(
        `
        INSERT INTO scraper_logs (scraper_name, jobs_scraped, jobs_saved, errors, duration, error_details)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          result.scraper,
          result.jobsScraped || 0,
          result.jobsSaved || 0,
          result.errors || 0,
          result.duration || null,
          result.error ? result.error : null,
        ]
      );
    }

    console.log('📝 Scraper run logged to database');
  } catch (error) {
    console.error('⚠️ Could not log to database:', error.message);
  }
}

async function cleanupExpiredJobs() {
  console.log('\n🧹 Cleaning up expired jobs...');

  try {
    const result = await db.query(`
      UPDATE jobs
      SET status = 'expired'
      WHERE expiry_date < CURRENT_TIMESTAMP
        AND status = 'active'
      RETURNING id
    `);

    console.log(`   Marked ${result.rowCount} jobs as expired`);
  } catch (error) {
    console.error('   Error cleaning up jobs:', error.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cronMode = args.includes('--cron');
  const dryRun = args.includes('--dry-run');
  const maxJobsArg = args.find((a) => a.startsWith('--max-jobs='));
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const maxJobs = maxJobsArg
    ? parseInt(maxJobsArg.split('=')[1], 10)
    : CONFIG.maxJobsPerScraper;
  const only = onlyArg ? onlyArg.split('=')[1] : null;

  if (cronMode) {
    console.log('🕐 Starting scraper scheduler in cron mode...');
    console.log(`   Schedule: ${CONFIG.cronSchedule}`);
    console.log('   Press Ctrl+C to stop\n');

    await cleanupExpiredJobs();
    await runAllScrapers({ dryRun, maxJobs, only });

    cron.schedule(CONFIG.cronSchedule, async () => {
      console.log('\n⏰ Scheduled run triggered');
      await cleanupExpiredJobs();
      await runAllScrapers({ dryRun, maxJobs, only });
    });

    process.on('SIGINT', () => {
      console.log('\n\n👋 Scheduler stopped');
      process.exit(0);
    });
  } else {
    await cleanupExpiredJobs();
    await runAllScrapers({ dryRun, maxJobs, only });
    await db.pool.end();
    process.exit(0);
  }
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
