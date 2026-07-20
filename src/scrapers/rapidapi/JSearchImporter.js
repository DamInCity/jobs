/**
 * JSearch (RapidAPI) importer — multi-board jobs via Google for Jobs.
 * Host: jsearch.p.rapidapi.com
 * Primary endpoint: GET /search
 */

const BaseScraper = require('../BaseScraper');
const RapidApiClient = require('./RapidApiClient');
const { mapCategory } = require('../categoryMapper');
const config = require('../../config');

const HOST = 'jsearch.p.rapidapi.com';

const DEFAULT_TITLES = [
  'software engineer',
  'full stack developer',
  'data engineer',
  'data scientist',
  'devops engineer',
  'product manager',
  'ui ux designer',
  'digital marketing manager',
  'sales representative',
  'customer success',
  'finance analyst',
  'hr business partner',
];

// query location fragment + country code
const DEFAULT_LOCATIONS = [
  { query: 'United States', country: 'us' },
  { query: 'United Kingdom', country: 'gb' },
  { query: 'Kenya', country: 'ke' },
  { query: 'Germany', country: 'de' },
  { query: 'remote', country: 'us', workFromHome: true },
];

class JSearchImporter extends BaseScraper {
  constructor() {
    super('JSearch', `https://${HOST}`);
    this.client = new RapidApiClient();
  }

  async init() {
    this.client.ensureKey();
  }

  async getJobListings() {
    return [];
  }

  async parseJob() {
    return null;
  }

  async run(options = {}) {
    const maxJobs = options.maxJobs || config.rapidapi.maxJobsPerSource;
    const dryRun = options.dryRun || false;
    const titles = options.titles || DEFAULT_TITLES;
    const locations = options.locations || DEFAULT_LOCATIONS;
    const maxPages = options.maxPages || 3;

    console.log(`\n🚀 Starting ${this.name} importer...`);
    console.log(`   Max jobs: ${maxJobs}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Request budget: ${this.client.maxRequests}`);

    const startTime = Date.now();

    try {
      await this.init();

      outer: for (const title of titles) {
        for (const loc of locations) {
          if (this.jobsSaved >= maxJobs) break outer;

          for (let page = 1; page <= maxPages; page++) {
            if (this.jobsSaved >= maxJobs || this.client.remainingRequests <= 0) break outer;

            const query = loc.workFromHome
              ? `${title} remote`
              : `${title} in ${loc.query}`;

            console.log(`\n📋 JSearch: "${query}" (page ${page}, country=${loc.country})`);

            let payload;
            try {
              // RapidAPI JSearch uses /search-v2 (legacy /search is 404 on marketplace)
              payload = await this.client.get(HOST, '/search-v2', {
                query,
                page: String(page),
                num_pages: '1',
                country: loc.country,
                date_posted: options.datePosted || 'month',
                ...(loc.workFromHome ? { work_from_home: 'true' } : {}),
              });
            } catch (error) {
              this.errors.push({ query, page, error: error.message });
              console.error(`   ❌ ${error.message}`);
              if (String(error.message).includes('request budget')) break outer;
              break;
            }

            // search-v2 shape: { data: { jobs: [...], cursor } }
            const jobs =
              (Array.isArray(payload?.data?.jobs) && payload.data.jobs) ||
              (Array.isArray(payload?.data) && payload.data) ||
              (Array.isArray(payload?.jobs) && payload.jobs) ||
              [];
            if (!Array.isArray(jobs) || jobs.length === 0) {
              console.log('   No more results for this query');
              break;
            }

            console.log(`   Found ${jobs.length} jobs`);

            for (const raw of jobs) {
              if (this.jobsSaved >= maxJobs) break outer;
              try {
                const job = this.mapJob(raw);
                this.jobsScraped++;

                if (job && this.validateJob(job)) {
                  if (!dryRun) {
                    const saved = await this.saveJob(job);
                    if (saved) this.jobsSaved++;
                  } else {
                    console.log(`   [DRY RUN] Would save: ${job.title} at ${job.company_name}`);
                    this.jobsSaved++;
                  }
                }
              } catch (error) {
                this.errors.push({ title: raw?.job_title, error: error.message });
                console.error(`   ❌ Map/save error: ${error.message}`);
              }
            }

            await this.delay(400 + Math.random() * 400);
          }
        }
      }
    } catch (error) {
      console.error(`\n❌ Fatal error in ${this.name}:`, error.message);
      this.errors.push({ error: error.message, fatal: true });
    }

    return this.finish(startTime);
  }

