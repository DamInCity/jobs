# JobsHub Steady Supply, Expiry Hygiene & Categories UX

> **For Hermes:** Implement task-by-task. Prefer durable `docker compose build` over hot-patch for scraper/Kenya paths. Plans live under `Documents/jobs/.hermes/plans/`.

**Goal:** Keep a steady stream of **fresh, relevant** active jobs on JobsHub, stop expired/stale listings from feeling like inventory, and fix Explore/categories so empty categories show **0** (or stay hidden) instead of looking broken.

**Architecture:** Fix the supply **ops gap** first (scraper service off by default + stale image missing Kenya pack), then harden **relevance guards** in API/save/expire paths, then tighten **category UX** so users only deep-link into categories that have roles (or clearly see `0 open roles`).

**Tech Stack:** Node/Express, PostgreSQL (`jobs_website` on `jobs_db:5433`), Docker Compose (`jobs_app`, optional `jobs_scraper` profile), Cheerio MyJobMag, RapidAPI importers, Kenya `job_sources` pack, vanilla `public/js/*`.

---

## Current context (measured 2026-08-19)

| Surface | Active jobs | Notes |
|---------|------------:|-------|
| Local `jobs_app` (`:3000`) | **21** | 15 MyJobMag (2026-08-17) + 6 old LinkedIn; **327 expired** |
| Public `https://jobs.usseo.one` | **10** | 4 categories with jobs; 22 categories at 0 |
| `jobs_scraper` container | **not running** | Compose service is under **`profiles: [scrapers]`** — never started with default `up` |
| Image scrapers tree | **no `src/scrapers/kenya/`** | Host has Kenya pack; running image is stale |
| Last quality report | 2026-08-17 | Only MyJobMag ran (15 saved); KenyaCareers **0**; registry 52 sources not ingested into live app |
| Facets API on live app | **404** | Host has `GET /api/jobs/meta/facets`; image not rebuilt after S3 |

**Root causes of “limited selection”**

1. **No continuous ingest** — scraper not in default stack; last meaningful run ~2 days ago (local), older on public.
2. **Default expiry ~30 days** on save (`saveJobRecord.js`) + expire cleanup only inside scraper run → inventory collapses when scrapers stop.
3. **Narrow live sources** — only MyJobMag surviving; RapidAPI rows mostly expired; Kenya upstream pack not in image / not scheduled.
4. **Junk board titles** still active locally: `Careers`, `Job Openings`, `Fresh Jobs` (listing pages, not real roles).
5. **Listing query** filters `status = 'active'` but does **not** also require `expiry_date > NOW()` (safety net if expire job lags).

**Root causes of “categories failing”**

1. Explore renders **all 26** seeded categories; **most have `job_count = 0`**.
2. Cards still look clickable → `/?category=agriculture` → empty list (“Nothing perfect yet”) — feels broken.
3. Discovery chips take **first 12 by sort** (job_count DESC, so zeros still fill after the few non-zeros).
4. API already computes live counts via `COUNT(...) FILTER (WHERE status='active')`; stored `categories.job_count` can drift after mass expire if not recomputed.

**Product interpretation of your ask**

> “Show 0 categories if there are no jobs for the particular category”

Implement as:

- Always display accurate **`0 open roles`** when a zero category is shown.
- **Default Explore + homepage chips + sidebar: hide categories with 0 jobs** (primary UX).
- Optional toggle / query `?include_empty=1` (and API `include_empty=true`) for admin/debug or “show all fields”.
- Empty category navigation copy: “No open roles in {name} right now” + clear filters / browse all.

---

## Proposed approach (phased)

### Phase A — Relevance guards (fast, no new sources)
Expire past-due rows from the **app** (not only scraper), harden list/detail queries, reject junk listing titles, recompute category counts.

### Phase B — Categories UX
Hide empty categories by default; show `0` only when explicitly included; better empty-state when a zero category is forced via URL.

