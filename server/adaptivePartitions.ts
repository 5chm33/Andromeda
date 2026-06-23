/**
 * adaptivePartitions.ts — Andromeda v5.68
 *
 * Dynamic context partition sizing based on task complexity signals.
 * Replaces fixed-size partitions with intelligent allocation that adapts
 * to the current workload.
 *
 * Signals used for sizing:
 *  1. Number of tool calls in the current task (more tools = more context needed)
 *  2. Average tool output size (large outputs need more partition space)
 *  3. Task type classification (coding > analysis > chat)
 *  4. Historical partition overflow rate per task type
 *
 * Integration: Called by tieredContextManager.assembleContext() to get
 * dynamic tier allocations instead of static weights.
 */

import { estimateTokens } from "./contextManager";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskComplexitySignals {
  toolCallCount: number;
  averageToolOutputTokens: number;
  taskType: "coding" | "analysis" | "search" | "chat" | "self-improvement" | "unknown";
  conversationTurns: number;
  hasFileOperations: boolean;
  hasCodeExecution: boolean;
}

export interface PartitionAllocation {
  systemPrompt: number;      // Tier 1 — always fixed
  currentQuery: number;      // Tier 2 — always fixed
  recentToolResults: number; // Tier 3 — dynamic
  recentConversation: number; // Tier 4 — dynamic
  olderToolResults: number;  // Tier 5 — dynamic
  olderConversation: number; // Tier 6 — dynamic
  totalAvailable: number;
}

// ─── Complexity Profiles ────────────────────────────────────────────────────

const COMPLEXITY_PROFILES: Record<string, Record<number, number>> = {
  coding: {
    1: 0.10, 2: 0.15, 3: 0.35, 4: 0.15, 5: 0.15, 6: 0.10,
  },
  analysis: {
    1: 0.10, 2: 0.15, 3: 0.30, 4: 0.20, 5: 0.15, 6: 0.10,
  },
  search: {
    1: 0.10, 2: 0.20, 3: 0.25, 4: 0.20, 5: 0.15, 6: 0.10,
  },
  chat: {
    1: 0.10, 2: 0.20, 3: 0.10, 4: 0.35, 5: 0.05, 6: 0.20,
  },
  "self-improvement": {
    1: 0.10, 2: 0.10, 3: 0.40, 4: 0.10, 5: 0.20, 6: 0.10,
  },
  unknown: {
    1: 0.15, 2: 0.20, 3: 0.25, 4: 0.20, 5: 0.10, 6: 0.10,
  },
};

// ─── Historical Learning ────────────────────────────────────────────────────

interface OverflowRecord {
  taskType: string;
  tier: number;
  overflowAmount: number;
  timestamp: number;
}

const overflowHistory: OverflowRecord[] = [];
const MAX_OVERFLOW_HISTORY = 200;

export function recordPartitionOverflow(taskType: string, tier: number, overflowAmount: number): void {
  overflowHistory.push({ taskType, tier, overflowAmount, timestamp: Date.now() });
  if (overflowHistory.length > MAX_OVERFLOW_HISTORY) overflowHistory.shift();
}

// ─── Core Allocation Logic ──────────────────────────────────────────────────

/**
 * Calculate dynamic partition allocation based on task complexity signals.
 * Returns per-tier token budgets that sum to availableTokens.
 */
