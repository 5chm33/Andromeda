/**
 * Andromeda v5.31 — Tiered Context Manager
 *
 * Replaces the naive "greedy prefix" approach to context assembly with a
 * priority-based system that ensures critical messages are never dropped.
 *
 * Priority tiers (highest to lowest):
 * 1. System prompt (always included)
 * 2. Current user message (always included)
 * 3. Recent tool results (last 3)
 * 4. Recent conversation (last 5 exchanges)
 * 5. Older tool results (summarized)
 * 6. Older conversation history (summarized)
 *
 * Also provides truncation detection → auto-retry → model escalation.
 */

import { getContextWindow, getMaxOutputTokens } from "./modelRegistry";
import { allocateTokens, recordUsage } from "./tokenBudgetManager";
import { inferComplexitySignals, calculateAdaptivePartitions } from "./adaptivePartitions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  priority?: number; // 1 = highest, 6 = lowest
  tokenEstimate?: number;
}

export interface ContextBudget {
  totalTokens: number;
  reservedForOutput: number;
  availableForInput: number;
  tierAllocations: Record<number, number>;
}

export interface TruncationRecoveryResult {
  recovered: boolean;
  method: "retry" | "escalate" | "chunk" | "none";
  newModel?: string;
  retryCount: number;
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

const AVG_CHARS_PER_TOKEN = 3.5;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

// ─── Context Budget Calculator ────────────────────────────────────────────────

export function calculateContextBudget(
  model: string,
  sessionId?: string
): ContextBudget {
  const contextWindow = getContextWindow(model);
  const maxOutput = getMaxOutputTokens(model);

  // v5.32: Integrate with tokenBudgetManager for session-aware budgeting
  let effectiveContextWindow = contextWindow;
  if (sessionId) {
    try {
      const allocation = allocateTokens(sessionId, contextWindow, "response");
      // If budget was capped, reduce our effective window proportionally
      if (allocation.wasCapped) {
        effectiveContextWindow = Math.floor(contextWindow * (allocation.allocated / contextWindow));
      }
    } catch { /* fallback to raw context window */ }
  }

  // Reserve output tokens + 10% safety margin
  const reservedForOutput = Math.min(maxOutput, Math.floor(effectiveContextWindow * 0.3));
  const safetyMargin = Math.floor(effectiveContextWindow * 0.05);
  const availableForInput = effectiveContextWindow - reservedForOutput - safetyMargin;

  // v5.33: Adaptive tier allocations — learn from past usage patterns
  const adaptedWeights = getAdaptiveTierWeights();
  const tierAllocations: Record<number, number> = {
    1: Math.floor(availableForInput * adaptedWeights[1]),
    2: Math.floor(availableForInput * adaptedWeights[2]),
    3: Math.floor(availableForInput * adaptedWeights[3]),
    4: Math.floor(availableForInput * adaptedWeights[4]),
    5: Math.floor(availableForInput * adaptedWeights[5]),
    6: Math.floor(availableForInput * adaptedWeights[6]),
  };

  return { totalTokens: contextWindow, reservedForOutput, availableForInput, tierAllocations };
}

// ─── Priority-Based Message Assembly ──────────────────────────────────────────

export function assembleContext(
  messages: ContextMessage[],
  model: string,
  sessionId?: string
): { assembled: ContextMessage[]; dropped: number; totalTokens: number; warnings: string[] } {
  const budget = calculateContextBudget(model, sessionId);
  const warnings: string[] = [];
  const assembled: ContextMessage[] = [];
  let totalTokens = 0;
  let dropped = 0;

  // v5.68: Use adaptive partitions based on task complexity signals
  const signals = inferComplexitySignals(messages as any[]);
  const adaptiveAllocation = calculateAdaptivePartitions(signals, budget.availableForInput);
  // Override tier allocations with adaptive values
  budget.tierAllocations[3] = adaptiveAllocation.recentToolResults;
  budget.tierAllocations[4] = adaptiveAllocation.recentConversation;
  budget.tierAllocations[5] = adaptiveAllocation.olderToolResults;
  budget.tierAllocations[6] = adaptiveAllocation.olderConversation;

  // Assign default priorities based on role and position
  const prioritized = messages.map((msg, idx) => {
    if (msg.priority) return msg;
    const isLast = idx === messages.length - 1;
    const isRecentTool = msg.role === "tool" && idx >= messages.length - 6;
    const isRecentConvo = (msg.role === "user" || msg.role === "assistant") && idx >= messages.length - 10;

    let priority: number;
    if (msg.role === "system") priority = 1;
    else if (msg.role === "user" && isLast) priority = 2;
    else if (isRecentTool) priority = 3;
    else if (isRecentConvo) priority = 4;
    else if (msg.role === "tool") priority = 5;
    else priority = 6;

    return { ...msg, priority, tokenEstimate: estimateTokens(msg.content) };
  });

  // Sort by priority (stable sort preserves order within same priority)
  const sorted = [...prioritized].sort((a, b) => (a.priority || 6) - (b.priority || 6));

  // Allocate tokens per tier
  const tierUsed: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const msg of sorted) {
    const tier = msg.priority || 6;
    const tokens = msg.tokenEstimate || estimateTokens(msg.content);
    const tierBudget = budget.tierAllocations[tier] || 0;

    if (totalTokens + tokens > budget.availableForInput) {
      // Over total budget — try to summarize if it's a low-priority message
      if (tier >= 5 && msg.content.length > 500) {
        const summarized = summarizeMessage(msg, Math.floor(tierBudget * 0.3));
        const sumTokens = estimateTokens(summarized.content);
        if (totalTokens + sumTokens <= budget.availableForInput) {
          assembled.push(summarized);
          totalTokens += sumTokens;
          tierUsed[tier] += sumTokens;
          continue;
        }
      }
      dropped++;
      continue;
    }

    if (tierUsed[tier] + tokens > tierBudget && tier >= 4) {
      // Tier budget exceeded for low-priority — summarize
      if (msg.content.length > 500) {
        const remaining = tierBudget - tierUsed[tier];
        if (remaining > 100) {
          const summarized = summarizeMessage(msg, remaining);
          const sumTokens = estimateTokens(summarized.content);
          assembled.push(summarized);
          totalTokens += sumTokens;
          tierUsed[tier] += sumTokens;
          continue;
        }
      }
      dropped++;
      continue;
    }

    assembled.push(msg);
    totalTokens += tokens;
    tierUsed[tier] += tokens;
  }

