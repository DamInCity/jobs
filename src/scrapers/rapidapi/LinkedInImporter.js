/**
 * LinkedIn Job Search API (Fantastic.jobs via RapidAPI)
 * Host: linkedin-job-search-api.p.rapidapi.com
 * Primary endpoint: GET /active-jb (not /active-jb-count)
 */

const BaseScraper = require('../BaseScraper');
const RapidApiClient = require('./RapidApiClient');
const { mapCategory } = require('../categoryMapper');
const config = require('../../config');

const HOST = 'linkedin-job-search-api.p.rapidapi.com';

const DEFAULT_TITLES = [
  'Software Engineer',
  'Data Engineer',
  'Product Manager',
  'Designer',
  'Marketing',
  'Sales',
  'DevOps',
  'Finance',
  'Customer Success',
  'Human Resources',
];

const DEFAULT_LOCATION = '"United States" OR "United Kingdom" OR "Kenya" OR "Germany"';

class LinkedInImporter extends BaseScraper {
  constructor() {
    super('LinkedIn', `https://${HOST}`);
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
    const timeFrame = options.timeFrame || '7d';
    const pageSize = Math.min(options.pageSize || 100, 1000);
    const location = options.location || DEFAULT_LOCATION;

    console.log(`\n🚀 Starting ${this.name} importer...`);
    console.log(`   Max jobs: ${maxJobs}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   time_frame: ${timeFrame}`);
    console.log(`   Request budget: ${this.client.maxRequests}`);

    const startTime = Date.now();

    try {
      await this.init();

      outer: for (const title of titles) {
        let offset = 0;

        while (this.jobsSaved < maxJobs && this.client.remainingRequests > 0) {
          console.log(`\n📋 LinkedIn active-jb: title="${title}" offset=${offset} limit=${pageSize}`);

          let payload;
          try {
            payload = await this.client.get(HOST, '/active-jb', {
              time_frame: timeFrame,
              limit: String(pageSize),
              offset: String(offset),
              title,
              location,
              description_format: 'text',
              source: 'linkedin',
            });
          } catch (error) {
            this.errors.push({ title, offset, error: error.message });
            console.error(`   ❌ ${error.message}`);
            // Some plans use different param names — try once without source filter
            if (offset === 0 && String(error.message).includes('400')) {
              try {
                payload = await this.client.get(HOST, '/active-jb', {
                  time_frame: timeFrame,
                  limit: String(pageSize),
                  offset: String(offset),
                  title,
                  location,
                  description_format: 'text',
                });
              } catch (retryError) {
                this.errors.push({ title, offset, error: retryError.message });
                console.error(`   ❌ retry: ${retryError.message}`);
                break;
              }
            } else {
              if (String(error.message).includes('request budget')) break outer;
              break;
            }
          }

          const jobs = normalizeList(payload);
          if (jobs.length === 0) {
            console.log('   No more results for this title');
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
              this.errors.push({ title: raw?.title, error: error.message });
              console.error(`   ❌ Map/save error: ${error.message}`);
            }
          }

          if (jobs.length < pageSize) break;
          offset += pageSize;
          await this.delay(400 + Math.random() * 400);
        }
      }
    } catch (error) {
      console.error(`\n❌ Fatal error in ${this.name}:`, error.message);
      this.errors.push({ error: error.message, fatal: true });
    }

    return this.finish(startTime);
  }

  mapJob(raw) {
    const externalLink = raw.url || raw.job_url || raw.external_url;
    if (!externalLink) return null;

    const location =
      (Array.isArray(raw.locations_derived) && raw.locations_derived[0]) ||
      (Array.isArray(raw.cities_derived) && raw.cities_derived[0]) ||
      (Array.isArray(raw.countries_derived) && raw.countries_derived[0]) ||
      'Remote';

    const arrangement = String(raw.ai_work_arrangement || raw.location_type || '').toLowerCase();
    let jobType = 'onsite';
    if (arrangement.includes('remote') || arrangement === 'telecommute') jobType = 'remote';
    else if (arrangement.includes('hybrid')) jobType = 'hybrid';

    const salaryPeriod = String(raw.ai_salary_unit_text || 'YEAR').toLowerCase();
    const periodMap = {
      year: 'yearly',
      yearly: 'yearly',
      month: 'monthly',
      monthly: 'monthly',
      hour: 'hourly',
      hourly: 'hourly',
      week: 'weekly',
      weekly: 'weekly',
      day: 'daily',
    };

    const description =
      raw.description_text ||
      raw.description_html ||
      raw.ai_core_responsibilities ||
      raw.title ||
      '';

    const benefits = Array.isArray(raw.ai_benefits)
      ? raw.ai_benefits.join('; ')
      : null;

    return {
      title: raw.title,
      company_name: raw.organization || raw.company_name || 'Unknown Company',
      company_logo_url: raw.organization_logo || raw.org_logo_permalink || null,
      company_website: raw.org_linkedin_website || raw.organization_url || null,
      description,
      requirements: raw.ai_requirements_summary || null,
      benefits,
      location,
      job_type: jobType,
      category: mapCategory({
        title: raw.title,
        taxonomies: raw.ai_taxonomies_a || [],
      }),
      salary_min: numberOrNull(raw.ai_salary_min_value ?? raw.ai_salary_value),
      salary_max: numberOrNull(raw.ai_salary_max_value ?? raw.ai_salary_value),
      salary_currency: raw.ai_salary_currency || 'USD',
      salary_period: periodMap[salaryPeriod] || 'yearly',
      external_link: externalLink,
      posted_date: raw.date_posted ? new Date(raw.date_posted) : new Date(),
      expiry_date: raw.date_valid_through ? new Date(raw.date_valid_through) : undefined,
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

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

module.exports = LinkedInImporter;
