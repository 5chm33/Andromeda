/**
 * aiTokens.ts — v6.25
 * Accurate BPE token counting and model/provider helper functions.
 * Extracted from ai.ts (god-module split).
 */
import { encodingForModel, getEncoding } from "js-tiktoken";
import { getActiveProvider } from "./llmProvider.js";
import { getContextWindow, getMaxOutputTokens } from "./modelRegistry.js";
import { allocateTokens, canFitResponse, recordUsage } from "./tokenBudgetManager.js";
import { assembleContext, recordAssembly, type ContextMessage } from "./tieredContextManager.js";
import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
const log = createLogger("aiTokens");

// ─── Accurate Token Counting ─────────────────────────────────────────────────
// v5.34: Replace character-based heuristic with proper BPE tokenization.
// v6.00: Upgraded from single-slot cache to 5-slot LRU map (Kimi audit).
// Falls back to improved heuristic (3.2 chars/token for code, 4 for prose) if
// the model isn't recognized by tiktoken.
const _encoderLRU = new Map<string, ReturnType<typeof getEncoding>>();
const ENCODER_LRU_MAX = 5;

function getEncoderCached(model: string): ReturnType<typeof getEncoding> {
  if (_encoderLRU.has(model)) {
    const enc = _encoderLRU.get(model)!;
    _encoderLRU.delete(model); // Move to end (most recently used)
    _encoderLRU.set(model, enc);
    return enc;
  }
  if (_encoderLRU.size >= ENCODER_LRU_MAX) {
    _encoderLRU.delete(_encoderLRU.keys().next().value!); // Evict LRU
  }
  try {
    const enc = encodingForModel(model as any);
    _encoderLRU.set(model, enc);
    return enc;
  } catch {
    const enc = getEncoding("cl100k_base");
    _encoderLRU.set(model, enc);
    return enc;
  }
}

function countTokens(text: string, model?: string): number {
  try {
    return getEncoderCached(model || "gpt-4").encode(text).length;
  } catch {
    // Ultimate fallback: improved heuristic
    // Code averages ~3.2 chars/token, prose ~4.0
    const codeRatio = (text.match(/[{}()\[\];=<>]/g)?.length || 0) / Math.max(text.length, 1);
    const charsPerToken = codeRatio > 0.02 ? 3.2 : 4.0;
    return Math.ceil(text.length / charsPerToken);
  }
}

// ─── ANDROMEDA.md Memory Injection (Claude Code-style project memory) ─────────
// Reads ANDROMEDA.md from the workspace root and injects it into every system
// prompt. This gives Andromeda persistent project-level context across sessions,
// similar to how Claude Code uses CLAUDE.md files.
export function getAndromedaMemory(): string {
  try {
    const workspaceRoot = process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace");
    const candidates = [
      path.join(workspaceRoot, "ANDROMEDA.md"),
      path.join(process.cwd(), "ANDROMEDA.md"),
      path.join(process.cwd(), ".andromeda", "memory.md"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, "utf-8").trim();
        if (content) {
          // v5.35: Dynamic memory limit based on model context window (10% of context)
          const memLimit = Math.max(8000, Math.floor(getContextWindow(getActiveModel()) * 4 * 0.10));
          return `\n\n## Project Memory (ANDROMEDA.md)\n${content.slice(0, memLimit)}`;
        }
      }
    }
  } catch (err) { log.caught("ignore — memory file is optional", err); }
  return "";
}

// v5.14: Fully configurable LLM provider and model via environment variables
// Supports DeepSeek, OpenAI-compatible APIs, and custom endpoints
// v6.13: Lazy provider resolution — routes through getActiveProvider() for non-DeepSeek providers

const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat";
const REASONING_MODEL = process.env.LLM_REASONING_MODEL || "deepseek-reasoner";
const _FALLBACK_API_URL = process.env.DEEPSEEK_API_URL || process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions";

// v6.15.3: Dynamic provider resolution — always reads from getActiveProvider() per request.
// Replaces the broken "resolve once and cache" pattern that broke tier switching.
/** Get the current API URL — always reads from active provider so tier switches work. */
export function getApiUrl(): string {
  try { const p = getActiveProvider(); return p?.apiUrl || _FALLBACK_API_URL; } catch { return _FALLBACK_API_URL; }
}
/** Get the current model name — always reads from active provider so tier switches work. */
export function getActiveModel(): string {
  try { const p = getActiveProvider(); return p?.model || DEEPSEEK_MODEL; } catch { return DEEPSEEK_MODEL; }
}
/** @deprecated no-op — replaced by dynamic reads in v6.15.3 */
export function resolveProviderOnce(): void { /* no-op */ }

