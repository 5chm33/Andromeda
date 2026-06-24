/**
 * contextAwareness.ts — v5.33
 *
 * Context Window Awareness Module.
 *
 * Tracks context window usage in real-time and predicts when truncation
 * will occur BEFORE it happens. Provides proactive optimization suggestions.
 *
 * Features:
 * - Real-time context usage tracking
 * - Truncation prediction with confidence scores
 * - Automatic context optimization (summarize, prune, compress)
 * - Usage history for trend analysis
 */

import { getContextWindow, getMaxOutputTokens } from "./modelRegistry";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ContextUsage {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  contextLimit: number;
  usagePercent: number;
  timestamp: number;
}

export interface TruncationPrediction {
  willTruncate: boolean;
  confidence: number;
  currentUsagePercent: number;
  projectedUsagePercent: number;
  suggestedActions: string[];
  urgency: "none" | "low" | "medium" | "high" | "critical";
}

export interface OptimizationResult {
  tokensFreed: number;
  method: string;
  success: boolean;
}

// ─── State ─────────────────────────────────────────────────────────────────────

const AVG_CHARS_PER_TOKEN = 3.5;
const usageHistory: ContextUsage[] = [];
const MAX_HISTORY = 200;

// ─── Token Estimation ──────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

// ─── Usage Tracking ────────────────────────────────────────────────────────────

/**
 * Record current context usage for a session.
 */
export function recordContextUsage(
  sessionId: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): ContextUsage {
  const contextLimit = getContextWindow(model);
  const totalUsed = inputTokens + outputTokens;
  const usagePercent = (totalUsed / contextLimit) * 100;

  const usage: ContextUsage = {
    sessionId,
    model,
    inputTokens,
    outputTokens,
    contextLimit,
    usagePercent,
    timestamp: Date.now(),
  };

  usageHistory.push(usage);
  if (usageHistory.length > MAX_HISTORY) usageHistory.shift();

  return usage;
}

/**
 * Get current context usage for a session.
 */
export function getCurrentUsage(sessionId: string): ContextUsage | null {
  // Find the most recent usage for this session
  for (let i = usageHistory.length - 1; i >= 0; i--) {
    if (usageHistory[i].sessionId === sessionId) {
      return usageHistory[i];
    }
  }
  return null;
}

// ─── Truncation Prediction ─────────────────────────────────────────────────────

/**
 * Predict whether upcoming content will cause truncation.
 */
export function predictTruncation(
  sessionId: string,
  model: string,
  upcomingContent: string
): TruncationPrediction {
  const contextLimit = getContextWindow(model);
  const maxOutput = getMaxOutputTokens(model);
  const upcomingTokens = estimateTokens(upcomingContent);

  // Get current usage
  const current = getCurrentUsage(sessionId);
  const currentUsed = current ? (current.inputTokens + current.outputTokens) : 0;
  const totalNeeded = currentUsed + upcomingTokens + maxOutput;

  const currentUsagePercent = (currentUsed / contextLimit) * 100;
  const projectedUsagePercent = (totalNeeded / contextLimit) * 100;

  const suggestedActions: string[] = [];
  let urgency: TruncationPrediction["urgency"] = "none";
  let willTruncate = false;
  let confidence = 0.95;

  const TRUNCATION_THRESHOLD = 100;
  const HIGH_THRESHOLD = 85;
  const MEDIUM_THRESHOLD = 70;
  const LOW_THRESHOLD = 50;

  if (projectedUsagePercent > TRUNCATION_THRESHOLD) {
    willTruncate = true;
    urgency = "critical";
    confidence = 0.95;
    suggestedActions.push(
      "Summarize conversation history",
      "Prune completed tool call results",
      "Reduce memory context",
      "Split into multiple turns"
    );
  } else if (projectedUsagePercent > HIGH_THRESHOLD) {
    willTruncate = false;
    urgency = "high";
    confidence = 0.8;
    suggestedActions.push(
      "Summarize low-value conversation turns",
      "Compress memory entries",
      "Consider model escalation for larger context"
    );
  } else if (projectedUsagePercent > MEDIUM_THRESHOLD) {
    urgency = "medium";
    confidence = 0.7;
    suggestedActions.push(
      "Monitor context growth",
      "Prepare summarization strategy"
    );
  } else if (projectedUsagePercent > LOW_THRESHOLD) {
    urgency = "low";
    confidence = 0.6;
  }

  return {
    willTruncate,
    confidence,
    currentUsagePercent: Math.round(currentUsagePercent * 10) / 10,
    projectedUsagePercent: Math.round(projectedUsagePercent * 10) / 10,
    suggestedActions,
    urgency,
  };
}

// ─── Context Optimization ──────────────────────────────────────────────────────

/**
 * Optimize context before truncation occurs.
 * Returns the optimized messages array with freed tokens.
 */
