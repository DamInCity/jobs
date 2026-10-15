#!/usr/bin/env node
/**
 * Daily OpenRouter free-model watchdog for JobsHub Resume AI.
 *
 * - Lists current $0 / :free chat models
 * - Probes the configured primary (+ a few candidates)
 * - If the current slug is gone or dead, writes a working one into .env
 * - Restarts PM2 jobs-website + jobs-telegram-bot only when env changes
 * - Prints a Telegram-ready report only when something changed
 *   (empty stdout = silent cron tick)
 *
 * Usage:
 *   node scripts/refreshOpenRouterFreeModels.js
 *   node scripts/refreshOpenRouterFreeModels.js --force   # always print report
 *   node scripts/refreshOpenRouterFreeModels.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const STATE_PATH = path.join(ROOT, 'logs', 'openrouter-free-models.json');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');
const PROBE_TIMEOUT_MS = 12000;
const MAX_PROBES = 6;

function loadDotEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function upsertEnv(filePath, updates) {
  const text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = text.split(/\n/);
  const seen = new Set();
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, val] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${val}`);
  }
  if (!next.length || next[next.length - 1] !== '') next.push('');
  fs.writeFileSync(filePath, next.join('\n'));
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isChatFreeModel(m) {
  const id = String(m.id || '');
  if (!id) return false;
  if (/rerank|embed|whisper|tts|image|lyria|moderat|safety|voice/i.test(id)) return false;
  const outs = m.architecture?.output_modalities || [];
  if (outs.length && !outs.includes('text')) return false;
  const prompt = Number(m.pricing?.prompt ?? 1);
  const completion = Number(m.pricing?.completion ?? 1);
  return id.endsWith(':free') || id === 'openrouter/free' || (prompt === 0 && completion === 0);
}

async function listFreeModels(apiKey, baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`models list failed (${res.status})`);
  }
  const data = await res.json();
  return (data.data || []).filter(isChatFreeModel).map((m) => m.id);
}

async function probe(apiKey, baseUrl, model) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jobshub.co.ke',
        'X-Title': 'JobsHub Resume AI watchdog',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word OK' }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const raw = await res.text();
    let json = {};
    try {
      json = JSON.parse(raw);
    } catch {
      json = {};
    }
    const content = String(json.choices?.[0]?.message?.content || '').trim();
    const errMsg = json.error?.message || '';
    const deprecated =
      res.status === 404 ||
      /deprecated|unavailable for free|no longer available|is not available/i.test(errMsg);
    const rateLimited = res.status === 429 || /rate.?limit|temporarily/i.test(errMsg);
    return {
      model,
      ok: res.ok && content.length > 0,
      alive: (res.ok && content.length > 0) || rateLimited || res.status === 200,
      status: res.status,
      deprecated,
      rateLimited,
      empty: res.ok && !content,
      ms: Date.now() - started,
      error: errMsg.slice(0, 140) || (!res.ok ? raw.slice(0, 140) : ''),
    };
  } catch (error) {
    return {
      model,
      ok: false,
      alive: false,
      status: 0,
      deprecated: false,
      rateLimited: false,
      empty: false,
      ms: Date.now() - started,
      error: String(error.message || error).slice(0, 140),
    };
  }
}

function pickCandidates(freeIds, current, fallbacks) {
  const preferred = [
    'openrouter/free',
    current,
    ...fallbacks,
    'google/gemma-4-26b-a4b-it:free',
    'z-ai/glm-5.2:free',
    'poolside/laguna-xs-2.1:free',
    'cohere/north-mini-code:free',
    'minimax/minimax-m2.7:free',
    'nvidia/nemotron-3.5-lightning:free',
  ];
  const out = [];
  const seen = new Set();
  for (const id of preferred.concat(freeIds)) {
    if (!id || seen.has(id)) continue;
    if (id !== 'openrouter/free' && !freeIds.includes(id) && id !== current) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PROBES) break;
  }
  return out;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { free: [], primary: '', fallbacks: [], checked_at: null };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function restartPm2() {
  const r = spawnSync('pm2', ['restart', 'jobs-website', 'jobs-telegram-bot', '--update-env'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'pm2 restart failed').slice(0, 240));
  }
}

function report(lines) {
  process.stdout.write(`${lines.filter(Boolean).join('\n')}\n`);
}

async function main() {
  const env = loadDotEnv(ENV_PATH);
  const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY missing in /var/www/jobs/.env');
    process.exit(1);
  }
  const baseUrl = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const current = env.OPENROUTER_MODEL || 'openrouter/free';
  const fallbacks = parseList(env.OPENROUTER_FALLBACK_MODELS);
  const prev = loadState();

  const freeIds = await listFreeModels(apiKey, baseUrl);
  const gone = (prev.free || []).filter((id) => !freeIds.includes(id));
  const added = freeIds.filter((id) => !(prev.free || []).includes(id));

  const candidates = pickCandidates(freeIds, current, fallbacks);
  const probes = [];
  for (const id of candidates) {
    // eslint-disable-next-line no-await-in-loop
    probes.push(await probe(apiKey, baseUrl, id));
  }

  const currentProbe = probes.find((p) => p.model === current);
  const working = probes.filter((p) => p.ok || p.alive);
  const currentOk = Boolean(currentProbe && (currentProbe.ok || currentProbe.alive) && !currentProbe.deprecated);
  const currentDeprecated = Boolean(currentProbe?.deprecated) || (current !== 'openrouter/free' && !freeIds.includes(current));

  let nextPrimary = current;
  let nextFallbacks = fallbacks;
  let swapped = false;

  if (!currentOk || currentDeprecated) {
    const replacement = working.find((p) => p.model !== current);
    if (!replacement) {
      saveState({
        free: freeIds,
        primary: current,
        fallbacks,
        checked_at: new Date().toISOString(),
        last_error: currentProbe?.error || 'no working free model found',
        probes,
      });
      report([
        'JobsHub Resume AI — OpenRouter free models',
        `Current: \`${current}\` is ${currentDeprecated ? 'deprecated/gone' : 'not responding'}.`,
        currentProbe?.error ? `Error: ${currentProbe.error}` : '',
        `Catalog: ${freeIds.length} free chat models.`,
        'No working replacement found this tick. Will retry tomorrow.',
      ]);
      process.exit(2);
    }
    nextPrimary = replacement.model;
    nextFallbacks = working
      .map((p) => p.model)
      .filter((id) => id !== nextPrimary)
      .slice(0, 2);
    if (!nextFallbacks.length && nextPrimary !== 'openrouter/free') {
      nextFallbacks = ['openrouter/free'];
    }
    swapped = nextPrimary !== current;
  } else if (!fallbacks.length && working.length > 1) {
    nextFallbacks = working.map((p) => p.model).filter((id) => id !== current).slice(0, 2);
    swapped = nextFallbacks.join(',') !== fallbacks.join(',');
  }

  if (swapped && !DRY) {
    upsertEnv(ENV_PATH, {
      OPENROUTER_MODEL: nextPrimary,
      OPENROUTER_FALLBACK_MODELS: nextFallbacks.join(','),
    });
    restartPm2();
  }

  saveState({
    free: freeIds,
    primary: nextPrimary,
    fallbacks: nextFallbacks,
    checked_at: new Date().toISOString(),
    probes,
    gone,
    added,
  });

  const first = !(prev.free || []).length;
  const interesting = swapped || currentDeprecated || (!first && gone.length > 0) || FORCE || DRY;
  if (!interesting) return;

  report([
    DRY ? 'JobsHub Resume AI — OpenRouter check (dry-run)' : 'JobsHub Resume AI — OpenRouter free models',
    swapped
      ? `Switched primary: \`${current}\` → \`${nextPrimary}\``
      : `Primary still working: \`${nextPrimary}\``,
    nextFallbacks.length ? `Fallbacks: ${nextFallbacks.map((m) => `\`${m}\``).join(', ')}` : '',
    gone.length ? `Deprecated / removed: ${gone.map((m) => `\`${m}\``).join(', ')}` : '',
    added.length ? `New free slugs: ${added.slice(0, 8).map((m) => `\`${m}\``).join(', ')}${added.length > 8 ? '…' : ''}` : '',
    `Catalog: ${freeIds.length} free chat models. Probed ${probes.length} (${working.length} ok).`,
    swapped && !DRY ? 'Restarted jobs-website + jobs-telegram-bot.' : '',
  ]);
}

main().catch((error) => {
  console.error(String(error.message || error).slice(0, 300));
  process.exit(1);
});
