# Plan: modal chrome, hero rotator, MyJobMag apply/email (not board)

**Project:** `/var/www/jobs`  
**Date:** 2026-08-26  
**Status:** waiting for approval

## Goal

1. Job modal: drop the letter logo placeholder on mobile and desktop; keep title block (`job-detail-info`) and the close button sticky while the modal body scrolls.
2. MyJobMag listings: strip board chrome from details (`prompt-link` / “Check how your CV aligns…”, `.icon-arrow`, “Build your CV for free” + `/cv`). Do **not** keep source-site nav links in the body. Only Method of Application contact is an outbound action — employer URL **or** email — never `myjobmag.co.ke`.
3. Hero: `<em>` always shows a visible default (`you`) on slow load; phrases actually rotate when the hero is in the viewport.

## Decisions (from Q&A)

- **Modal logo:** remove the **entire** logo column (no placeholder, no image). Cards unchanged.
- **Hero:** loop phrases while `.hero` is in view; pause on leave; never blank. Reduced-motion: stay on `you`.
- **Email-only jobs:** show the employer email as **text** in Method of Application. **No Apply button** (and never fall back to MyJobMag). Optional `mailto:` on the email text itself is OK as a small link; the primary `btn-apply` is omitted.

## Remaining assumption

- Existing ~1.3k dirty `description` rows: **render-strip + SQL/scraper backfill** (confirmed).
- Drop the extra **CV / Download** button (`cv_url`) from last round.
- `external_link` stays the MyJobMag listing URL internally (dedup / admin) but is never the user-facing Apply href.

## Why hero is static today (root cause)

HTML is `<section class="hero">` (`public/index.html`).  
`initHeroRotator()` looks for `.hero-section` / `#heroSection` / `#hero` — **none match**. It then sets text to the last phrase (`waking up for`) and **returns without observing or rotating**. Server-rendered default is also `waking up for`, not `you`.

## Why Apply still opens MyJobMag

- `openJobModal` Apply href is `job.application_url || job.external_link`.
- 645/1381 MyJobMag rows have `application_url IS NULL` (email / hand-delivery). Those fall back to the listing page.
- 0 stored `mailto:` values. Emails live only in description HTML.
- `rewriteJobContentLinks()` maps relative/same-origin anchors (`/cv`, `/apply-now/…`, taxonomy links) to `external_link` (the MyJobMag page).
- Stored descriptions: **1284** contain `prompt-link`, **1284** `.icon-arrow`, **1367** “Build your CV”.

Method-of-application anatomy (already documented):

- Direct `https://employer…` → `application_url`
- `/apply-now/{id}` → 302 to employer ATS → store **final** URL (reject if host still myjobmag)
- Email in prose → today NULL; **new:** `mailto:addr`
- `/cv`, `/cv-match` → never apply links

## Approach

### A. Modal UI (`public/js/main.js`, `public/css/main.css`)

- Stop rendering `.job-detail-logo` / `.job-logo-placeholder` inside the modal (cards unchanged).
- Make `.job-detail-header` / `.job-detail-info` `position: sticky; top: 0` on the scrolling `.modal-content`, with solid `background: var(--surface)` and a bottom border so content does not show through.
- Change `.modal-close` from `absolute` (scrolls away) to `sticky` on the same scroll container (`top` aligned with the header, high z-index). Same rules in the mobile sheet (`max-width: 560px`).
- Apply CTA: `mailto:` if `application_url` starts with `mailto:`; else http(s) employer URL; **else omit the Apply `<a>`** (keep Save). Never href MyJobMag.
- Remove `.job-detail-method` “CV / Download” and the “links back to myjobmag” paragraph.
- Client-side `stripBoardChrome(root)` on every `.job-detail-content` before fold/rewrite:
  - remove `a.prompt-link`, `.icon-arrow`, nodes matching “Check how your CV aligns”
  - remove “Build your CV for free” paragraph and `a[href*="/cv"]`
  - unwrap or drop remaining `<a>` whose host is myjobmag or whose path is board nav (`/jobs-at/`, `/jobs-by-`, `/jobs-location/`, `/apply-now/`, `/job-application/`, `/contact`)
  - keep `mailto:` / `tel:` and true external employer links **only inside the Method of Application fold**
- After chrome strip, `rewriteJobContentLinks` must **not** remap leftovers to `external_link`. Relative board hrefs → remove href (or convert to plain text).

### B. Hero (`public/index.html`, `public/js/main.js`)

