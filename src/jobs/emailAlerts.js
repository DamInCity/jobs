/**
 * Multi-channel job alerts (email + Telegram)
 * Run via PM2 or cron: node src/jobs/emailAlerts.js
 *
 * Flags:
 *   --force              Ignore hour/day schedule gates
 *   --frequency=daily    Process only this frequency (daily|weekly)
 *   --frequency=all      Process both (with --force)
 *   --test-loop          Env-gated diagnostic: send 1 matched job to each
 *                        Telegram-linked user every ALERT_TEST_INTERVAL_MINUTES
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
  const args = { force: false, frequency: null, closePool: true, testLoop: false };
  for (const arg of argv) {
    if (arg === '--force') args.force = true;
    else if (arg === '--no-close-pool') args.closePool = false;
    else if (arg === '--test-loop') args.testLoop = true;
    else if (arg.startsWith('--frequency=')) {
      args.frequency = arg.split('=')[1];
    }
  }
  return args;
}

function getLookbackDays() {
  return config.alerts?.lookbackDays || 30;
}

function getTestIntervalMinutes() {
  return config.alerts?.testIntervalMinutes || 0;
}

/**
 * Build job_alerts search_criteria from user preferred_* / profile fields.
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

  // Skills only when no category is set — otherwise AND would over-filter digests
  if (!criteria.category && !criteria.categories) {
    const skills = normalizeTextArray(user.skills);
    const keywords = normalizeTextArray(user.profile_keywords);
    const skillTerms = [...new Set([...skills, ...keywords])].slice(0, 12);
    if (skillTerms.length > 0) {
      criteria.skills = skillTerms;
    }
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
async function ensurePreferenceAlert(userId, userRow = null, options = {}) {
  const alertName = options.name || 'My profile';
  let user = userRow;
  if (!user) {
    const res = await db.query(
      `
      SELECT preferred_categories, preferred_locations, preferred_job_types,
             skills, profile_keywords
      FROM users WHERE id = $1
      `,
      [userId]
    );
    user = res.rows[0];
  }
  if (!user) return null;

  const criteria = criteriaFromPreferences(user);
  if (Object.keys(criteria).length === 0) return null;

  // Refresh managed profile/preference alerts when re-profiling
  const managed = await db.query(
    `
    SELECT id FROM job_alerts
    WHERE user_id = $1
      AND is_active = true
      AND name = ANY($2::text[])
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [userId, ['My profile', 'My preferences']]
  );

  if (managed.rows.length > 0) {
    const result = await db.query(
      `
      UPDATE job_alerts
      SET name = $1, search_criteria = $2, frequency = 'daily', is_active = true
      WHERE id = $3
      RETURNING *
      `,
      [alertName, JSON.stringify(criteria), managed.rows[0].id]
    );
    console.log(`📌 Updated preference alert for user ${userId}`);
    return result.rows[0];
  }

  if (!options.forceCreate) {
    const existing = await db.query(
      `SELECT id FROM job_alerts WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );
    if (existing.rows.length > 0) return null;
  }

  const result = await db.query(
    `
    INSERT INTO job_alerts (user_id, name, search_criteria, frequency, is_active)
    VALUES ($1, $2, $3, 'daily', true)
    RETURNING *
    `,
    [userId, alertName, JSON.stringify(criteria)]
  );
  console.log(`📌 Created preference alert for user ${userId}`);
  return result.rows[0];
}

/**
 * For Telegram-linked users with prefs but no alerts, backfill alert rows.
 */
