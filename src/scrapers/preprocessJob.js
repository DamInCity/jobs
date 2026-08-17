/**
 * Shared job preprocessing for scrapers, ingest API, and n8n Code-node parity.
 */

const { mapCategory } = require('./categoryMapper');
const { normalizeCounty, isKenyaLocation } = require('./kenya/counties');
const { inferSourceType, defaultVerification, SOURCE_TYPES } = require('./kenya/sourceTypes');

const SPAM_PATTERNS = [
  /earn\s+\$+\s*\d+/i,
  /work\s+from\s+home\s+and\s+make/i,
  /no\s+experience\s+needed.*\$/i,
  /crypto\s+airdrop/i,
  /click\s+here\s+to\s+get\s+rich/i,
];

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref', 'ref_src',
]);

/**
 * @param {object} raw - Incoming job-like object
 * @param {object} [options]
 * @param {number} [options.maxAgeDays=45]
 * @param {string} [options.defaultSource]
 * @returns {{ ok: true, job: object } | { ok: false, reason: string }}
 */
function preprocessJob(raw, options = {}) {
  const maxAgeDays = options.maxAgeDays ?? 45;
  const input = raw && typeof raw === 'object' ? { ...raw } : {};

  let title = String(input.title || input.job_title || '').trim();
  let company = String(input.company_name || input.company || input.employer_name || '').trim();
  let externalLink = String(
    input.external_link || input.url || input.apply_url || input.job_apply_link || ''
  ).trim();

  if (!title) return { ok: false, reason: 'missing_title' };
  if (!company) return { ok: false, reason: 'missing_company' };
  if (!externalLink) return { ok: false, reason: 'missing_external_link' };

  // Drop nav / section labels that sometimes leak from board HTML
  if (/^(careers?|jobs?|vacancies|opportunities|view all jobs|see all|home|about us)$/i.test(title)) {
    return { ok: false, reason: 'nav_title' };
  }

  externalLink = normalizeUrl(externalLink);
  if (!externalLink) return { ok: false, reason: 'invalid_url' };
  if (isBlockedExampleHost(externalLink)) {
    return { ok: false, reason: 'example_domain_blocked' };
  }

  const textBlob = `${title} ${company} ${input.description || ''}`;
  for (const re of SPAM_PATTERNS) {
    if (re.test(textBlob)) return { ok: false, reason: 'spam_blocked' };
  }

  title = title.slice(0, 255);
  company = company.slice(0, 255);

  let description = input.description || input.job_description || title;
  description = sanitizeHtml(String(description)).slice(0, 50000);

  let requirements = input.requirements || null;
  if (requirements) requirements = sanitizeHtml(String(requirements)).slice(0, 20000);

  let benefits = input.benefits || null;
  if (benefits) benefits = String(benefits).slice(0, 5000);

  const jobType = normalizeJobType(
    input.job_type || input.employment_type || input.work_arrangement,
    input
  );

  let location = String(input.location || input.job_location || '').trim().replace(/\s+/g, ' ');
  if (!location) {
    location = jobType === 'remote' ? 'Remote' : 'Not specified';
  }
  location = location.slice(0, 255);

  const category = mapCategory({
    title,
    taxonomies: input.taxonomies || input.job_function || input.category_raw,
    explicit: input.category || input.categoryHint || input.category_slug,
  });

  const salary = parseSalary(input, location);
  const postedDate = parseDate(input.posted_date || input.posted_at || input.date);
  if (postedDate && maxAgeDays > 0) {
    const ageMs = Date.now() - postedDate.getTime();
    if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: 'too_old' };
    }
  }

  const deadline = parseDate(input.deadline || input.closing_date || input.application_deadline);
  const expiry = parseDate(input.expiry_date)
    || deadline
    || new Date((postedDate || new Date()).getTime() + 30 * 24 * 60 * 60 * 1000);

  const source = input.source || options.defaultSource || 'ingest';
  const sourceType = String(
    input.source_type || options.sourceType || inferSourceType(source)
  ).toUpperCase();
  const verificationStatus = String(
    input.verification_status
      || options.verificationStatus
      || defaultVerification(sourceType)
  ).toLowerCase();
  const isAggregated = input.is_aggregated != null
    ? Boolean(input.is_aggregated)
    : sourceType !== SOURCE_TYPES.DIRECT;

  const county = normalizeCounty(location, input.county || input.county_hint || options.countyHint);
  let countryCode = String(input.country_code || input.countryCode || options.countryCode || '')
    .toUpperCase()
    .slice(0, 2);
  if (!countryCode) {
    countryCode = isKenyaLocation(location) || county ? 'KE' : '';
  }
  if (!countryCode && /kenya/i.test(String(options.defaultSource || source))) {
    countryCode = 'KE';
  }

  let applicationUrl = input.application_url || input.apply_url || null;
  if (applicationUrl) {
    applicationUrl = normalizeUrl(String(applicationUrl)) || applicationUrl;
  }

  const job = {
    title,
    company_name: company,
    company_logo_url: input.company_logo_url || input.employer_logo || null,
    company_website: input.company_website || input.employer_website || null,
    description,
    requirements,
    benefits,
    location,
    county: county || null,
    country_code: countryCode || null,
    job_type: jobType,
    category,
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
    salary_period: salary.period,
    external_link: externalLink,
    application_url: applicationUrl,
    source_url: input.source_url || input.list_url || options.sourceUrl || null,
    source_type: sourceType,
    verification_status: verificationStatus,
    is_aggregated: isAggregated,
    job_source_id: input.job_source_id || options.jobSourceId || null,
    deadline: deadline || null,
    posted_date: postedDate || new Date(),
    expiry_date: expiry,
    source,
  };

  return { ok: true, job };
}