  // Re-sort assembled messages back to original order
  const originalOrder = messages.map(m => m.content.slice(0, 100));
  assembled.sort((a, b) => {
    const aIdx = originalOrder.findIndex(o => a.content.startsWith(o.slice(0, 50)));
    const bIdx = originalOrder.findIndex(o => b.content.startsWith(o.slice(0, 50)));
    return aIdx - bIdx;
  });

  if (dropped > 0) {
    warnings.push(`Dropped ${dropped} messages due to context budget (${totalTokens}/${budget.availableForInput} tokens used)`);
  }

  // v5.32: Record input token usage to tokenBudgetManager
  if (sessionId) {
    try {
      recordUsage(sessionId, totalTokens, 0); // Output tokens recorded later after stream completes
    } catch { /* non-fatal */ }
  }

  return { assembled, dropped, totalTokens, warnings };
}

// ─── Message Summarization ────────────────────────────────────────────────────

function summarizeMessage(msg: ContextMessage, maxTokens: number): ContextMessage {
  const maxChars = maxTokens * Math.floor(AVG_CHARS_PER_TOKEN);
  let summarizedContent: string;

  if (msg.role === "tool") {
    const lines = String(msg.content).split("\n");
    const header = lines.slice(0, 5).join("\n");
    const footer = lines.slice(-5).join("\n");
    const lineCount = lines.length;
    const summarizedLines = Math.max(0, lineCount - 10);
    summarizedContent = `${header}\n\n... [${summarizedLines} lines summarized] ...\n\n${footer}`;
  } else {
    summarizedContent = msg.content + "\n[...truncated]";
  }

  const truncated = summarizedContent.slice(0, maxChars);
  return {
    ...msg,
    content: truncated,
    tokenEstimate: estimateTokens(truncated),
  };
}

// ─── Truncation Recovery Pipeline ─────────────────────────────────────────────

const MODEL_ESCALATION_CHAIN = [
  "deepseek-chat",
  "deepseek-reasoner",
  "claude-3-5-sonnet",
  "claude-3-opus",
];

export interface TruncationRecoveryOptions {
  currentModel: string;
  sessionId: string;
  wasTruncated: boolean;
  outputTokensUsed: number;
  maxOutputTokens: number;
  retryCount?: number;
}

