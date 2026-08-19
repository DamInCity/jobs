/**
 * Supply heartbeat — expire stale jobs, score inventory, alert via Telegram / n8n.
 *
 * Usage:
 *   node src/jobs/supplyHeartbeat.js
 *   node src/jobs/supplyHeartbeat.js --json
 *   node src/jobs/supplyHeartbeat.js --alert-only-on-fail
 *
 * Compose/PM2: run every few hours so the board stays healthy without manual ops.
 */

require('dotenv').config();

const db = require('../db');
const config = require('../config');
const {
  expirePastDueJobs,
  getSupplySnapshot,
} = require('./expiryMaintenance');

async function postJson(url, body) {
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function notifyTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN || config.telegram?.botToken;
  const chatId = process.env.SUPPLY_ALERT_CHAT_ID || process.env.TELEGRAM_ALERT_CHAT_ID;
  if (!token || !chatId) return { ok: false, skipped: true };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function run() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const alertOnlyOnFail = args.includes('--alert-only-on-fail');

  const maintenance = await expirePastDueJobs();
  const snapshot = await getSupplySnapshot();

  const payload = {
    type: 'jobshub_supply_heartbeat',
    maintenance,
    supply: snapshot,
  };

  if (!asJson) {
    console.log('🧹 Maintenance', maintenance);
    console.log(
      `📦 Supply active=${snapshot.active} kenya=${snapshot.kenya_active} ` +
        `cats=${snapshot.categories_with_jobs} last_ingest_h=${snapshot.hours_since_ingest} ` +
        `gates=${snapshot.gates_passed ? 'PASS' : 'FAIL'}`
    );
    if (!snapshot.gates_passed) {
      console.log('   gate detail:', snapshot.gates);
    }
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  const shouldAlert = !snapshot.gates_passed || !alertOnlyOnFail;
  if (shouldAlert && !snapshot.gates_passed) {
    const lines = [
      '⚠️ JobsHub supply heartbeat FAILED',
      `active=${snapshot.active} (min ${snapshot.thresholds.minActive})`,
      `kenya=${snapshot.kenya_active}`,
      `categories_with_jobs=${snapshot.categories_with_jobs}`,
      `hours_since_ingest=${snapshot.hours_since_ingest}`,
      `gates=${JSON.stringify(snapshot.gates)}`,
      `expired_now date=${maintenance.expiredByDate} age=${maintenance.expiredByAge} junk=${maintenance.expiredJunkTitles}`,
      config.app?.url || process.env.APP_URL || '',
    ];
    const text = lines.filter(Boolean).join('\n');

    const n8nUrl =
      process.env.N8N_SUPPLY_WEBHOOK_URL ||
      process.env.N8N_WEBHOOK_URL ||
      config.n8n?.webhookUrl;
    const [tg, n8n] = await Promise.all([
      notifyTelegram(text),
      postJson(n8nUrl, { ...payload, alert: true, message: text }),
    ]);
    if (!asJson) {
      console.log('📣 Telegram', tg);
      console.log('📣 n8n', n8n);
    }
    payload.alerts = { telegram: tg, n8n };
  } else if (!alertOnlyOnFail && snapshot.gates_passed) {
    // Optional quiet success ping to n8n only (no Telegram spam)
    const n8nUrl = process.env.N8N_SUPPLY_WEBHOOK_URL;
    if (n8nUrl) {
      payload.alerts = {
        n8n: await postJson(n8nUrl, { ...payload, alert: false }),
      };
    }
  }

  await db.pool.end().catch(() => {});
  process.exit(snapshot.gates_passed ? 0 : 2);
}

run().catch(async (err) => {
  console.error('supplyHeartbeat fatal:', err);
  try {
    await db.pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