### Phase C — Steady supply (ops + ingest)
Enable scraper in compose (or always-on profile docs + one-shot bootstrap), rebuild image with Kenya pack + latest routes, run MyJobMag + KenyaCareers (+ RapidAPI if key present), verify volume/diversity.

### Phase D — Deploy both surfaces
Local `jobs_app` and public `jobs.usseo.one` (same image/DB story as your deploy path — confirm whether public is reverse-proxy to this host or separate).

---

## Step-by-step plan

### Task 1: App-side expiry + category count recompute

**Objective:** Active inventory never includes past-`expiry_date` rows even if scraper is down; category counts stay true.

**Files:**
- Modify: `src/server.js` (startup hook after migrate)
- Modify: `src/scrapers/scheduler.js` (extract shared cleanup or call shared module)
- Create: `src/jobs/expiryMaintenance.js` (shared)
- Modify: `src/routes/jobs.js` (defense-in-depth WHERE)
- Modify: `src/db/saveJobRecord.js` if needed after insert path

**Step 1 — Shared maintenance module**

Create `src/jobs/expiryMaintenance.js`:

```js
const db = require('../db');

async function expirePastDueJobs() {
  const expired = await db.query(`
    UPDATE jobs
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND expiry_date IS NOT NULL
      AND expiry_date < CURRENT_TIMESTAMP
    RETURNING id, category_id
  `);

  // Optional freshness ceiling for aggregated board/API rows (not employer-posted)
  const stale = await db.query(`
    UPDATE jobs
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND is_aggregated IS DISTINCT FROM FALSE
      AND COALESCE(posted_date, created_at) < NOW() - INTERVAL '45 days'
    RETURNING id, category_id
  `);

  await recomputeAllCategoryCounts();
  return {
    expiredByDate: expired.rowCount,
    expiredByAge: stale.rowCount,
  };
}

async function recomputeAllCategoryCounts() {
  await db.query(`
    UPDATE categories c
    SET job_count = (
      SELECT COUNT(*) FROM jobs j
      WHERE j.category_id = c.id AND j.status = 'active'
        AND (j.expiry_date IS NULL OR j.expiry_date > CURRENT_TIMESTAMP)
    )
  `);
}

module.exports = { expirePastDueJobs, recomputeAllCategoryCounts };
```

**Step 2 — Call on server boot** (after migrations) and optionally `setInterval` every 6h inside `src/server.js` (lightweight SQL).

**Step 3 — Defense in list/detail SQL** in `src/routes/jobs.js`:

Replace bare:

```sql
j.status = 'active'
```

with:

```sql
j.status = 'active'
AND (j.expiry_date IS NULL OR j.expiry_date > CURRENT_TIMESTAMP)
```

Apply on list, featured, trending, get-by-id, related. Same for `src/routes/categories.js` job lists and COUNT filters.

**Step 4 — Scheduler** should `require` the shared module instead of duplicating UPDATE.

**Verify:**

```bash
docker exec jobs_db psql -U postgres -d jobs_website -c \
  "SELECT status, COUNT(*) FROM jobs GROUP BY 1;"
# after maintenance: no active rows with expiry_date < now()
```

---

### Task 2: Reject junk listing titles at preprocess

**Objective:** Stop “Careers / Job Openings / Fresh Jobs” pages from counting as roles.

**Files:**
- Modify: `src/scrapers/preprocessJob.js`

**Logic (extend existing bare-title rejects):**

```js
const JUNK_TITLE = /^(careers?|jobs?|job openings?|fresh jobs?|vacancies|we are hiring|hiring|opportunities)$/i;
// also reject if title length < 8 after trim and matches /careers at company/i list pages
```

Mark `reject` with reason `junk_listing_title`.

**One-time cleanup SQL** (run with user OK on prod):

```sql
UPDATE jobs SET status = 'expired'
WHERE status = 'active'
  AND title ~* '^(careers?|job openings?|fresh jobs?|jobs?|vacancies)$';
-- then recompute category counts via maintenance module
```

