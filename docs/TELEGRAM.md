# Telegram job notifications

JobsHub sends **personalized job digests** to Telegram based on each user’s alert filters (category, location, job type, keywords).

## Architecture

| Process | Role |
|---------|------|
| `telegram-bot` | Long-polling bot: link account (`/start`), `/status`, `/alerts` |
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

1. Sign in → open `/alerts`.
2. Create an alert (pick category / location / remote|hybrid|onsite).
3. Click **Link Telegram** → complete `/start` in the bot.
4. When matching jobs appear (scrape or manual), the user gets a chat digest.

Bot commands after linking:

- `/status` — account and channels  
- `/alerts` — active category filters  
- `/help` — help  

## Manual test without scrapers

```bash
# Create alert + link Telegram via UI, then:
docker compose exec app node src/jobs/emailAlerts.js --force --frequency=daily
```

If `TELEGRAM_BOT_TOKEN` is set and the user is linked, messages are sent for real; otherwise the job logs a dry-run line.

## Notes

- Linking auto-enables the `telegram` notify channel.
- If a linked user has profile preferences but no alert row, a **“My preferences”** daily alert is created automatically.
- Unlink from the website clears `telegram_chat_id`.
