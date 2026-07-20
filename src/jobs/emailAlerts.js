/**
 * Multi-channel job alerts (email + Telegram)
 * Run via PM2 or cron: node src/jobs/emailAlerts.js
 *
 * Flags:
 *   --force              Ignore hour/day schedule gates
 *   --frequency=daily    Process only this frequency (daily|weekly)
 *   --frequency=all      Process both (with --force)
 */

require('dotenv').config();
const db = require('../db');
const config = require('../config');

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { force: false, frequency: null, closePool: true };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--no-close-pool') args.closePool = false;
    else if (arg.startsWith('--frequency=')) {
      args.frequency = arg.split('=')[1];
    }
  }
  return args;
}

/**
 * Build job_alerts search_criteria from user preferred_* fields.
 */
function criteriaFromPreferences(user) {
  const criteria = {};
  const cats = normalizeUuidArray(user.preferred_categories);
  if (cats.length > 1) {
    criteria.categories = cats;
  } else if (cats.length === 1) {
    criteria.category = cats[0];
  }

  const locations = normalizeTextArray(user.preferred_locations);
  if (locations.length === 1) {
    criteria.location = locations[0];
  } else if (locations.length > 1) {
    // Match any of the preferred locations via OR (handled in findMatchingJobs)
    criteria.locations = locations;
  }

  const types = normalizeTextArray(user.preferred_job_types);
  if (types.length === 1) {
    criteria.job_type = types[0];
  } else if (types.length > 1) {
    criteria.job_types = types;
  }

  return criteria;
}

function normalizeUuidArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    // Postgres may return "{uuid1,uuid2}" for some drivers
    const trimmed = value.replace(/^{|}$/g, '');
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeTextArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    const trimmed = value.replace(/^{|}$/g, '');
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [];
}

/**
 * If user has preferences but no active alert, create a daily "My preferences" alert.
 * Returns the created row or null.
 */
async function ensurePreferenceAlert(userId, userRow = null) {
  const existing = await db.query(
    `SELECT id FROM job_alerts WHERE user_id = $1 AND is_active = true LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) return null;

  let user = userRow;
  if (!user) {
    const res = await db.query(
      `
      SELECT preferred_categories, preferred_locations, preferred_job_types
      FROM users WHERE id = $1
      `,
      [userId]
    );
    user = res.rows[0];
  }
  if (!user) return null;

  const criteria = criteriaFromPreferences(user);
  if (Object.keys(criteria).length === 0) return null;

  const result = await db.query(
    `
    INSERT INTO job_alerts (user_id, name, search_criteria, frequency, is_active)
    VALUES ($1, $2, $3, 'daily', true)
    RETURNING *
    `,
    [userId, 'My preferences', JSON.stringify(criteria)]
  );
  console.log(`📌 Created preference alert for user ${userId}`);
  return result.rows[0];
}

/**
 * For Telegram-linked users with prefs but no alerts, backfill alert rows.
 */
async function backfillPreferenceAlertsForTelegramUsers() {
  const result = await db.query(`
    SELECT u.id, u.preferred_categories, u.preferred_locations, u.preferred_job_types
    FROM users u
    WHERE u.telegram_chat_id IS NOT NULL
      AND (
        u.preferred_categories IS NOT NULL
        OR u.preferred_locations IS NOT NULL
        OR u.preferred_job_types IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_alerts ja
        WHERE ja.user_id = u.id AND ja.is_active = true
      )
  `);

  for (const row of result.rows) {
    try {
      await ensurePreferenceAlert(row.id, row);
    } catch (error) {
      console.warn(`Could not backfill alert for ${row.id}:`, error.message);
    }
  }
}

function createMailTransporter() {
  const host = config.email.host;
  if (
    !nodemailer ||
    !host ||
    !config.email.user ||
    host.includes('example.com')
  ) {
    return null;
  }
  return nodemailer.createTransport({
    host,
    port: config.email.port,
    secure: config.email.port === 465,
    auth: {
      user: config.email.user,
      pass: config.email.password,
    },
  });
}

const mailTransporter = createMailTransporter();

async function sendEmail(to, subject, html) {
  if (!mailTransporter) {
    console.log(`📧 [dry-run] Would send email to ${to}: ${subject}`);
    return { sent: false, dryRun: true };
  }

  await mailTransporter.sendMail({
    from: config.email.from,
    to,
    subject,
    html,
  });
  return { sent: true, dryRun: false };
}

async function sendTelegramMessage(chatId, text) {
  const token = config.telegram.botToken;
  if (!token || !chatId) {
    console.log(`📱 [dry-run] Would send Telegram to ${chatId}: ${text.slice(0, 80)}...`);
    return { sent: false, dryRun: true };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error (${response.status})`);
  }
  return { sent: true, dryRun: false };
}