**Verify:** active list no longer contains those titles.

---

### Task 3: Categories API — accurate 0 + hide empty by default

**Objective:** Categories with no active jobs report `job_count: 0` and are omitted from default public lists.

**Files:**
- Modify: `src/routes/categories.js`
- Modify: `public/js/categories-page.js`
- Modify: `public/js/main.js` (`loadCategories`)
- Optional CSS: `public/css/main.css` (muted zero card if include_empty)

**API change** (`GET /api/categories`):

```js
const includeEmpty = req.query.include_empty === '1' || req.query.include_empty === 'true';

// existing SELECT with COUNT FILTER (... active AND not past expiry ...)
// HAVING:
if (!includeEmpty) {
  // append: HAVING COUNT(j.id) FILTER (...) > 0
}
// Always return integer job_count (cast): COUNT(...)::int
```

Response stays `{ success, data: Category[] }`. Zero categories only appear when `include_empty=true`, each with `"job_count": 0`.

**UI Explore (`categories-page.js`):**

- Call `api('/categories')` (default non-empty).
- If `data.length === 0`, show empty state: “No open roles categorized yet — browse all jobs”.
- Optional footer link: “Show all fields (including empty)” → `api('/categories?include_empty=1')` and render cards with **`0 open roles`**, class `category-card is-empty`, **not** primary CTA (span instead of link, or link to `/?category=` with honest empty copy).

**Homepage sidebar + chips (`main.js`):**

- Use default `/categories` (non-empty only) for filters and discovery chips.
- Chip list: all returned (already >0) up to 12 — no more zero chips.
- Sidebar counts always `Number(cat.job_count) || 0` (already).

**Empty filter copy** when URL has `?category=slug` and total=0:

```js
// in renderJobs / loadJobs when state.filters.category && pagination.total === 0
h3: `No open roles in this category`
p: `Try another category or browse all jobs.`
```

**Verify:**

```bash
curl -sS 'http://127.0.0.1:3000/api/categories' | jq '.data | length, map(.job_count)'
curl -sS 'http://127.0.0.1:3000/api/categories?include_empty=1' | jq '[.data[] | select(.job_count==0)] | length'
# default length should equal nonzero categories only
```

---

### Task 4: Steady supply — enable scraper + rebuild image

**Objective:** Twice-daily ingest without manual runs; Kenya pack + latest scrapers inside image.

**Files:**
- Modify: `docker-compose.yml` — either remove `profiles: [scrapers]` from `scraper` service **or** document/default a `compose --profile scrapers` in README + ops script
- Prefer: **remove profile** so `docker compose up -d` starts `jobs_scraper` whenever RAPIDAPI optional env is present (MyJobMag + KenyaCareers work without key)
- Ensure scraper env includes same keys as app: `RAPIDAPI_KEY`, `DISABLE_KENYA_CAREERS`, `ENABLE_HTML_SCRAPERS`, `INGEST_MAX_JOBS_PER_SOURCE`
- `Dockerfile` already copies full tree — rebuild picks up `src/scrapers/kenya/`

**Recommended compose tweak:**

```yaml
scraper:
  # remove:
  # profiles:
  #   - scrapers
  environment:
    # ...existing...
    DISABLE_KENYA_CAREERS: ${DISABLE_KENYA_CAREERS:-false}
    ENABLE_HTML_SCRAPERS: ${ENABLE_HTML_SCRAPERS:-false}
    RAPIDAPI_MAX_REQUESTS_PER_RUN: ${RAPIDAPI_MAX_REQUESTS_PER_RUN:-80}
    INGEST_MAX_JOBS_PER_SOURCE: ${INGEST_MAX_JOBS_PER_SOURCE:-200}
```

**Durable deploy:**

```bash
cd ~/Documents/jobs
docker compose build app scraper
docker compose up -d app telegram-bot scraper
# if scraper still profiled:
# docker compose --profile scrapers up -d scraper
```

