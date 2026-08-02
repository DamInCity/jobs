# Telegram job notifications

JobsHub sends **personalized job digests** to Telegram based on each user’s alert filters (category, location, job type, keywords).

## Architecture

| Process | Role |
|---------|------|
| `telegram-bot` | Long-polling bot: link account (`/start`), `/status`, `/alerts`, `/resume` (tailored PDF) |
| `emailAlerts.js` | Match jobs to `job_alerts` criteria → `sendMessage` to linked chats |
| Scraper (optional) | After new jobs are saved, runs daily alert matching automatically |

Web UI (`/alerts`) is the source of truth for categories and filters.

## Setup (BotFather)

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow prompts.
3. Copy the **token** and **username** (without `@`).
4. Put them in `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_BOT_USERNAME=YourJobsHubBot
APP_URL=https://your-public-site-or-localhost
```

5. Start services:

```bash
docker compose up -d --build
# telegram-bot container starts with app
```

Or locally:

```bash
npm run telegram-bot   # link bot (keep running)
npm run alerts:force   # send digests now
```

## User flow

1. **Sign up** (optional Telegram username for contact) → redirected to `/alerts?onboarding=1`.
2. **Upload CV** on **Profile** or **Alerts** → skill profile (categories + skills) and a “My profile” alert.
3. **Confirm profile** (or edit preferences).
4. Click **Link Telegram** → complete `/start` in the bot (chat ID is required for delivery; username alone is not enough).
5. When matching jobs appear (scrape, n8n ingest, or `alerts:force`), the user gets a chat digest.
6. **Optional:** `/resume` (or Profile → Tailor CV) generates a job-specific PDF via SiliconFlow.

Manual path still works: create a category alert without a CV.

Bot commands after linking:

- `/status` — account and channels  
- `/alerts` — active category filters  
- `/resume` — list matching/saved jobs and tailor your master CV for one of them  
- `/resume 1` — generate a tailored PDF for list item #1 (also `/resume <job-uuid>`)  
- `/help` — help  

### Tailored CV (`/resume`)

1. Upload a master CV on the website (**Profile** or **Alerts**).
2. Set `SILICONFLOW_API_KEY` and `SILICONFLOW_MODEL` in `.env` (OpenAI-compatible API at SiliconFlow).
3. Link Telegram, then send `/resume` — pick a numbered match.
4. The bot replies with a PDF (and the same file appears under **Profile → Tailored resumes**).

Requires the `telegram-bot` service to share the CV upload volume and SiliconFlow env (see `docker-compose.yml`).

## How matching works

1. Active `job_alerts` rows (category, location, job type, keywords/skills) are evaluated.
2. Jobs must be `status = active` and within the lookback window (`ALERT_LOOKBACK_DAYS`, default **30**).
3. If the last send was recent, only newer `posted_date` jobs are preferred; if that yields **zero**, the matcher **backfills** within the lookback window and relaxes filters (drop location/type → category-only) so qualified roles still deliver.
4. Delivery uses `notify_channels` + `telegram_chat_id` (link is required; username alone is not enough).

Logs show `stage=strict|lookback|no-location-type|category-only|none` and per-channel `ok` / `dry-run` / `err`.

## Manual test without scrapers

```bash
# Create alert + link Telegram via UI, then one-shot:
docker compose exec app node src/jobs/emailAlerts.js --force --frequency=daily
# or host:
npm run alerts:force
```

If `TELEGRAM_BOT_TOKEN` is set and the user is linked, messages are sent for real; otherwise the job logs a dry-run line.

### 5‑minute diagnostic loop (all linked users)

Use this when digests should fire but chat is silent — it is a **matching + delivery** health check.

```env
ALERT_TEST_INTERVAL_MINUTES=5
ALERT_LOOKBACK_DAYS=30
```

```bash
# Host (reads .env):
ALERT_TEST_INTERVAL_MINUTES=5 npm run alerts:test

# Docker:
docker compose exec -e ALERT_TEST_INTERVAL_MINUTES=5 app node src/jobs/emailAlerts.js --test-loop
```

- Sends **1** *new* matched job to every user with `telegram_chat_id` every N minutes.
- Messages are prefixed with `🧪 Test digest`.
- Does **not** update `last_sent_at`, but **does** write `job_alert_deliveries` so the **same job is never re-sent** to that user (test or production).
- Logs `TEST: ALL MATCHES ALREADY SENT` when every match was already delivered.
- Logs `TEST: NO MATCH for …` when criteria find nothing — a strong signal the matcher or prefs are wrong.
- Set `ALERT_TEST_INTERVAL_MINUTES=0` (or stop the process) when finished — leave the test loop running and you will burn through unique matches once each.

Optional PM2 app: `jobs-alerts-test` in `ecosystem.config.js` (disabled by default).

## Notes

- Linking auto-enables the `telegram` notify channel.
- If a linked user has profile preferences but no alert row, a **“My preferences”** daily alert is created automatically.
- Unlink from the website clears `telegram_chat_id`.
- Change your account email anytime on **Job Alerts** (requires current password).