async function notifyN8n(payload) {
  if (!config.n8n.webhookUrl) return { sent: false, dryRun: true };
  try {
    const response = await fetch(config.n8n.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(`⚠️ n8n webhook returned ${response.status}`);
      return { sent: false, dryRun: false };
    }
    return { sent: true, dryRun: false };
  } catch (error) {
    console.warn(`⚠️ n8n webhook failed: ${error.message}`);
    return { sent: false, dryRun: false };
  }
}

function jobUrl(job) {
  if (job.slug) return `${config.app.url}/jobs/${job.slug}`;
  return job.external_link || config.app.url;
}

function buildJobHtml(job) {
  return `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <h3 style="margin: 0 0 8px; color: #111827;">${escapeHtml(job.title)}</h3>
      <p style="margin: 0 0 8px; color: #6b7280;">${escapeHtml(job.company_name)} • ${escapeHtml(job.location)}</p>
      <p style="margin: 0 0 12px; color: #9ca3af; font-size: 14px;">
        ${escapeHtml(job.job_type)} ${job.salary_min ? `• ${formatSalary(job.salary_min, job.salary_max, job.salary_currency)}` : ''}
      </p>
      <a href="${jobUrl(job)}" 
         style="display: inline-block; background-color: #0d9488; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px;">
        View Job
      </a>
    </div>
  `;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSalary(min, max, currency = 'KES') {
  if (min && max) return `${currency} ${min.toLocaleString()} - ${max.toLocaleString()}`;
  if (min) return `From ${currency} ${min.toLocaleString()}`;
  if (max) return `Up to ${currency} ${max.toLocaleString()}`;
  return '';
}

function buildEmailTemplate(userName, jobs, alertName) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #0d9488; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: white; font-size: 24px;">💼 JobsHub</h1>
        </div>
        
        <div style="padding: 24px;">
          <h2 style="margin: 0 0 8px; color: #111827;">New Jobs for You!</h2>
          <p style="margin: 0 0 24px; color: #6b7280;">
            Hi ${escapeHtml(userName) || 'there'},<br>
            We found ${jobs.length} new job${jobs.length > 1 ? 's' : ''} matching your "${escapeHtml(alertName)}" alert.
          </p>
          
          ${jobs.map((job) => buildJobHtml(job)).join('')}
          
          <div style="text-align: center; margin-top: 24px;">
            <a href="${config.app.url}" 
               style="display: inline-block; background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View All Jobs
            </a>
          </div>
        </div>
        
        <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">
            You're receiving this because you set up job alerts on JobsHub.
          </p>
          <a href="${config.app.url}/alerts" style="color: #0d9488; font-size: 14px;">
            Manage your alerts
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
}

function buildTelegramMessage(userName, jobs, alertName, categoryLabel) {
  const categoryBit = categoryLabel ? ` in ${categoryLabel}` : '';
  const lines = [
    `Hi ${userName || 'there'} — ${jobs.length} new job${jobs.length > 1 ? 's' : ''}${categoryBit} matching “${alertName || 'Job Alert'}”:`,
    '',
  ];

  jobs.forEach((job, i) => {
    const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
    const cat = job.category_name ? ` · ${job.category_name}` : '';
    lines.push(`${i + 1}. ${job.title} @ ${job.company_name}`);
    lines.push(`   ${job.location} · ${job.job_type}${cat}${salary ? ` · ${salary}` : ''}`);
    lines.push(`   ${jobUrl(job)}`);
    lines.push('');
  });

  lines.push(`Manage alerts: ${config.app.url}/alerts`);
  return lines.join('\n').trim();
}

