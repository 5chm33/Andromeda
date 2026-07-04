/**
 * sweBenchModelConfig.ts — Configurable Model Provider for SWE-bench (v2.0.0)
 *
 * Provides a unified, runtime-configurable LLM provider for the SWE-bench
 * pipeline. Supports:
 *   - anthropic/claude-sonnet-4-5 (current default, via OpenRouter)
 *   - anthropic/claude-3-7-sonnet (extended thinking, +~15pp estimated)
 *   - claude-fable-5 (direct Anthropic API, prompt caching, SOTA model)
 *   - openai/o3 (reasoning model, +~20pp estimated)
 *   - openai/o3-mini (cheaper reasoning, +~10pp estimated)
 *   - Any OpenRouter model (via SWEBENCH_MODEL env var)
 *
 * Configuration priority:
 *   1. SWEBENCH_MODEL env var (e.g. "anthropic/claude-3-7-sonnet")
 *   2. SWEBENCH_PROVIDER env var ("openai-o3" | "claude-3-7" | "claude-sonnet" | "claude-fable-5")
 *   3. Default: anthropic/claude-sonnet-4-5 (current baseline)
 *
 * Extended thinking:
 *   Set SWEBENCH_THINKING=1 to enable extended thinking for claude-3-7-sonnet.
 *   This sends a `thinking` block in the request with budget_tokens=8000.
 *   NOTE: Extended thinking requires temperature=1 and is only supported by
 *   claude-3-7-sonnet and newer models.
 *
 * Prompt caching (Fable 5 / Anthropic native):
 *   When apiFormat='anthropic', callSWEBenchLLM uses the Anthropic Messages API
 *   format with cache_control blocks on the system prompt and first user turn.
 *   This reduces input token cost by ~90% on cache hits — critical for Fable 5.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** API request/response format to use */
export type APIFormat = 'openrouter' | 'anthropic';

export interface SWEBenchModelConfig {
  /** Human-readable model name for logging and prediction metadata */
  modelName: string;
  /** Model identifier (OpenRouter format or Anthropic model ID) */
  modelId: string;
  /** API endpoint */
  apiUrl: string;
  /** API key (from env) */
  apiKey: string;
  /** API request/response format: 'openrouter' (default) or 'anthropic' (native) */
  apiFormat: APIFormat;
  /** Max output tokens */
  maxTokens: number;
  /** Temperature (0.0 for deterministic patch generation) */
  temperature: number;
  /** Whether to enable extended thinking (claude-3-7-sonnet only) */
  extendedThinking: boolean;
  /** Thinking budget tokens (only used when extendedThinking=true) */
  thinkingBudget: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Whether to use prompt caching (Anthropic native API only) */
  promptCaching: boolean;
}

// ─── Preset Configurations ────────────────────────────────────────────────────

const PRESETS: Record<string, Omit<SWEBenchModelConfig, 'apiKey'>> = {
  /** Current baseline — claude-sonnet-4-5 via OpenRouter */
  'claude-sonnet': {
    modelName: 'andromeda-v4-claude-sonnet-4-5',
    modelId: 'anthropic/claude-sonnet-4-5',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openrouter',
    maxTokens: 16000,
    temperature: 0.0,
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 300_000,  // Increased: revision prompts with large files can be slow
    promptCaching: false,
  },
  /** Claude 3.7 Sonnet — extended thinking, best for complex reasoning */
  'claude-3-7': {
    modelName: 'andromeda-v5-claude-3-7-sonnet',
    modelId: 'anthropic/claude-3-7-sonnet',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openrouter',
    maxTokens: 16000,
    temperature: 1,  // Required for extended thinking
    extendedThinking: false,  // Overridden lazily in resolveSWEBenchModelConfig
    thinkingBudget: 8000,
    timeoutMs: 240_000,  // Longer timeout for thinking
    promptCaching: false,
  },
  /** Claude Fable 5 — direct Anthropic API, prompt caching, SOTA model */
  'claude-fable-5': {
    modelName: 'andromeda-v6-claude-fable-5',
    modelId: 'claude-fable-5',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiFormat: 'anthropic',
    maxTokens: 16000,
    temperature: 1,  // Required for Anthropic native API
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 300_000,
    promptCaching: true,  // CRITICAL: reduces input token cost by ~90% on cache hits
  },
  /** OpenAI o3 — frontier reasoning model */
  'openai-o3': {
    modelName: 'andromeda-v5-o3',
    modelId: 'openai/o3',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openrouter',
    maxTokens: 16000,
    temperature: 1,  // o3 ignores temperature but API requires it
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 300_000,  // o3 can be slow
    promptCaching: false,
  },
  /** OpenAI o3-mini — cheaper reasoning model */
  'openai-o3-mini': {
    modelName: 'andromeda-v5-o3-mini',
    modelId: 'openai/o3-mini',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openrouter',
    maxTokens: 16000,
    temperature: 1,
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 240_000,
    promptCaching: false,
  },
  /** Kimi k2.6 — 256K context, strong coding, much cheaper than o3 */
  'kimi': {
    modelName: 'andromeda-v5-kimi-k2',
    modelId: 'moonshotai/kimi-k2',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openrouter',
    maxTokens: 16000,
    temperature: 1,  // kimi-k2 requires temperature=1
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 180_000,
    promptCaching: false,
  },
};

