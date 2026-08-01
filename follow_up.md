# how to personalize it to user
===========
user subscribes to job category, eg software, social work, etc.
user submits cv stored on their profile
user gets personalized messages on tg/whatsapp per their request, eg job category, location, hybrid, remote, etc.
n8n automations + hermes?

# Implemented (phase 1 + telegram + n8n path)
- CV upload → text extract → skill/category profile → "My profile" alert
- Optional Telegram username on signup; link bot for delivery
- n8n POST /api/ingest/jobs → auto daily alerts when jobs accepted
- See docs/N8N.md, docs/TELEGRAM.md

# version 2
======
user uploads cv, jobs they choose are applied for them automatically