- Default visible text in HTML: `you` (and matching `.sr-only`).
- Observe **`.hero`** (the real class).
- While intersecting and not `prefers-reduced-motion`: cycle `you` → grinding for → diving into → showing up for → living for → waking up for → repeat.
- On leave-viewport: pause, leave current phrase in the DOM (never empty).
- If JS is slow/failed: HTML `you` is already there.

### C. Scraper + schema (`src/scrapers/MyJobMagScraper.js`, `preprocessJob.js`)

- After load, **sanitize description HTML**: drop `.prompt-link`, SVG `.icon-arrow`, the `clear:both` CV-builder footer, ads (`#adbox`), share/save chrome. Strip every `<a>` **outside** `#application-method`’s following block (unwrap text, drop href).
- `extractApplyUrl`: keep direct + `/apply-now/` resolve; **add email extraction** from the method section (`mailto:` href or email regex in text). Prefer URL over email if both exist. Reject any final URL whose host is `myjobmag`.
- Stop collecting `/cv` into `cv_url` for user-facing apply. Leave column unused (no migration drop unless asked).
- `saveJobRecord` already writes `application_url`; allow `mailto:` through `preprocessJob` (today `normalizeUrl` likely drops it — **fix**).

### D. Backfill existing rows

- Script from `job-board-scraping` template: for MyJobMag rows, re-fetch listing **or** (faster, no extra HTTP) regex-clean stored `description` + extract email into `application_url` where NULL.
- Prefer **HTML clean of stored descriptions without re-fetch** for chrome (works offline). For NULL apply URLs that need `/apply-now/` resolve, optional second pass that re-fetches live listings only (`--only-missing`).
- Client strip in A makes UI correct even before backfill finishes.

### E. Deploy

- Bump `public/sw.js` `CACHE_VERSION` (`jobshub-v4` → `v5`).
- `pm2 restart jobs-website` after server/scraper JS changes.
- Rebuild/restart `jobs_scraper` Docker image (baked code, no bind mount). Postgres `jobs_db` image does **not** need rebuild; column `cv_url` already exists.
- Commit/push only after this plan is approved (you already asked to commit last time; this round waits).

## Step-by-step tasks

1. Fix hero selector + HTML default `you` + in-view loop/pause.
2. Modal: remove logo block; sticky header + close; Apply href policy; client `stripBoardChrome`.
3. Scraper: description sanitizer; email + resolved ATS; `preprocessJob` mailto allowlist.
4. CSS sticky + mobile sheet tweaks.
5. Backfill script: description chrome + NULL→mailto from stored HTML; optional live re-fetch for remaining URL gaps.
6. `CACHE_VERSION` v5; PM2; `docker compose build scraper && restart`.
7. Verify (below). Commit when you say so.

## Tests / verification

- Slow-load: disable JS or throttle — hero reads **Find work worth you**. Enable JS, stay on hero — phrases change; scroll away — freeze; return — resume.
- Open a modal with no logo: no letter tile; title + X stay visible while scrolling body (desktop + ≤560px sheet).
- MyJobMag job with `prompt-link` in DB: modal has no CV-align CTA, no arrow SVG, no “Build your CV”.
- Body links: taxonomy/company `/jobs-at/` are not clickable to MyJobMag.
- ATS job: Apply → employer host (curl `-sI` Location / `application_url` host ≠ myjobmag).
- Email job (e.g. Divine Caterers pattern): Apply → `mailto:jobs@…`.
- `curl -s localhost:3004/api/jobs/:id` — `application_url` is https employer or mailto, never myjobmag host.

## Risks

- Sticky header height on mobile can eat sheet space if meta wraps — cap with tighter header (title + company only; meta can scroll).
- `/apply-now/` ATS collapse (one portal URL for many IDs) is upstream; we still store the resolved employer URL.
- Email regex false positives in method prose — scope to method section only.
- Client-only strip without backfill leaves dirty HTML in DB/API (fine for UI, messy for alerts). Backfill recommended.

## Open questions

1. Modal logos: drop **placeholder only** (keep real images) or drop the **entire** logo column in the modal?
2. Hero: **loop while in view** (assumed) or one-shot then land on “waking up for”?
3. Email-only Apply button: **`mailto:`** (assumed) or show the address as text with no button?
4. Existing 1.3k descriptions: **render-strip + SQL backfill** (assumed) or render-strip only?

## Optional rules (not written unless you approve plan+rules)

In project `AGENTS.md` / job-board-scraping skill: never use `external_link` as user-facing Apply; never store myjobmag hosts in `application_url`; `mailto:` is a valid apply target; hero observer must target `.hero`.
