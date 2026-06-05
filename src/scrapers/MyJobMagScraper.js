/**
 * MyJobMag Kenya Scraper
 * Scrapes jobs from myjobmag.co.ke - uses Cheerio for lightweight HTML parsing
 */

const BaseScraper = require('./BaseScraper');

class MyJobMagScraper extends BaseScraper {
  constructor() {
    super('MyJobMag', 'https://www.myjobmag.co.ke');
    this.searchUrl = `${this.baseUrl}/jobs`;
    this.cheerio = null;
  }

  async init() {
    // Use Cheerio for simpler HTML parsing (no JavaScript execution needed)
    this.cheerio = require('cheerio');
    console.log('   Cheerio parser initialized');
  }

  async close() {
    // No browser to close for Cheerio
    this.cheerio = null;
  }

  async fetchHtml(url) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.text();
  }

  async getJobListings() {
    const jobUrls = [];
    let page = 1;
    const maxPages = 5;

    while (page <= maxPages) {
      const url = page === 1 ? this.searchUrl : `${this.searchUrl}?page=${page}`;
      console.log(`   Fetching page ${page}: ${url}`);

      try {
        const html = await this.fetchHtml(url);
        const $ = this.cheerio.load(html);

        // Extract job URLs
        const urls = [];
        $('a[href*="/job/"], a[href*="/jobs/"], .job-title a, h2 a, h3 a').each((i, el) => {
          const href = $(el).attr('href');
          if (href && (href.includes('/job/') || href.includes('/jobs/'))) {
            const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;
            if (!urls.includes(fullUrl)) {
              urls.push(fullUrl);
            }
          }
        });

        if (urls.length === 0) {
          console.log(`   No jobs found on page ${page}, stopping pagination`);
          break;
        }

        jobUrls.push(...urls);
        console.log(`   Found ${urls.length} jobs on page ${page}`);

        page++;
        await this.delay(1000);
      } catch (error) {
        console.error(`   Error fetching page ${page}: ${error.message}`);
        break;
      }
    }

    return [...new Set(jobUrls)];
  }

  async parseJob(url) {
    try {
      const html = await this.fetchHtml(url);
      const $ = this.cheerio.load(html);

      // Extract job data
      const title = $('h1').first().text().trim() ||
                   $('.job-title').first().text().trim();

      const company = $('.company-name').text().trim() ||
                     $('[itemprop="hiringOrganization"]').text().trim() ||
                     $('a[href*="/company/"]').first().text().trim();

      const location = $('.location').text().trim() ||
                      $('[itemprop="jobLocation"]').text().trim() ||
                      'Kenya';

      const jobType = $('.job-type').text().trim() ||
                     $('[itemprop="employmentType"]').text().trim() ||
                     '';

      const salary = $('.salary').text().trim() ||
                    $('[itemprop="baseSalary"]').text().trim() ||
                    '';

      const description = $('.job-description').html() ||
                         $('[itemprop="description"]').html() ||
                         $('.description').html() ||
                         '';

      const requirements = $('.requirements').html() ||
                          $('.qualifications').html() ||
                          '';

      const logo = $('.company-logo img').attr('src') ||
                  $('[itemprop="logo"]').attr('src');

      const category = $('.category').text().trim() ||
                      $('.industry').text().trim() ||
                      '';

      // Posted date extraction
      let postedDate = $('[itemprop="datePosted"]').attr('datetime') ||
                      $('time').attr('datetime') ||
                      null;

      if (!title || !company) {
        console.warn(`   ⚠️ Could not parse job at ${url}`);
        return null;
      }

      // Process salary
      const salaryInfo = this.parseSalary(salary);

      return {
        title: this.cleanText(title),
        company_name: this.cleanText(company),
        company_logo_url: logo ? (logo.startsWith('http') ? logo : `${this.baseUrl}${logo}`) : null,
        description: description,
        requirements: requirements || null,
        location: this.cleanText(location) || 'Kenya',
        job_type: this.parseJobType(jobType),
        category: category,
        salary_min: salaryInfo.min,
        salary_max: salaryInfo.max,
        salary_currency: salaryInfo.currency,
        external_link: url,
        posted_date: postedDate ? new Date(postedDate) : new Date(),
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      console.error(`   Error parsing job at ${url}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MyJobMagScraper;
