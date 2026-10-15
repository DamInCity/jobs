/**
 * Telegram bot long-polling for account linking + preference status + /resume
 * Run: node src/jobs/telegramBot.js
 * Requires TELEGRAM_BOT_TOKEN
 *
 * Job digests are sent by src/jobs/emailAlerts.js (schedule / post-scrape).
 */

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Blob } = require('buffer');
const db = require('../db');
const config = require('../config');
const { ensurePreferenceAlert } = require('./emailAlerts');
const resumeTailor = require('../services/resumeTailor');
const cvInterview = require('../services/cvInterview');

const TOKEN = config.telegram.botToken;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

let offset = 0;
let running = true;

/** chatId → [{ id, title, company_name }] for /resume N */
const resumePickCache = new Map();
/** chatId → expiry ms for interview-helper mode */
const interviewModeUntil = new Map();
const INTERVIEW_TTL_MS = 45 * 60 * 1000;

function interviewOn(chatId) {
  interviewModeUntil.set(String(chatId), Date.now() + INTERVIEW_TTL_MS);
}

function interviewOff(chatId) {
  interviewModeUntil.delete(String(chatId));
}

function isInterviewMode(chatId) {
  const until = interviewModeUntil.get(String(chatId));
  if (!until) return false;
  if (Date.now() > until) {
    interviewModeUntil.delete(String(chatId));
    return false;
  }
  interviewOn(chatId);
  return true;
}

function interviewKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '⏹ Stop interview helper', callback_data: 'r:ask:stop', style: 'danger' }],
    ],
  };
}

const REPLY = {
  INTERVIEW: '🎤 Interview',
  TAILOR: '📋 Tailor CV',
  UPDATE: '📄 Update CV',
};

