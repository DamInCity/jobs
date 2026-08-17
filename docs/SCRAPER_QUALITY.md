# Scraper quality assessment (weekly)

JobsHub runs a **lightweight SQL report** instead of an LLM-heavy “review cron”.

## Why this shape

| Approach | Cost | Reliability |
|----------|------|-------------|
| **This script** (`qualityAssessment.js`) | ~1 DB round-trip + file write | Deterministic scores/gates |
| LLM weekly review | Tokens every week | Flaky, expensive, hard to gate CI |
| Only `scraper_logs` glance | Free | Misses field quality (county, thin JD) |

## Commands

```bash
# Last 7 days (default) — writes DB row + logs/scraper-quality-latest.md
npm run scrape:quality

# Custom window
node src/scrapers/qualityAssessment.js --days=14

# Exit 2 if quality gates fail (good for monitoring)
npm run scrape:quality:strict

# Markdown only, no DB insert
node src/scrapers/qualityAssessment.js --no-store
```

## Schedule (recommended)

Already wired in `ecosystem.config.js` as PM2 app **`jobs-scraper-quality`**:

- `cron_restart: '15 4 * * 1'` → Mondays **04:15 UTC** (~07:15 EAT)
- `autorestart: false` → run once per tick (same pattern as `jobs-alerts`)

```bash
pm2 start ecosystem.config.js --only jobs-scraper-quality --env production
pm2 save
```

System crontab equivalent:

```cron
15 4 * * 1 cd /var/www/jobs && /usr/bin/node src/scrapers/qualityAssessment.js --days=7 >> logs/scraper-quality-cron.log 2>&1
```

## What it measures

1. **scraper_logs** — runs, scraped, saved, errors, save-rate score  
2. **jobs** (created in window) — per `source` volume, county fill, KE flag, thin descriptions  
3. **Kenya slice** — counts by `source_type`  
4. **job_sources registry** — dead (error + 0 saved) and stale (>> crawl frequency)  
5. **Gates** (used by `--strict`):
   - some scraper runs exist
   - ≥5 Kenya-tagged jobs in window
   - at least one source with county set
   - not total blackout (some saves) when scrapers ran
   - dead registry sources ≤ 15

## Outputs

| Artifact | Path |
|----------|------|
| Rolling markdown | `logs/scraper-quality-latest.md` |
| Rolling JSON | `logs/scraper-quality-latest.json` |
| Timestamped copies | `logs/scraper-quality-<iso>.md/json` |
| DB history | `scraper_quality_reports` |

## Ops tips

- After deploying S1/S2, run once manually and skim `recommendations`.
- If Greenhouse boards 404, fix `board_token` in `src/scrapers/kenya/sources.json` then `npm run sources:sync`.
- Pair with existing scrape schedule (`jobs-scraper` 6 AM/6 PM EAT) — quality job only **reads**, it does not crawl.
