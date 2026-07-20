# Job Scraper / Importer System

Imports job listings into JobsHub from RapidAPI sources (primary) and optional HTML scrapers (Kenya boards).

## Primary sources (RapidAPI)

| Source | Host | Bulk endpoint | Notes |
|--------|------|---------------|-------|
| **JSearch** | `jsearch.p.rapidapi.com` | `GET /search-v2` | Multi-board via Google for Jobs |
| **LinkedIn** | `linkedin-job-search-api.p.rapidapi.com` | `GET /active-jb` | Fantastic.jobs LinkedIn feed (1–1000/call) |
| **Jobs API14** | `jobs-api14.p.rapidapi.com` | `GET /v2/linkedin/search`, `/v2/bing/search` | Secondary volume + optional `/v2/salary/range` |

Set in `.env`:

```env
RAPIDAPI_KEY=your_rapidapi_key
RAPIDAPI_MAX_REQUESTS_PER_RUN=80
INGEST_MAX_JOBS_PER_SOURCE=400
```

> Do not commit API keys. Rotate any key that was shared in chat or logs.

## Usage

```bash
# One-shot ingest (all enabled sources)
npm run scrape

# Bootstrap larger run
npm run scrape:bootstrap

# Dry run (no DB writes)
npm run scrape:dry

# Cap jobs per source
node src/scrapers/scheduler.js --max-jobs=50

# Single source
node src/scrapers/scheduler.js --only=JSearch --max-jobs=100
node src/scrapers/scheduler.js --only=LinkedIn --max-jobs=200
node src/scrapers/scheduler.js --only=JobsAPI14 --max-jobs=50

# Cron mode (6 AM & 6 PM EAT)
npm run scrape:cron
```

## Optional HTML scrapers

| Site | Scraper | Default |
|------|---------|---------|
| BrighterMonday Kenya | Puppeteer | **disabled** |
| MyJobMag Kenya | Cheerio | **disabled** |

Enable in `src/scrapers/scheduler.js` (`enabled: true`) and install:

```bash
npm install puppeteer cheerio node-cron p-queue
```

## Architecture

```
src/scrapers/
  BaseScraper.js              # validate + saveJob (dedupe by external_link)
  categoryMapper.js           # title/taxonomy → category slug
  scheduler.js                # orchestrates sources + scraper_logs
  rapidapi/
    RapidApiClient.js         # headers, retries, request budget
    JSearchImporter.js
    LinkedInImporter.js
    JobsApi14Importer.js
```

Jobs are stored with `source` = `JSearch` | `LinkedIn` | `JobsAPI14` | etc.

## Deduplication

- Unique index on `jobs.external_link`
- Application-level skip if URL already exists
- Safe to re-run ingest

## Database

Schema is applied by `npm run migrate` (also auto-runs on app startup if `jobs` is missing).

```bash
npm run migrate
npm run seed      # admin user + categories
```

With Docker Compose, host tools use port **5433** and password from `.env` (`DB_PASSWORD=postgres`).

## Admin API

```bash
curl -X POST http://localhost:3000/api/admin/scrapers/run \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxJobs": 50, "dryRun": false}'
```

## Troubleshooting

### `relation "jobs" does not exist`
Run migrations: `npm run migrate` or restart the app container (auto-migrate).

### RapidAPI 429 monthly quota
Upgrade the plan on RapidAPI or wait for reset. Importers stop retrying monthly-quota errors.

### JSearch 404 on `/search`
Use `/search-v2` (already configured).

### Empty LinkedIn results
Use full location names (`United States`, not `US`) and a `time_frame` of `24h` or `7d`.