**Bootstrap once after deploy:**

```bash
docker exec jobs_scraper node src/scrapers/scheduler.js --max-jobs=150
# or host (DB_HOST=127.0.0.1 DB_PORT=5433):
cd ~/Documents/jobs && npm run scrape:bootstrap
npm run scrape:kenya:bootstrap
```

**Success criteria (targets, not guarantees):**

| Metric | Target after bootstrap + 48h |
|--------|------------------------------|
| Active jobs | ≥ 80 (stretch ≥ 150) |
| Categories with count > 0 | ≥ 8 |
| Sources with active rows | MyJobMag + ≥1 of KenyaCareers / JSearch / LinkedIn |
| Active past expiry | 0 |
| Junk titles active | 0 |

**Verify:**

```bash
docker ps --filter name=jobs_scraper
docker logs jobs_scraper --tail 80
docker exec jobs_db psql -U postgres -d jobs_website -c "
SELECT source, COUNT(*) FILTER (WHERE status='active') active, MAX(created_at) last_in
FROM jobs GROUP BY 1 ORDER BY active DESC;
SELECT COUNT(*) FILTER (WHERE status='active') active FROM jobs;
SELECT name, job_count FROM categories WHERE job_count > 0 ORDER BY job_count DESC;
"
curl -sS 'http://127.0.0.1:3000/api/jobs?limit=1' # pagination.total
curl -sS 'http://127.0.0.1:3000/api/categories'    # only non-empty
```

---

### Task 5: Relevance knobs (streams + mapping) without PII scrape

**Objective:** More **local / multi-field** choices, fewer random EU LinkedIn dupes dominating “Software”.

**Files:**
- Modify: `src/scrapers/jobStreams.js` — default RapidAPI location mix **weight KE** higher (already has KE list); ensure importers prefer `KE_LOCATIONS` when `JOBS_FOCUS=kenya` or always for this product.
- Modify: RapidAPI importers if they still default global `LOCATIONS` heavily.
- Modify: `src/scrapers/categoryMapper.js` — map “Instructor/Plumbing” → education/skilled-trades (already has instructor → education); ensure manufacturing/ops titles not dumped to `other`.
- Modify: `src/scrapers/MyJobMagScraper.js` — skip category hub URLs / multi-job “Careers at X” pages if not already.

**Env (optional):**

```bash
JOBS_FOCUS=kenya
RAPIDAPI_MAX_REQUESTS_PER_RUN=80
INGEST_MAX_JOBS_PER_SOURCE=200
```

**Do not:** build phone/name harvest pipelines; click-out apply links only.

---

### Task 6: Public site parity (`jobs.usseo.one`)

**Objective:** Production leaves 10-active / empty-categories state.

**Steps:**
1. Confirm routing: does `jobs.usseo.one` hit this host’s `jobs_app` or another server?
2. Same image deploy + scraper enable + bootstrap against the **production DB**.
3. Run expiry maintenance + junk cleanup on prod DB (with explicit OK).
4. Smoke:
   - `https://jobs.usseo.one/api/jobs` total ≥ target
   - `https://jobs.usseo.one/api/categories` returns only non-empty (or zeros only with flag)
   - Explore page no longer full of dead ends

---

### Task 7: Observability so supply does not silently die again

**Objective:** Know within a day if ingest stopped.

**Files:**
- Optional: extend `src/scrapers/qualityAssessment.js` gate: fail if `active < 30` or `max(created_at) < now()-36h`
- Optional Hermes/cron: daily check `SELECT MAX(created_at) FROM jobs` + Telegram alert via existing bot
- README ops section: “scraper must be up”; compose without profile

**Verify:** stop scraper in staging → quality/alert fires; restart recovers counts within one cron tick (`0 3,15 * * *` UTC = 6 AM/PM EAT).

---

## Files likely to change