function normalizeChannels(channels, user) {
  let list = Array.isArray(channels) ? [...channels] : [];
  if (list.length === 0) list = ['email'];

  // Only include telegram if linked; whatsapp is n8n-only for now
  const out = new Set(list.map((c) => String(c).toLowerCase()));
  if (!user.telegram_chat_id) out.delete('telegram');
  out.delete('whatsapp');

  // Never leave the user with zero deliverable channels
  if (out.size === 0) out.add('email');
  return [...out];
}

async function findMatchingJobs(criteria, lastSentAt) {
  const conditions = ["j.status = 'active'"];
  const params = [];
  let paramIndex = 1;

  if (lastSentAt) {
    conditions.push(`j.posted_date > $${paramIndex++}`);
    params.push(lastSentAt);
  } else {
    conditions.push(`j.posted_date > NOW() - INTERVAL '24 hours'`);
  }

  if (criteria.keywords) {
    conditions.push(`(j.title ILIKE $${paramIndex} OR j.description ILIKE $${paramIndex})`);
    params.push(`%${criteria.keywords}%`);
    paramIndex++;
  }

  // Single category or multi-category (ANY)
  if (Array.isArray(criteria.categories) && criteria.categories.length > 0) {
    conditions.push(`j.category_id = ANY($${paramIndex++}::uuid[])`);
    params.push(criteria.categories);
  } else if (criteria.category) {
    conditions.push(`j.category_id = $${paramIndex++}`);
    params.push(criteria.category);
  }

  if (Array.isArray(criteria.locations) && criteria.locations.length > 0) {
    const ors = criteria.locations.map((loc) => {
      const clause = `j.location ILIKE $${paramIndex++}`;
      params.push(`%${loc}%`);
      return clause;
    });
    conditions.push(`(${ors.join(' OR ')})`);
  } else if (criteria.location) {
    conditions.push(`j.location ILIKE $${paramIndex++}`);
    params.push(`%${criteria.location}%`);
  }

  if (Array.isArray(criteria.job_types) && criteria.job_types.length > 0) {
    conditions.push(`j.job_type = ANY($${paramIndex++}::job_type[])`);
    params.push(criteria.job_types);
  } else if (criteria.job_type) {
    conditions.push(`j.job_type = $${paramIndex++}`);
    params.push(criteria.job_type);
  }

  if (criteria.salary_min) {
    conditions.push(`j.salary_max >= $${paramIndex++}`);
    params.push(criteria.salary_min);
  }

  const query = `
    SELECT j.id, j.title, j.slug, j.company_name, j.location, j.job_type, 
           j.salary_min, j.salary_max, j.salary_currency, j.posted_date, j.external_link,
           j.category_id, c.name AS category_name
    FROM jobs j
    LEFT JOIN categories c ON c.id = j.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY j.posted_date DESC
    LIMIT 10
  `;

  const result = await db.query(query, params);
  return result.rows;
}

async function resolveCategoryLabel(criteria) {
  try {
    if (criteria.category) {
      const r = await db.query('SELECT name FROM categories WHERE id = $1', [criteria.category]);
      return r.rows[0]?.name || null;
    }
    if (Array.isArray(criteria.categories) && criteria.categories.length) {
      const r = await db.query(
        'SELECT name FROM categories WHERE id = ANY($1::uuid[]) ORDER BY name',
        [criteria.categories]
      );
      if (!r.rows.length) return null;
      return r.rows.map((row) => row.name).join(', ');
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function deliverAlert(alert, jobs, options = {}) {
  const channels = normalizeChannels(alert.notify_channels, alert);
  const alertName = alert.name || 'Job Alert';
  const categoryLabel = options.categoryLabel || null;
  const results = [];

  for (const channel of channels) {
    try {
      if (channel === 'email') {
        const emailHtml = buildEmailTemplate(alert.user_name || alert.name, jobs, alertName);
        const r = await sendEmail(
          alert.email,
          `${jobs.length} new job${jobs.length > 1 ? 's' : ''} matching your alert`,
          emailHtml
        );
        results.push({ channel, ...r });
      } else if (channel === 'telegram') {
        const text = buildTelegramMessage(alert.user_name, jobs, alertName, categoryLabel);
        const r = await sendTelegramMessage(alert.telegram_chat_id, text);
        results.push({ channel, ...r });
      } else if (channel === 'whatsapp') {
        // Delivery via optional n8n webhook only
        results.push({ channel, sent: false, deferred: true });
      }
    } catch (error) {
      console.error(`❌ ${channel} failed for ${alert.email}:`, error.message);
      results.push({ channel, sent: false, error: error.message });
    }
  }

  await notifyN8n({
    user: {
      id: alert.user_id,
      name: alert.user_name,
      email: alert.email,
      whatsapp_number: alert.whatsapp_number,
      telegram_chat_id: alert.telegram_chat_id,
    },
    alert: {
      id: alert.id,
      name: alertName,
      criteria: alert.search_criteria,
    },
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company_name,
      location: j.location,
      job_type: j.job_type,
      url: jobUrl(j),
    })),
  });

  return results;
}

