# Job Scraper / Importer System

Imports job listings into JobsHub from RapidAPI sources, Kenya upstream career pages, and optional HTML scrapers (Kenya boards).

## Primary sources

| Source | Type | Notes |
|--------|------|-------|
| **KenyaCareers** | Registry + adapters | Upstream orgs in `kenya/sources.json` — **enabled by default** |
| **MyJobMag** | HTML (Cheerio) | Kenya board; **enabled by default** (no API key) |
| **JSearch** | RapidAPI | Multi-board via Google for Jobs (`/search-v2`) — needs `RAPIDAPI_KEY` |
| **LinkedIn** | RapidAPI | Fantastic.jobs LinkedIn feed — needs key |
| **Jobs API14** | RapidAPI | LinkedIn/Bing/Indeed search paths — needs key |
| **n8n ingest** | Webhook | `POST /api/ingest/jobs` — see `docs/N8N.md` |

Query streams live in `src/scrapers/jobStreams.js` (`KE_LOCATIONS` for Kenya bias).

- Kenya pack: `docs/KENYA_SOURCES.md`
- Weekly quality: `docs/SCRAPER_QUALITY.md`

```env
RAPIDAPI_KEY=your_rapidapi_key
RAPIDAPI_MAX_REQUESTS_PER_RUN=80
INGEST_MAX_JOBS_PER_SOURCE=400
# DISABLE_KENYA_CAREERS=true
# ENABLE_HTML_SCRAPERS=true
```

## Usage

```bash
npm run scrape
npm run scrape:kenya
npm run scrape:kenya:dry
npm run sources:sync
npm run scrape:quality
npm run scrape:bootstrap
npm run scrape:dry
node src/scrapers/scheduler.js --max-jobs=50
node src/scrapers/scheduler.js --only=KenyaCareers --max-jobs=100
npm run scrape:cron
```

## Architecture

```
src/scrapers/
  BaseScraper.js
  scheduler.js
  preprocessJob.js
  qualityAssessment.js
  kenya/
    sources.json
    adapters.js
    KenyaCareerImporter.js
    syncSources.js
    counties.js
    sourceTypes.js
  rapidapi/
```

Dedup on `jobs.external_link`. Schema via `npm run migrate`.
