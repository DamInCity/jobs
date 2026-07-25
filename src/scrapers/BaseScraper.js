/**
 * Base Scraper Class
 * Provides common functionality for all job scrapers
 */

const { saveJobRecord } = require('../db/saveJobRecord');
const { preprocessJob } = require('./preprocessJob');

class BaseScraper {
  constructor(name, baseUrl) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.browser = null;
    this.page = null;
    this.jobsScraped = 0;
    this.jobsSaved = 0;
    this.errors = [];
  }

  /**
   * Initialize the scraper (browser or http client)
   */
  async init() {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Close browser/connections
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Get list of job URLs to scrape
   * @returns {Promise<string[]>} Array of job URLs
   */
  async getJobListings() {
    throw new Error('getJobListings() must be implemented by subclass');
  }

  /**
   * Parse a single job page
   * @param {string} url - Job URL
   * @returns {Promise<Object>} Job data
   */
  async parseJob(url) {
    throw new Error('parseJob() must be implemented by subclass');
  }

  /**
   * Run the scraper
   * @param {Object} options - Scraper options
   * @returns {Promise<Object>} Scraping results
   */
  async run(options = {}) {
    const { maxJobs = 50, dryRun = false } = options;
    
    console.log(`\n🚀 Starting ${this.name} scraper...`);
    console.log(`   Max jobs: ${maxJobs}`);
    console.log(`   Dry run: ${dryRun}`);
    
    const startTime = Date.now();

    try {
      await this.init();

      // Get job listings
      console.log(`\n📋 Fetching job listings from ${this.baseUrl}...`);
      const jobUrls = await this.getJobListings();
      console.log(`   Found ${jobUrls.length} job URLs`);

      // Limit jobs to scrape
      const urlsToScrape = jobUrls.slice(0, maxJobs);
      console.log(`   Scraping ${urlsToScrape.length} jobs...\n`);

      // Process each job
      for (const url of urlsToScrape) {
        try {
          const job = await this.parseJob(url);
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

          // Random delay to be polite
          await this.delay(1000 + Math.random() * 2000);
        } catch (error) {
          this.errors.push({ url, error: error.message });
          console.error(`   ❌ Error scraping ${url}: ${error.message}`);
        }
      }
    } catch (error) {
      console.error(`\n❌ Fatal error in ${this.name} scraper:`, error.message);
      this.errors.push({ error: error.message, fatal: true });
    } finally {
      await this.close();
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

    console.log(`\n✅ ${this.name} scraper completed:`);
    console.log(`   Jobs scraped: ${this.jobsScraped}`);
    console.log(`   Jobs saved: ${this.jobsSaved}`);
    console.log(`   Errors: ${this.errors.length}`);
    console.log(`   Duration: ${duration}s`);

    return results;
  }

  /**
   * Validate job data before saving (runs shared preprocess rules)
   */
  validateJob(job) {
    const result = preprocessJob(
      { ...job, source: job.source || this.name },
      { defaultSource: this.name }
    );
    if (!result.ok) {
      console.warn(`   ⚠️ Invalid job (${result.reason}): ${job?.title || 'unknown'}`);
      return false;
    }
    // Mutate in place so saveJob gets normalized fields
    Object.assign(job, result.job);
    return true;
  }

  /**
   * Save job to database (deduplicating by external_link)
   */
  async saveJob(job) {
    try {
      const result = await saveJobRecord(job, {
        source: this.name,
        skipPreprocess: true, // already validated/normalized
      });
      if (!result.saved) {
        console.log(`   ⏭️  Skipped (${result.reason}): ${job.title}`);
        return false;
      }
      console.log(`   ✅ Saved: ${job.title} at ${job.company_name}`);
      return true;
    } catch (error) {
      console.error(`   ❌ Error saving job: ${error.message}`);
      this.errors.push({ job: job.title, error: error.message });
      return false;
    }
  }

  /**
   * Helper: Delay execution
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Helper: Parse salary string to min/max values
   * Handles formats like "KES 50,000 - 100,000", "50k-100k", etc.
   */
  parseSalary(salaryText) {
    if (!salaryText) return { min: null, max: null, currency: 'KES' };

    const cleaned = salaryText.replace(/,/g, '').toUpperCase();
    
    // Detect currency
    let currency = 'KES';
    if (cleaned.includes('USD') || cleaned.includes('$')) currency = 'USD';
    else if (cleaned.includes('EUR') || cleaned.includes('€')) currency = 'EUR';

    // Extract numbers
    const numbers = cleaned.match(/\d+(?:\.\d+)?[KM]?/g);
    if (!numbers || numbers.length === 0) {
      return { min: null, max: null, currency };
    }

    const parseNumber = (str) => {
      let num = parseFloat(str);
      if (str.includes('K')) num *= 1000;
      if (str.includes('M')) num *= 1000000;
      return Math.round(num);
    };

    const values = numbers.map(parseNumber);
    
    if (values.length === 1) {
      return { min: values[0], max: values[0], currency };
    }
    
    return { 
      min: Math.min(...values), 
      max: Math.max(...values), 
      currency 
    };
  }

  /**
   * Helper: Determine job type from text
   */
  parseJobType(text) {
    if (!text) return 'onsite';
    const lower = text.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('hybrid')) return 'hybrid';
    return 'onsite';
  }

  /**
   * Helper: Clean HTML from text
   */
  cleanText(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = BaseScraper;