  mapJob(raw) {
    const applyLink =
      raw.job_apply_link ||
      raw.apply_options?.[0]?.apply_link ||
      raw.job_google_link;

    if (!applyLink) return null;

    const requirements = Array.isArray(raw.job_highlights?.Qualifications)
      ? `<ul>${raw.job_highlights.Qualifications.map((q) => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`
      : null;

    const benefitsFromHighlights = Array.isArray(raw.job_highlights?.Benefits)
      ? raw.job_highlights.Benefits.join('; ')
      : null;
    const benefitsFromList = Array.isArray(raw.job_benefits)
      ? raw.job_benefits.join(', ')
      : null;

    let jobType = 'onsite';
    if (raw.job_is_remote === true || raw.work_arrangement === 'remote') jobType = 'remote';
    else if (raw.work_arrangement === 'hybrid') jobType = 'hybrid';
    else if (typeof raw.job_is_remote === 'string' && raw.job_is_remote.toLowerCase().includes('remote')) {
      jobType = 'remote';
    }

    const salaryPeriod = (raw.job_salary_period || 'YEARLY').toString().toLowerCase();
    const periodMap = {
      year: 'yearly',
      yearly: 'yearly',
      month: 'monthly',
      monthly: 'monthly',
      hour: 'hourly',
      hourly: 'hourly',
      week: 'weekly',
      weekly: 'weekly',
    };

    return {
      title: raw.job_title,
      company_name: raw.employer_name || 'Unknown Company',
      company_logo_url: raw.employer_logo || null,
      company_website: raw.employer_website || null,
      description: raw.job_description || raw.job_title || '',
      requirements,
      benefits: benefitsFromHighlights || benefitsFromList || null,
      location: raw.job_location || [raw.job_city, raw.job_state, raw.job_country].filter(Boolean).join(', ') || 'Remote',
      job_type: jobType,
      category: mapCategory({ title: raw.job_title, taxonomies: raw.job_function ? [raw.job_function] : [] }),
      salary_min: numberOrNull(raw.job_min_salary),
      salary_max: numberOrNull(raw.job_max_salary),
      salary_currency: raw.job_salary_currency || 'USD',
      salary_period: periodMap[salaryPeriod] || 'yearly',
      external_link: applyLink,
      posted_date: raw.job_posted_at_datetime_utc
        ? new Date(raw.job_posted_at_datetime_utc)
        : raw.job_posted_at_timestamp
          ? new Date(raw.job_posted_at_timestamp * 1000)
          : new Date(),
    };
  }

  finish(startTime) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const results = {
      scraper: this.name,
      jobsScraped: this.jobsScraped,
      jobsSaved: this.jobsSaved,
      errors: this.errors.length,
      duration: `${duration}s`,
      requests: this.client.requestCount,
      timestamp: new Date().toISOString(),
    };

    console.log(`\n✅ ${this.name} importer completed:`);
    console.log(`   Jobs scraped: ${this.jobsScraped}`);
    console.log(`   Jobs saved: ${this.jobsSaved}`);
    console.log(`   Errors: ${this.errors.length}`);
    console.log(`   API requests: ${this.client.requestCount}`);
    console.log(`   Duration: ${duration}s`);

    return results;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = JSearchImporter;
