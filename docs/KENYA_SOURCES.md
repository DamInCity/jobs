# Kenya upstream sources (S1/S2)

Increase **local Kenyan** listings by crawling employer/NGO/government career pages — not by cloning BrighterMonday/Fuzu.

## Pipeline

```
sources.json
    ↓ npm run sources:sync
job_sources (Postgres)
    ↓ KenyaCareerImporter
adapters (greenhouse | lever | workable | generic-html)
    ↓ preprocessJob (county, KE currency defaults, source_type)
saveJobRecord → jobs
    ↓ existing email/Telegram alerts
```

## Commands

```bash
npm run migrate                 # S1 columns + job_sources + quality reports
npm run sources:sync            # upsert registry from sources.json
npm run scrape:kenya:dry        # crawl without DB writes
npm run scrape:kenya            # production kenya pack
npm run scrape:kenya:bootstrap  # higher max jobs
node src/scrapers/scheduler.js --only=KenyaCareers --max-jobs=100
```

Disable kenya pack inside full scheduler:

```env
DISABLE_KENYA_CAREERS=true
```

## Adding a source

Edit `src/scrapers/kenya/sources.json`:

```json
{
  "slug": "acme-ke",
  "name": "Acme Kenya",
  "source_type": "COMPANY_CAREER",
  "base_url": "https://acme.co.ke/careers",
  "parser_key": "generic-html",
  "parser_config": { "company_name": "Acme Kenya" },
  "county_hint": "Nairobi",
  "crawl_frequency_hours": 24
}
```

Parser keys:

| Key | When |
|-----|------|
| `greenhouse` | Public board token known — best quality |
| `lever` | Lever company slug |
| `workable` | Workable account widget |
| `generic-html` | Default — link heuristics + JSON-LD JobPosting |

Then: `npm run sources:sync` and `npm run scrape:kenya`.

## Legal / product posture

- Prefer **title + short summary + apply URL** (click-out).
- Respect rate limits (importer delays ~1s between sources).
- Mark `verification_status=aggregated` for crawled rows; direct employer posts (later) use `verified`.
- Do not enable BrighterMonday scraping as the primary KE supply (`ENABLE_HTML_SCRAPERS` remains opt-in).

## Schema fields (S1)

On `jobs`: `county`, `country_code`, `source_type`, `source_url`, `application_url`, `verification_status`, `is_aggregated`, `deadline`, `job_source_id`.

On `job_sources`: crawl registry + last run stats.