async function backfillPreferenceAlertsForTelegramUsers() {
  const result = await db.query(`
    SELECT u.id, u.preferred_categories, u.preferred_locations, u.preferred_job_types,
           u.skills, u.profile_keywords
    FROM users u
    WHERE u.telegram_chat_id IS NOT NULL
      AND (
        u.preferred_categories IS NOT NULL
        OR u.preferred_locations IS NOT NULL
        OR u.preferred_job_types IS NOT NULL
        OR u.skills IS NOT NULL
        OR u.profile_keywords IS NOT NULL
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

function buildTelegramMessage(userName, jobs, alertName, categoryLabel, options = {}) {
  const categoryBit = categoryLabel ? ` in ${categoryLabel}` : '';
  const prefix = options.testMode ? '🧪 Test digest\n\n' : '';
  const lines = [
    `${prefix}Hi ${userName || 'there'} — ${jobs.length} new job${jobs.length > 1 ? 's' : ''}${categoryBit} matching “${alertName || 'Job Alert'}”:`,
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

/**
 * Job IDs already delivered to this user (never re-notify the same listing).
 * @param {string} userId
 * @returns {Promise<Set<string>>}
 */
async function getDeliveredJobIds(userId) {
  if (!userId) return new Set();
  const r = await db.query(
    `SELECT job_id::text AS job_id FROM job_alert_deliveries WHERE user_id = $1`,
    [userId]
  );
  return new Set(r.rows.map((row) => row.job_id));
}

/**
 * Record successful deliveries so the same job is never re-sent to this user.
 * @param {string} userId
 * @param {string|null} alertId
 * @param {Array<{id: string}>} jobs
 * @param {{ channel?: string, isTest?: boolean }} [meta]
 */
async function recordJobDeliveries(userId, alertId, jobs, meta = {}) {
  if (!userId || !jobs?.length) return;
  const channel = meta.channel || null;
  const isTest = !!meta.isTest;
  for (const job of jobs) {
    if (!job?.id) continue;
    try {
      await db.query(
        `
        INSERT INTO job_alert_deliveries (user_id, job_id, alert_id, channel, is_test)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, job_id) DO NOTHING
        `,
        [userId, job.id, alertId || null, channel, isTest]
      );
    } catch (error) {
      // Table missing mid-deploy: don't fail the whole digest
      if (error.code === '42P01') {
        console.warn('job_alert_deliveries missing — run migrations');
        return;
      }
      console.warn(`recordJobDeliveries: ${error.message}`);
    }
  }
}

/**
 * Drop jobs already sent to this user (or already chosen earlier in this run).
 * @param {object[]} jobs
 * @param {Set<string>} deliveredIds
 * @param {Set<string>} [sessionSentIds] - jobs sent earlier in this processAlerts pass
 */
function filterNewJobsForUser(jobs, deliveredIds, sessionSentIds = null) {
  if (!jobs?.length) return [];
  return jobs.filter((j) => {
    const id = String(j.id);
    if (deliveredIds?.has(id)) return false;
    if (sessionSentIds?.has(id)) return false;
    return true;
  });
}

/**
 * Find jobs matching alert criteria.
 *
 * @param {object} criteria
 * @param {Date|string|null} lastSentAt
 * @param {object} [options]
 * @param {number} [options.lookbackDays] - window when no lastSentAt / ignoreLastSent
 * @param {boolean} [options.ignoreLastSent] - ignore last_sent_at, use lookback only
 * @param {number} [options.limit]
 * @param {boolean} [options.skipLocation]
 * @param {boolean} [options.skipJobType]
 * @param {boolean} [options.skipSkills]
 * @param {boolean} [options.categoryOnly] - only category filters (+ keywords if any)
 * @param {string[]} [options.excludeJobIds] - skip these job UUIDs (already delivered)
 */
async function findMatchingJobs(criteria = {}, lastSentAt = null, options = {}) {
  const lookbackDays = options.lookbackDays ?? getLookbackDays();
  const limit = Math.min(Math.max(options.limit || 10, 1), 50);
  const conditions = ["j.status = 'active'"];
  const params = [];
  let paramIndex = 1;

  if (options.ignoreLastSent || !lastSentAt) {
    conditions.push(`j.posted_date > NOW() - ($${paramIndex++}::int * INTERVAL '1 day')`);
    params.push(lookbackDays);
  } else {
    conditions.push(`j.posted_date > $${paramIndex++}`);
    params.push(lastSentAt);
  }

  const excludeIds = Array.isArray(options.excludeJobIds)
    ? options.excludeJobIds.filter(Boolean).map(String)
    : [];
  if (excludeIds.length > 0) {
    conditions.push(`NOT (j.id = ANY($${paramIndex++}::uuid[]))`);
    params.push(excludeIds);
  }

  const categoryOnly = !!options.categoryOnly;
  const skipLocation = categoryOnly || !!options.skipLocation;
  const skipJobType = categoryOnly || !!options.skipJobType;
  const skipSkills = categoryOnly || !!options.skipSkills;

  if (criteria.keywords && !categoryOnly) {
    conditions.push(`(j.title ILIKE $${paramIndex} OR j.description ILIKE $${paramIndex})`);
    params.push(`%${criteria.keywords}%`);
    paramIndex++;
  }

  // Skills: match if ANY skill appears in title or description (soft filter)
  if (!skipSkills && Array.isArray(criteria.skills) && criteria.skills.length > 0) {
    const skillOrs = criteria.skills.slice(0, 12).map((skill) => {
      const clause = `(j.title ILIKE $${paramIndex} OR j.description ILIKE $${paramIndex})`;
      params.push(`%${skill}%`);
      paramIndex++;
      return clause;
    });
    conditions.push(`(${skillOrs.join(' OR ')})`);
  }

  // Single category or multi-category (ANY)
  if (Array.isArray(criteria.categories) && criteria.categories.length > 0) {
    conditions.push(`j.category_id = ANY($${paramIndex++}::uuid[])`);
    params.push(criteria.categories);
  } else if (criteria.category) {
    conditions.push(`j.category_id = $${paramIndex++}`);
    params.push(criteria.category);
  }

  if (!skipLocation) {
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
  }

  if (!skipJobType) {
    if (Array.isArray(criteria.job_types) && criteria.job_types.length > 0) {
      conditions.push(`j.job_type = ANY($${paramIndex++}::job_type[])`);
      params.push(criteria.job_types);
    } else if (criteria.job_type) {
      conditions.push(`j.job_type = $${paramIndex++}`);
      params.push(criteria.job_type);
    }
  }

  if (!categoryOnly && criteria.salary_min) {
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
    LIMIT $${paramIndex}
  `;
  params.push(limit);

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Progressive relaxation when strict criteria return zero matches.
 * Order: full → drop location/type → category (or skills) only → optional backfill lookback.
 */
async function findMatchingJobsWithFallback(criteria, lastSentAt, options = {}) {
  const base = {
    lookbackDays: options.lookbackDays ?? getLookbackDays(),
    ignoreLastSent: !!options.ignoreLastSent,
    limit: options.limit || 10,
    excludeJobIds: options.excludeJobIds || [],
  };

  const hasCategory =
    !!criteria.category ||
    (Array.isArray(criteria.categories) && criteria.categories.length > 0);
  const hasSkills = Array.isArray(criteria.skills) && criteria.skills.length > 0;
  const hasLocation =
    !!criteria.location ||
    (Array.isArray(criteria.locations) && criteria.locations.length > 0);
  const hasJobType =
    !!criteria.job_type ||
    (Array.isArray(criteria.job_types) && criteria.job_types.length > 0);

  // 1) Strict (respect lastSentAt unless ignoreLastSent)
  let jobs = await findMatchingJobs(criteria, lastSentAt, base);
  if (jobs.length > 0) {
    return { jobs, stage: 'strict' };
  }

  // 2) Same criteria but ignore last_sent / use full lookback (backfill older active jobs)
  if (lastSentAt && !base.ignoreLastSent) {
    jobs = await findMatchingJobs(criteria, null, { ...base, ignoreLastSent: true });
    if (jobs.length > 0) {
      return { jobs, stage: 'lookback' };
    }
  }

  // 3) Drop location + job_type (keep category/skills/keywords)
  if (hasLocation || hasJobType) {
    jobs = await findMatchingJobs(criteria, null, {
      ...base,
      ignoreLastSent: true,
      skipLocation: true,
      skipJobType: true,
    });
    if (jobs.length > 0) {
      return { jobs, stage: 'no-location-type' };
    }
  }

  // 4) Category-only (or skills-only if no category)
  if (hasCategory) {
    jobs = await findMatchingJobs(criteria, null, {
      ...base,
      ignoreLastSent: true,
      categoryOnly: true,
    });
    if (jobs.length > 0) {
      return { jobs, stage: 'category-only' };
    }
  } else if (hasSkills) {
    jobs = await findMatchingJobs(
      { skills: criteria.skills },
      null,
      { ...base, ignoreLastSent: true }
    );
    if (jobs.length > 0) {
      return { jobs, stage: 'skills-only' };
    }
  }

  return { jobs: [], stage: 'none' };
}

function criteriaSummary(criteria) {
  if (!criteria || typeof criteria !== 'object') return '{}';
  const keys = Object.keys(criteria).filter((k) => {
    const v = criteria[k];
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  return keys.join(',') || '(empty)';
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
  let channels = normalizeChannels(alert.notify_channels, alert);
  // Test loop: Telegram only (avoid spamming SMTP every few minutes)
  if (options.telegramOnly) {
    channels = channels.filter((c) => c === 'telegram');
    if (channels.length === 0 && alert.telegram_chat_id) {
      channels = ['telegram'];
    }
  }
  const alertName = alert.name || 'Job Alert';
  const categoryLabel = options.categoryLabel || null;
  const results = [];

  console.log(
    `📬 Delivering ${jobs.length} job(s) → ${alert.email}` +
      ` channels=[${channels.join(',')}]` +
      ` tg=${alert.telegram_chat_id ? 'yes' : 'no'}` +
      (options.testMode ? ' [test]' : '')
  );

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
        const text = buildTelegramMessage(alert.user_name, jobs, alertName, categoryLabel, {
          testMode: !!options.testMode,
        });
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

  if (!options.skipN8n) {
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
  }

  return results;
}

async function processAlerts(frequency) {
  console.log(`\n🔔 Processing ${frequency} alerts...`);
  console.log(`   lookbackDays=${getLookbackDays()} telegramToken=${config.telegram.botToken ? 'set' : 'MISSING'}`);

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

    // Per-user: already-notified jobs (DB) + jobs sent earlier in this pass (multi-alert overlap)
    const deliveredCache = new Map(); // userId → Set of job ids
    const sessionSent = new Map(); // userId → Set of job ids sent this run

    for (const alert of alertsResult.rows) {
      try {
        const criteria =
          typeof alert.search_criteria === 'string'
            ? JSON.parse(alert.search_criteria)
            : alert.search_criteria || {};

        const channels = normalizeChannels(alert.notify_channels, alert);
        console.log(
          `🔎 ${alert.email} alert="${alert.name || alert.id}" criteria=[${criteriaSummary(criteria)}]` +
            ` last_sent=${alert.last_sent_at || 'never'}` +
            ` channels=[${channels.join(',')}] tg=${alert.telegram_chat_id ? 'yes' : 'no'}`
        );

        const userId = alert.user_id;
        if (!deliveredCache.has(userId)) {
          deliveredCache.set(userId, await getDeliveredJobIds(userId));
        }
        const deliveredIds = deliveredCache.get(userId);
        const alreadyThisRun = sessionSent.get(userId) || new Set();
        const excludeJobIds = [...new Set([...deliveredIds, ...alreadyThisRun])];

        const { jobs: matched, stage } = await findMatchingJobsWithFallback(
          criteria,
          alert.last_sent_at,
          { excludeJobIds }
        );

        // Defense in depth (in case exclude list was truncated / race)
        const jobs = filterNewJobsForUser(matched, deliveredIds, alreadyThisRun);

        if (jobs.length > 0) {
          const categoryLabel = await resolveCategoryLabel(criteria);
          const delivery = await deliverAlert(alert, jobs, { categoryLabel });

          const anySent = delivery.some((d) => d.sent);
          const anyAttempt = delivery.some((d) => d.sent || d.dryRun);
          if (anySent) {
            await db.query('UPDATE job_alerts SET last_sent_at = NOW() WHERE id = $1', [
              alert.id,
            ]);
            // Only mark delivered after a real send (not dry-run), so retries still work offline
            await recordJobDeliveries(userId, alert.id, jobs, { isTest: false });
            for (const j of jobs) {
              const id = String(j.id);
              deliveredIds.add(id);
              alreadyThisRun.add(id);
            }
            sessionSent.set(userId, alreadyThisRun);
          } else if (anyAttempt) {
            // Dry-run: still avoid re-queuing the same jobs in this process pass
            for (const j of jobs) alreadyThisRun.add(String(j.id));
            sessionSent.set(userId, alreadyThisRun);
          }

          const summary = delivery
            .map((d) => `${d.channel}:${d.sent ? 'ok' : d.dryRun ? 'dry-run' : d.error ? 'err' : 'skip'}`)
            .join(', ');
          console.log(
            `✅ ${jobs.length} jobs → ${alert.email} stage=${stage} (${summary})`
          );
        } else {
          console.log(
            `⏭️ No matching jobs for ${alert.email} (stage=${stage}, criteria=[${criteriaSummary(criteria)}]` +
              (matched.length ? `, ${matched.length} already delivered` : '') +
              `)`
          );
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

/**
 * One pass of the diagnostic test loop: every Telegram-linked user gets
 * at most 1 *new* matched job (skips jobs already delivered to that user).
 * Does not update last_sent_at, but does record job_alert_deliveries so
 * the same listing is never spammed every interval.
 */
async function runTestDigestPass() {
  console.log(`\n🧪 Test digest pass @ ${new Date().toISOString()}`);
  console.log(
    `   lookbackDays=${getLookbackDays()} telegramToken=${config.telegram.botToken ? 'set' : 'MISSING'}`
  );

  await backfillPreferenceAlertsForTelegramUsers();

  const usersResult = await db.query(`
    SELECT u.id, u.email, u.name AS user_name, u.telegram_chat_id,
           u.whatsapp_number, u.notify_channels,
           u.preferred_categories, u.preferred_locations, u.preferred_job_types,
           u.skills, u.profile_keywords
    FROM users u
    WHERE u.telegram_chat_id IS NOT NULL
  `);

  console.log(`Found ${usersResult.rows.length} Telegram-linked user(s)`);

  let sent = 0;
  let noMatch = 0;
  let failed = 0;
  let skippedDup = 0;

  for (const user of usersResult.rows) {
    try {
      // Prefer managed profile alert, else any active alert
      let alertRow = null;
      const managed = await db.query(
        `
        SELECT * FROM job_alerts
        WHERE user_id = $1 AND is_active = true
          AND name = ANY($2::text[])
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [user.id, ['My profile', 'My preferences']]
      );
      if (managed.rows[0]) {
        alertRow = managed.rows[0];
      } else {
        const any = await db.query(
          `
          SELECT * FROM job_alerts
          WHERE user_id = $1 AND is_active = true
          ORDER BY updated_at DESC
          LIMIT 1
          `,
          [user.id]
        );
        alertRow = any.rows[0] || null;
      }

      if (!alertRow) {
        const created = await ensurePreferenceAlert(user.id, user, {
          name: 'My profile',
          forceCreate: true,
        });
        alertRow = created;
      }

      if (!alertRow) {
        console.log(`TEST: NO ALERT for ${user.email} (no prefs/criteria)`);
        noMatch++;
        continue;
      }

      const criteria =
        typeof alertRow.search_criteria === 'string'
          ? JSON.parse(alertRow.search_criteria)
          : alertRow.search_criteria || {};

      const deliveredIds = await getDeliveredJobIds(user.id);
      const excludeJobIds = [...deliveredIds];

      // Fetch a few matches so we can skip already-delivered ones
      const { jobs: matched, stage } = await findMatchingJobsWithFallback(criteria, null, {
        ignoreLastSent: true,
        limit: 10,
        excludeJobIds,
      });

      const jobs = filterNewJobsForUser(matched, deliveredIds).slice(0, 1);

      if (jobs.length === 0) {
        if (matched.length === 0 && excludeJobIds.length > 0) {
          skippedDup++;
          console.log(
            `TEST: ALL MATCHES ALREADY SENT for ${user.email} (delivered=${excludeJobIds.length}) stage=${stage}`
          );
        } else {
          console.log(
            `TEST: NO MATCH for ${user.email} stage=${stage} criteria=[${criteriaSummary(criteria)}]`
          );
        }
        noMatch++;
        continue;
      }

      const alert = {
        ...alertRow,
        email: user.email,
        user_name: user.user_name,
        telegram_chat_id: user.telegram_chat_id,
        whatsapp_number: user.whatsapp_number,
        notify_channels: user.notify_channels,
        user_id: user.id,
      };

      const categoryLabel = await resolveCategoryLabel(criteria);
      const delivery = await deliverAlert(alert, jobs, {
        categoryLabel,
        testMode: true,
        telegramOnly: true,
        skipN8n: true,
      });

      const summary = delivery
        .map((d) => `${d.channel}:${d.sent ? 'ok' : d.dryRun ? 'dry-run' : d.error ? 'err' : 'skip'}`)
        .join(', ');
      const reallySent = delivery.some((d) => d.sent);
      const dryOnly = !reallySent && delivery.some((d) => d.dryRun);
      if (reallySent) {
        await recordJobDeliveries(user.id, alertRow.id, jobs, {
          channel: 'telegram',
          isTest: true,
        });
        sent++;
        console.log(
          `TEST: sent 1 job → ${user.email} chat=${user.telegram_chat_id} stage=${stage} (${summary}) · ${jobs[0].title}`
        );
      } else if (dryOnly) {
        // Count as sent for diagnostics but do not poison the delivery log
        sent++;
        console.log(
          `TEST: dry-run 1 job → ${user.email} (${summary}) · ${jobs[0].title}`
        );
      } else {
        failed++;
        console.log(`TEST: DELIVERY FAILED for ${user.email} (${summary})`);
      }
    } catch (error) {
      failed++;
      console.error(`TEST: error for ${user.email}:`, error.message);
    }
  }

  console.log(
    `🧪 Pass done: sent=${sent} no_match=${noMatch} already_sent_only=${skippedDup} failed=${failed}`
  );
  return { sent, noMatch, failed, skippedDup };
}

async function runTestLoop(options = {}) {
  const intervalMin =
    options.intervalMinutes ?? (getTestIntervalMinutes() || 5);
  if (intervalMin <= 0) {
    console.error(
      '❌ ALERT_TEST_INTERVAL_MINUTES must be > 0 (or pass interval). Example: ALERT_TEST_INTERVAL_MINUTES=5 npm run alerts:test'
    );
    return;
  }

  console.log('🚀 Starting Telegram alert TEST LOOP');
  console.log(`   interval=${intervalMin} minute(s)`);
  console.log(`   lookbackDays=${getLookbackDays()}`);
  console.log(`   telegramToken=${config.telegram.botToken ? 'set' : 'MISSING (dry-run)'}`);
  console.log('   Ctrl+C to stop. last_sent_at is NOT updated; each job_id is only sent once per user.');

  let running = true;
  const shutdown = () => {
    running = false;
    console.log('\nStopping test loop...');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      await runTestDigestPass();
    } catch (error) {
      console.error('TEST pass failed:', error.message);
    }
    if (!running) break;
    const ms = intervalMin * 60 * 1000;
    console.log(`⏳ Next test pass in ${intervalMin} minute(s)...`);
    const started = Date.now();
    while (running && Date.now() - started < ms) {
      await new Promise((r) => setTimeout(r, Math.min(1000, ms - (Date.now() - started))));
    }
  }

  if (options.closePool !== false) {
    await db.pool.end();
  }
}

async function run(options = {}) {
  const cli = { ...parseArgs(), ...options };
  console.log('🚀 Starting job alerts job...');
  console.log(`📅 Current time: ${new Date().toISOString()}`);
  console.log(
    `⚙️  force=${!!cli.force} frequency=${cli.frequency || 'auto'} testLoop=${!!cli.testLoop}`
  );

  if (cli.testLoop) {
    await runTestLoop({ closePool: cli.closePool !== false });
    return;
  }

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
  findMatchingJobsWithFallback,
  sendEmail,
  sendTelegramMessage,
  buildTelegramMessage,
  deliverAlert,
  ensurePreferenceAlert,
  criteriaFromPreferences,
  backfillPreferenceAlertsForTelegramUsers,
  runTestDigestPass,
  runTestLoop,
  getDeliveredJobIds,
  recordJobDeliveries,
  filterNewJobsForUser,
};
