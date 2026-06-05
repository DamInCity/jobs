# Job Scraper System

This module automatically scrapes job listings from popular Kenyan job boards and imports them into the JobsHub database.

## Supported Job Sites

| Site | URL | Scraper Type |
|------|-----|--------------|
| BrighterMonday Kenya | brightermonday.co.ke | Puppeteer (JS-rendered) |
| MyJobMag Kenya | myjobmag.co.ke | Cheerio (HTML parsing) |

## Installation

Install the optional scraper dependencies:

```bash
npm install puppeteer cheerio node-cron p-queue
```

> **Note:** Puppeteer downloads Chromium (~280MB) on first install.

For production servers, you may need additional dependencies for Chromium:

```bash
# Ubuntu/Debian
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

## Usage

### Manual Run (One-time)

```bash
# Scrape jobs and save to database
npm run scrape

# Dry run (test without saving)
npm run scrape:dry

# Limit number of jobs
node src/scrapers/scheduler.js --max-jobs=10
```

### Scheduled Run (Cron)

```bash
# Start scraper with built-in cron schedule (6 AM & 6 PM EAT)
npm run scrape:cron
```

### With PM2 (Production)

```bash
# Start all services including scraper
pm2 start ecosystem.config.js

# Or start just the scraper
pm2 start ecosystem.config.js --only jobs-scraper

# View scraper logs
pm2 logs jobs-scraper
```

### Via Admin API

```bash
# Trigger scraper manually (requires admin auth)
curl -X POST http://localhost:3000/api/admin/scrapers/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"maxJobs": 30, "dryRun": false}'

# Get scraper logs
curl http://localhost:3000/api/admin/scrapers/logs \
  -H "Authorization: Bearer YOUR_TOKEN"

# Get scraper stats
curl http://localhost:3000/api/admin/scrapers/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Configuration

Edit `src/scrapers/scheduler.js` to customize:

```javascript
const CONFIG = {
  // Cron schedule (default: 6 AM & 6 PM Kenya time)
  cronSchedule: '0 3,15 * * *',
  
  // Max jobs per scraper per run
  maxJobsPerScraper: 30,
  
  // Run scrapers sequentially
  concurrency: 1,
};

// Enable/disable scrapers
const SCRAPERS = [
  { name: 'BrighterMonday', Class: BrighterMondayScraper, enabled: true },
  { name: 'MyJobMag', Class: MyJobMagScraper, enabled: true },
];
```

## Adding a New Scraper

1. Create a new file in `src/scrapers/`:

```javascript
const BaseScraper = require('./BaseScraper');

class NewSiteScraper extends BaseScraper {
  constructor() {
    super('NewSite', 'https://example.com');
  }

  async init() {
    // Initialize Puppeteer or Cheerio
  }

  async getJobListings() {
    // Return array of job URLs
    return ['https://example.com/job/1', ...];
  }

  async parseJob(url) {
    // Parse and return job data
    return {
      title: 'Job Title',
      company_name: 'Company',
      location: 'Nairobi, Kenya',
      external_link: url,
      // ... other fields
    };
  }
}

module.exports = NewSiteScraper;
```

2. Register in `src/scrapers/scheduler.js`:

```javascript
const NewSiteScraper = require('./NewSiteScraper');

const SCRAPERS = [
  // ... existing
  { name: 'NewSite', Class: NewSiteScraper, enabled: true },
];
```

3. Export from `src/scrapers/index.js`

## Database Schema

Jobs are saved with a `source` field to track origin:

```sql
-- Added to jobs table
source VARCHAR(100) DEFAULT 'manual'  -- 'manual', 'BrighterMonday', 'MyJobMag', etc.
```

Scraper logs are stored in:

```sql
CREATE TABLE scraper_logs (
  id UUID PRIMARY KEY,
  scraper_name VARCHAR(100) NOT NULL,
  jobs_scraped INTEGER DEFAULT 0,
  jobs_saved INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  duration VARCHAR(50),
  error_details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## Deduplication

Jobs are deduplicated by `external_link` - if a job with the same URL already exists, it's skipped.

## Rate Limiting

Scrapers include:
- Random delays (1-3 seconds) between job pages
- 5 second delay between different scrapers
- Pagination limits (max 5 pages per site)

## Troubleshooting

### Puppeteer fails to launch
```bash
# Install required system dependencies
sudo apt-get install -y chromium-browser

# Or use system Chromium
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser npm run scrape
```

### Scraper returns empty results
- Site structure may have changed
- Check if site blocks automated requests
- Verify selectors in the scraper file

### Memory issues
- Reduce `maxJobsPerScraper`
- Run one scraper at a time
- Increase PM2 memory limit

## Logs

- PM2 logs: `logs/scraper-output.log`, `logs/scraper-error.log`
- Database logs: `scraper_logs` table
- Console output shows progress in real-time

## Legal Considerations

- Respect `robots.txt` of target sites
- Use reasonable rate limiting
- Don't scrape personal/private data
- Consider reaching out to sites for partnership/API access
