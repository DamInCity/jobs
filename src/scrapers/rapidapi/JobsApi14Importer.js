/**
 * Jobs API14 (RapidAPI) importer
 * Host: jobs-api14.p.rapidapi.com
 * - Listing via search endpoints (best-effort across known paths)
 * - Salary enrichment via GET /v2/salary/range
 */

const BaseScraper = require('../BaseScraper');
const RapidApiClient = require('./RapidApiClient');
const { mapCategory } = require('../categoryMapper');
const config = require('../../config');
const db = require('../../db');

const HOST = 'jobs-api14.p.rapidapi.com';

const DEFAULT_QUERIES = [
  { query: 'software engineer', location: 'United States' },
  { query: 'data engineer', location: 'United Kingdom' },
  { query: 'product manager', location: 'United States' },
  { query: 'devops engineer', location: 'Germany' },
  { query: 'marketing manager', location: 'United States' },
  { query: 'software developer', location: 'Kenya' },
];

// Working Jobs API14 listing paths (probed against live RapidAPI)
const SEARCH_CANDIDATES = [
  {
    path: '/v2/linkedin/search',
    buildParams: (q) => ({ query: q.query, location: q.location }),
  },
  {
    path: '/v2/bing/search',
    buildParams: (q) => ({ query: `${q.query} ${q.location || ''}`.trim() }),
  },
  {
    path: '/v2/indeed/search',
    buildParams: (q) => ({
      query: q.query,
      location: q.location,
      countryCode: q.countryCode || 'us',
    }),
  },
];

class JobsApi14Importer extends BaseScraper {
  constructor() {
    super('JobsAPI14', `https://${HOST}`);
    this.client = new RapidApiClient();
    this.workingSearchPath = null;
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
    const maxJobs = options.maxJobs || Math.min(config.rapidapi.maxJobsPerSource, 150);
    const dryRun = options.dryRun || false;
    const queries = options.queries || DEFAULT_QUERIES;
    const enrichSalaries = options.enrichSalaries !== false;

    console.log(`\n🚀 Starting ${this.name} importer...`);
    console.log(`   Max jobs: ${maxJobs}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Request budget: ${this.client.maxRequests}`);

    const startTime = Date.now();

    try {
      await this.init();

      for (const q of queries) {
        if (this.jobsSaved >= maxJobs || this.client.remainingRequests <= 0) break;

        console.log(`\n📋 JobsAPI14 search: "${q.query}" @ ${q.location}`);
        let jobs = [];

        try {
          jobs = await this.searchJobs(q);
        } catch (error) {
          this.errors.push({ query: q.query, error: error.message });
          console.error(`   ❌ ${error.message}`);
          if (String(error.message).includes('request budget')) break;
          continue;
        }

        console.log(`   Found ${jobs.length} jobs`);

        for (const raw of jobs) {
          if (this.jobsSaved >= maxJobs) break;
          try {
            let enriched = raw;
            // LinkedIn list rows are thin — pull full description when budget allows
            if (
              raw.id &&
              this.workingSearchPath === '/v2/linkedin/search' &&
              this.client.remainingRequests > 0 &&
              !this.client.quotaExceeded &&
              !raw.description
            ) {
              try {
                const detail = await this.client.get(HOST, '/v2/linkedin/get', {
                  id: String(raw.id),
                });
                if (detail?.data) {
                  enriched = { ...raw, ...detail.data };
                }
              } catch (detailError) {
                console.warn(`   ⚠️ detail fetch failed for ${raw.id}: ${detailError.message.slice(0, 100)}`);
              }
            }

            const job = this.mapJob(enriched, q);
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
            this.errors.push({ title: raw?.title, error: error.message });
            console.error(`   ❌ Map/save error: ${error.message}`);
          }
        }

        await this.delay(400 + Math.random() * 400);
      }

      if (
        enrichSalaries &&
        !dryRun &&
        this.client.remainingRequests > 0 &&
        !this.client.quotaExceeded
      ) {
        await this.enrichMissingSalaries();
      }
    } catch (error) {
      console.error(`\n❌ Fatal error in ${this.name}:`, error.message);
      this.errors.push({ error: error.message, fatal: true });
    }

    return this.finish(startTime);
  }

  async searchJobs(queryObj) {
    const candidates = this.workingSearchPath
      ? SEARCH_CANDIDATES.filter((c) => c.path === this.workingSearchPath)
      : SEARCH_CANDIDATES;

    let lastError;

    for (const candidate of candidates) {
      if (this.client.remainingRequests <= 0) break;
      try {
        const payload = await this.client.get(
          HOST,
          candidate.path,
          candidate.buildParams(queryObj)
        );
        const jobs = normalizeList(payload);
        // Treat non-array / error-shaped responses as failure
        if (payload && payload.message && jobs.length === 0 && payload.error) {
          throw new Error(payload.message);
        }
        this.workingSearchPath = candidate.path;
        console.log(`   Using endpoint ${candidate.path}`);
        return jobs;
      } catch (error) {
        lastError = error;
        // 404/400 means try next path
        if (
          String(error.message).includes('404') ||
          String(error.message).includes('400') ||
          String(error.message).includes('401') ||
          String(error.message).includes('403')
        ) {
          console.warn(`   ⚠️ ${candidate.path} failed: ${error.message.slice(0, 120)}`);
          continue;
        }
        throw error;
      }
    }

    if (lastError) throw lastError;
    return [];
  }

