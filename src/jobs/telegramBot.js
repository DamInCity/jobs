/**
 * Telegram bot long-polling for account linking + preference status
 * Run: node src/jobs/telegramBot.js
 * Requires TELEGRAM_BOT_TOKEN
 *
 * Job digests are sent by src/jobs/emailAlerts.js (schedule / post-scrape).
 */

require('dotenv').config();
const db = require('../db');
const config = require('../config');
const { ensurePreferenceAlert } = require('./emailAlerts');

const TOKEN = config.telegram.botToken;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let offset = 0;
let running = true;

async function apiCall(method, body) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data.result;
}

async function sendMessage(chatId, text) {
  // Telegram message limit ~4096; keep safe margin
  const chunks = [];
  let remaining = text;
  while (remaining.length > 4000) {
    chunks.push(remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }
  chunks.push(remaining);
  for (const chunk of chunks) {
    await apiCall('sendMessage', { chat_id: chatId, text: chunk });
  }
}

async function findUserByChat(chatId) {
  const result = await db.query(
    `
    SELECT id, email, name, notify_channels,
           preferred_categories, preferred_locations, preferred_job_types,
           telegram_chat_id
    FROM users
    WHERE telegram_chat_id = $1
    LIMIT 1
    `,
    [String(chatId)]
  );
  return result.rows[0] || null;
}

async function formatCriteria(criteria) {
  if (!criteria || typeof criteria !== 'object') return 'any jobs';
  const parts = [];
  if (criteria.keywords) parts.push(`keywords: ${criteria.keywords}`);
  if (criteria.location) parts.push(`location: ${criteria.location}`);
  if (Array.isArray(criteria.locations) && criteria.locations.length) {
    parts.push(`locations: ${criteria.locations.join(', ')}`);
  }
  if (criteria.job_type) parts.push(`type: ${criteria.job_type}`);
  if (Array.isArray(criteria.job_types) && criteria.job_types.length) {
    parts.push(`types: ${criteria.job_types.join(', ')}`);
  }

  const catIds = [];
  if (criteria.category) catIds.push(criteria.category);
  if (Array.isArray(criteria.categories)) catIds.push(...criteria.categories);
  if (catIds.length) {
    const r = await db.query(
      'SELECT name FROM categories WHERE id = ANY($1::uuid[]) ORDER BY name',
      [catIds]
    );
    if (r.rows.length) {
      parts.push(`categories: ${r.rows.map((x) => x.name).join(', ')}`);
    } else {
      parts.push('category filter set');
    }
  }

  return parts.length ? parts.join(' · ') : 'any jobs';
}

async function linkUser(token, chatId, from) {
  if (!token) {
    await sendMessage(
      chatId,
      'Welcome to JobsHub!\n\nTo link your account, open Job Alerts on the website and tap “Link Telegram”.\n\n' +
        `${config.app.url}/alerts`
    );
    return;
  }

  const result = await db.query(
    `
    SELECT id, email, name, notify_channels,
           preferred_categories, preferred_locations, preferred_job_types
    FROM users
    WHERE telegram_link_token = $1
      AND telegram_link_expires > NOW()
    `,
    [token]
  );

  if (result.rows.length === 0) {
    await sendMessage(
      chatId,
      'This link is invalid or expired. Please generate a new link from JobsHub → Job Alerts.'
    );
    return;
  }

  const user = result.rows[0];
  const channels = Array.isArray(user.notify_channels)
    ? [...user.notify_channels]
    : ['email'];
  if (!channels.includes('telegram')) channels.push('telegram');

  await db.query(
    `
    UPDATE users SET
      telegram_chat_id = $1,
      notify_channels = $2,
      telegram_link_token = NULL,
      telegram_link_expires = NULL
    WHERE id = $3
    `,
    [String(chatId), channels, user.id]
  );

  // Create a daily alert from profile preferences if none exist
  try {
    await ensurePreferenceAlert(user.id, user);
  } catch (error) {
    console.warn('ensurePreferenceAlert after link:', error.message);
  }

  const display = user.name || user.email;
  await sendMessage(
    chatId,
    `✅ Linked to JobsHub as ${display}.\n\n` +
      `You will receive job opportunities matching your categories and filters.\n\n` +
      `Commands:\n` +
      `/status — account & channels\n` +
      `/alerts — your active job filters\n` +
      `/help — help\n\n` +
      `Manage preferences: ${config.app.url}/alerts`
  );
  console.log(
    `✅ Linked Telegram chat ${chatId} → user ${user.email}${from?.username ? ` (@${from.username})` : ''}`
  );
}

async function sendStatus(chatId) {
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      `Not linked yet.\nOpen ${config.app.url}/alerts and tap “Link Telegram”.`
    );
    return;
  }

  const channels = Array.isArray(user.notify_channels)
    ? user.notify_channels.join(', ')
    : 'email';

  const alertCount = await db.query(
    `SELECT COUNT(*)::int AS n FROM job_alerts WHERE user_id = $1 AND is_active = true`,
    [user.id]
  );

  await sendMessage(
    chatId,
    `JobsHub status\n\n` +
      `Account: ${user.name || user.email}\n` +
      `Email: ${user.email}\n` +
      `Channels: ${channels}\n` +
      `Active alerts: ${alertCount.rows[0].n}\n\n` +
      `Use /alerts to see category filters.\n` +
      `Manage: ${config.app.url}/alerts`
  );
}

