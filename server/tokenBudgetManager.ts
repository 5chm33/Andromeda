/**
 * tokenBudgetManager.ts — v5.24
 * 
 * Centralized token budget management to prevent truncation at every output path.
 * Instead of detecting truncation after it happens, this proactively prevents it
 * by tracking token usage per session and enforcing budgets.
 * 
 * Key principles:
 * - Every output path (stream, file analysis, self-modification) goes through budget allocation
 * - Operates at 85% capacity (sustainable throughput, not max burst)
 * - Pre-emptive warnings at 75% to allow graceful handling
 * - Per-session tracking with automatic cleanup
 */

// ── Configuration ─────────────────────────────────────────────────────────────

interface TokenBudgetConfig {
  /** Total context window size in tokens */
  contextWindow: number;
  /** Reserved tokens for system prompt + tools (20%) */
  reservedRatio: number;
  /** Warning threshold (75% of available) */
  warningThreshold: number;
  /** Hard cap threshold (85% of available — the "85% rule") */
  hardCapThreshold: number;
  /** Maximum output tokens per single response */
  maxOutputTokens: number;
  /** Session timeout in ms (auto-cleanup) */
  sessionTimeoutMs: number;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  contextWindow: 131_072,       // DeepSeek's context window
  reservedRatio: 0.20,          // 20% reserved for system/tools
  warningThreshold: 0.75,       // Warn at 75%
  hardCapThreshold: 0.95,       // v5.45: CEO edition - use 95% of context window
  maxOutputTokens: 32_000,      // Max output per response
  sessionTimeoutMs: 30 * 60 * 1000, // 30 min session timeout
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenBudget {
  total: number;
  reserved: number;
  available: number;
  used: number;
  remaining: number;
  utilizationPercent: number;
}

interface SessionState {
  id: string;
  createdAt: number;
  lastActivity: number;
  inputTokens: number;
  outputTokens: number;
  turnCount: number;
  truncationEvents: number;
  allocations: AllocationRecord[];
}

interface AllocationRecord {
  timestamp: number;
  requested: number;
  allocated: number;
  type: "stream" | "file_analysis" | "self_modify" | "response";
  wasCapped: boolean;
}

interface AllocationResult {
  allocated: number;
  wasCapped: boolean;
  warningLevel: "none" | "approaching" | "critical";
  message?: string;
  suggestedAction?: "continue" | "summarize" | "split" | "stop";
}

interface BudgetStats {
  activeSessions: number;
  totalAllocations: number;
  totalTruncationsPrevented: number;
  averageUtilization: number;
  peakUtilization: number;
}

// ── Token Estimation ──────────────────────────────────────────────────────────

/**
 * Estimate token count from text using the ~4 chars per token heuristic.
 * For more accuracy, we could use tiktoken, but this is fast and good enough
 * for budget management (we add a 10% safety margin).
 */
// v5.35: Use tiktoken for accurate token counting (shared with ai.ts)
let _tikEncoder: { encode: (text: string) => number[] } | null = null;

// Eagerly load tiktoken at module init (non-blocking)
(async () => {
  try {
    const tiktoken = await import("js-tiktoken") as any;
    _tikEncoder = tiktoken.encodingForModel("gpt-4");
  } catch {
    console.warn("[TokenBudget] js-tiktoken not available, using heuristic fallback");
  }
})();

function getTikEncoder() {
  return _tikEncoder;
}

function estimateTokensFallback(text: string, charsPerToken: number): number {
  return Math.ceil(Math.ceil(text.length / charsPerToken) * 1.1);
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const enc = getTikEncoder();
  if (enc) {
    try { return enc.encode(text).length; } catch { /* fallback */ }
  }
  return estimateTokensFallback(text, 4);
}

/**
 * More precise estimation for code (which tends to have shorter tokens)
 */
export function estimateCodeTokens(code: string): number {
  if (!code) return 0;
  const enc = getTikEncoder();
  if (enc) {
    try { return enc.encode(code).length; } catch { /* fallback */ }
  }
  return estimateTokensFallback(code, 3.5);
}

// ── Session Management ────────────────────────────────────────────────────────

const sessions: Map<string, SessionState> = new Map();
let config: TokenBudgetConfig = { ...DEFAULT_CONFIG };
let totalTruncationsPrevented = 0;
let peakUtilization = 0;

function getOrCreateSession(sessionId: string): SessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      id: sessionId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
      turnCount: 0,
      truncationEvents: 0,
      allocations: [],
    };
    sessions.set(sessionId, session);
  }
  session.lastActivity = Date.now();
  return session;
}

function cleanupStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of Array.from(sessions.entries())) {
    if (now - session.lastActivity > config.sessionTimeoutMs) {
      sessions.delete(id);
    }
  }
}

// ── Core Budget Logic ─────────────────────────────────────────────────────────

/**
 * Get the current budget state for a session
 */
export function getBudget(sessionId: string): TokenBudget {
  const session = getOrCreateSession(sessionId);
  const total = config.contextWindow;
  const reserved = Math.floor(total * config.reservedRatio);
  const available = total - reserved;
  const used = session.inputTokens + session.outputTokens;
  const remaining = Math.max(0, available - used);
  const utilizationPercent = available > 0 ? (used / available) * 100 : 100;

  return { total, reserved, available, used, remaining, utilizationPercent };
}

/**
 * v5.81: Auto-compress a session if it has exceeded 85% utilization.
 * Instead of wiping the session (which causes the 121% loop), we reduce the
 * tracked token usage by 40% to simulate context compression. The actual
 * message compression happens in contextManager.ts — this just prevents the
 * budget from thinking it's at 0% after a wipe (which causes immediate re-fill).
 *
 * The old wipe approach caused: reset → model starts over → fills context again
 * → reset → infinite loop. The compress approach: reduce budget → model continues
 * from where it was with a smaller footprint.
 */
function autoResetIfExhausted(sessionId: string): void {
  const budget = getBudget(sessionId);
  if (budget.utilizationPercent < 85) return;

  const session = sessions.get(sessionId);
  if (!session) return;

  // Compress session by removing oldest 50% of allocations to simulate context summarization.
  // This preserves continuity and avoids restart loops caused by full resets.
  const previousUtilization = budget.utilizationPercent;
  const allocationsToKeep = Math.floor(session.allocations.length * 0.5);
  const removedAllocations = session.allocations.splice(0, session.allocations.length - allocationsToKeep);

  // Calculate total tokens removed from allocations
  const removedTokens = removedAllocations.reduce((sum, allocation) => sum + allocation.allocated, 0);

  // Reduce input and output tokens proportionally to simulate compression
  const totalTokens = session.inputTokens + session.outputTokens;
  const reductionRatio = removedTokens / Math.max(1, totalTokens);
  session.inputTokens = Math.max(0, Math.floor(session.inputTokens * (1 - reductionRatio)));
  session.outputTokens = Math.max(0, Math.floor(session.outputTokens * (1 - reductionRatio)));

  const newBudget = getBudget(sessionId);
  console.log(
    `[TokenBudget] Compressed session ${sessionId}: ${previousUtilization.toFixed(1)}% → ${newBudget.utilizationPercent.toFixed(1)}% ` +
    `(removed ${removedTokens} tokens from ${removedAllocations.length} old allocations)`
  );
}

/**
 * Allocate tokens for an output operation.
 * Returns the actual allocation (may be less than requested if budget is tight).
 */
export function allocateTokens(
  sessionId: string,
  requestedTokens: number,
  type: AllocationRecord["type"] = "response"
): AllocationResult {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("allocateTokens: sessionId must be a non-empty string");
  }
  if (typeof requestedTokens !== "number" || requestedTokens < 0) {
    throw new Error("allocateTokens: requestedTokens must be a non-negative number");
  }
  // v5.68: Auto-reset if session is exhausted to prevent spiral
  autoResetIfExhausted(sessionId);
  const session = getOrCreateSession(sessionId);
  const budget = getBudget(sessionId);

  // Calculate effective cap based on 85% rule
  const effectiveCap = Math.floor(budget.available * config.hardCapThreshold);
  const warningLine = Math.floor(budget.available * config.warningThreshold);
  const currentUsed = budget.used;

  let allocated = requestedTokens;
  let wasCapped = false;
  let warningLevel: AllocationResult["warningLevel"] = "none";
  let message: string | undefined;
  let suggestedAction: AllocationResult["suggestedAction"];

  // Check if we'd exceed the hard cap
  if (currentUsed + requestedTokens > effectiveCap) {
    allocated = Math.max(0, effectiveCap - currentUsed);
    wasCapped = true;
    totalTruncationsPrevented++;
    session.truncationEvents++;
    warningLevel = "critical";
    message = `Budget capped: requested ${requestedTokens}, allocated ${allocated} (${budget.utilizationPercent.toFixed(1)}% utilized)`;
    suggestedAction = allocated < requestedTokens * 0.5 ? "split" : "summarize";
  } else if (currentUsed + requestedTokens > warningLine) {
    warningLevel = "approaching";
    message = `Approaching budget limit: ${budget.utilizationPercent.toFixed(1)}% utilized`;
    suggestedAction = "continue";
  }

  // Also cap at maxOutputTokens per single response
  if (allocated > config.maxOutputTokens) {
    allocated = config.maxOutputTokens;
    wasCapped = true;
  }

  // Record the allocation
  const record: AllocationRecord = {
    timestamp: Date.now(),
    requested: requestedTokens,
    allocated,
    type,
    wasCapped,
  };
  session.allocations.push(record);

  // Keep allocations bounded (last 100)
  if (session.allocations.length > 100) {
    session.allocations = session.allocations.slice(-100);
  }

  // Track peak utilization
  const newUtilization = (currentUsed + allocated) / budget.available * 100;
  if (newUtilization > peakUtilization) {
    peakUtilization = newUtilization;
  }

  return { allocated, wasCapped, warningLevel, message, suggestedAction };
}