  mapJob(raw, queryObj = {}) {
    const title = raw.title || raw.jobTitle || raw.job_title || raw.name;
    const company =
      raw.company ||
      raw.companyName ||
      raw.company_name ||
      raw.employer ||
      'Unknown Company';
    const externalLink =
      raw.linkedinUrl ||
      raw.url ||
      raw.jobUrl ||
      raw.job_url ||
      raw.applyUrl ||
      raw.apply_url ||
      raw.link ||
      raw.external_link ||
      (raw.id ? `https://www.linkedin.com/jobs/view/${raw.id}` : null);

    if (!title || !externalLink) return null;

    const location =
      raw.location ||
      raw.jobLocation ||
      raw.job_location ||
      [raw.city, raw.state, raw.country].filter(Boolean).join(', ') ||
      queryObj.location ||
      'Remote';

    // LinkedIn list endpoint is often summary-only — still usable as a listing
    const description =
      raw.description ||
      raw.jobDescription ||
      raw.job_description ||
      raw.snippet ||
      `${title} at ${company}` + (location ? ` (${location})` : '');

    const salaryMin = numberOrNull(
      raw.salaryMin ?? raw.salary_min ?? raw.minSalary ?? raw.min_salary
    );
    const salaryMax = numberOrNull(
      raw.salaryMax ?? raw.salary_max ?? raw.maxSalary ?? raw.max_salary
    );

    return {
      title,
      company_name: company,
      company_logo_url: raw.companyLogo || raw.company_logo || raw.logo || null,
      description,
      requirements: raw.requirements || null,
      benefits: raw.benefits || null,
      location,
      job_type: this.parseJobType(
        `${raw.employmentType || ''} ${raw.jobType || ''} ${location} ${title}`
      ),
      category: mapCategory({ title }),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_currency: raw.salaryCurrency || raw.currency || 'USD',
      salary_period: 'yearly',
      external_link: externalLink,
      posted_date: raw.datePosted || raw.postedAt || raw.date
        ? new Date(raw.datePosted || raw.postedAt || raw.date)
        : new Date(),
    };
  }

  /**
   * Fill salary for a small sample of JobsAPI14 / null-salary active jobs
   * using /v2/salary/range (rate-limited).
   */
  async enrichMissingSalaries() {
    console.log('\n💰 Enriching missing salaries via JobsAPI14 /v2/salary/range...');

    let rows;
    try {
      const result = await db.query(`
        SELECT id, title, location, salary_currency
        FROM jobs
        WHERE status = 'active'
          AND salary_min IS NULL
          AND salary_max IS NULL
        ORDER BY posted_date DESC
        LIMIT 10
      `);
      rows = result.rows;
    } catch (error) {
      console.warn(`   ⚠️ Could not load jobs for salary enrichment: ${error.message}`);
      return;
    }

    for (const row of rows) {
      if (this.client.remainingRequests <= 0) break;

      const countryCode = guessCountryCode(row.location);
      try {
        const payload = await this.client.get(HOST, '/v2/salary/range', {
          query: row.title,
          countryCode,
        });

        const range = extractSalaryRange(payload);
        if (!range) {
          console.log(`   ⏭️  No salary data for: ${row.title}`);
          continue;
        }

        await db.query(
          `UPDATE jobs
           SET salary_min = $1, salary_max = $2, salary_currency = $3, salary_period = $4
           WHERE id = $5`,
          [
            range.min,
            range.max,
            range.currency || row.salary_currency || 'USD',
            range.period || 'yearly',
            row.id,
          ]
        );
        console.log(`   ✅ Salary for ${row.title}: ${range.min}-${range.max} ${range.currency || ''}`);
      } catch (error) {
        this.errors.push({ salaryEnrich: row.title, error: error.message });
        console.warn(`   ⚠️ Salary enrich failed for ${row.title}: ${error.message}`);
      }

      await this.delay(300);
    }
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

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.jobs?.jobs)) return payload.jobs.jobs;
  return [];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[,$]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function guessCountryCode(location = '') {
  const lower = String(location).toLowerCase();
  if (lower.includes('kenya') || lower.includes('nairobi')) return 'ke';
  if (lower.includes('germany') || lower.includes('berlin')) return 'de';
  if (lower.includes('united kingdom') || lower.includes('london') || lower.includes('uk')) return 'gb';
  if (lower.includes('canada')) return 'ca';
  return 'us';
}

function extractSalaryRange(payload) {
  if (!payload) return null;

  // Common shapes
  const candidates = [
    payload,
    payload.data,
    payload.result,
    Array.isArray(payload.data) ? payload.data[0] : null,
    Array.isArray(payload) ? payload[0] : null,
  ].filter(Boolean);

  for (const item of candidates) {
    const min = numberOrNull(
      item.min ?? item.minSalary ?? item.salaryMin ?? item.min_salary ?? item.salary_min
    );
    const max = numberOrNull(
      item.max ?? item.maxSalary ?? item.salaryMax ?? item.max_salary ?? item.salary_max
    );
    if (min != null || max != null) {
      return {
        min: min ?? max,
        max: max ?? min,
        currency: item.currency || item.salaryCurrency || 'USD',
        period: (item.period || item.salaryPeriod || 'yearly').toString().toLowerCase(),
      };
    }
  }

  return null;
}

module.exports = JobsApi14Importer;
