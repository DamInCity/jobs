/**
 * Kenya upstream career-page importer (S2).
 * Walks job_sources registry → adapters → preprocess → saveJobRecord.
 */

require('dotenv').config();

const BaseScraper = require('../BaseScraper');
const { fetchJobsForSource } = require('./adapters');
const {
  syncJobSources,
  getActiveSources,
  markSourceResult,
  loadSourcesFile,
} = require('./syncSources');

class KenyaCareerImporter extends BaseScraper {
  constructor() {
    super('KenyaCareers', 'kenya-job-sources');
  }

  async init() {
    // ensure registry exists
    await syncJobSources();
  }

  async getJobListings() {
    return [];
  }

  async parseJob() {
    return null;
  }

  /**
   * @param {object} options
   * @param {number} [options.maxJobs]
   * @param {boolean} [options.dryRun]
   * @param {boolean} [options.dueOnly] only sources past crawl_frequency
   * @param {number} [options.maxSources]
   * @param {string} [options.onlySlug]
   */
  async run(options = {}) {
    const maxJobs = options.maxJobs || 400;
    const dryRun = options.dryRun || false;
    const dueOnly = options.dueOnly === true;
    const maxSources = options.maxSources || 999;
    const onlySlug = options.onlySlug || null;

    console.log(`\n🚀 Starting ${this.name} importer...`);
    console.log(`   Max jobs: ${maxJobs}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Due-only: ${dueOnly}`);

    const startTime = Date.now();

    try {
      await this.init();

      let sources = await getActiveSources({ dueOnly });
      if (onlySlug) {
        sources = sources.filter((s) => s.slug === onlySlug);
      }
      // Prefer ATS APIs first (higher yield / cleaner data)
      sources.sort((a, b) => {
        const rank = (s) => (s.parser_key === 'greenhouse' || s.parser_key === 'lever' || s.parser_key === 'workable' ? 0 : 1);
        return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
      });
      sources = sources.slice(0, maxSources);

      console.log(`   Active sources to crawl: ${sources.length}`);

      for (const source of sources) {
        if (this.jobsSaved >= maxJobs) break;

        console.log(`\n📋 ${source.name} [${source.parser_key}] ${source.base_url}`);
        let found = 0;
        let saved = 0;
        let errMsg = null;

        try {
          const rawJobs = await fetchJobsForSource(source);
          found = rawJobs.length;
          console.log(`   Found ${found} candidate listing(s)`);

          for (const raw of rawJobs) {
            if (this.jobsSaved >= maxJobs) break;
            this.jobsScraped += 1;

            const job = {
              ...raw,
              job_source_id: source.id,
              source: raw.source || `kenya:${source.slug}`,
              source_type: raw.source_type || source.source_type,
              county_hint: raw.county_hint || source.county_hint,
              country_code: raw.country_code || source.country_code || 'KE',
              verification_status: 'aggregated',
              is_aggregated: true,
            };

            if (!this.validateJob(job)) continue;

            if (dryRun) {
              console.log(`   [DRY RUN] ${job.title} @ ${job.company_name} (${job.location})`);
              this.jobsSaved += 1;
              saved += 1;
            } else {
              const ok = await this.saveJob(job);
              if (ok) {
                this.jobsSaved += 1;
                saved += 1;
              }
            }
          }
        } catch (error) {
          errMsg = error.message;
          this.errors.push({ source: source.slug, error: error.message });
          console.error(`   ❌ ${source.slug}: ${error.message}`);
        }

        if (!dryRun && source.id) {
          await markSourceResult(source.id, { found, saved, error: errMsg });
        }

        await this.delay(800 + Math.random() * 1200);
      }
    } catch (error) {
      console.error(`\n❌ Fatal error in ${this.name}:`, error.message);
      this.errors.push({ error: error.message, fatal: true });
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const results = {
      scraper: this.name,
      jobsScraped: this.jobsScraped,
      jobsSaved: this.jobsSaved,
      errors: this.errors.length,
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
    };

    console.log(`\n✅ ${this.name} completed:`);
    console.log(`   Jobs scraped: ${this.jobsScraped}`);
    console.log(`   Jobs saved: ${this.jobsSaved}`);
    console.log(`   Errors: ${this.errors.length}`);
    console.log(`   Duration: ${duration}s`);

    return results;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dueOnly = args.includes('--due-only');
  const maxJobsArg = args.find((a) => a.startsWith('--max-jobs='));
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const maxJobs = maxJobsArg ? parseInt(maxJobsArg.split('=')[1], 10) : 400;
  const onlySlug = onlyArg ? onlyArg.split('=')[1] : null;

  // Allow running against file only without DB for adapter smoke: --list-sources
  if (args.includes('--list-sources')) {
    const list = loadSourcesFile();
    console.log(`sources.json count: ${list.length}`);
    for (const s of list) {
      console.log(`- ${s.slug} | ${s.parser_key} | ${s.source_type} | ${s.base_url}`);
    }
    process.exit(0);
  }

  const importer = new KenyaCareerImporter();
  const result = await importer.run({ dryRun, maxJobs, dueOnly, onlySlug });
  const db = require('../../db');
  await db.pool.end();
  process.exit(result.errors > 0 && result.jobsSaved === 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = KenyaCareerImporter;