| File | Change |
|------|--------|
| `src/jobs/expiryMaintenance.js` | **New** shared expire + category recount |
| `src/server.js` | Boot + interval maintenance |
| `src/scrapers/scheduler.js` | Use shared maintenance |
| `src/routes/jobs.js` | `expiry_date` guard on all public queries |
| `src/routes/categories.js` | Live count + `include_empty` + HAVING |
| `src/scrapers/preprocessJob.js` | Junk title rejects |
| `public/js/categories-page.js` | Hide empty default; 0-state UX |
| `public/js/main.js` | Chips/sidebar from non-empty; better empty category copy |
| `public/css/main.css` | `.category-card.is-empty` optional |
| `docker-compose.yml` | Scraper always-on + Kenya env |
| `README.md` / `docs/SCRAPER_QUALITY.md` | Ops notes |
| `src/scrapers/jobStreams.js` (+ rapidapi importers) | KE-weighted supply |
| `src/scrapers/categoryMapper.js` | Fewer “Other” buckets |

---

## Tests / validation

1. **Unit-ish / SQL:** after maintenance, `active ∩ expiry_date < now()` = 0.
2. **API:** categories default excludes zeros; `include_empty=1` shows zeros with `job_count === 0`.
3. **UI:** Explore only clickable categories with roles; `/?category=agriculture` honest empty if forced.
4. **Ingest:** one scraper run saves > 0; `jobs_scraper` container stays up.
5. **Regression:** login, forgot-password, job detail modal, alerts still work after rebuild.
6. **Public:** `jobs.usseo.one` totals move off ~10 active.

Commands:

```bash
cd ~/Documents/jobs
# after code + rebuild
curl -sS -X POST http://127.0.0.1:3000/api/users/forgot-password \
  -H 'Content-Type: application/json' -d '{"email":"t@example.com"}'
curl -sS 'http://127.0.0.1:3000/api/categories' | jq 'length as $x | .data | map(.job_count)|min'
# min job_count on default list should be >= 1
```

---

## Risks, tradeoffs, open questions

| Risk / question | Notes |
|-----------------|--------|
| **Hiding empty categories** | Taxonomy looks “smaller” until supply grows — intentional; `include_empty` preserves full map. |
| **45-day aggregated age cap** | May expire slow-moving gov posts early — tune to 60d or exempt `source_type IN ('GOV','NGO','CAREER')`. |
| **RapidAPI cost/quota** | Cap `RAPIDAPI_MAX_REQUESTS_PER_RUN`; MyJobMag + KenyaCareers are free path. |
| **Public vs local DB drift** | Local 21 vs public 10 — treat as **two environments** until deploy target confirmed. |
| **BrighterMonday** | Still off by default (`ENABLE_HTML_SCRAPERS`) — OK; upstream Kenya preferred. |
| **Rebuild required** | Hot-copying `users.js` already proved transitive requires break images; scraper/Kenya **must** rebuild. |
| **Legal/ToS** | Board scrapers stay labeled, click-out apply; no PII harvest. |

**Open question for you (default if silent):**

1. Default Explore = **hide empty categories** (recommended) vs always show all with **0 open roles** muted.
2. Enable `jobs_scraper` on every `compose up` (recommended) vs keep profile and only document `--profile scrapers`.
3. Focus inventory **Kenya-first** (recommended for JobsHub) vs global remote mix.

---

## Implementation order (when you say Proceed)

1. Task 1 expiry maintenance + SQL guards  
2. Task 2 junk titles + optional DB cleanup  
3. Task 3 categories API/UI  
4. Task 4 compose scraper + **image rebuild** + bootstrap scrape  
5. Task 5 stream/mapper tweaks if volume still thin  
6. Task 6 public deploy parity  
7. Task 7 alert/quality gate  

**Out of scope for this plan:** employer self-serve post + M-Pesa (S4+), mass registry URL repair beyond failing sources already flagged (`brighter-future-agency`, `jkuat`).