export function planTruncationRecovery(
  options: TruncationRecoveryOptions
): TruncationRecoveryResult {
  const { currentModel, wasTruncated, outputTokensUsed, maxOutputTokens, retryCount = 0 } = options;

  if (!wasTruncated) {
    return { recovered: false, method: "none", retryCount };
  }

  // Strategy 1: If output used >90% of max tokens, retry with higher max_tokens
  if (outputTokensUsed > maxOutputTokens * 0.9 && retryCount < 2) {
    return { recovered: true, method: "retry", retryCount: retryCount + 1 };
  }

  // Strategy 2: Escalate to a model with larger context/output
  const currentIdx = MODEL_ESCALATION_CHAIN.indexOf(currentModel);
  if (currentIdx >= 0 && currentIdx < MODEL_ESCALATION_CHAIN.length - 1) {
    const nextModel = MODEL_ESCALATION_CHAIN[currentIdx + 1];
    return { recovered: true, method: "escalate", newModel: nextModel, retryCount: retryCount + 1 };
  }

  // Strategy 3: Request chunked output
  if (retryCount < 3) {
    return { recovered: true, method: "chunk", retryCount: retryCount + 1 };
  }

  return { recovered: false, method: "none", retryCount };
}

// ─── v5.33: Adaptive Tier Weight Learning ──────────────────────────────────────

// Default weights
const DEFAULT_TIER_WEIGHTS: Record<number, number> = {
  1: 0.15, 2: 0.20, 3: 0.25, 4: 0.20, 5: 0.10, 6: 0.10,
};

// Track actual usage per tier over recent assemblies
const tierUsageHistory: Array<Record<number, number>> = [];
const MAX_USAGE_HISTORY = 50;

/**
 * Record actual tier usage after assembly for adaptive learning.
 */
export function recordTierUsage(tierUsage: Record<number, number>, totalUsed: number): void {
  if (totalUsed <= 0) return;
  // Normalize to fractions
  const normalized: Record<number, number> = {};
  for (let t = 1; t <= 6; t++) {
    normalized[t] = (tierUsage[t] || 0) / totalUsed;
  }
  tierUsageHistory.push(normalized);
  if (tierUsageHistory.length > MAX_USAGE_HISTORY) tierUsageHistory.shift();
}

/**
 * Calculate adaptive tier weights based on recent usage patterns.
 * If a tier consistently uses more than its allocation, increase it.
 * If a tier consistently underuses, decrease it and redistribute.
 */
function getAdaptiveTierWeights(): Record<number, number> {
  if (tierUsageHistory.length < 5) return { ...DEFAULT_TIER_WEIGHTS };

  // Average actual usage over recent history
  const avgUsage: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const usage of tierUsageHistory) {
    if (!usage) continue;
    for (let t = 1; t <= 6; t++) {
      avgUsage[t] += usage[t] || 0;
    }
  }
  for (let t = 1; t <= 6; t++) {
    avgUsage[t] /= tierUsageHistory.length;
  }

  // Blend default weights with actual usage (70% default, 30% actual)
  const blended: Record<number, number> = {};
  let total = 0;
  for (let t = 1; t <= 6; t++) {
    blended[t] = DEFAULT_TIER_WEIGHTS[t] * 0.7 + avgUsage[t] * 0.3;
    // Enforce minimum allocation per tier
    blended[t] = Math.max(blended[t], 0.05);
    total += blended[t];
  }

  // Normalize to sum to 1.0
  for (let t = 1; t <= 6; t++) {
    blended[t] /= total;
  }

  return blended;
}

// ─── v5.50: Context Isolate — Per-Task Context Partitioning ─────────────────────
//
// Implements the "Isolate" strategy from context engineering (2025):
// each task/agent run gets its own isolated context partition.
// A hallucination or error in one step cannot pollute subsequent steps.
// Reference: Building Natural Language and LLM Pipelines (Funderburk, 2025), Ch.2

interface IsolatedContext {
  taskId: string;
  createdAt: number;
  lastUsed: number;
  messages: ContextMessage[];
  metadata: {
    taskType?: string;
    parentTaskId?: string;
    sealed: boolean; // Once sealed, no new messages can be added
  };
}

const isolatedContexts = new Map<string, IsolatedContext>();
const MAX_ISOLATED_CONTEXTS = 50;
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Create a new isolated context partition for a task.
 * Returns a taskId that must be passed to all subsequent context operations.
 */
