/**
 * Shared OpenAI-compatible chat client.
 * Primary: SiliconFlow (SILICONFLOW_API_KEY).
 * Fallback: xAI / SpaceXAI (XAI_API_KEY) when SiliconFlow is not configured.
 */

const config = require('../config');

/**
 * @returns {{ provider: string, apiKey: string, baseUrl: string, model: string } | null}
 */
function resolveProvider() {
  const sfKey = config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || '';
  if (sfKey) {
    return {
      provider: 'siliconflow',
      apiKey: sfKey,
      baseUrl: (config.siliconflow?.baseUrl || process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(
        /\/$/,
        ''
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

/**
 * Chat completion (non-streaming).
 * @param {object} options
 * @param {{role: string, content: string}[]} options.messages
 * @param {number} [options.temperature]
 * @param {number} [options.maxTokens]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.model] - override model
 * @returns {Promise<{ content: string, provider: string, model: string, raw: object }>}
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
      'No LLM configured. Set SILICONFLOW_API_KEY (preferred) or XAI_API_KEY in .env'
    );
    err.code = 'LLM_NOT_CONFIGURED';
    throw err;
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages are required');
  }

  const model = modelOverride || provider.model;
  const url = `${provider.baseUrl}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
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
      `LLM ${provider.provider} failed (${response.status}): ${errText.slice(0, 300)}`
    );
    err.status = response.status;
    err.provider = provider.provider;
    throw err;
  }

  const data = await response.json();
  const content =
    data.choices?.[0]?.message?.content ||
    data.output_text ||
    '';

  return {
    content: String(content || ''),
    provider: provider.provider,
    model,
    raw: data,
  };
}

/**
 * Chat and parse the first JSON object from the response.
 * @param {object} options - same as chat()
 * @returns {Promise<{ parsed: object, content: string, provider: string, model: string }>}
 */
async function chatJson(options = {}) {
  const result = await chat(options);
  const jsonMatch = String(result.content).match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const err = new Error('LLM response did not contain JSON');
    err.code = 'LLM_NO_JSON';
    err.content = result.content.slice(0, 500);
    throw err;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
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
};
