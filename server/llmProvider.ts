/**
 * llmProvider.ts — Model-Agnostic LLM Abstraction Layer
 * Andromeda v6.15
 *
 * Supports any OpenAI-compatible API (DeepSeek, OpenAI, Claude-via-proxy,
 * Ollama, LM Studio, Together, Groq, etc.)
 */
import { createLogger } from "./logger.js";
const log = createLogger("llmProvider");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LLMProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  supportsTools?: boolean;        // native function-calling
  supportsVision?: boolean;
  supportsStreaming?: boolean;
  supportsJsonMode?: boolean;     // v6.15: response_format: { type: "json_object" } support
  headers?: Record<string, string>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;   // JSON string
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMStreamChunk {
  type: "text" | "tool_calls" | "done" | "error";
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface LLMCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ─── Default Providers ──────────────────────────────────────────────────────

const DEFAULT_PROVIDERS: Record<string, Omit<LLMProviderConfig, "apiKey">> = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",  // v6.17: DeepSeek direct API uses short form (NOT "deepseek/deepseek-chat")
    maxTokens: 32768, // v5.75: Increased from 8192 — deepseek-chat supports up to 64K output tokens
    temperature: 0.7,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    supportsJsonMode: true,  // v6.15
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-reasoner",  // v6.17: DeepSeek direct API uses short form
    maxTokens: 8192,
    temperature: 0.7,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    apiUrl: (process.env.OPENAI_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions",
    model: process.env.OPENAI_MODEL || "gpt-4o",
    maxTokens: 4096,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsJsonMode: true,  // v6.15
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude Sonnet (via OpenRouter)",
    // v5.87: Route Claude through OpenRouter so we use the OpenAI-compatible API format.
    // Direct Anthropic API uses a different request/response format (tool_use blocks, etc.)
    // that this codebase doesn't support. OpenRouter accepts OpenAI format and translates.
    // Claude does NOT truncate large code outputs unlike DeepSeek chat.
    // v9.16.3 FIX: HARDCODED model — OPENROUTER_MODEL env var only applies to the cheap
    // 'openrouter' provider. This provider is the PRO tier (security/architecture tasks)
    // and must always use Claude Sonnet regardless of what OPENROUTER_MODEL is set to.
    // If you want to change the pro model, edit this line directly.
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "anthropic/claude-sonnet-4-5",  // HARDCODED — see comment above
    maxTokens: 16000,  // v5.87: Claude supports up to 64K output; 16K is safe for large code files
    temperature: 0.5,  // Lower temp for code generation
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    model: "llama3",
    maxTokens: 4096,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  groq: {
    id: "groq",
    name: "Groq",
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    maxTokens: 4096,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  // v5.48: Kimi k2.6 — best-in-class coding model (256K context, vision, tools)
  // v7.1.8: temperature MUST be 1 — kimi-k2.6 is a reasoning model and rejects any other value
  kimi: {
    id: "kimi",
    name: "Kimi k2.6 (Coding)",
    apiUrl: "https://api.moonshot.ai/v1/chat/completions",
    model: "kimi-k2.6",
    maxTokens: 8192,
    temperature: 1,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  // v5.48: DeepSeek V4 Flash — fast, cheap, great for quick tasks
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash (Fast)",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",  // v6.17: deepseek-v4-flash → deepseek-chat (current)
    maxTokens: 8192,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  // v7.1.7: Direct Anthropic API — bypasses OpenRouter entirely.
  // Uses the OpenAI-compatible endpoint so no format changes needed.
  // Preferred when ANTHROPIC_API_KEY is set and OpenRouter has no credits.
  "anthropic-direct": {
    id: "anthropic-direct",
    name: "Anthropic Claude Sonnet (Direct)",
    apiUrl: "https://api.anthropic.com/v1/chat/completions",
    model: "claude-sonnet-4-5",
    maxTokens: 16000,
    temperature: 0.5,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    headers: {
      "anthropic-version": "2023-06-01",
    },
  },
  custom: {
    id: "custom",
    name: "Custom Provider",
    apiUrl: "",
    model: "",
    maxTokens: 4096,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  // v5.49: OpenRouter — unified gateway to 200+ models (Claude, GPT-4, Gemini, etc.)
  // v6.21: Default model changed from claude-opus-4.6 to gemini-2.5-flash to prevent
  // accidental cost drain. Use llmRouter.ts tier=Max to explicitly select Claude Opus.
  openrouter: {
    id: "openrouter",
    name: "OpenRouter (Gemini Flash — cheap default)",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: process.env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
    maxTokens: 8192,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsJsonMode: true,  // v6.15
    headers: {
      "HTTP-Referer": "https://andromeda-ai.local",
      "X-Title": "Andromeda AI",
    },
  },
  // v5.49: OpenRouter Fast — Gemini Flash for speed-critical tasks
  "openrouter-fast": {
    id: "openrouter-fast",
    name: "OpenRouter (Gemini Flash)",
    apiUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "google/gemini-2.5-flash",
    maxTokens: 8192,
    temperature: 0.7,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsJsonMode: true,  // v6.15
    headers: {
      "HTTP-Referer": "https://andromeda-ai.local",
      "X-Title": "Andromeda AI",
    },
  },
};

// ─── Provider State ─────────────────────────────────────────────────────────────────

let activeProvider: LLMProviderConfig | null = null;
let _providerInitialized = false;

// ─── v6.22: Live Cost Tracker ─────────────────────────────────────────────────
// Tracks USD cost of every LLM call in real time.
// Pricing is per-million-tokens (input/output separately) and matches the
// public pricing pages as of June 2026. Update PROVIDER_PRICING when prices change.
//
// Features:
//   • Per-provider cost accumulation (reset on process restart)
//   • Daily spending cap with automatic warning
//   • getCostStats() for the /api/rsi/status dashboard
//   • Zero overhead when provider is "ollama" (local, free)

interface ProviderPricing {
  inputPerMillion: number;   // USD per 1M input tokens
  outputPerMillion: number;  // USD per 1M output tokens
}

// Prices in USD per 1M tokens (June 2026)
const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  "deepseek":           { inputPerMillion: 0.14,  outputPerMillion: 0.28  },
  "deepseek-reasoner":  { inputPerMillion: 0.55,  outputPerMillion: 2.19  },
  "deepseek-v4-flash":  { inputPerMillion: 0.14,  outputPerMillion: 0.28  },
  "openrouter":         { inputPerMillion: 3.00,  outputPerMillion: 15.00 }, // Claude Sonnet via OR
  "openrouter-fast":    { inputPerMillion: 0.10,  outputPerMillion: 0.40  }, // Gemini 2.5 Flash
  "anthropic":          { inputPerMillion: 3.00,  outputPerMillion: 15.00 }, // Claude Sonnet 4.5
  "anthropic-direct":   { inputPerMillion: 3.00,  outputPerMillion: 15.00 },
  "kimi":               { inputPerMillion: 0.15,  outputPerMillion: 0.60  }, // Kimi k2.6
  "groq":               { inputPerMillion: 0.05,  outputPerMillion: 0.08  }, // Llama 3.3 70B
  "openai":             { inputPerMillion: 2.50,  outputPerMillion: 10.00 }, // GPT-4o
  "ollama":             { inputPerMillion: 0.00,  outputPerMillion: 0.00  }, // local, free
};

interface CostEntry {
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: number;
}

const _costLog: CostEntry[] = [];
const _costByProvider: Record<string, number> = {};
let _totalCostUsd = 0;
let _costResetAt = Date.now();

/**
 * v6.22: Record the cost of a single LLM call.
 * Called automatically by chatCompletion() and backgroundChatCompletion().
 */
export function recordLLMCost(
  providerId: string,
  inputTokens: number,
  outputTokens: number
): void {
  const pricing = PROVIDER_PRICING[providerId] ?? { inputPerMillion: 1.00, outputPerMillion: 4.00 };
  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion;
  _costLog.push({ providerId, inputTokens, outputTokens, costUsd, timestamp: Date.now() });
  _costByProvider[providerId] = (_costByProvider[providerId] ?? 0) + costUsd;
  _totalCostUsd += costUsd;
  // Daily cap check: warn (but do not block) when the cap is first crossed
  const dailyCapUsd = parseFloat(process.env.DAILY_COST_CAP_USD ?? "5.00");
  if (_totalCostUsd > dailyCapUsd && _totalCostUsd - costUsd <= dailyCapUsd) {
    const msg = `[CostTracker] Daily spending cap of $${dailyCapUsd.toFixed(2)} exceeded! ` +
      `Total: $${_totalCostUsd.toFixed(4)}. Consider switching to a cheaper provider.`;
    console.warn(msg);
  }
}

/**
 * v6.22: Return a snapshot of all cost tracking data.
 * Exposed via GET /api/rsi/status and the RSI dashboard.
 */
export function getCostStats(): {
  totalCostUsd: number;
  byProvider: Record<string, number>;
  callCount: number;
  resetAt: number;
  dailyCapUsd: number;
  capExceeded: boolean;
} {
  const dailyCapUsd = parseFloat(process.env.DAILY_COST_CAP_USD ?? "5.00");
  return {
    totalCostUsd: _totalCostUsd,
    byProvider: { ..._costByProvider },
    callCount: _costLog.length,
    resetAt: _costResetAt,
    dailyCapUsd,
    capExceeded: _totalCostUsd > dailyCapUsd,
  };
}

/**
 * v6.22: Reset the cost accumulator (e.g., at midnight or on demand).
 */
export function resetCostStats(): void {
  _costLog.length = 0;
  Object.keys(_costByProvider).forEach(k => delete _costByProvider[k]);
  _totalCostUsd = 0;
  _costResetAt = Date.now();
}


function ensureProviderInitialized(): LLMProviderConfig {
  if (!_providerInitialized || !activeProvider) {
    activeProvider = resolveProviderFromEnv();
    _providerInitialized = true;
  }
  return activeProvider;
}

/**
 * Resolves the active provider based on environment variables and availability.
 * Extracted for testability and separation of concerns.
 */
export function resolveProviderFromEnv(): LLMProviderConfig {
  let modelId = process.env.LLM_MODEL ?? "";
  if (modelId === "deepseek-chat" || modelId === "deepseek-v3") modelId = "deepseek";
  if (modelId === "openrouter" && process.env.DEEPSEEK_API_KEY) {
    console.warn(
      "[COST GUARD v6.21] LLM_MODEL=openrouter detected but DEEPSEEK_API_KEY is present.\n" +
      "  AUTO-REDIRECTING to DeepSeek (~$0.14/M) instead of Claude Opus (~$15/M).\n" +
      "  Remove LLM_MODEL=openrouter from .env.local to silence this warning.\n" +
      "  To use OpenRouter intentionally: set LLM_MODEL=openrouter-fast (Gemini Flash)."
    );
    modelId = "deepseek";
  }
  if (!modelId || !DEFAULT_PROVIDERS[modelId]) {
    if (process.env.DEEPSEEK_API_KEY) {
      modelId = "deepseek";
    } else if (process.env.KIMI_API_KEY) {
      modelId = "kimi";
    } else if (process.env.OPENROUTER_API_KEY) {
      modelId = "openrouter-fast";
    } else {
      modelId = "deepseek";
    }
  }
  const base = DEFAULT_PROVIDERS[modelId] ?? DEFAULT_PROVIDERS.deepseek;
  const apiKey = getProviderApiKey(modelId);
  let resolvedApiUrl = base.apiUrl;
  let resolvedModel = base.model;
  if (modelId === "openai") {
    if (process.env.OPENAI_API_BASE) {
      resolvedApiUrl = process.env.OPENAI_API_BASE.replace(/\/$/, "") + "/chat/completions";
    }
    if (process.env.OPENAI_MODEL) {
      resolvedModel = process.env.OPENAI_MODEL;
    }
  }
  console.log(`[v6.17] Startup provider: ${modelId} (LLM_MODEL=${process.env.LLM_MODEL ?? "(not set)"}, DEEPSEEK_KEY=${process.env.DEEPSEEK_API_KEY ? "set" : "MISSING"})`);
  return { ...base, apiUrl: resolvedApiUrl, model: resolvedModel, apiKey };
}

/**
 * Returns the API key for a given provider ID.
 * Used by the auto-router to validate provider availability before switching.
 * @param id Provider identifier (e.g. 'deepseek', 'openrouter', 'anthropic')
 * @returns The API key string, or empty string if not configured
 */
export function getProviderApiKey(id: string): string {
  switch (id) {
    case "kimi": return process.env.KIMI_API_KEY ?? "";
    case "deepseek":
    case "deepseek-v4-flash":
    case "deepseek-reasoner": return process.env.DEEPSEEK_API_KEY ?? "";
    case "openai": return process.env.OPENAI_API_KEY ?? "";
    case "groq": return process.env.GROQ_API_KEY ?? "";
    case "openrouter":
    case "openrouter-fast": return process.env.OPENROUTER_API_KEY ?? "";
    // v5.87: anthropic provider routes through OpenRouter (OpenAI-compatible format)
    case "anthropic": return process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
    // v7.1.7: anthropic-direct uses the direct Anthropic API key (no OpenRouter)
    case "anthropic-direct": return process.env.ANTHROPIC_API_KEY ?? "";
    default: return process.env.DEEPSEEK_API_KEY ?? "";
  }
}

/**
 * Switches the active LLM provider by ID, auto-filling the API key from environment variables.
 * @param id Provider identifier (e.g. 'deepseek', 'openrouter', 'anthropic')
 */
export function switchProvider(id: string): void {
  const base = DEFAULT_PROVIDERS[id] ?? DEFAULT_PROVIDERS.custom;
  activeProvider = { ...base, apiKey: getProviderApiKey(id) };
  _providerInitialized = true;
}

/** Returns a copy of the currently active LLM provider configuration. */
export function getActiveProvider(): LLMProviderConfig {
  return { ...ensureProviderInitialized() };
}

/**
 * Overrides the active LLM provider configuration.
 * Partial updates are merged with the existing provider config.
 * @param config Partial provider config — must include at minimum an `id` field
 */
export function setActiveProvider(config: Partial<LLMProviderConfig> & { id: string }): void {
  if (!config) return;
  const base = DEFAULT_PROVIDERS[config.id] ?? DEFAULT_PROVIDERS.custom;
  // v6.15.3 FIX: Always resolve the API key from the NEW provider's id.
  // Bug: previously fell back to old active provider's key when switching tiers,
  // causing e.g. OpenRouter key to be sent to Kimi/DeepSeek API → 401.
  const correctApiKey = config.apiKey ?? getProviderApiKey(config.id);
  activeProvider = {
    ...base,
    ...config,
    apiKey: correctApiKey,
  };
  _providerInitialized = true;
  log.info(`[v6.15.3] Provider switched: ${config.id} (key: ...${correctApiKey.slice(-6)})`);
}

/** Returns a list of all registered LLM providers with their IDs and display names. */
export function listProviders(): Array<{ id: string; name: string }> {
  return Object.values(DEFAULT_PROVIDERS).map(p => ({ id: p.id, name: p.name }));
}

// ─── v7.1.6: Tiered LLM Cost Model ─────────────────────────────────────────────
// Three tiers control which model is used based on task importance:
//
//   Eco      — DeepSeek or Gemini Flash (~$0.00–0.14/M tokens)
//              Used for: routine self-improvement analysis, dedup checks,
//              background RSI cycles, health checks, memory consolidation.
//              This is the DEFAULT tier — used 95%+ of the time.
//
//   Standard — Kimi k2.6 or DeepSeek Reasoner (~$0.14–1.00/M tokens)
//              Used for: complex code refactoring, multi-file proposals,
//              goal decomposition, architecture analysis.
//
//   Pro      — Claude Sonnet 4.5 via OpenRouter (~$3/M tokens)
//              Used for: critical security/auth changes, high-stakes
//              proposals that affect core orchestration, constitution checks.
//              Only used when explicitly requested AND OpenRouter credits > 0.
//
// The tier is selected automatically based on task type, or can be overridden
// by setting LLM_TIER=eco|standard|pro in .env.local.

export type LLMTier = "eco" | "standard" | "pro";

/**
 * Returns the provider ID assigned to a given quality/cost tier.
 * @param tier 'fast' | 'standard' | 'pro' | 'reasoning'
 * @returns Provider ID string (e.g. 'deepseek', 'openrouter')
 */
export function getProviderForTier(tier: LLMTier): string {
  const override = process.env.LLM_TIER as LLMTier | undefined;
  const effectiveTier = override ?? tier;

  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasKimi = !!process.env.KIMI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

    switch (effectiveTier) {
    case "eco":
      // Cheapest available — DeepSeek first, then Kimi
      if (hasDeepSeek) return "deepseek";
      if (hasKimi) return "kimi";
      if (hasOpenRouter) return "openrouter-fast"; // Gemini Flash
      return "deepseek"; // fallback (will fail gracefully)
    case "standard":
      // Mid-tier — Kimi k2.6 (best free coding model) or DeepSeek Reasoner
      if (hasKimi) return "kimi";
      if (hasDeepSeek) return "deepseek-reasoner";
      if (hasOpenRouter) return "openrouter-fast";
      return "deepseek";
    case "pro":
      // v9.16.2: Premium — use OpenRouter for complex decisions (Claude Sonnet 3.5)
      // The user explicitly requested OpenRouter for complex tasks as it was not draining budget.
      if (hasOpenRouter) return "anthropic";                         // Claude via OpenRouter
      if (process.env.ANTHROPIC_API_KEY) return "anthropic-direct";  // Direct Claude (fallback)
      if (hasKimi) return "kimi";                                    // Kimi as last resort
      if (hasDeepSeek) return "deepseek-reasoner";                   // DeepSeek deep-think guard
      return "deepseek";
    default:
      return "deepseek";
  }
}

// Helper: classify a task area into a tier
/**
 * Maps a task area to the appropriate LLM quality tier.
 * Self-modification tasks use 'pro'; fast tasks use 'fast'; default is 'standard'.
 * @param area Optional task area string (e.g. 'self-modification', 'search')
 * @returns The recommended LLM tier for this task area
 */
export function tierForArea(area?: string): LLMTier {
  if (!area) return "eco";
  const a = area.toLowerCase();
  // Pro tier: security-critical or architecture-level changes
  if (/security|auth|constitution|orchestrat|circuit.break/.test(a)) return "pro";
  // Standard tier: complex coding tasks
  if (/performance|feature|refactor|architect|multi.file/.test(a)) return "standard";
  // Eco tier: everything else
  return "eco";
}

// ─── Non-Streaming Completion ───────────────────────────────────────────────

export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    tools?: ToolDefinition[];
    toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    sessionId?: string;  // v5.68: For token budget tracking
    /** v6.33: Override the active provider for this call only (e.g. "kimi", "deepseek", "anthropic"). */
    providerId?: string;
    /** v10.4.1: Skip json_object response_format — use for natural language tasks like eval prompts. */
    plainText?: boolean;
  },
): Promise<LLMCompletionResult> {
  // v6.33: Use a temporary provider override if requested, otherwise use the active provider
  let provider: LLMProviderConfig;
  if (options?.providerId) {
    const base = DEFAULT_PROVIDERS[options.providerId];
    const key = base ? getProviderApiKey(options.providerId) : "";
    if (base && key) {
      provider = { ...base, apiKey: key };
    } else {
      // Requested provider not available — fall back to active
      provider = ensureProviderInitialized();
    }
  } else {
    provider = ensureProviderInitialized();
  }
  // v8.2.0 FIX: deepseek-reasoner and kimi-k2.6 only accept temperature=1.
  // Clamp automatically so callers don't need to know about this restriction.
  const TEMP_MUST_BE_ONE_MODELS = ["deepseek-reasoner", "kimi-k2.6"];
  const rawTemperature = options?.temperature ?? provider.temperature ?? 0.7;
  const temperature = TEMP_MUST_BE_ONE_MODELS.includes(provider.model) ? 1 : rawTemperature;
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature,
    // v5.68: Clamp to [1000, 32768] — prevents API 400 "invalid max_tokens" error
    max_tokens: Math.min(32768, Math.max(1000, options?.maxTokens ?? provider.maxTokens ?? 32768)),
    stream: false,
  };

  if (options?.tools && options.tools.length > 0 && provider.supportsTools) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
    // v6.15: When tools are active, do NOT add response_format — it conflicts with tool_calls on some providers
  } else if (provider.supportsJsonMode && !options?.plainText) {
    // v6.15: No tools active — request JSON object mode to guarantee valid structured output
    // v10.4.1: Skip if plainText=true (e.g. eval tasks that expect natural language responses)
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...provider.headers,
  };

  const resp = await fetch(provider.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new Error(`LLM API error ${resp.status}: ${errText}`);
  }

  const json = (await resp.json()) as any;
  const choice = json.choices?.[0];
  const msg = choice?.message;
  const finishReason: string = choice?.finish_reason ?? "stop";

  // v5.50: Strip reasoning_content from assistant messages before returning.
  // DeepSeek R1 (and other reasoning models) include a reasoning_content field.
  // Per DeepSeek documentation, this MUST NOT be appended back to the conversation
  // history — it causes context rot and performance degradation.
  // Reference: DeepSeek in Practice (Peng et al., 2025), Chapter 6.
  if (msg && (msg as any).reasoning_content !== undefined) {
    delete (msg as any).reasoning_content;
  }

  // v5.75: Auto-continuation for agent tool-calling loops.
  // If finish_reason === "length", the model hit max_tokens mid-response.
  // For non-streaming completions (used by the agent), retry with a continuation
  // prompt and concatenate the results seamlessly.
  //
  // v5.75: Tool-argument continuation — when finish_reason=length AND tool_calls are present,
  // the model was truncated mid-tool-call-argument. Detect if the last tool call's
  // argument JSON is incomplete and request a continuation to complete it.
  let content: string | null = msg?.content ?? null;
  let rawToolCalls: ToolCall[] = msg?.tool_calls ?? [];

  const isIncompleteJson = (s: string): boolean => {
    try { JSON.parse(s); return false; } catch { return true; }
  };

  if (finishReason === "length" && rawToolCalls.length > 0 && !options?.signal?.aborted) {
    const lastTc = rawToolCalls[rawToolCalls.length - 1];
    const lastArgs: string = lastTc?.function?.arguments ?? "";
    if (isIncompleteJson(lastArgs)) {
      // Tool call arguments were truncated mid-JSON. Request a continuation.
      const repairMessages: ChatMessage[] = [
        ...messages,
        {
          role: "assistant" as const,
          content: content ?? null,
        },
        {
          role: "user" as const,
          content: `Your previous tool call for '${lastTc.function.name}' was cut off mid-JSON. Complete ONLY the truncated JSON arguments. Start exactly where it was cut off (do not repeat anything). The incomplete arguments end with: ...${lastArgs.slice(-300)}`,
        },
      ];
      try {
        const repairBody: Record<string, unknown> = {
          model: provider.model,
          messages: repairMessages,
          temperature: 0,
          max_tokens: Math.min(32768, Math.max(1000, options?.maxTokens ?? provider.maxTokens ?? 32768)),
          stream: false,
        };
        const repairResp = await fetch(provider.apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(repairBody),
          signal: options?.signal,
        });
        if (repairResp.ok) {
          const repairJson = (await repairResp.json()) as any;
          const repairContent: string = repairJson.choices?.[0]?.message?.content ?? "";
          if (repairContent) {
            const repairedArgs = lastArgs + repairContent.trim();
            if (!isIncompleteJson(repairedArgs)) {
              rawToolCalls = rawToolCalls.map((tc, i) =>
                i === rawToolCalls.length - 1
                  ? { ...tc, function: { ...tc.function, arguments: repairedArgs } }
                  : tc
              );
              console.log(`[llmProvider] v5.75: Repaired truncated tool-call args for '${lastTc.function.name}' (+${repairContent.length} chars)`);
            }
          }
        }
      } catch (err) { log.caught("non-fatal", err); }
    }
  }

  // v5.77/v5.98: Also continue when finish_reason=="stop" but output is structurally truncated.
  // DeepSeek sometimes returns "stop" even when mid-function or mid-code-block.
  // v5.98 adds: token-count heuristic — if response is >=95% of maxTokens, treat as truncated.
  let effectiveFinishReason = finishReason;
  if (finishReason === "stop" && content && rawToolCalls.length === 0 && !options?.signal?.aborted) {
    // v5.98: Token-count heuristic — provider may lie about finish_reason
    const providerMaxTokens = provider.maxTokens ?? 8192;
    const estimatedOutputTokens = Math.floor(content.length / 4); // ~4 chars per token
    if (estimatedOutputTokens >= providerMaxTokens * 0.95) {
      console.log(`[llmProvider] v5.98: finish_reason=stop but response is ${estimatedOutputTokens} tokens (~${Math.round(estimatedOutputTokens / providerMaxTokens * 100)}% of ${providerMaxTokens} limit). Treating as truncated.`);
      effectiveFinishReason = "length";
    } else {
      try {
        const { detectOutputTruncation } = await import("./truncationDetector.js");
        const truncCheck = detectOutputTruncation(content);
        if (truncCheck.isTruncated && (truncCheck.confidence === "high" || truncCheck.confidence === "medium")) {
          console.log(`[llmProvider] v5.77: finish_reason=stop but output looks truncated (${truncCheck.confidence} confidence: ${truncCheck.reason}). Treating as length.`);
          effectiveFinishReason = "length";
        }
      } catch (err) { log.caught("truncationDetector not available — skip", err); }
    }
  }

  if (effectiveFinishReason === "length" && content && rawToolCalls.length === 0 && !options?.signal?.aborted) {
    const MAX_AGENT_CONTINUATIONS = 5; // v5.75: Increased from 3 to 5 for large code generation
    let continuations = 0;
    let accumulated = content;
    // v5.75: Smarter continuation prompt — detect if we're mid-code-block
    const isMidCodeBlock = (text: string): boolean => {
      const openBackticks = (text.match(/```/g) ?? []).length;
      return openBackticks % 2 !== 0; // odd number of ``` = inside a code block
    };
    const getContinuationPrompt = (text: string): string => {
      if (isMidCodeBlock(text)) {
        return "Continue the code exactly where you left off. Do not add any preamble, do not repeat any code already written. Continue from the exact character where the previous response ended.";
      }
      return "Continue exactly where you left off. Do not repeat anything already written. Start from the exact word/character where the previous response ended.";


    };
    let continueMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: accumulated },
      { role: "user", content: getContinuationPrompt(accumulated) },
    ];
    while (continuations < MAX_AGENT_CONTINUATIONS) {
      continuations++;
      const contBody: Record<string, unknown> = {
        model: provider.model,
        messages: continueMessages,
        temperature: 0, // v5.75: Use temperature=0 for continuations to minimize drift
        max_tokens: Math.min(32768, Math.max(1000, options?.maxTokens ?? provider.maxTokens ?? 32768)),
        stream: false,
      };
      // v5.75: Pass tools in continuation requests so the model can switch to tool-calling
      // if the continuation naturally leads to a tool call
      if (options?.tools && options.tools.length > 0 && provider.supportsTools) {
        contBody.tools = options.tools;
        contBody.tool_choice = options?.toolChoice ?? "auto";
      }
      try {
        const contResp = await fetch(provider.apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(contBody),
          signal: options?.signal,
        });
        if (!contResp.ok) break;
        const contJson = (await contResp.json()) as any;
        const contChoice = contJson.choices?.[0];
        const contMsg = contChoice?.message;
        const contContent: string = contMsg?.content ?? "";
        if (contMsg && (contMsg as any).reasoning_content !== undefined) {
          delete (contMsg as any).reasoning_content;
        }
        // v5.75: If the continuation produced tool calls, return them immediately
        if (contMsg?.tool_calls && contMsg.tool_calls.length > 0) {
          return {
            content: accumulated + (contContent || ""),
            toolCalls: contMsg.tool_calls as ToolCall[],
            finishReason: contChoice?.finish_reason ?? "tool_calls",
            usage: {
              promptTokens: json.usage?.prompt_tokens ?? 0,
              completionTokens: json.usage?.completion_tokens ?? 0,
              totalTokens: json.usage?.total_tokens ?? 0,
            },
          };
        }
        accumulated += contContent;
        if (contChoice?.finish_reason !== "length" || !contContent) break;
        continueMessages = [
          ...continueMessages,
          { role: "assistant", content: contContent },
          { role: "user", content: getContinuationPrompt(accumulated) },
        ];
      } catch {
        break;
      }
    }
    content = accumulated;
  }

    // v6.22: Record cost of this call
  const _inputToks = json.usage?.prompt_tokens ?? 0;
  const _outputToks = json.usage?.completion_tokens ?? 0;
  recordLLMCost(provider.id, _inputToks, _outputToks);
  return {
    content,
    toolCalls: rawToolCalls,
    finishReason,
    usage: {
      promptTokens: _inputToks,
      completionTokens: _outputToks,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
  };
}
// ─── Streaming Completion ───────────────────────────────────────────────────