export function createIsolatedContext(
  taskId: string,
  options?: { taskType?: string; parentTaskId?: string }
): string {
  if (typeof taskId !== 'string' || taskId.trim().length === 0) {
    throw new Error('taskId must be a non-empty string');
  }
  // Evict expired contexts
  const now = Date.now();
  for (const [id, ctx] of Array.from(isolatedContexts.entries())) {
    if (now - ctx.lastUsed > CONTEXT_TTL_MS) {
      isolatedContexts.delete(id);
    }
  }
  // Evict oldest if at capacity
  if (isolatedContexts.size >= MAX_ISOLATED_CONTEXTS) {
    const oldest = Array.from(isolatedContexts.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest) isolatedContexts.delete(oldest[0]);
  }
  const ctx: IsolatedContext = {
    taskId,
    createdAt: now,
    lastUsed: now,
    messages: [],
    metadata: {
      taskType: options?.taskType,
      parentTaskId: options?.parentTaskId,
      sealed: false,
    },
  };
  isolatedContexts.set(taskId, ctx);
  return taskId;
}

/**
 * Append a message to an isolated context partition.
 * Silently ignores writes to sealed contexts (prevents cross-contamination).
 */
export function appendToIsolatedContext(taskId: string, message: ContextMessage): boolean {
  const ctx = isolatedContexts.get(taskId);
  if (!ctx || ctx.metadata.sealed) return false;
  ctx.messages.push(message);
  ctx.lastUsed = Date.now();
  return true;
}

/**
 * Get all messages in an isolated context, optionally filtered by role.
 * Returns a defensive copy — callers cannot mutate the stored context.
 */
export function getIsolatedContext(
  taskId: string,
  filterRoles?: Array<"system" | "user" | "assistant" | "tool">
): ContextMessage[] {
  const ctx = isolatedContexts.get(taskId);
  if (!ctx) return [];
  ctx.lastUsed = Date.now();
  const messages = filterRoles
    ? ctx.messages.filter(m => filterRoles.includes(m.role))
    : ctx.messages;
  return messages.map(m => ({ ...m })); // defensive copy
}

/**
 * Seal an isolated context — no new messages can be added.
 * Use this when a task step is complete to prevent later steps from
 * accidentally polluting the context of a finished step.
 */
export function sealIsolatedContext(taskId: string): void {
  const ctx = isolatedContexts.get(taskId);
  if (ctx) ctx.metadata.sealed = true;
}

/**
 * Merge a child context into a parent context, applying Compress:
 * only the final assistant message and any critical tool results
 * are carried forward, discarding intermediate chain-of-thought.
 */
export function mergeIsolatedContext(
  childTaskId: string,
  parentTaskId: string,
  options?: { includeToolResults?: boolean; maxMessages?: number }
): boolean {
  const child = isolatedContexts.get(childTaskId);
  const parent = isolatedContexts.get(parentTaskId);
  if (!child || !parent || parent.metadata.sealed) return false;

  const maxMessages = options?.maxMessages ?? 3;
  const includeTools = options?.includeToolResults ?? false;

  // Compress: only keep the last N assistant messages and optionally tool results
  const toMerge = child.messages
    .filter(m => m.role === "assistant" || (includeTools && m.role === "tool"))
    .slice(-maxMessages);

  for (const msg of toMerge) {
    parent.messages.push({
      ...msg,
      // Tag merged messages so the assembler can deprioritize them
      priority: (msg.priority ?? 4) + 1,
    });
  }
  parent.lastUsed = Date.now();
  return true;
}

/**
 * Delete an isolated context when the task is fully complete.
 */
export function deleteIsolatedContext(taskId: string): void {
  isolatedContexts.delete(taskId);
}

export function getIsolatedContextStats() {
  return {
    activeContexts: isolatedContexts.size,
    contextIds: Array.from(isolatedContexts.keys()),
    sealedCount: Array.from(isolatedContexts.values()).filter(c => c.metadata.sealed).length,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

let totalAssemblies = 0;
let totalDropped = 0;
let totalRecoveries = 0;

export function getContextManagerStats() {
  return {
    totalAssemblies,
    totalDropped,
    totalRecoveries,
    avgDropRate: totalAssemblies > 0 ? (totalDropped / totalAssemblies).toFixed(3) : "0",
    adaptiveWeights: getAdaptiveTierWeights(),
    usageHistorySize: tierUsageHistory.length,
  };
}

export function recordAssembly(dropped: number): void {
  totalAssemblies++;
  totalDropped += dropped;
}

export function recordRecovery(): void {
  totalRecoveries++;
}
