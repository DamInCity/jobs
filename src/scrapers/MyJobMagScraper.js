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

  /**
   * Extract the real application URL from the "Method of Application" section.
   *
   * Priority:
   *   1. Absolute external http(s) link inside the method section (employer form/ATS)
   *   2. Relative /apply-now/{id} wrapper -> resolved by following its redirects
   *
   * Never returns board nav / CV-builder links (/cv, /cv-match, /contact,
   * /jobs-at/*, /job-application/*) or mailto/tel/javascript targets.
   * Returns { applyUrl, needsResolution } — needsResolution=true means applyUrl
   * is a myjobmag /apply-now/ wrapper that should be resolved via HTTP redirect.
   */
  extractApplyUrl($) {
    const EXCLUDED_PATHS = [
      /^\/cv\b/i,
      /^\/cv-match/i,
      /^\/contact/i,
      /^\/jobs-at\//i,
      /^\/jobs-location\//i,
      /^\/jobs-by-/i,
      /^\/job-application\//i,
      /^\/(page|category)\b/i,
    ];
    const candidatesDirect = [];
    const candidatesWrapper = [];
    const candidatesCv = [];

    const collect = ($scope) => {
      $scope.find('a[href]').each((_, el) => {
        const href = ($(el).attr('href') || '').trim();
        if (!href) return;
        if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
        if (href.startsWith('#')) return;
        let parsed;
        try { parsed = new URL(href, this.baseUrl); } catch { return; }
        if (!['http:', 'https:'].includes(parsed.protocol)) return;
        const path = parsed.pathname;
        if (path === '/' || EXCLUDED_PATHS.some((re) => re.test(path))) return;
        if (/^\/apply-now\/\d+/.test(path)) {
          (parsed.protocol === 'https:' && parsed.host !== new URL(this.baseUrl).host ? candidatesDirect : candidatesWrapper).push({ url: parsed.toString() });
          return;
        }
        // CV links: relative / absolute links whose path/text indicates CV/upload/download
        if (/^\/cv\b/i.test(path) || /upload/i.test(href) || /download/i.test($(el).text())) {
          candidatesCv.push({ url: parsed.toString() });
          return;
        }
        // Any external (non-board) link inside method section = direct apply
        if (parsed.host !== new URL(this.baseUrl).host) {
          candidatesDirect.push({ url: parsed.toString() });
        }
      });
    };

    const methodHeading = $('h2#application-method').first();
    if (methodHeading.length > 0) {
      let section = methodHeading.next();
      while (section.length > 0) {
        if (section.is('p') && /clear:\s*both/i.test(section.attr('style') || '')) break;
        collect(section);
        section = section.next();
      }
    }
    if (candidatesDirect.length === 0 && candidatesWrapper.length === 0 && candidatesCv.length === 0) {
      const scopes = $('article, .job-details, .mag-b').toArray();
      for (const el of scopes.slice(0, 60)) {
        collect($(el));
        if (candidatesDirect.length || candidatesWrapper.length || candidatesCv.length) break;
      }
    }

    let applyUrl = null; let needsResolution = false;
    const direct = candidatesDirect.find((c) => !/myjobmag/.test(new URL(c.url).host));
    if (direct) { applyUrl = direct.url; needsResolution = false; }
    else if (candidatesDirect.length > 0) { applyUrl = candidatesDirect[0].url; needsResolution = false; }
    else if (candidatesWrapper.length > 0) { applyUrl = candidatesWrapper[0].url; needsResolution = true; }

    let cvUrl = null;
    const cvLink = candidatesCv.find((c) => applyUrl ? c.url !== applyUrl : true);
    if (cvLink) cvUrl = cvLink.url;

    return { applyUrl, needsResolution, cvUrl };
  }

  /**
   * Follow a myjobmag /apply-now/{id} wrapper URL to its final destination
   * (employer ATS). Returns the original URL if resolution fails — the wrapper
   * itself still redirects client-side, so it remains a usable apply link.
   */
  async resolveRedirect(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
      });
      clearTimeout(timer);
      // Drain body so the socket is released
      await response.arrayBuffer().catch(() => {});
      const finalUrl = response.url || url;
      if (/^https?:\/\//i.test(finalUrl)) return finalUrl;
      return url;
    } catch {
      return url;
    }
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

      const h1 = this.cleanText($('h1').first().text() || $('.job-title').first().text() || '');

      // Company: /jobs-at/ link or "… at Company" from H1
      let company = '';
      const jobsAtText = this.cleanText($('a[href*="/jobs-at/"]').first().text() || '');
      if (jobsAtText) {
        company = jobsAtText
          .replace(/^view\s+jobs\s+at\s+/i, '')
          .replace(/^read\s+more\s+about\s+this\s+company$/i, '')
          .trim();
      }
      if (!company || /^read more/i.test(company)) {
        const atMatch = h1.match(/\bat\s+(.+)$/i);
        if (atMatch) company = atMatch[1].trim();
      }
      if (!company) {
        company = this.cleanText(
          $('[itemprop="hiringOrganization"]').text() ||
          $('.company-name').text() ||
          'Unknown Employer'
        );
      }

      // Title without trailing " at Company"
      let title = h1;
      if (company) {
        const stripped = title.replace(new RegExp(`\\s+at\\s+${escapeRegExp(company)}\\s*$`, 'i'), '').trim();
        if (stripped) title = stripped;
      }
      // Fallback: strip any trailing " at …"
      if (/\sat\s.+/i.test(title) && company) {
        title = title.replace(/\s+at\s+.+$/i, '').trim() || title;
      }
      if (!title) title = h1;

      const location =
        this.cleanText($('a[href*="/jobs-location/"]').first().text()) ||
        this.cleanText($('.location').text()) ||
        this.extractKeyInfo($, 'Location') ||
        'Kenya';

      const jobTypeRaw =
        this.cleanText($('a[href*="/jobs-by-type/"]').first().text()) ||
        this.extractKeyInfo($, 'Job Type') ||
        this.cleanText($('.job-type').text()) ||
        '';

      const salary =
        this.cleanText($('.salary').text()) ||
        this.extractKeyInfo($, 'Salary') ||
        '';

      const description =
        $('.job-description').html() ||
        $('.job-details').html() ||
        $('[itemprop="description"]').html() ||
        '';

      const requirements =
        $('.requirements').html() ||
        $('.qualifications').html() ||
        null;

      const logo = $('.company-logo img').attr('src') || $('[itemprop="logo"]').attr('src');

      const fieldText =
        this.cleanText($('a[href*="/jobs-by-field/"]').first().text()) ||
        this.extractKeyInfo($, 'Job Field') ||
        this.cleanText($('.job-industry').text()) ||
        '';

      const { mapCategory } = require('./categoryMapper');
      const category = mapCategory({
        title,
        taxonomies: fieldText ? [fieldText] : [],
      });

      // Real apply link from the Method of Application section
      const { applyUrl, needsResolution, cvUrl } = this.extractApplyUrl($);
      let applicationUrl = null;
      if (applyUrl) {
        applicationUrl = needsResolution ? await this.resolveRedirect(applyUrl) : applyUrl;
        try {
          if (new URL(applicationUrl).host === new URL(this.baseUrl).host) {
            applicationUrl = null;
          }
        } catch { applicationUrl = null; }
      }

      let postedDate =
        $('[itemprop="datePosted"]').attr('datetime') ||
        $('time').attr('datetime') ||
        null;

      if (!title || !company) {
        console.warn(`   ⚠️ Could not parse job at ${url}`);
        return null;
      }

      const salaryInfo = this.parseSalary(salary);

      return {
        title: this.cleanText(title),
        company_name: this.cleanText(company),
        company_logo_url: logo ? (logo.startsWith('http') ? logo : `${this.baseUrl}${logo}`) : null,
        description: description || title,
        requirements: requirements || null,
        location: this.cleanText(location) || 'Kenya',
        job_type: this.parseJobType(jobTypeRaw),
        category,
        salary_min: salaryInfo.min,
        salary_max: salaryInfo.max,
        salary_currency: salaryInfo.currency || 'KES',
        external_link: url,
        application_url: applicationUrl,
        cv_url: (cvUrl && cvUrl !== applicationUrl) ? cvUrl : null,
        posted_date: postedDate ? new Date(postedDate) : new Date(),
        expiry_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      console.error(`   Error parsing job at ${url}: ${error.message}`);
      throw error;
    }
  }

  /** Parse "Label value" pairs from .job-key-info blocks */
  extractKeyInfo($, label) {
    const block = this.cleanText($('.job-key-info').text() || '');
    if (!block) return '';
    const re = new RegExp(`${label}\\s+([^\\n]+)`, 'i');
    const m = block.match(re);
    return m ? m[1].trim() : '';
  }
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = MyJobMagScraper;