/**
 * Record actual token usage after a response is sent
 */
export function recordUsage(
  sessionId: string,
  inputTokens: number,
  outputTokens: number
): void {
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("recordUsage: sessionId must be a non-empty string");
  }
  if (typeof inputTokens !== "number" || inputTokens < 0) {
    throw new Error("recordUsage: inputTokens must be a non-negative number");
  }
  if (typeof outputTokens !== "number" || outputTokens < 0) {
    throw new Error("recordUsage: outputTokens must be a non-negative number");
  }
  const session = getOrCreateSession(sessionId);
  session.inputTokens += inputTokens;
  session.outputTokens += outputTokens;
  session.turnCount++;
}

/**
 * Check if a response of estimated size can fit without truncation
 */
export function canFitResponse(sessionId: string, estimatedTokens: number): {
  canFit: boolean;
  availableTokens: number;
  suggestion: string;
} {
  // v5.68: Auto-reset if exhausted before checking fit
  autoResetIfExhausted(sessionId);
  const budget = getBudget(sessionId);
  const effectiveCap = Math.floor(budget.available * config.hardCapThreshold);
  const availableTokens = Math.max(0, effectiveCap - budget.used);

  if (estimatedTokens <= availableTokens) {
    return { canFit: true, availableTokens, suggestion: "proceed" };
  }

  if (estimatedTokens <= availableTokens * 1.5) {
    return {
      canFit: false,
      availableTokens,
      suggestion: `Summarize to fit within ${availableTokens} tokens (currently ${estimatedTokens} estimated)`,
    };
  }

  return {
    canFit: false,
    availableTokens,
    suggestion: `Split into ${Math.ceil(estimatedTokens / availableTokens)} parts of ~${availableTokens} tokens each`,
  };
}

/**
 * Reset a session's budget (e.g., for a new conversation)
 */
export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// ── Stats & Monitoring ────────────────────────────────────────────────────────

export function getBudgetStats(): BudgetStats {
  cleanupStaleSessions();
  
  let totalAllocations = 0;
  let totalUtilization = 0;
  
  for (const session of Array.from(sessions.values())) {
    totalAllocations += session.allocations.length;
    const budget = getBudget(session.id);
    totalUtilization += budget.utilizationPercent;
  }

  const activeSessions = sessions.size;
  const averageUtilization = activeSessions > 0 ? totalUtilization / activeSessions : 0;

  return {
    activeSessions,
    totalAllocations,
    totalTruncationsPrevented,
    averageUtilization,
    peakUtilization,
  };
}

/**
 * Get detailed budget info for a specific session (for debugging)
 */
export function getSessionDetail(sessionId: string): SessionState | null {
  return sessions.get(sessionId) || null;
}

// ── Configuration ─────────────────────────────────────────────────────────────

export function updateConfig(partial: Partial<TokenBudgetConfig>): void {
  config = { ...config, ...partial };
}

export function getConfig(): TokenBudgetConfig {
  return { ...config };
}

// ── Initialization ────────────────────────────────────────────────────────────

let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function initTokenBudgetManager(): void {
  // Cleanup stale sessions every 5 minutes
  _cleanupInterval = setInterval(cleanupStaleSessions, 5 * 60 * 1000);
  _cleanupInterval.unref();
  console.log(`[TokenBudget] Initialized: ${config.contextWindow} token window, ${(config.hardCapThreshold * 100).toFixed(0)}% hard cap`);
}

export function stopTokenBudgetManager(): void {
  if (_cleanupInterval !== null) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
  }
}