// ─── Config Resolution ────────────────────────────────────────────────────────

/**
 * Resolves the active SWEBenchModelConfig from environment variables.
 *
 * Priority:
 *   1. SWEBENCH_MODEL env var → custom OpenRouter model ID
 *   2. SWEBENCH_PROVIDER env var → preset name
 *   3. Default: claude-sonnet
 */
export function resolveSWEBenchModelConfig(): SWEBenchModelConfig {
  // Priority 1: Explicit model ID override (always uses OpenRouter)
  const customModel = process.env.SWEBENCH_MODEL;
  if (customModel) {
    const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
    const base = PRESETS['claude-sonnet'];  // Use claude-sonnet defaults
    return {
      ...base,
      apiKey,
      modelName: `andromeda-v5-custom-${customModel.replace(/\//g, '-')}`,
      modelId: customModel,
    };
  }

  // Priority 2: Preset name
  const providerName = process.env.SWEBENCH_PROVIDER ?? 'claude-sonnet';
  const preset = PRESETS[providerName] ?? PRESETS['claude-sonnet'];

  // Select the correct API key based on the preset's API format
  let apiKey: string;
  if (preset.apiFormat === 'anthropic') {
    // Fable 5 uses ANTHROPIC_FABLE_API_KEY (direct Anthropic API, not OpenRouter)
    apiKey = process.env.ANTHROPIC_FABLE_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
  } else {
    apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
  }

  // Apply extended thinking lazily (read env var at call time, not module load time)
  const extendedThinking = providerName === 'claude-3-7' && process.env.SWEBENCH_THINKING === '1';

  return { ...preset, apiKey, extendedThinking };
}

// ─── Anthropic Native API Types ───────────────────────────────────────────────

interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  cache_control?: { type: 'ephemeral' };
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  // Note: temperature is intentionally omitted — claude-fable-5 does not support it
  system?: AnthropicTextBlock[];
  messages: AnthropicMessage[];
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message: string };
  type?: string;
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────

/**
 * Makes a single LLM call using the given config.
 * Handles two API formats:
 *   - 'openrouter': OpenRouter chat completions format (existing behavior)
 *   - 'anthropic': Anthropic Messages API format with optional prompt caching
 *
 * Returns the text content of the response.
 */
export async function callSWEBenchLLM(
  config: SWEBenchModelConfig,
  prompt: string,
  temperature?: number
): Promise<string> {
  if (config.apiFormat === 'anthropic') {
    return callAnthropicNative(config, prompt, temperature);
  }
  return callOpenRouter(config, prompt, temperature);
}

/**
 * Calls the Anthropic Messages API directly.
 * Supports prompt caching via cache_control blocks.
 *
 * The prompt is split into a system block (cached) and a user block (cached).
 * On cache hit, input token cost drops by ~90% — critical for Fable 5.
 *
 * Prompt format convention:
 *   If the prompt contains "---SYSTEM---\n...\n---USER---\n..." markers,
 *   the system and user parts are split accordingly.
 *   Otherwise, the entire prompt is sent as the user message.
 */