// v6.15.3: Always read from active provider — supports tier switching (Code/Max/Fast/Auto)
export function getApiKey(): string {
  try {
    const provider = getActiveProvider();
    if (provider?.apiKey) return provider.apiKey;
  } catch { /* fallback */ }
  return process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "";
}
// v6.15.3: Always read from active provider — supports tier switching
export function getProviderHeaders(): Record<string, string> {
  try {
    const provider = getActiveProvider();
    if (provider?.headers) return { ...provider.headers };
  } catch { /* fallback */ }
  return {};
}

// v5.25: Unified token budget system — single authority on output token limits
// v5.26: Now model-aware — uses modelRegistry.getContextWindow() + getMaxOutputTokens()
const LLM_MAX_OUTPUT_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "32000");
// v5.34: Proportional safety buffer — scales with context window instead of fixed 2000
function getSafetyBuffer(contextLimit: number): number {
  return Math.min(2000, Math.floor(contextLimit * 0.05)); // 5% or 2000, whichever is smaller
}

export function calculateMaxTokens(messages: Array<{ role: string; content: any }>, sessionId?: string): number {
  // v5.26: Model-aware context window — consult modelRegistry instead of hardcoded value
  let contextLimit = 131072; // fallback
  let modelMaxOutput = LLM_MAX_OUTPUT_TOKENS; // fallback
  try {
    // v5.29: Using static imports
    try {
      contextLimit = getContextWindow(getActiveModel());
    } catch (err) { log.caught("operation", err); }
    try {
      modelMaxOutput = getMaxOutputTokens(getActiveModel());
    } catch (err) { log.caught("operation", err); }
  } catch (err) {
    console.warn("[ai.ts] modelRegistry unavailable, using defaults:", (err as Error).message);
  }

  const effectiveMaxOutput = Math.min(modelMaxOutput, LLM_MAX_OUTPUT_TOKENS);

  // v5.34: Proper token counting with js-tiktoken instead of char/4 heuristic
  const totalInputText = messages.reduce((acc, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + content;
  }, "");
  const inputTokens = countTokens(totalInputText, getActiveModel());
  const safetyBuffer = getSafetyBuffer(contextLimit);
  const contextAvailable = contextLimit - inputTokens - safetyBuffer;

  // v5.26: Consult tokenBudgetManager for session-aware allocation (85% rule)
  let budgetAllocation = effectiveMaxOutput;
  try {
    // v5.29: Using static import for tokenBudgetManager
    if (allocateTokens) {
      const allocation = allocateTokens(sessionId || "global", effectiveMaxOutput, "response");
      budgetAllocation = allocation.allocated;
      if (allocation.warningLevel === "critical") {
        console.warn(`[ai.ts] Token budget CRITICAL for session ${sessionId}: ${allocation.message}`);
      }
    }
  } catch (err) {
    // tokenBudgetManager not available — fall back to raw calculation
    console.warn("[ai.ts] tokenBudgetManager unavailable:", (err as Error).message);
  }

  // Enforce: min(budgetManager.allocation, contextLimit - inputTokens - reserve)
  // Floor at 4000 tokens to ensure meaningful responses even under pressure
  return Math.min(
    Math.max(Math.min(contextAvailable, budgetAllocation), 4000),
    effectiveMaxOutput
  );
}

let DEEPSEEK_MODEL = DEFAULT_MODEL;
export function setModel(model: string) {
  // v6.15: If LLM_MODEL env routes to a non-DeepSeek provider (e.g. openrouter),
  // ignore frontend model overrides — the active provider handles model selection.
  const envModel = process.env.LLM_MODEL ?? "";
  const isDeepSeekOverride = !envModel || envModel === "deepseek" || envModel === "deepseek-chat" || envModel === "deepseek-v3";
  if (isDeepSeekOverride) {
    DEEPSEEK_MODEL = model;
  }
  // If using OpenRouter/other provider, resolveProviderOnce() already set the correct model.
}
export function getModel(): string {
  return DEEPSEEK_MODEL;
}
export function getAvailableModels(): Array<{ id: string; name: string; type: string }> {
  const models = [
    { id: DEFAULT_MODEL, name: DEFAULT_MODEL, type: "standard" },
  ];
  if (REASONING_MODEL !== DEFAULT_MODEL) {
    models.push({ id: REASONING_MODEL, name: REASONING_MODEL, type: "reasoning" });
  }
  // Add any custom models from env
  const customModels = process.env.LLM_CUSTOM_MODELS?.split(",").filter(Boolean) || [];
  for (const m of customModels) {
    models.push({ id: m.trim(), name: m.trim(), type: "custom" });
  }
  return models;
}

