/**
 * Shared OpenAI-compatible chat client.
 * Primary: OpenRouter free models (OPENROUTER_API_KEY).
 * Fallback: SiliconFlow, then xAI, when OpenRouter is not configured.
 */

const config = require('../config');

function stripSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

/**
 * @returns {{ provider: string, apiKey: string, baseUrl: string, model: string, fallbackModels?: string[], extraHeaders?: object } | null}
 */
function resolveProvider() {
  const orKey = config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || '';
  if (orKey) {
    return {
      provider: 'openrouter',
      apiKey: orKey,
      baseUrl: stripSlash(
        config.openrouter?.baseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
      ),
      model:
        config.openrouter?.model ||
        process.env.OPENROUTER_MODEL ||
        'openrouter/free',
      fallbackModels: config.openrouter?.fallbackModels || ['cohere/north-mini-code:free'],
      extraHeaders: {
        'HTTP-Referer': (config.app && config.app.url) || 'https://jobshub.co.ke',
        'X-Title': 'JobsHub Resume AI',
      },
    };
  }

  const sfKey = config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || '';
  if (sfKey) {
    return {
      provider: 'siliconflow',
      apiKey: sfKey,
      baseUrl: stripSlash(
        config.siliconflow?.baseUrl || process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1'
      ),
      model:
        config.siliconflow?.model ||
        process.env.SILICONFLOW_MODEL ||
        'Qwen/Qwen2.5-72B-Instruct',
    };
  }

  const xaiKey = config.xai?.apiKey || process.env.XAI_API_KEY || '';
  if (xaiKey) {
    return {
      provider: 'xai',
      apiKey: xaiKey,
      baseUrl: 'https://api.x.ai/v1',
      model: config.xai?.model || process.env.XAI_MODEL || 'grok-4.5',
    };
  }

  return null;
}

function isConfigured() {
  return !!resolveProvider();
}

async function chatOnce(provider, model, { messages, temperature, maxTokens, timeoutMs }) {
  const url = `${provider.baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      ...(provider.extraHeaders || {}),
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const err = new Error(
      `LLM ${provider.provider}/${model} failed (${response.status}): ${errText.slice(0, 300)}`
    );
    err.status = response.status;
    err.provider = provider.provider;
    err.model = model;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || data.output_text || '';
  if (!String(content || '').trim()) {
    const err = new Error(`LLM ${provider.provider}/${model} returned empty content`);
    err.status = 502;
    err.provider = provider.provider;
    err.model = model;
    throw err;
  }
  return {
    content: String(content || ''),
    provider: provider.provider,
    model,
    raw: data,
  };
}

function isTimeoutErr(err) {
  const msg = String(err?.message || '');
  return (
    err?.code === 'LLM_TIMEOUT' ||
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError' ||
    /aborted due to timeout|The operation was aborted/i.test(msg)
  );
}

/**
 * Chat completion (non-streaming).
 */
async function chat({
  messages,
  temperature = 0.3,
  maxTokens = 4096,
  timeoutMs = 90000,
  model: modelOverride,
} = {}) {
  const provider = resolveProvider();
  if (!provider) {
    const err = new Error(
      'No LLM configured. Set OPENROUTER_API_KEY (preferred) or SILICONFLOW_API_KEY in .env'
    );
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages are required');
  }

  const models = [modelOverride || provider.model]
    .concat(provider.fallbackModels || [])
    .filter((m, i, arr) => m && arr.indexOf(m) === i);

  let lastErr;
  for (const model of models) {
    try {
      return await chatOnce(provider, model, { messages, temperature, maxTokens, timeoutMs });
    } catch (err) {
      if (isTimeoutErr(err)) {
        err.code = err.code || 'LLM_TIMEOUT';
      }
      lastErr = err;
      const retryable =
        isTimeoutErr(err) ||
        err.status === 429 ||
        err.status === 408 ||
        (err.status && err.status >= 500);
      if (!retryable || model === models[models.length - 1]) throw err;
    }
  }
  throw lastErr;
}

function extractFirstJsonObject(raw) {
  let s = String(raw || '');
  s = s.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

async function chatJson(options = {}) {
  const result = await chat(options);
  const slice = extractFirstJsonObject(result.content);
  if (!slice) {
    const err = new Error('LLM response did not contain JSON');
    err.code = 'LLM_NO_JSON';
    err.content = result.content.slice(0, 500);
    throw err;
  }
  try {
    const parsed = JSON.parse(slice);
    return {
      parsed,
      content: result.content,
      provider: result.provider,
      model: result.model,
    };
  } catch (e) {
    const err = new Error(`Failed to parse LLM JSON: ${e.message}`);
    err.code = 'LLM_BAD_JSON';
    err.content = result.content.slice(0, 500);
    throw err;
  }
}

module.exports = {
  resolveProvider,
  isConfigured,
  chat,
  chatJson,
  extractFirstJsonObject,
  isTimeoutErr,
};
