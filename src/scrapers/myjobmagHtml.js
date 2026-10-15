/**
 * MyJobMag listing HTML: extract real apply targets and strip board chrome.
 * Used by MyJobMagScraper and backfill scripts.
 */

const BOARD_HOST_RE = /myjobmag/i;
const LOGIN_HOST_RE = /^(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|facebook\.com|www\.facebook\.com)$/i;
const EXCLUDED_PATHS = [
  /^\/cv\b/i,
  /^\/cv-match/i,
  /^\/cv-pilot/i,
  /^\/contact/i,
  /^\/jobs-at\//i,
  /^\/jobs-location\//i,
  /^\/jobs-by-/i,
  /^\/job-application\//i,
  /^\/apply-now\//i,
  /^\/(page|category)\b/i,
];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function isBoardHost(hostname) {
  return BOARD_HOST_RE.test(String(hostname || ''));
}

function methodNodes($) {
  const nodes = [];
  const heading = $('h2#application-method').first();
  if (!heading.length) return nodes;
  let section = heading.next();
  while (section.length > 0) {
    if (section.is('p') && /clear:\s*both/i.test(section.attr('style') || '')) break;
    nodes.push(section);
    section = section.next();
  }
  return nodes;
}

function methodHtml($) {
  return methodNodes($).map((n) => n.html() || n.text() || '').join(' ');
}

/**
 * @returns {{ applyUrl: string|null, needsResolution: boolean, email: string|null }}
 */
function extractApplyFromCheerio($, baseUrl) {
  const base = baseUrl || 'https://www.myjobmag.co.ke';
  const candidatesDirect = [];
  const candidatesWrapper = [];
  const emails = [];

  const collect = ($scope, inMethod) => {
    $scope.find('a[href]').addBack('a[href]').each((_, el) => {
      const href = (($(el).attr('href') || '')).trim();
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return;
      if (/^mailto:/i.test(href)) {
        const addr = href.replace(/^mailto:/i, '').split('?')[0].trim();
        if (addr) emails.push(addr);
        return;
      }
      if (/^tel:/i.test(href)) return;
      let parsed;
      try { parsed = new URL(href, base); } catch { return; }
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      if (EXCLUDED_PATHS.some((re) => re.test(parsed.pathname) && !/^\/apply-now\/\d+/.test(parsed.pathname))) {
        return;
      }
      if (/^\/apply-now\/\d+/.test(parsed.pathname)) {
        if (isBoardHost(parsed.hostname) || parsed.hostname === new URL(base).hostname) {
          candidatesWrapper.push(parsed.toString());
        } else {
          candidatesDirect.push(parsed.toString());
        }
        return;
      }
      if (isBoardHost(parsed.hostname)) return;
      if (parsed.hostname === new URL(base).hostname) return;
      candidatesDirect.push(parsed.toString());
    });
    if (inMethod) {
      const text = $scope.text() || '';
      const found = text.match(EMAIL_RE) || [];
      found.forEach((e) => emails.push(e));
    }
  };

  const nodes = methodNodes($);
  if (nodes.length) {
    nodes.forEach((n) => collect(n, true));
  }

  let applyUrl = null;
  let needsResolution = false;
  const direct = candidatesDirect.find((u) => {
    try { return !isBoardHost(new URL(u).hostname); } catch { return false; }
  });
  if (direct) {
    applyUrl = direct;
  } else if (candidatesWrapper.length) {
    applyUrl = candidatesWrapper[0];
    needsResolution = true;
  }

  const email = emails.map((e) => e.trim()).find(Boolean) || null;
  return { applyUrl, needsResolution, email };
}

function unwrapAnchor($, el) {
  const $el = $(el);
  $el.replaceWith($el.text());
}

/**
 * Strip MyJobMag chrome from a job-description HTML fragment.
 * Unwraps board links; keeps mailto/tel and non-board http(s) only inside Method of Application.
 */
function sanitizeListingHtml(html, cheerio, baseUrl) {
  if (!html) return html || '';
  const $ = cheerio.load(`<div id="__root">${html}</div>`, { decodeEntities: false });
  const root = $('#__root');
  const base = baseUrl || 'https://www.myjobmag.co.ke';

  root.find('a.prompt-link, .icon-arrow, svg.icon-arrow, #adbox, .share-but, #apply-sec').remove();

  root.find('a, p, span, b, strong').each((_, el) => {
    const t = ($(el).text() || '').replace(/\s+/g, ' ').trim();
    if (/check how your cv aligns/i.test(t) || /build your cv for free/i.test(t)) {
      const wrap = $(el).closest('p').length ? $(el).closest('p') : $(el);
      wrap.remove();
    }
  });

  const methodSet = new Set(methodNodes($).map((n) => n.get(0)));
  const inMethod = (el) => {
    let cur = el;
    while (cur) {
      if (methodSet.has(cur)) return true;
      if (cur.attribs && cur.attribs.id === 'application-method') return true;
      cur = cur.parent;
    }
    return false;
  };

  root.find('a[href]').each((_, el) => {
    const href = (($(el).attr('href') || '')).trim();
    if (/^(mailto:|tel:)/i.test(href)) return;
    const keepExternal = inMethod(el);
    let parsed;
    try { parsed = new URL(href, base); } catch {
      unwrapAnchor($, el);
      return;
    }
    if (keepExternal && ['http:', 'https:'].includes(parsed.protocol)
        && !isBoardHost(parsed.hostname)
        && parsed.hostname !== new URL(base).hostname
        && !EXCLUDED_PATHS.some((re) => re.test(parsed.pathname))) {
      $(el).attr('href', parsed.toString());
      $(el).attr('target', '_blank');
      $(el).attr('rel', 'nofollow noopener noreferrer');
      return;
    }
    unwrapAnchor($, el);
  });

  return root.html() || '';
}

function isEmployerHttpUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (isBoardHost(u.hostname)) return false;
    if (LOGIN_HOST_RE.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function stripTrackingParams(url) {
  try {
    const u = new URL(url);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Follow only the first 302/301 Location from a MyJobMag /apply-now/ wrapper.
 * Do not follow Google login hops — those replace the real form URL.
 */
async function resolveApplyNowFirstHop(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    await response.arrayBuffer().catch(() => {});
    const loc = response.headers.get('location');
    if (!loc) return null;
    const dest = stripTrackingParams(new URL(loc, url).toString());
    return isEmployerHttpUrl(dest) ? dest : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  extractApplyFromCheerio,
  sanitizeListingHtml,
  isEmployerHttpUrl,
  isBoardHost,
  resolveApplyNowFirstHop,
  stripTrackingParams,
  EMAIL_RE,
};
