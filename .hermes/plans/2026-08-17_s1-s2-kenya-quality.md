# JobsHub S1+S2 Implementation Plan (Kenya local supply + weekly quality)

> **For Hermes:** Implemented in-repo; this file is the spec trail. Extend with S3+ later.

**Goal:** Add Kenya-local job metadata + upstream career-page ingestion, and a weekly deterministic scraper quality assessment.

**Architecture:** Extend existing Node/Express/Postgres ingest path. Registry-driven crawlers (`job_sources` + adapters) feed `preprocessJob` → `saveJobRecord`. Weekly PM2 cron runs SQL quality report (no LLM).

**Tech stack:** Node 18+, PostgreSQL, cheerio (optional dep), existing scheduler/PM2.

---

## S1 — Schema + preprocess (done)

- Migration columns on `jobs` + `job_sources` + `scraper_quality_reports`
- `counties.js`, `sourceTypes.js`
- `preprocessJob` / `saveJobRecord` persist new fields; KES defaults for KE context

## S2 — Kenya pack (done)

- `src/scrapers/kenya/sources.json` (~50 orgs)
- Adapters: greenhouse, lever, workable, generic-html (+ JSON-LD)
- `KenyaCareerImporter` + `syncSources`
- Scheduler entry `KenyaCareers` (default on)
- npm scripts: `scrape:kenya*`, `sources:sync`

## Weekly quality (done)

- `src/scrapers/qualityAssessment.js`
- Docs: `docs/SCRAPER_QUALITY.md`
- PM2 `jobs-scraper-quality` Mondays 04:15 UTC

## Verify

```bash
cd /home/kai/Documents/jobs
npm install cheerio --save-optional
npm run migrate
npm run sources:sync
node -e "const {preprocessJob}=require('./src/scrapers/preprocessJob'); console.log(preprocessJob({title:'Nurse',company:'KNH',url:'https://knh.or.ke/jobs/1',location:'Nairobi, Kenya'}))"
npm run scrape:kenya:dry -- --max-jobs=20
npm run scrape:quality -- --no-store
```

## Out of scope here (later sprints)

- County filter UI / homepage modules
- Employer self-serve + M-Pesa
- Detail-page deep fetch for generic-html
- Growing registry to 150–300 sources