async function processAlerts(frequency) {
  console.log(`\n🔔 Processing ${frequency} alerts...`);

  try {
    // Ensure Telegram users with profile prefs still get matched via job_alerts
    if (frequency === 'daily') {
      await backfillPreferenceAlertsForTelegramUsers();
    }

    const alertsResult = await db.query(
      `
      SELECT ja.*,
             u.email,
             u.name AS user_name,
             u.telegram_chat_id,
             u.whatsapp_number,
             u.notify_channels
      FROM job_alerts ja
      JOIN users u ON ja.user_id = u.id
      WHERE ja.is_active = true 
        AND ja.frequency = $1
      `,
      [frequency]
    );

    console.log(`Found ${alertsResult.rows.length} active ${frequency} alerts`);

    for (const alert of alertsResult.rows) {
      try {
        const criteria =
          typeof alert.search_criteria === 'string'
            ? JSON.parse(alert.search_criteria)
            : alert.search_criteria || {};

        const jobs = await findMatchingJobs(criteria, alert.last_sent_at);

        if (jobs.length > 0) {
          const categoryLabel = await resolveCategoryLabel(criteria);
          const delivery = await deliverAlert(alert, jobs, { categoryLabel });

          await db.query('UPDATE job_alerts SET last_sent_at = NOW() WHERE id = $1', [
            alert.id,
          ]);

          const summary = delivery
            .map((d) => `${d.channel}:${d.sent ? 'ok' : d.dryRun ? 'dry-run' : 'skip'}`)
            .join(', ');
          console.log(`✅ ${jobs.length} jobs → ${alert.email} (${summary})`);
        } else {
          console.log(`⏭️ No new jobs for ${alert.email}`);
        }
      } catch (error) {
        console.error(`❌ Failed to process alert ${alert.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('❌ Failed to process alerts:', error);
  }
}

/**
 * Process alerts without exiting or closing the pool (for scraper hooks).
 */
async function processAlertsInProcess(frequency = 'daily') {
  await processAlerts(frequency);
}

async function run(options = {}) {
  const cli = { ...parseArgs(), ...options };
  console.log('🚀 Starting job alerts job...');
  console.log(`📅 Current time: ${new Date().toISOString()}`);
  console.log(`⚙️  force=${!!cli.force} frequency=${cli.frequency || 'auto'}`);

  const hour = new Date().getHours();
  const dayOfWeek = new Date().getDay();

  const frequencies = [];

  if (cli.frequency === 'all') {
    frequencies.push('daily', 'weekly');
  } else if (cli.frequency === 'daily' || cli.frequency === 'weekly') {
    frequencies.push(cli.frequency);
  } else if (cli.force) {
    frequencies.push('daily');
  } else {
    // Scheduled mode: daily at 8 AM; weekly on Monday 8 AM
    if (hour === 8) {
      frequencies.push('daily');
      if (dayOfWeek === 1) frequencies.push('weekly');
    } else {
      console.log('⏰ Outside scheduled window (08:00). Use --force to run now.');
    }
  }

  for (const freq of frequencies) {
    await processAlerts(freq);
  }

  console.log('\n✨ Job alerts job completed');
  if (cli.closePool !== false) {
    await db.pool.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  run,
  processAlerts,
  processAlertsInProcess,
  findMatchingJobs,
  sendEmail,
  sendTelegramMessage,
  buildTelegramMessage,
  deliverAlert,
  ensurePreferenceAlert,
  criteriaFromPreferences,
  backfillPreferenceAlertsForTelegramUsers,
};
