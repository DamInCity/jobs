/**
 * Job Scraper Scheduler
 * Runs all scrapers on a schedule and reports results
 * 
 * Usage:
 *   node src/scrapers/scheduler.js           # Run once
 *   node src/scrapers/scheduler.js --cron    # Run with cron schedule
 *   node src/scrapers/scheduler.js --dry-run # Test without saving
 */

require('dotenv').config();

const cron = require('node-cron');
const db = require('../db');

// Import scrapers
const BrighterMondayScraper = require('./BrighterMondayScraper');
const MyJobMagScraper = require('./MyJobMagScraper');

// Configuration
const CONFIG = {
  // Run at 6 AM and 6 PM Kenya time (EAT = UTC+3)
  cronSchedule: '0 3,15 * * *', // 6 AM and 6 PM EAT
  maxJobsPerScraper: 30,
  concurrency: 1, // Run one scraper at a time
};

// All available scrapers
const SCRAPERS = [
  { name: 'BrighterMonday', Class: BrighterMondayScraper, enabled: true },
  { name: 'MyJobMag', Class: MyJobMagScraper, enabled: true },
];

/**
 * Run all enabled scrapers
 */
async function runAllScrapers(options = {}) {
  const { dryRun = false, maxJobs = CONFIG.maxJobsPerScraper } = options;
  
  console.log('\n' + '='.repeat(60));
  console.log('🕷️  JOB SCRAPER SCHEDULER');
  console.log('='.repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Max jobs per scraper: ${maxJobs}`);
  console.log('='.repeat(60));

  const results = [];
  const enabledScrapers = SCRAPERS.filter(s => s.enabled);
  
  console.log(`\nRunning ${enabledScrapers.length} scraper(s)...\n`);

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

    // Delay between scrapers
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Print summary
  printSummary(results);
  
  // Log results to database (optional)
  await logScraperRun(results);

  return results;
}

/**
 * Print summary of all scraper results
 */
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
    const name = result.scraper.padEnd(20);
    const scraped = String(result.jobsScraped).padStart(7);
    const saved = String(result.jobsSaved).padStart(5);
    const errors = String(result.errors).padStart(6);
    const duration = (result.duration || 'N/A').padStart(8);
    
    console.log(`${name} | ${scraped} | ${saved} | ${errors} | ${duration}`);
    
    totalScraped += result.jobsScraped;
    totalSaved += result.jobsSaved;
    totalErrors += result.errors;
  }

  console.log('─'.repeat(60));
  console.log(`${'TOTAL'.padEnd(20)} | ${String(totalScraped).padStart(7)} | ${String(totalSaved).padStart(5)} | ${String(totalErrors).padStart(6)} |`);
  console.log('─'.repeat(60));

  console.log(`\nCompleted at: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Log scraper run to database for tracking
 */
async function logScraperRun(results) {
  try {
    // Check if scraper_logs table exists, create if not
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

    // Insert log entries
    for (const result of results) {
      await db.query(`
        INSERT INTO scraper_logs (scraper_name, jobs_scraped, jobs_saved, errors, duration, error_details)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        result.scraper,
        result.jobsScraped,
        result.jobsSaved,
        result.errors,
        result.duration,
        result.error ? result.error : null,
      ]);
    }

    console.log('📝 Scraper run logged to database');
  } catch (error) {
    console.error('⚠️ Could not log to database:', error.message);
  }
}

/**
 * Cleanup old expired jobs
 */
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

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const cronMode = args.includes('--cron');
  const dryRun = args.includes('--dry-run');
  const maxJobsArg = args.find(a => a.startsWith('--max-jobs='));
  const maxJobs = maxJobsArg ? parseInt(maxJobsArg.split('=')[1]) : CONFIG.maxJobsPerScraper;

  if (cronMode) {
    console.log('🕐 Starting scraper scheduler in cron mode...');
    console.log(`   Schedule: ${CONFIG.cronSchedule}`);
    console.log('   Press Ctrl+C to stop\n');

    // Run immediately once
    await cleanupExpiredJobs();
    await runAllScrapers({ dryRun, maxJobs });

    // Schedule regular runs
    cron.schedule(CONFIG.cronSchedule, async () => {
      console.log('\n⏰ Scheduled run triggered');
      await cleanupExpiredJobs();
      await runAllScrapers({ dryRun, maxJobs });
    });

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n\n👋 Scheduler stopped');
      process.exit(0);
    });
  } else {
    // Single run mode
    await cleanupExpiredJobs();
    await runAllScrapers({ dryRun, maxJobs });
    
    // Close database connection
    await db.end();
    process.exit(0);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