async function callAnthropicNative(
  config: SWEBenchModelConfig,
  prompt: string,
  _temperature?: number  // Ignored: claude-fable-5 does not support temperature
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  // Split prompt into system + user if markers are present
  let systemText = '';
  let userText = prompt;

  const systemMarker = '---SYSTEM---\n';
  const userMarker = '\n---USER---\n';
  const sysIdx = prompt.indexOf(systemMarker);
  const userIdx = prompt.indexOf(userMarker);
  if (sysIdx !== -1 && userIdx !== -1 && userIdx > sysIdx) {
    systemText = prompt.slice(sysIdx + systemMarker.length, userIdx).trim();
    userText = prompt.slice(userIdx + userMarker.length).trim();
  }

  // Build the request body in Anthropic Messages format
  // NOTE: claude-fable-5 does NOT support the temperature parameter
  // (returns 400 "temperature is deprecated for this model").
  // We omit it entirely for Anthropic native format.
  const body: AnthropicRequestBody = {
    model: config.modelId,
    max_tokens: config.maxTokens,
    messages: [],
  };

  // System prompt block (with caching if enabled)
  if (systemText) {
    const systemBlock: AnthropicTextBlock = { type: 'text', text: systemText };
    if (config.promptCaching) {
      systemBlock.cache_control = { type: 'ephemeral' };
    }
    body.system = [systemBlock];
  }

  // User message block (with caching if enabled)
  const userBlock: AnthropicContentBlock = { type: 'text', text: userText };
  if (config.promptCaching) {
    userBlock.cache_control = { type: 'ephemeral' };
  }
  body.messages = [{ role: 'user', content: [userBlock] }];

  // Anthropic-specific headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (config.promptCaching) {
    headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
  }

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json() as AnthropicResponse;

    if (data.error) {
      throw new Error(`Anthropic API error: ${data.error.message}`);
    }

    if (!data.content || data.content.length === 0) {
      throw new Error('Anthropic API returned no content');
    }

    // Extract text blocks only (skip thinking blocks if any)
    const textContent = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n');

    return textContent;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls the OpenRouter chat completions API.
 * Handles extended thinking for claude-3-7-sonnet.
 */
async function callOpenRouter(
  config: SWEBenchModelConfig,
  prompt: string,
  temperature?: number
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  const effectiveTemp = temperature ?? config.temperature;

  // Build the request body
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: config.maxTokens,
    temperature: effectiveTemp,
  };

  // Extended thinking for claude-3-7-sonnet
  if (config.extendedThinking && config.thinkingBudget > 0) {
    body['thinking'] = {
      type: 'enabled',
      budget_tokens: config.thinkingBudget,
    };
    // Extended thinking requires temperature=1
    body['temperature'] = 1;
  }

  // OpenRouter-specific headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    'HTTP-Referer': 'https://andromeda-swebench.ai',
    'X-Title': 'Andromeda SWE-bench',
  };

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      throw new Error(`LLM API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          // Extended thinking returns an array of content blocks
          content_blocks?: Array<{ type: string; text?: string }>;
        };
      }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`LLM API error: ${data.error.message}`);
    }

    const choice = data.choices?.[0];
    if (!choice) throw new Error('LLM API returned no choices');

    // Handle extended thinking response format (array of content blocks)
    const msg = choice.message;
    if (Array.isArray(msg?.content)) {
      // Content is an array of blocks — extract text blocks only
      const textBlocks = (msg.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n');
      return textBlocks;
    }

    return (msg?.content as string | null | undefined) ?? '';
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Creates an andromedaLLM-compatible function using the given config.
 * Drop-in replacement for the hardcoded andromedaLLM in run_swebench.ts.
 */
export function createSWEBenchLLMProvider(
  config: SWEBenchModelConfig
): (prompt: string, temperature?: number) => Promise<string> {
  return (prompt: string, temperature?: number) =>
    callSWEBenchLLM(config, prompt, temperature);
}