export function calculateAdaptivePartitions(
  signals: TaskComplexitySignals,
  availableTokens: number
): PartitionAllocation {
  // Start with the base profile for this task type
  const baseProfile = COMPLEXITY_PROFILES[signals.taskType] || COMPLEXITY_PROFILES.unknown;
  const weights = { ...baseProfile };

  // Adjustment 1: If many tool calls, expand tier 3 (recent tool results) and tier 5 (older tool results)
  if (signals.toolCallCount > 5) {
    const boost = Math.min(0.15, signals.toolCallCount * 0.01);
    weights[3] += boost;
    weights[5] += boost * 0.5;
    weights[6] -= boost * 0.75;
    weights[4] -= boost * 0.75;
  }

  // Adjustment 2: If tool outputs are large, expand tier 3 further
  if (signals.averageToolOutputTokens > 500) {
    const boost = Math.min(0.10, (signals.averageToolOutputTokens - 500) / 5000);
    weights[3] += boost;
    weights[6] -= boost;
  }

  // Adjustment 3: If long conversation, expand tier 4 (recent conversation)
  if (signals.conversationTurns > 10) {
    const boost = Math.min(0.10, (signals.conversationTurns - 10) * 0.005);
    weights[4] += boost;
    weights[5] -= boost * 0.5;
    weights[6] -= boost * 0.5;
  }

  // Adjustment 4: Learn from historical overflows
  const recentOverflows = overflowHistory.filter(
    r => r.taskType === signals.taskType && Date.now() - r.timestamp < 3600_000
  );
  for (const overflow of recentOverflows) {
    weights[overflow.tier] += 0.02;
    // Steal from lowest-priority tier
    weights[6] -= 0.02;
  }

  // Normalize weights to sum to 1.0 and enforce minimums
  let total = 0;
  for (let t = 1; t <= 6; t++) {
    weights[t] = Math.max(weights[t], 0.03); // Minimum 3% per tier
    total += weights[t];
  }
  for (let t = 1; t <= 6; t++) {
    weights[t] /= total;
  }

  return {
    systemPrompt: Math.floor(availableTokens * weights[1]),
    currentQuery: Math.floor(availableTokens * weights[2]),
    recentToolResults: Math.floor(availableTokens * weights[3]),
    recentConversation: Math.floor(availableTokens * weights[4]),
    olderToolResults: Math.floor(availableTokens * weights[5]),
    olderConversation: Math.floor(availableTokens * weights[6]),
    totalAvailable: availableTokens,
  };
}

/**
 * Infer task complexity signals from a message array.
 * Used when explicit signals are not available.
 */
export function inferComplexitySignals(
  messages: Array<{ role: string; content: string; tool_calls?: unknown[] }>
): TaskComplexitySignals {
  let toolCallCount = 0;
  let totalToolOutputTokens = 0;
  let toolOutputCount = 0;
  let hasFileOperations = false;
  let hasCodeExecution = false;
  let conversationTurns = 0;

  for (const msg of messages) {
    if (msg.role === "user") conversationTurns++;
    if (msg.role === "assistant" && msg.tool_calls) {
      toolCallCount += (msg.tool_calls as unknown[]).length;
    }
    if (msg.role === "tool") {
      const tokens = estimateTokens(msg.content || "");
      totalToolOutputTokens += tokens;
      toolOutputCount++;
      const content = (msg.content || "").toLowerCase();
      if (content.includes("file") || content.includes("write") || content.includes("read")) {
        hasFileOperations = true;
      }
      if (content.includes("executed") || content.includes("output:") || content.includes("exit code")) {
        hasCodeExecution = true;
      }
    }
  }

  // Classify task type
  let taskType: TaskComplexitySignals["taskType"] = "unknown";
  if (hasCodeExecution || hasFileOperations) taskType = "coding";
  else if (toolCallCount > 3) taskType = "analysis";
  else if (messages.some(m => m.content?.includes("search") || m.content?.includes("find"))) taskType = "search";
  else if (conversationTurns > 5 && toolCallCount < 2) taskType = "chat";

  // Check for self-improvement signals
  if (messages.some(m => m.content?.includes("self_write_file") || m.content?.includes("self_patch"))) {
    taskType = "self-improvement";
  }

  return {
    toolCallCount,
    averageToolOutputTokens: toolOutputCount > 0 ? Math.floor(totalToolOutputTokens / toolOutputCount) : 0,
    taskType,
    conversationTurns,
    hasFileOperations,
    hasCodeExecution,
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export function getAdaptivePartitionStats() {
  return {
    overflowHistorySize: overflowHistory.length,
    recentOverflows: overflowHistory.filter(r => Date.now() - r.timestamp < 3600_000).length,
    profiles: Object.keys(COMPLEXITY_PROFILES),
  };
}
