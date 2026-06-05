/**
 * BrighterMonday Kenya Scraper
 * Scrapes jobs from brightermonday.co.ke - one of Kenya's largest job boards
 */

const BaseScraper = require('./BaseScraper');

class BrighterMondayScraper extends BaseScraper {
  constructor() {
    super('BrighterMonday', 'https://www.brightermonday.co.ke');
    this.searchUrl = `${this.baseUrl}/jobs`;
  }

  async init() {
    // Use Puppeteer for JavaScript-rendered content
    const puppeteer = require('puppeteer');
    
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
      ],
    });
    
    this.page = await this.browser.newPage();
    
    // Set user agent to avoid blocking
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    // Block unnecessary resources for faster scraping
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    console.log('   Browser initialized');
  }

  async getJobListings() {
    const jobUrls = [];
    let page = 1;
    const maxPages = 5; // Limit pages to scrape

    while (page <= maxPages) {
      const url = page === 1 ? this.searchUrl : `${this.searchUrl}?page=${page}`;
      console.log(`   Fetching page ${page}: ${url}`);

      try {
        await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Wait for job cards to load
        await this.page.waitForSelector('.search-result__item, .job-card, article[data-job-id]', { timeout: 10000 });

        // Extract job URLs from the page
        const urls = await this.page.evaluate(() => {
          const links = [];
          
          // Try multiple selectors for job links
          const selectors = [
            '.search-result__item a[href*="/job/"]',
            '.job-card a[href*="/job/"]',
            'a[href*="/jobs/"][href*="-"]',
            '.job-title a',
            'h3 a[href*="/job"]',
          ];

          for (const selector of selectors) {
            document.querySelectorAll(selector).forEach(a => {
              const href = a.getAttribute('href');
              if (href && !links.includes(href)) {
                links.push(href.startsWith('http') ? href : `https://www.brightermonday.co.ke${href}`);
              }
            });
          }

          return [...new Set(links)];
        });

        if (urls.length === 0) {
          console.log(`   No jobs found on page ${page}, stopping pagination`);
          break;
        }

        jobUrls.push(...urls);
        console.log(`   Found ${urls.length} jobs on page ${page}`);
        
        page++;
        await this.delay(1500);
      } catch (error) {
        console.error(`   Error fetching page ${page}: ${error.message}`);
        break;
      }
    }

    return [...new Set(jobUrls)];
  }

  async parseJob(url) {
    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for job content to load
      await this.page.waitForSelector('h1, .job-title', { timeout: 10000 });

      const job = await this.page.evaluate(() => {
        // Helper to get text content safely
        const getText = (selector) => {
          const el = document.querySelector(selector);
          return el ? el.textContent.trim() : null;
        };

        // Get job title
        const title = getText('h1') || getText('.job-title') || getText('[itemprop="title"]');

        // Get company name
        const company = getText('.company-link') || 
                       getText('[itemprop="hiringOrganization"]') ||
                       getText('.employer-name') ||
                       getText('a[href*="/companies/"]');

        // Get location
        const location = getText('[itemprop="jobLocation"]') ||
                        getText('.location') ||
                        getText('.job-location') ||
                        'Kenya';

        // Get job type
        const jobTypeEl = document.querySelector('[itemprop="employmentType"]') ||
                         document.querySelector('.employment-type');
        const jobType = jobTypeEl ? jobTypeEl.textContent.trim() : '';

        // Get salary
        const salary = getText('[itemprop="baseSalary"]') ||
                      getText('.salary') ||
                      getText('.compensation');

        // Get description
        const descEl = document.querySelector('[itemprop="description"]') ||
                      document.querySelector('.job-description') ||
                      document.querySelector('.description');
        const description = descEl ? descEl.innerHTML : '';

        // Get requirements
        const reqEl = document.querySelector('.requirements') ||
                     document.querySelector('.qualifications');
        const requirements = reqEl ? reqEl.innerHTML : '';

        // Get company logo
        const logoEl = document.querySelector('.company-logo img') ||
                      document.querySelector('[itemprop="logo"]') ||
                      document.querySelector('.employer-logo img');
        const logo = logoEl ? logoEl.getAttribute('src') : null;

        // Get posted date
        const dateEl = document.querySelector('[itemprop="datePosted"]') ||
                      document.querySelector('.posted-date') ||
                      document.querySelector('time');
        const postedDate = dateEl ? dateEl.getAttribute('datetime') || dateEl.textContent : null;

        // Get category
        const category = getText('.job-category') ||
                        getText('.industry') ||
                        getText('[itemprop="occupationalCategory"]');

        return {
          title,
          company,
          location,
          jobType,
          salary,
          description,
          requirements,
          logo,
          postedDate,
          category,
        };
      });

      if (!job.title || !job.company) {
        console.warn(`   ⚠️ Could not parse job at ${url}`);
        return null;
      }

      // Process the scraped data
      const salaryInfo = this.parseSalary(job.salary);

      return {
        title: this.cleanText(job.title),
        company_name: this.cleanText(job.company),
        company_logo_url: job.logo,
        description: job.description || '',
        requirements: job.requirements || null,
        location: this.cleanText(job.location) || 'Kenya',
        job_type: this.parseJobType(job.jobType),
        category: job.category,
        salary_min: salaryInfo.min,
        salary_max: salaryInfo.max,
        salary_currency: salaryInfo.currency,
        external_link: url,
        posted_date: job.postedDate ? new Date(job.postedDate) : new Date(),
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      console.error(`   Error parsing job at ${url}: ${error.message}`);
      throw error;
    }
  }
}

module.exports = BrighterMondayScraper;
