/**
 * Fetch adapters for Kenya job_sources registry.
 * Prefer structured ATS APIs; fall back to polite HTML listing extraction.
 */

const DEFAULT_HEADERS = {
  'User-Agent':
    'JobsHubBot/1.0 (+https://jobs.usseo.one; kenya-career-aggregator; polite crawl)',
  Accept: 'application/json, text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-KE,en;q=0.9',
};

async function fetchText(url, { timeoutMs = 25000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return { body, finalUrl: res.url || url, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const { body, finalUrl } = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });
  return { data: JSON.parse(body), finalUrl };
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function kenyaRelevant(text, cfg = {}) {
  const blob = String(text || '');
  const must = cfg.location_must_include;
  if (!must || !must.length) return true;
  const lower = blob.toLowerCase();
  return must.some((token) => lower.includes(String(token).toLowerCase()));
}

/**
 * Greenhouse job board API
 * https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 */
async function fetchGreenhouse(source) {
  const token = source.parser_config?.board_token
    || source.parser_config?.token
    || source.slug;
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const { data } = await fetchJson(url);
  const company = source.parser_config?.company_name || source.name;
  const jobs = [];
  for (const item of data.jobs || []) {
    const location = item.location?.name || source.county_hint || 'Kenya';
    const desc = stripHtml(item.content || '').slice(0, 4000);
    const combined = `${item.title} ${location} ${desc}`;
    if (!kenyaRelevant(combined, source.parser_config) && source.parser_config?.location_must_include) {
      // Still allow if explicitly Kenya board
      if (!/kenya|nairobi|mombasa|remote/i.test(combined) && token !== 'safaricom') continue;
    }
    const applyUrl = item.absolute_url || item.host_url;
    if (!applyUrl) continue;
    jobs.push({
      title: item.title,
      company_name: company,
      location: /kenya|nairobi|mombasa|kisumu|nakuru/i.test(location)
        ? location
        : `${location}, Kenya`,
      description: desc || `${item.title} at ${company}. Apply on the company careers page.`,
      external_link: applyUrl,
      application_url: applyUrl,
      source_url: source.base_url,
      posted_date: item.updated_at || item.created_at || null,
      job_type: /remote/i.test(location) ? 'remote' : 'onsite',
      county_hint: source.county_hint,
      country_code: source.country_code || 'KE',
      source_type: source.source_type,
      source: `kenya:${source.slug}`,
    });
  }
  return jobs;
}

/**
 * Lever postings API
 * https://api.lever.co/v0/postings/{company}?mode=json
 */
async function fetchLever(source) {
  const company = source.parser_config?.company_slug
    || source.parser_config?.board_token
    || source.slug;
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
  const { data } = await fetchJson(url);
  const companyName = source.parser_config?.company_name || source.name;
  const jobs = [];
  for (const item of Array.isArray(data) ? data : []) {
    const location = item.categories?.location || item.workplaceType || source.county_hint || 'Kenya';
    const desc = stripHtml(item.descriptionPlain || item.description || '').slice(0, 4000);
    const combined = `${item.text} ${location} ${desc}`;
    if (source.parser_config?.location_must_include && !kenyaRelevant(combined, source.parser_config)) {
      continue;
    }
    const applyUrl = item.hostedUrl || item.applyUrl;
    if (!applyUrl) continue;
    jobs.push({
      title: item.text,
      company_name: companyName,
      location: String(location).includes('Kenya') ? location : `${location}, Kenya`,
      description: desc || `${item.text} at ${companyName}`,
      external_link: applyUrl,
      application_url: item.applyUrl || applyUrl,
      source_url: source.base_url,
      posted_date: item.createdAt ? new Date(item.createdAt) : null,
      job_type: /remote/i.test(String(item.workplaceType || location)) ? 'remote' : 'onsite',
      county_hint: source.county_hint,
      country_code: 'KE',
      source_type: source.source_type,
      source: `kenya:${source.slug}`,
    });
  }
  return jobs;
}

/**
 * Workable widget API (public accounts)
 */
async function fetchWorkable(source) {
  const account = source.parser_config?.account
    || source.parser_config?.board_token
    || source.slug;
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`;
  const { data } = await fetchJson(url);
  const companyName = source.parser_config?.company_name || source.name;
  const jobs = [];
  for (const item of data.jobs || []) {
    const location = [item.city, item.country].filter(Boolean).join(', ')
      || source.county_hint
      || 'Kenya';
    const combined = `${item.title} ${location}`;
    if (source.parser_config?.location_must_include && !kenyaRelevant(combined, source.parser_config)) {
      continue;
    }
    const applyUrl = item.url;
    if (!applyUrl) continue;
    jobs.push({
      title: item.title,
      company_name: companyName,
      location,
      description: `${item.title} at ${companyName}. Apply on the employer careers page.`,
      external_link: applyUrl,
      application_url: applyUrl,
      source_url: source.base_url,
      posted_date: item.published_on || null,
      job_type: /remote/i.test(location) ? 'remote' : 'onsite',
      county_hint: source.county_hint,
      country_code: 'KE',
      source_type: source.source_type,
      source: `kenya:${source.slug}`,
    });
  }
  return jobs;
}

/**
 * Generic HTML career page: extract likely job links + short snippet.
 * Does not deep-fetch every detail page (polite + YAGNI for S2).
 */
async function fetchGenericHtml(source) {
  let cheerio;
  try {
    cheerio = require('cheerio');
  } catch {
    throw new Error('cheerio not installed — run npm install cheerio');
  }

  const { body, finalUrl } = await fetchText(source.base_url, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  const $ = cheerio.load(body);
  const companyName = source.parser_config?.company_name || source.name;
  const includes = (source.parser_config?.link_includes || [
    '/job',
    '/jobs',
    '/career',
    '/careers',
    'vacanc',
    'opportunit',
    'position',
    'opening',
  ]).map((s) => String(s).toLowerCase());

  const seen = new Set();
  const jobs = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !text || text.length < 8 || text.length > 180) return;

    const full = absoluteUrl(href, finalUrl || source.base_url);
    if (!full || seen.has(full)) return;

    // Skip pure navigation / section labels
    if (/^(home|about|contact|login|sign\s*in|privacy|cookie|careers?|jobs?|vacancies|opportunities|view all|see all|read more|apply now|learn more)$/i.test(text)) {
      return;
    }

    const hay = `${href} ${text}`.toLowerCase();
    const looksLikeJob = includes.some((token) => hay.includes(token));
    if (!looksLikeJob) return;

    // Prefer links that look like detail pages, not the careers index itself
    try {
      const u = new URL(full);
      const base = new URL(source.base_url);
      const samePath = u.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '');
      if (samePath) return;
      const path = u.pathname.toLowerCase();
      const detailHint = /\/(job|jobs|vacanc|career|position|opening|opportunit|advert)s?\//i.test(path)
        || /[0-9]{3,}/.test(path)
        || path.split('/').filter(Boolean).length >= 2;
      if (!detailHint && !/\.pdf($|\?)/i.test(path)) {
        // allow if anchor text looks like a role title (contains space or senior/officer/etc.)
        if (!/\s/.test(text) && !/(officer|manager|engineer|nurse|teacher|assistant|director|lead|analyst|developer)/i.test(text)) {
          return;
        }
      }
    } catch {
      return;
    }

    if (/\.(jpg|png|zip|css|js)(\?|$)/i.test(full)) return;

    seen.add(full);

    const parentText = stripHtml($(el).parent().text() || '').slice(0, 400);
    const locationGuess = source.county_hint
      ? `${source.county_hint}, Kenya`
      : 'Kenya';

    if (source.parser_config?.location_must_include) {
      const combined = `${text} ${parentText} ${full}`;
      if (!kenyaRelevant(combined, source.parser_config) && !kenyaRelevant(body.slice(0, 2000), source.parser_config)) {
        if (!kenyaRelevant(combined, source.parser_config)) return;
      }
    }

    jobs.push({
      title: text,
      company_name: companyName,
      location: locationGuess,
      description:
        parentText
        || `${text} at ${companyName}. Aggregated from the employer careers page — apply on the original listing.`,
      external_link: full,
      application_url: full,
      source_url: source.base_url,
      county_hint: source.county_hint,
      country_code: source.country_code || 'KE',
      source_type: source.source_type,
      source: `kenya:${source.slug}`,
      job_type: 'onsite',
    });
  });

  // JSON-LD JobPosting if present
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      const data = JSON.parse(raw);
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        const graph = node['@graph'] || [node];
        for (const item of graph) {
          if (!item || item['@type'] !== 'JobPosting') continue;
          const apply = item.url || item.applicationUrl || item.hiringOrganization?.sameAs;
          const title = item.title;
          if (!title || !apply) continue;
          const full = absoluteUrl(apply, source.base_url);
          if (!full || seen.has(full)) continue;
          seen.add(full);
          const loc = item.jobLocation?.address?.addressLocality
            || item.jobLocation?.name
            || source.county_hint
            || 'Kenya';
          jobs.push({
            title,
            company_name: item.hiringOrganization?.name || companyName,
            location: String(loc).includes('Kenya') ? String(loc) : `${loc}, Kenya`,
            description: stripHtml(item.description || '').slice(0, 4000)
              || `${title} at ${companyName}`,
            external_link: full,
            application_url: full,
            source_url: source.base_url,
            deadline: item.validThrough || null,
            posted_date: item.datePosted || null,
            county_hint: source.county_hint,
            country_code: 'KE',
            source_type: source.source_type,
            source: `kenya:${source.slug}`,
            job_type: /TELECOMMUTE|remote/i.test(JSON.stringify(item.jobLocationType || ''))
              ? 'remote'
              : 'onsite',
          });
        }
      }
    } catch {
      // ignore bad JSON-LD
    }
  });

  return jobs.slice(0, 80);
}

async function fetchJobsForSource(source) {
  const key = String(source.parser_key || 'generic-html').toLowerCase();
  if (key === 'greenhouse') return fetchGreenhouse(source);
  if (key === 'lever') return fetchLever(source);
  if (key === 'workable') return fetchWorkable(source);
  if (key === 'generic-html' || key === 'html' || key === 'json-ld') {
    return fetchGenericHtml(source);
  }
  throw new Error(`Unknown parser_key: ${source.parser_key}`);
}

module.exports = {
  fetchJobsForSource,
  fetchGreenhouse,
  fetchLever,
  fetchWorkable,
  fetchGenericHtml,
  fetchText,
  stripHtml,
};