function summarizeAssistantMessage(msg: { role: string; content: string }): { content: string; tokensFreed: number } {
  const originalTokens = estimateTokens(msg.content);
  const summary = msg.content.slice(0, 200) + "\n[...earlier response summarized]";
  return { content: summary, tokensFreed: originalTokens - estimateTokens(summary) };
}

function pruneToolResult(msg: { role: string; content: string }): { content: string; tokensFreed: number } {
  const originalTokens = estimateTokens(msg.content);
  const lines = msg.content.split("\n");
  const pruned = lines.slice(0, 3).join("\n") + `\n[...${lines.length - 3} lines pruned]`;
  return { content: pruned, tokensFreed: originalTokens - estimateTokens(pruned) };
}

function summarizeAssistantMessages(optimized: Array<{ role: string; content: string }>, targetTokenReduction: number): { tokensFreed: number; actions: string[] } {
  let tokensFreed = 0;
  const actions: string[] = [];
  for (let i = 0; i < optimized.length - 4 && tokensFreed < targetTokenReduction; i++) {
    if (optimized[i].role === "assistant" && optimized[i].content.length > 500) {
      const { content, tokensFreed: freed } = summarizeAssistantMessage(optimized[i]);
      optimized[i] = { ...optimized[i], content };
      tokensFreed += freed;
      actions.push(`Summarized assistant message at position ${i}`);
    }
  }
  return { tokensFreed, actions };
}

function pruneToolResults(optimized: Array<{ role: string; content: string }>, targetTokenReduction: number): { tokensFreed: number; actions: string[] } {
  let tokensFreed = 0;
  const actions: string[] = [];
  for (let i = 0; i < optimized.length - 6 && tokensFreed < targetTokenReduction; i++) {
    if (optimized[i].role === "tool" && optimized[i].content.length > 1000) {
      const { content, tokensFreed: freed } = pruneToolResult(optimized[i]);
      optimized[i] = { ...optimized[i], content };
      tokensFreed += freed;
      actions.push(`Pruned tool result at position ${i}`);
    }
  }
  return { tokensFreed, actions };
}

function removeRedundantSystemMessages(optimized: Array<{ role: string; content: string }>): { tokensFreed: number; actions: string[] } {
  let tokensFreed = 0;
  const actions: string[] = [];
  const systemIndices = optimized
    .map((m, i) => m.role === "system" ? i : -1)
    .filter(i => i >= 0);
  if (systemIndices.length > 1) {
    for (let j = 0; j < systemIndices.length - 1; j++) {
      const idx = systemIndices[j];
      tokensFreed += estimateTokens(optimized[idx].content);
      optimized[idx] = { role: "system", content: "[earlier system context removed]" };
      actions.push(`Removed redundant system message at position ${idx}`);
    }
  }
  return { tokensFreed, actions };
}

export function optimizeContext(
  messages: Array<{ role: string; content: string }>,
  targetTokenReduction: number
): { optimized: Array<{ role: string; content: string }>; tokensFreed: number; actions: string[] } {
  const optimized = [...messages];
  let tokensFreed = 0;
  const actions: string[] = [];

  const result1 = summarizeAssistantMessages(optimized, targetTokenReduction - tokensFreed);
  tokensFreed += result1.tokensFreed;
  actions.push(...result1.actions);
  if (tokensFreed >= targetTokenReduction) return { optimized, tokensFreed, actions };

  const result2 = pruneToolResults(optimized, targetTokenReduction - tokensFreed);
  tokensFreed += result2.tokensFreed;
  actions.push(...result2.actions);
  if (tokensFreed >= targetTokenReduction) return { optimized, tokensFreed, actions };

  const result3 = removeRedundantSystemMessages(optimized);
  tokensFreed += result3.tokensFreed;
  actions.push(...result3.actions);

  return { optimized, tokensFreed, actions };
}

// ─── Diagnostics ───────────────────────────────────────────────────────────────

export function getContextAwarenessStats(): {
  totalTracked: number;
  averageUsagePercent: number;
  peakUsagePercent: number;
  truncationPredictions: number;
  description: string;
} {
  const recentUsage = usageHistory.slice(-50);
  const avgUsage = recentUsage.length > 0
    ? recentUsage.reduce((s, u) => s + u.usagePercent, 0) / recentUsage.length
    : 0;
  const peakUsage = recentUsage.length > 0
    ? Math.max(...recentUsage.map(u => u.usagePercent))
    : 0;

  return {
    totalTracked: usageHistory.length,
    averageUsagePercent: Math.round(avgUsage * 10) / 10,
    peakUsagePercent: Math.round(peakUsage * 10) / 10,
    truncationPredictions: usageHistory.filter(u => u.usagePercent > 85).length,
    description: "Real-time context window awareness with truncation prediction",
  };
}