const BLOCKED_EXAMPLE_HOSTS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'www.example.com',
  'www.example.org',
  'www.example.net',
]);

function isBlockedExampleHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_EXAMPLE_HOSTS.has(host) || host.endsWith('.example.com');
  } catch {
    return false;
  }
}

function normalizeUrl(url) {
  try {
    let u = url.trim();
    if (!u || /^javascript:/i.test(u) || u.startsWith('#')) return null;
    if (u.startsWith('//')) u = `https:${u}`;
    if (!/^https?:\/\//i.test(u)) {
      // relative paths not useful as external apply links
      if (u.startsWith('/')) return null;
      u = `https://${u}`;
    }
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    [...parsed.searchParams.keys()].forEach((key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        parsed.searchParams.delete(key);
      }
    });
    // strip hash
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');
}

function normalizeJobType(value, raw = {}) {
  const s = String(value || '').toLowerCase();
  if (raw.job_is_remote === true || raw.remote === true) return 'remote';
  if (/\bremote\b/.test(s) || s === 'wfh' || s === 'work from home') return 'remote';
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\bonsite\b|\bon-site\b|\bon site\b|\bin-?office\b/.test(s)) return 'onsite';
  if (['remote', 'hybrid', 'onsite'].includes(s)) return s;
  return 'onsite';
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const d = value > 1e12 ? new Date(value) : new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseSalary(input, location = '') {
  let min = numberOrNull(input.salary_min ?? input.min_salary ?? input.job_min_salary);
  let max = numberOrNull(input.salary_max ?? input.max_salary ?? input.job_max_salary);
  const kenyaContext = isKenyaLocation(location)
    || isKenyaLocation(input.location)
    || Boolean(input.county)
    || String(input.country_code || input.countryCode || '').toUpperCase() === 'KE'
    || /kenya|\.co\.ke\b/i.test(String(input.external_link || input.url || input.source || ''));
  let currency = String(
    input.salary_currency || input.currency || (kenyaContext ? 'KES' : 'USD')
  ).slice(0, 10).toUpperCase();
  let period = String(input.salary_period || (kenyaContext ? 'monthly' : 'yearly')).toLowerCase();
  if (!['yearly', 'monthly', 'weekly', 'hourly'].includes(period)) {
    period = kenyaContext ? 'monthly' : 'yearly';
  }

  if (min == null && max == null && input.salary) {
    const text = String(input.salary);
    const cur = text.match(/\b(KES|KSH|USD|EUR|GBP|ZAR|NGN)\b/i);
    if (cur) {
      currency = cur[1].toUpperCase() === 'KSH' ? 'KES' : cur[1].toUpperCase();
    }
    const nums = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 2) {
      min = Math.round(Number(nums[0]));
      max = Math.round(Number(nums[1]));
    } else if (nums && nums.length === 1) {
      min = Math.round(Number(nums[0]));
    }
    if (/month|mo\b/i.test(text)) period = 'monthly';
    else if (/hour|hr\b/i.test(text)) period = 'hourly';
    else if (/week/i.test(text)) period = 'weekly';
  }

  return { min, max, currency, period };
}

function numberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Batch helper for ingest API / n8n.
 */
function preprocessJobs(list, options = {}) {
  const accepted = [];
  const rejected = [];
  for (const item of Array.isArray(list) ? list : []) {
    const result = preprocessJob(item, options);
    if (result.ok) accepted.push(result.job);
    else rejected.push({ reason: result.reason, title: item?.title || item?.job_title });
  }
  return { accepted, rejected };
}

module.exports = {
  preprocessJob,
  preprocessJobs,
  normalizeUrl,
  normalizeJobType,
  sanitizeHtml,
  parseSalary,
};