export async function* streamChatCompletion(
  messages: ChatMessage[],
  options?: {
    tools?: ToolDefinition[];
    toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  },
): AsyncGenerator<LLMStreamChunk> {
  const provider = ensureProviderInitialized();
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature: options?.temperature ?? provider.temperature ?? 0.7,
    // v5.68: Use provider.maxTokens (model's actual output limit) instead of hardcoded 4096
    // v5.68: Clamp to [1000, 32768] — prevents API 400 "invalid max_tokens" error
    max_tokens: Math.min(32768, Math.max(1000, options?.maxTokens ?? provider.maxTokens ?? 32768)),
    stream: true,
  };

  if (options?.tools && options.tools.length > 0 && provider.supportsTools) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...provider.headers,
  };

  const resp = await fetch(provider.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    yield { type: "error", text: `LLM API error ${resp.status}: ${errText}` };
    return;
  }

  const reader = resp.body?.getReader();
  if (!reader) {
    yield { type: "error", text: "No response body" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const accumulatedToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          // Emit accumulated tool calls if any
          if (accumulatedToolCalls.size > 0) {
            const toolCalls: ToolCall[] = Array.from(accumulatedToolCalls.values()).map(tc => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            }));
            yield { type: "tool_calls", toolCalls };
          }
          yield { type: "done", finishReason: "stop" };
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;

          if (delta?.content) {
            yield { type: "text", text: delta.content };
          }

          // Accumulate tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!accumulatedToolCalls.has(idx)) {
                accumulatedToolCalls.set(idx, { id: tc.id ?? "", name: "", args: "" });
              }
              const acc = accumulatedToolCalls.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
            }
          }

          if (finishReason) {
            if ((finishReason === "tool_calls" || finishReason === "length") && accumulatedToolCalls.size > 0) {
              // v5.85: Repair any tool call whose arguments JSON was truncated mid-stream.
              // This mirrors the non-streaming repair in chatCompletion() above.
              // When finish_reason=="length", the last tool call's args may be incomplete JSON.
              const isIncompleteJsonStream = (s: string): boolean => {
                try { JSON.parse(s); return false; } catch { return true; }
              };
              const repairedCalls = new Map(accumulatedToolCalls);
              const callEntries = Array.from(repairedCalls.entries());
              const lastIdx = callEntries[callEntries.length - 1]?.[0];
              if (finishReason === "length" && lastIdx !== undefined) {
                const lastEntry = repairedCalls.get(lastIdx)!;
                if (isIncompleteJsonStream(lastEntry.args)) {
                  // Attempt repair via a continuation request
                  try {
                    const repairHeaders: Record<string, string> = {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${provider.apiKey}`,
                      ...provider.headers,
                    };
                    const repairBody: Record<string, unknown> = {
                      model: provider.model,
                      messages: [
                        ...messages,
                        {
                          role: "user" as const,
                          content: `Your previous tool call for '${lastEntry.name}' was cut off mid-JSON during streaming. Complete ONLY the truncated JSON arguments. Start exactly where it was cut off (do not repeat anything). The incomplete arguments end with: ...${lastEntry.args.slice(-300)}`,
                        },
                      ],
                      temperature: 0,
                      max_tokens: Math.min(32768, Math.max(1000, options?.maxTokens ?? provider.maxTokens ?? 32768)),
                      stream: false,
                    };
                    const repairResp = await fetch(provider.apiUrl, {
                      method: "POST",
                      headers: repairHeaders,
                      body: JSON.stringify(repairBody),
                      signal: options?.signal,
                    });
                    if (repairResp.ok) {
                      const repairJson = (await repairResp.json()) as any;
                      const repairContent: string = repairJson.choices?.[0]?.message?.content ?? "";
                      if (repairContent) {
                        const repairedArgs = lastEntry.args + repairContent.trim();
                        if (!isIncompleteJsonStream(repairedArgs)) {
                          repairedCalls.set(lastIdx, { ...lastEntry, args: repairedArgs });
                          console.log(`[llmProvider] v5.85: Repaired truncated streaming tool-call args for '${lastEntry.name}' (+${repairContent.length} chars)`);
                        }
                      }
                    }
                  } catch (err) { log.caught("non-fatal — yield what we have", err); }
                }
              }
              const toolCalls: ToolCall[] = Array.from(repairedCalls.values()).map(tc => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
              }));
              yield { type: "tool_calls", toolCalls };
            }
            yield {
              type: "done",
              finishReason,
              usage: parsed.usage
                ? {
                    promptTokens: parsed.usage.prompt_tokens ?? 0,
                    completionTokens: parsed.usage.completion_tokens ?? 0,
                    totalTokens: parsed.usage.total_tokens ?? 0,
                  }
                : undefined,
            };
            return;
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Background / Daemon LLM Provider (v6.16) ──────────────────────────────
// Background daemons (CapabilityDiscovery, ContinuousImprover, RecursiveGoals,
// AutoGoalSuggester, selfImprove, etc.) MUST use this instead of chatCompletion()
// or simpleChatCompletion(). Those functions use the active user-facing provider
// (OpenRouter/Claude Opus at ~$15/M tokens). Background tasks should use
// DeepSeek (~$0.14/M input) or Gemini Flash (~$0.10/M) instead.
//
// Priority: DeepSeek → Gemini Flash via OpenRouter → active provider (last resort)

/**
 * Returns the LLM provider configuration used for background/cheap analysis tasks.
 * Defaults to DeepSeek for cost efficiency. Falls back to the active provider if unavailable.
 */
export function getBackgroundProvider(): LLMProviderConfig {
  // v10.5.2: Ollama (local, free, zero-cost) — preferred for RSI background cycles
  // when OLLAMA_BASE_URL is set. On RTX 3060 8GB, use qwen2.5-coder:7b (~4.7GB VRAM).
  // Set OLLAMA_BASE_URL=http://localhost:11434 and OLLAMA_MODEL=qwen2.5-coder:7b in .env.local
  const ollamaUrl = process.env.OLLAMA_BASE_URL;
  if (ollamaUrl) {
    const ollamaModel = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
    return {
      id: "ollama",
      name: "Ollama (Local — Free)",
      apiUrl: ollamaUrl.replace(/\/$/, "") + "/v1/chat/completions",
      model: ollamaModel,
      apiKey: "ollama",  // Ollama doesn't require a real API key
      maxTokens: 4096,
      temperature: 0.4,
      supportsTools: false,
      supportsVision: false,
      supportsStreaming: false,
    };
  }
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    return {
      ...DEFAULT_PROVIDERS.deepseek,
      apiKey: deepseekKey,
      model: "deepseek-chat",  // v6.17: correct short-form model ID for DeepSeek direct API
      maxTokens: 4096,
    };
  }
  // Fallback: Gemini Flash via OpenRouter — very cheap, fast
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    return {
      ...DEFAULT_PROVIDERS["openrouter-fast"],
      apiKey: openrouterKey,
      maxTokens: 4096,
    };
  }
  // Last resort: active user provider (should not happen if keys are configured)
  return ensureProviderInitialized();
}

/**
 * backgroundChatCompletion — like chatCompletion() but always routes through
 * the cheap background provider (DeepSeek or Gemini Flash).
 * Use in ALL background daemons instead of chatCompletion().
 */
export async function backgroundChatCompletion(
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<LLMCompletionResult> {
  const provider = getBackgroundProvider();
  // v8.2.0 FIX: DeepSeek-reasoner only allows temperature=1.
  // deepseek-chat supports 0-2, but we use 1 as a safe universal default
  // that works across all DeepSeek model variants.
  const isDeepSeekReasoner = provider.model === "deepseek-reasoner";
  const rawTemp = options?.temperature ?? 0.7;
  const temperature = isDeepSeekReasoner ? 1 : rawTemp;
  const body: Record<string, unknown> = {
    model: provider.model,
    messages,
    temperature,
    max_tokens: Math.min(8192, Math.max(500, options?.maxTokens ?? 2000)),
    stream: false,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
    ...(provider.headers ?? {}),
  };
  const resp = await fetch(provider.apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Background LLM API error ${resp.status}: ${errText}`);
  }
  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
    const choice = data.choices?.[0];
  // v6.22: Record cost of this background call
  const _bgInputToks = data.usage?.prompt_tokens ?? 0;
  const _bgOutputToks = data.usage?.completion_tokens ?? 0;
  recordLLMCost(provider.id, _bgInputToks, _bgOutputToks);
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? "stop",
    usage: {
      promptTokens: _bgInputToks,
      completionTokens: _bgOutputToks,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  };
}
/**
 * backgroundSimpleCompletion — drop-in for simpleChatCompletion() that routes
 * through the cheap background provider. Use in all background daemons.
 */
export async function backgroundSimpleCompletion(
  messages: Array<{ role: string; content: string }>,
  options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<string> {
  const result = await backgroundChatCompletion(
    messages as ChatMessage[],
    { maxTokens: options?.maxTokens ?? 2000, temperature: options?.temperature ?? 0.4, signal: options?.signal },
  );
  if (!result.content) throw new Error("backgroundSimpleCompletion: no content returned");
  return result.content.trim();
}

// ─── Simple Chat Helper (v5.93) ──────────────────────────────────────────────
// A lightweight wrapper around chatCompletion() for internal modules that
// previously called the DeepSeek API directly. Using this function ensures
// all internal calls respect the active provider (Claude, OpenRouter, etc.)
// instead of being hardcoded to DeepSeek.
//
// Drop-in replacement for:
//   fetch("https://api.deepseek.com/v1/chat/completions", { ... model: "deepseek-chat" })
//
// Usage:
//   const text = await simpleChatCompletion(messages, { maxTokens: 2000, temperature: 0.3 });

/**
 * Simplified chat completion that returns just the response text string.
 * Convenience wrapper around `chatCompletion` for single-turn interactions.
 * @param messages Array of chat messages
 * @param options Optional override for model, temperature, and max tokens
 * @returns The assistant's response as a plain string
 */
export async function simpleChatCompletion(
  messages: Array<{ role: string; content: string }>,
  options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal; providerId?: string; plainText?: boolean },
): Promise<string> {
  const result = await chatCompletion(
    messages as ChatMessage[],
    {
      maxTokens: options?.maxTokens ?? 4000,
      temperature: options?.temperature ?? 0.4,
      signal: options?.signal,
      providerId: options?.providerId,
      plainText: options?.plainText,
    },
  );
  // LLMCompletionResult has { content: string | null, toolCalls, finishReason, usage }
  if (result.content === null || result.content === undefined) {
    throw new Error("simpleChatCompletion: no content returned");
  }
  return result.content.trim();
}
