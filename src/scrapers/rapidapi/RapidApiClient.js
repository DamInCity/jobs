/**
 * Shared RapidAPI HTTP client with retries and request budgeting.
 */

const config = require('../../config');

class RapidApiClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || config.rapidapi.key;
    this.maxRequests = options.maxRequests || config.rapidapi.maxRequestsPerRun;
    this.requestCount = 0;
    this.timeoutMs = options.timeoutMs || 30000;
    this.quotaExceeded = false;
  }

  ensureKey() {
    if (!this.apiKey) {
      throw new Error(
        'RAPIDAPI_KEY is not set. Add it to .env (or RAPID_API_KEY) before running importers.'
      );
    }
  }

  get remainingRequests() {
    return Math.max(0, this.maxRequests - this.requestCount);
  }

  async get(host, path, params = {}) {
    this.ensureKey();

    if (this.requestCount >= this.maxRequests) {
      throw new Error(
        `RapidAPI request budget exhausted (${this.maxRequests} requests this run)`
      );
    }

    const url = new URL(path.startsWith('http') ? path : `https://${host}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });

    const maxAttempts = 4;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.requestCount += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'x-rapidapi-key': this.apiKey,
            'x-rapidapi-host': host,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.status === 429 || response.status >= 500) {
          const body = await response.text().catch(() => '');
          lastError = new Error(
            `RapidAPI ${response.status} from ${host}${path}: ${body.slice(0, 200)}`
          );
          // Monthly/plan quota — do not burn retries
          if (
            response.status === 429 &&
            /MONTHLY|quota|Upgrade your plan/i.test(body)
          ) {
            this.quotaExceeded = true;
            throw lastError;
          }
          const retryAfter = parseInt(response.headers.get('retry-after') || '', 10);
          const delayMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** (attempt - 1), 15000);
          if (attempt < maxAttempts) {
            console.warn(`   ⏳ ${response.status} — retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
            await this.delay(delayMs);
            continue;
          }
          throw lastError;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `RapidAPI ${response.status} from ${host}${path}: ${body.slice(0, 300)}`
          );
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await response.json();
        }
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (error.name === 'AbortError') {
          lastError = new Error(`RapidAPI request timed out: ${host}${path}`);
        }
        if (attempt < maxAttempts && this.isRetryable(error)) {
          const delayMs = Math.min(1000 * 2 ** (attempt - 1), 15000);
          console.warn(`   ⏳ ${lastError.message} — retrying in ${delayMs}ms`);
          await this.delay(delayMs);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error('RapidAPI request failed');
  }

  isRetryable(error) {
    const msg = String(error.message || '');
    return (
      msg.includes('timed out') ||
      msg.includes('ECONNRESET') ||
      msg.includes('fetch failed') ||
      msg.includes('429') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = RapidApiClient;