function mainReplyKeyboard() {
  return {
    keyboard: [
      [{ text: REPLY.INTERVIEW }, { text: REPLY.TAILOR }],
      [{ text: REPLY.UPDATE }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function withReplyKeyboard(extra = {}) {
  return { ...extra, reply_markup: extra.reply_markup || mainReplyKeyboard() };
}

async function apiCall(method, body, signal) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: signal || AbortSignal.timeout(method === 'getUpdates' ? 40000 : 20000),
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 4000) {
    chunks.push(remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }
  chunks.push(remaining);
  let last;
  for (let i = 0; i < chunks.length; i++) {
    const payload = { chat_id: chatId, text: chunks[i] };
    if (i === chunks.length - 1) Object.assign(payload, extra);
    last = await apiCall('sendMessage', payload);
  }
  return last;
}

async function answerCallback(callbackQueryId, text) {
  try {
    await apiCall('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || undefined,
    });
  } catch {
    /* already answered */
  }
}

/**
 * Send a local PDF via Telegram sendDocument (multipart).
 */
async function sendDocument(chatId, filePath, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Document file not found');
  }
  const buffer = fs.readFileSync(filePath);
  const filename = options.filename || path.basename(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);
  if (options.caption) {
    form.append('caption', String(options.caption).slice(0, 1024));
  }

  const response = await fetch(`${API}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Telegram sendDocument failed');
  }
  return data.result;
}

async function findUserByChat(chatId) {
  const result = await db.query(
    `
    SELECT id, email, name, notify_channels,
           preferred_categories, preferred_locations, preferred_job_types,
           telegram_chat_id, cv_path, cv_original_name,
           (cv_path IS NOT NULL) AS has_cv
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
      `Use the buttons below — Interview, Tailor CV, or send a PDF.\n\n` +
      `Manage preferences: ${config.app.url}/alerts`,
    { reply_markup: mainReplyKeyboard() }
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

/**
 * /resume — show tap-to-tailor buttons; optional job id still works.
 */
function resumeKeyboard(candidates) {
  const rows = candidates.slice(0, 8).map((c, i) => {
    const label = `${i + 1}. ${(c.title || 'Role').slice(0, 28)} @ ${(c.company_name || 'Company').slice(0, 18)}`;
    return [{ text: label.slice(0, 64), callback_data: `r:j:${c.id}` }];
  });
  rows.push([
    { text: '🎤 Interview helper', callback_data: 'r:ask', style: 'primary' },
    { text: '📄 Update my CV', callback_data: 'r:cv', style: 'success' },
  ]);
  rows.push([{ text: '🔄 Refresh jobs', callback_data: 'r:more' }]);
  return { inline_keyboard: rows };
}

async function promptCvUpload(chatId) {
  await sendMessage(
    chatId,
    'Send your CV in this chat as a PDF or Word file (.pdf / .docx).\n\nI’ll save it and use it the next time you tailor a resume.'
  );
}

async function showResumeJobs(chatId, user) {
  const candidates = await resumeTailor.getResumeCandidates(user.id, 8);
  if (!candidates.length) {
    await sendMessage(
      chatId,
      `I don’t have jobs to tailor for yet.\nBrowse and save a few roles, then tap Refresh:\n${config.app.url}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 Update my CV', callback_data: 'r:cv', style: 'success' }],
            [{ text: '🔄 Refresh jobs', callback_data: 'r:more' }],
          ],
        },
      }
    );
    return;
  }
  resumePickCache.set(
    String(chatId),
    candidates.map((c) => ({ id: c.id, title: c.title, company_name: c.company_name }))
  );
  await sendMessage(
    chatId,
    'Tap a job to tailor your CV.\nI’ll send back a PDF when it’s ready.',
    { reply_markup: resumeKeyboard(candidates) }
  );
}

async function handleResume(chatId, arg) {
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      `Not linked yet.\nOpen ${config.app.url}/alerts and tap “Link Telegram”.`
    );
    return;
  }

  if (!user.has_cv && !user.cv_path) {
    await sendMessage(chatId, 'I don’t have your CV yet.');
    await promptCvUpload(chatId);
    return;
  }

  if (!resumeTailor.isLlmConfigured()) {
    await sendMessage(
      chatId,
      'Resume AI is not configured on the server. Ask the admin to set OPENROUTER_API_KEY in .env.'
    );
    return;
  }

  const token = (arg || '').trim();
  if (!token) {
    await showResumeJobs(chatId, user);
    return;
  }

  let jobId = null;
  if (/^\d{1,2}$/.test(token)) {
    const list = resumePickCache.get(String(chatId)) || [];
    const idx = parseInt(token, 10) - 1;
    if (idx < 0 || idx >= list.length) {
      await sendMessage(chatId, 'That number isn’t on the list. Tap a job below.');
      await showResumeJobs(chatId, user);
      return;
    }
    jobId = list[idx].id;
  } else if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)
  ) {
    jobId = token;
  }

  if (!jobId) {
    await sendMessage(chatId, 'Tap a job button to tailor your CV.');
    await showResumeJobs(chatId, user);
    return;
  }

  const jobMeta = await db.query(
    `SELECT id, title, company_name FROM jobs WHERE id = $1`,
    [jobId]
  );
  if (!jobMeta.rows[0]) {
    await sendMessage(chatId, 'That job is no longer available. Pick another.');
    await showResumeJobs(chatId, user);
    return;
  }

  const job = jobMeta.rows[0];
  await sendMessage(
    chatId,
    `Working on your CV for:\n${job.title} @ ${job.company_name || 'Company'}\n\n` +
      `Resume AI can take up to ~35 seconds. If it’s slow I’ll still send a focused PDF from your real CV.`
  );

  try {
    const row = await resumeTailor.tailorAndSave(user.id, jobId);
    const caption =
      `Ready — tailored CV\n${row.job_title} @ ${row.company_name || ''}\n\n` +
      `${(row.changes_summary || '').slice(0, 700)}`;

    await sendDocument(chatId, row.file_path, {
      filename: row.original_name || 'tailored-cv.pdf',
      caption,
    });
    await sendMessage(chatId, 'Want another role?', {
      reply_markup: {
        inline_keyboard: [[{ text: '📋 Show jobs again', callback_data: 'r:more' }]],
      },
    });
  } catch (error) {
    console.error('Telegram /resume failed:', error.message);
    await sendMessage(
      chatId,
      `Couldn’t generate that CV: ${error.message}\n\nYou can send a new PDF here, or update it on ${config.app.url}/profile`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📄 Update my CV', callback_data: 'r:cv' }],
            [{ text: '📋 Show jobs', callback_data: 'r:more' }],
          ],
        },
      }
    );
  }
}

async function downloadTelegramFile(fileId, destPath) {
  const info = await apiCall('getFile', { file_id: fileId });
  const filePath = info.file_path;
  if (!filePath) throw new Error('Telegram did not return a file path');
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

function cvExtension(document) {
  const name = String(document.file_name || '').toLowerCase();
  if (name.endsWith('.pdf')) return '.pdf';
  if (name.endsWith('.docx')) return '.docx';
  const mime = String(document.mime_type || '').toLowerCase();
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('wordprocessingml') || mime.includes('officedocument')) return '.docx';
  return '';
}

async function handleCvDocument(chatId, document) {
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      `Link your JobsHub account first:\n${config.app.url}/alerts`
    );
    return;
  }

  const ext = cvExtension(document);
  if (!ext) {
    await sendMessage(chatId, 'Please send a PDF or Word (.docx) file.');
    return;
  }
  const maxBytes = config.uploads?.maxCvBytes || 5 * 1024 * 1024;
  if (document.file_size && document.file_size > maxBytes) {
    await sendMessage(chatId, 'That file is too large. Please send a CV under 5 MB.');
    return;
  }

  await sendMessage(chatId, 'Got it — saving your CV…');
  const dest = path.join(config.uploads.cvDir, `${user.id}-${Date.now()}${ext}`);
  try {
    await downloadTelegramFile(document.file_id, dest);
    const prev = await db.query('SELECT cv_path FROM users WHERE id = $1', [user.id]);
    const oldPath = prev.rows[0]?.cv_path;
    await db.query(
      `
      UPDATE users
      SET cv_path = $1, cv_original_name = $2, cv_uploaded_at = NOW(),
          master_resume_json = NULL, master_resume_parsed_at = NULL
      WHERE id = $3
      `,
      [dest, document.file_name || `cv${ext}`, user.id]
    );
    if (oldPath && oldPath !== dest && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
    }

    await sendMessage(chatId, 'Got it. Reading your CV and parsing it for Resume AI — this can take up to a minute.');
    const parsed = await resumeTailor.ensureMasterResume(user.id, { force: true });
    const bits = [];
    if (parsed.resume?.basics?.name) bits.push(parsed.resume.basics.name);
    if (parsed.resume?.work?.length) bits.push(`${parsed.resume.work.length} roles`);
    if (parsed.resume?.skills?.length) bits.push(`${parsed.resume.skills.length} skills`);
    await sendMessage(
      chatId,
      `CV updated${bits.length ? ` — ${bits.join(' · ')}` : ''}.\nTap a job to tailor it.`
    );
    const fresh = await findUserByChat(chatId);
    await showResumeJobs(chatId, fresh || user);
  } catch (error) {
    console.error('Telegram CV upload failed:', error.message);
    await sendMessage(
      chatId,
      `Couldn’t update your CV: ${error.message}\nTry another PDF, or upload on ${config.app.url}/profile`
    );
  }
}

async function startInterviewMode(chatId) {
  const user = await findUserByChat(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      `Not linked yet.\nOpen ${config.app.url}/alerts and tap “Link Telegram”.`
    );
    return;
  }
  if (!user.has_cv && !user.cv_path) {
    await sendMessage(chatId, 'I don’t have your CV yet. Send a PDF first.');
    await promptCvUpload(chatId);
    return;
  }
  if (!resumeTailor.isLlmConfigured()) {
    await sendMessage(
      chatId,
      'Interview helper is not configured on the server (OPENROUTER_API_KEY).'
    );
    return;
  }
  interviewOn(chatId);
  await sendMessage(
    chatId,
    'Interview helper is on for 45 minutes.\n\nPaste the question here (or forward it). I’ll draft a first-person answer using only your CV — no invented jobs or numbers.\n\nTap Stop when the interview is over.',
    { reply_markup: interviewKeyboard() }
  );
}

async function handleInterviewQuestion(chatId, question) {
  const user = await findUserByChat(chatId);
  if (!user) {
    interviewOff(chatId);
    await sendMessage(chatId, `Link your account first: ${config.app.url}/alerts`);
    return;
  }
  await sendMessage(chatId, 'Drafting from your CV…');
  try {
    const { text } = await cvInterview.answerInterviewQuestion(user.id, question);
    await sendMessage(chatId, text, { reply_markup: interviewKeyboard() });
  } catch (error) {
    console.error('Interview helper failed:', error.message);
    await sendMessage(
      chatId,
      `Couldn’t draft that: ${error.message}`,
      { reply_markup: interviewKeyboard() }
    );
  }
}

async function handleCallbackQuery(cq) {
  const chatId = cq.message?.chat?.id;
  const data = String(cq.data || '');
  if (!chatId) {
    await answerCallback(cq.id);
    return;
  }

  if (data === 'r:more') {
    await answerCallback(cq.id, 'Refreshing…');
    await handleResume(chatId, '');
    return;
  }
  if (data === 'r:cv') {
    await answerCallback(cq.id);
    await promptCvUpload(chatId);
    return;
  }
  if (data === 'r:ask') {
    await answerCallback(cq.id);
    await startInterviewMode(chatId);
    return;
  }
  if (data === 'r:ask:stop') {
    interviewOff(chatId);
    await answerCallback(cq.id, 'Stopped');
    await sendMessage(chatId, 'Interview helper is off. Tap it again anytime you need it.');
    return;
  }
  if (data.startsWith('r:j:')) {
    const jobId = data.slice(4);
    await answerCallback(cq.id, 'Tailoring…');
    await handleResume(chatId, jobId);
    return;
  }
  await answerCallback(cq.id);
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message || update.edited_message;
  if (!message) return;
  const chatId = message.chat.id;

  if (message.document) {
    await handleCvDocument(chatId, message.document);
    return;
  }

  if (!message.text) return;

  const text = message.text.trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const arg = text.split(/\s+/).slice(1).join(' ').trim();

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
        'Tap the colored buttons below, or the ones on messages.\n\n' +
        '🎤 Interview — answers from your CV\n' +
        '📋 Tailor CV — pick a job, get a PDF\n' +
        '📄 Update CV — send a PDF here\n\n' +
        `Website: ${config.app.url}/profile`,
      { reply_markup: mainReplyKeyboard() }
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

  if (command === '/resume' || command === '/cv') {
    await handleResume(chatId, arg);
    return;
  }

  if (text === REPLY.INTERVIEW) {
    await startInterviewMode(chatId);
    return;
  }
  if (text === REPLY.TAILOR) {
    await handleResume(chatId, '');
    return;
  }
  if (text === REPLY.UPDATE) {
    await promptCvUpload(chatId);
    return;
  }

  if (command === '/ask' || command === '/interview') {
    if (arg) {
      interviewOn(chatId);
      await handleInterviewQuestion(chatId, arg);
    } else {
      await startInterviewMode(chatId);
    }
    return;
  }

  if (command === '/askstop' || command === '/stopask') {
    interviewOff(chatId);
    await sendMessage(chatId, 'Interview helper is off.');
    return;
  }

  if (isInterviewMode(chatId) && !text.startsWith('/')) {
    await handleInterviewQuestion(chatId, text);
    return;
  }

  await sendMessage(
    chatId,
    'Try /resume to tailor your CV, /ask for interview help, or send a PDF to update it.',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Tailor my CV', callback_data: 'r:more', style: 'success' }],
          [{ text: '🎤 Interview helper', callback_data: 'r:ask', style: 'primary' }],
          [{ text: '📄 Update my CV', callback_data: 'r:cv' }],
        ],
      },
    }
  );
}

async function poll() {
  let abort = null;
  while (running) {
    abort = new AbortController();
    try {
      const updates = await apiCall(
        'getUpdates',
        {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        },
        abort.signal
      );

      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (error) {
          console.error('Failed to handle update:', error.message);
        }
      }
    } catch (error) {
      if (!running) break;
      console.error('Poll error:', error.message);
      const wait = /Conflict/i.test(error.message) ? 15000 : 3000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function webhookSecret() {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) return process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!TOKEN) return '';
  return crypto.createHash('sha256').update(`jobshub-tg:${TOKEN}`).digest('hex').slice(0, 32);
}

function webhookUrl() {
  const base = String(config.app.url || 'https://jobshub.co.ke').replace(/\/$/, '');
  return `${base}/api/telegram/webhook`;
}

function verifyWebhookRequest(req) {
  const expected = webhookSecret();
  if (!expected) return false;
  return req.get('X-Telegram-Bot-Api-Secret-Token') === expected;
}

async function registerWebhook() {
  if (!TOKEN || !API) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const url = webhookUrl();
  await apiCall('setWebhook', {
    url,
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  console.log(`🤖 Telegram webhook set → ${url}`);
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
  try {
    await registerWebhook();
    console.log(`🤖 Telegram bot @${me.username} in webhook mode (no long-poll).`);
    await new Promise(() => {
      setInterval(() => {}, 60 * 60 * 1000);
    });
    return;
  } catch (err) {
    console.warn('webhook unavailable, falling back to long-poll:', err.message);
    try {
      await apiCall('deleteWebhook', { drop_pending_updates: false });
    } catch (e) {
      console.warn('deleteWebhook:', e.message);
    }
  }
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

module.exports = {
  linkUser,
  handleUpdate,
  findUserByChat,
  verifyWebhookRequest,
  registerWebhook,
};