async function sendAlertsList(chatId) {
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      `Not linked yet.\nOpen ${config.app.url}/alerts and tap “Link Telegram”.`
    );
    return;
  }

  // Ensure prefs become alerts if user only set profile prefs
  try {
    await ensurePreferenceAlert(user.id, user);
  } catch {
    /* ignore */
  }

  const alerts = await db.query(
    `
    SELECT id, name, search_criteria, frequency, is_active, last_sent_at
    FROM job_alerts
    WHERE user_id = $1
    ORDER BY is_active DESC, created_at DESC
    LIMIT 20
    `,
    [user.id]
  );

  if (alerts.rows.length === 0) {
    await sendMessage(
      chatId,
      `No job filters yet.\n\n` +
        `Create an alert with your preferred categories on the website:\n` +
        `${config.app.url}/alerts\n\n` +
        `Once set, new matching jobs will be sent here.`
    );
    return;
  }

  const lines = [`Your job notification filters:\n`];
  for (let i = 0; i < alerts.rows.length; i++) {
    const a = alerts.rows[i];
    const criteria =
      typeof a.search_criteria === 'string'
        ? JSON.parse(a.search_criteria)
        : a.search_criteria || {};
    const summary = await formatCriteria(criteria);
    const last = a.last_sent_at
      ? new Date(a.last_sent_at).toISOString().slice(0, 16).replace('T', ' ')
      : 'never';
    lines.push(
      `${i + 1}. ${a.name || 'Untitled'} (${a.frequency}${a.is_active ? '' : ', paused'})\n` +
        `   ${summary}\n` +
        `   last sent: ${last}\n`
    );
  }
  lines.push(`Edit on the web: ${config.app.url}/alerts`);
  await sendMessage(chatId, lines.join('\n'));
}

async function handleUpdate(update) {
  const message = update.message || update.edited_message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const payload = parts[1] || null;
    await linkUser(payload, chatId, message.from);
    return;
  }

  if (command === '/help') {
    await sendMessage(
      chatId,
      'JobsHub bot\n\n' +
        '/start — link account (use the link from the website)\n' +
        '/status — check link & channels\n' +
        '/alerts — list category / preference filters\n' +
        '/help — this message\n\n' +
        `Job digests are sent when new listings match your filters.\n` +
        `Set categories: ${config.app.url}/alerts`
    );
    return;
  }

  if (command === '/status') {
    await sendStatus(chatId);
    return;
  }

  if (command === '/alerts' || command === '/prefs') {
    await sendAlertsList(chatId);
    return;
  }

  await sendMessage(
    chatId,
    'JobsHub bot commands:\n/start — link account\n/status — account status\n/alerts — your filters\n/help — help'
  );
}

async function poll() {
  while (running) {
    try {
      const updates = await apiCall('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message'],
      });

      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('Failed to handle update:', error.message);
        }
      }
    } catch (error) {
      console.error('Poll error:', error.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set.');
    console.error('   Set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME in .env (see docs/TELEGRAM.md).');
    console.error('   Idling so Docker does not crash-loop; restart after configuring.');
    // Bare Promise does not keep Node's event loop alive — use a timer.
    await new Promise(() => {
      setInterval(() => {}, 60 * 60 * 1000);
    });
    return;
  }

  const me = await apiCall('getMe');
  console.log(`🤖 Telegram bot @${me.username} starting (long poll)...`);
  console.log(`   Link users via: https://t.me/${me.username}?start=<token>`);
  console.log(`   Digests are sent by the alerts job (schedule / post-scrape).`);

  process.on('SIGINT', () => {
    running = false;
    console.log('\nShutting down bot...');
    db.pool.end().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    running = false;
    db.pool.end().then(() => process.exit(0));
  });

  await poll();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { linkUser, handleUpdate, findUserByChat };
