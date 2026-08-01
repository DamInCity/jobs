# n8n automation for JobsHub

JobsHub can discover jobs **without RapidAPI** by using n8n as the scheduler and Google/board discovery layer, then pushing normalized listings into the **ingest API**.

Site: `https://jobs.usseo.one`

---

## Why not “just call Google Jobs API”?

There is **no free official Google for Jobs API**. Realistic options:

| Approach | Notes |
|----------|--------|
| SERP provider (SerpAPI, DataForSEO, ValueSERP) “Google Jobs” engine | Most reliable; still a paid/free-tier API, but not RapidAPI job APIs |
| HTTP scrape of Google Jobs HTML | Free but brittle, CAPTCHA/ToS risk — use only with low frequency |
| Google Alerts → email → n8n IMAP | Free, slow, keyword-based |
| Public boards (MyJobMag, company careers) | Free; good Kenya coverage; JobsHub also has a MyJobMag scraper |

**Recommended production path:** n8n Cron → discovery (SERP or boards) → preprocess → `POST /api/ingest/jobs`.

---

## Streams (pipeline)

```
1. Query planner     Cron every 6h
                     Expand titles × locations from jobStreams (or n8n Set node)

2. Discovery         Google Jobs (SERP node) and/or board HTML
                     Output: raw { title, company, location, url, snippet, date }

3. Preprocessing     Code node (mirror src/scrapers/preprocessJob.js rules)
                     Or POST /api/ingest/preprocess for a dry-run

4. Ingest            POST https://jobs.usseo.one/api/ingest/jobs
                     Header: X-Ingest-Key: $INGEST_API_KEY

5. Fan-out           After successful ingest (accepted > 0), JobsHub runs
                     daily alert matching (email/Telegram) automatically.
                     Optional N8N_WEBHOOK_URL for WhatsApp / custom routing.
                     Pass `notify: false` in the ingest body to skip fan-out.
```

Shared title/location matrix lives in:

`src/scrapers/jobStreams.js`

Copy those queries into an n8n **Set** / **Code** node so Google searches cover **healthcare, education, social work, trades, hospitality**, etc.—not only software roles.

---

## Preprocessing checklist

Apply these before or during ingest (the API re-runs the same rules server-side):

1. Require `title`, `company_name` (or `company`), `external_link` (or `url`)
2. Normalize URL (https, strip `utm_*` / `fbclid`)
3. Drop spam patterns (“earn $$$ work from home…”)
4. Map job type → `remote` | `hybrid` | `onsite`
5. Map category via title/taxonomy → slug (`healthcare`, `education`, …)
6. Parse salary best-effort; else leave null
7. Drop listings older than ~45 days
8. Cap title (255) and description length
9. Set `source` to e.g. `n8n-google` or `n8n-board`
10. Default expiry = posted + 30 days

Dry-run:

```bash
curl -sS -X POST https://jobs.usseo.one/api/ingest/preprocess \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: $INGEST_API_KEY" \
  -d '{
    "jobs": [{
      "title": "Registered Nurse",
      "company": "City Hospital",
      "url": "https://example.com/jobs/rn?utm_source=google",
      "location": "Nairobi",
      "description": "Ward nursing role",
      "categoryHint": "healthcare"
    }]
  }'
```

Ingest:

```bash
curl -sS -X POST https://jobs.usseo.one/api/ingest/jobs \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Key: $INGEST_API_KEY" \
  -d '{
    "source": "n8n-google",
    "jobs": [{
      "title": "Registered Nurse",
      "company_name": "City Hospital",
      "external_link": "https://example.com/jobs/rn",
      "location": "Nairobi, Kenya",
      "job_type": "onsite",
      "description": "Ward nursing role",
      "category": "healthcare"
    }]
  }'
```

Dedup is on `external_link` (unique index). Safe to re-run.

---

## Outbound webhook (alerts → n8n)

Set in `.env`:

```env
N8N_WEBHOOK_URL=https://your-n8n-host/webhook/jobshub-alerts
```

When user alerts match, JobsHub POSTs a JSON payload (jobs + user channel hints) so you can route to **WhatsApp**, SMS, etc.

---

## Importable workflow skeleton

See `docs/n8n/job-google-ingest.workflow.json`.

1. Import into n8n  
2. Set env `JOBSHUB_INGEST_KEY` = your `INGEST_API_KEY` (or hardcode header carefully)  
3. Replace the **Placeholder map** node with real discovery:
   - SerpAPI / DataForSEO / ValueSERP **Google Jobs** using `searchQuery`, **or**
   - HTTP Request to a public board list page + HTML extract  
4. Ensure preprocess maps: `title`, `company_name`, `external_link`, `location`, `description`, `category`  
5. Activate schedule (default every 6 hours)  
6. Confirm JobsHub has `INGEST_API_KEY` set (compose passes it into the app container)  

When jobs are accepted, JobsHub immediately runs preference-based alerts so Telegram users get fresh matches without waiting for the daily cron.

### Minimal checklist for “always up to date”

| Step | Done when |
|------|-----------|
| `INGEST_API_KEY` in JobsHub `.env` + compose | `curl` preprocess returns 200 |
| n8n workflow imported + key set | Test execution hits ingest |
| Discovery not placeholder | Real employers/URLs in DB (`source=n8n-google`) |
| Users have profile or alerts | CV profile or manual category alert |
| Telegram bot token + linked users | Digests arrive in chat | 

---

## Security

- Never commit `INGEST_API_KEY`
- Prefer HTTPS only (already true on jobs.usseo.one)
- Rate limit: 120 requests/minute on `/api/ingest/*`
- Max 100 jobs per POST
- Do not expose an unauthenticated n8n UI on the public internet without auth

---

## Optional: run scrapers on the server (no n8n)

```bash
# MyJobMag (no API key) — enabled by default in scheduler
npm run scrape -- --only=MyJobMag --max-jobs=30

# RapidAPI sources need RAPIDAPI_KEY
# pm2 start ecosystem.config.js --only jobs-scraper --env production
```
