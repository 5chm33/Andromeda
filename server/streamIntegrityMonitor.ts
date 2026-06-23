/**
 * streamIntegrityMonitor.ts — v5.24
 * 
 * Monitors streaming responses for integrity and completeness.
 * Detects truncation in real-time and triggers auto-continuation.
 * 
 * Two-layer protection:
 * 1. PRE-SEND: Verify the response can complete within budget
 * 2. POST-SEND: Verify the response was delivered completely
 * 
 * Integrates with tokenBudgetManager for budget enforcement.
 */

import {
  estimateTokenCount,
  allocateTokens,
  recordUsage,
  canFitResponse,
} from "./tokenBudgetManager";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StreamState {
  sessionId: string;
  streamId: string;
  startedAt: number;
  expectedTokens: number;
  actualTokens: number;
  chunks: number;
  lastChunkAt: number;
  isComplete: boolean;
  wasTruncated: boolean;
  truncationReason?: string;
  continuationCount: number;
}

interface IntegrityCheck {
  isComplete: boolean;
  confidence: number; // 0-1
  indicators: string[];
  suggestedAction: "none" | "continue" | "retry" | "split";
}

interface MonitorStats {
  activeStreams: number;
  completedStreams: number;
  truncatedStreams: number;
  averageCompletionRate: number;
  continuationsTriggered: number;
}

// ── Truncation Detection Patterns ─────────────────────────────────────────────

const INCOMPLETE_PATTERNS = [
  // Code blocks left open — only match if there's an odd number of ``` markers
  // (checked separately via codeBlocks % 2 below, so this is a backup)
  /```[a-z]*\s*\n[\s\S]{50,}$/,
  // v5.35: Only flag very long unbroken identifier-like strings (likely truncated variable names)
  // Previous pattern flagged normal words at end of sentences as "mid-word cuts"
  /[a-zA-Z_$][a-zA-Z0-9_$]{15,}$/,
  // List item started but not finished — must be the LAST line
  /\n\s*[-*]\s+\S{1,20}$/,
  // Function/class left open (unbalanced braces) — v5.27: more robust
  /\{[^}]{0,200}$/,
  // JSON/array left open
  /\[[^\]]{0,200}$/,
  // v5.35: Removed overly aggressive "no terminal punctuation" pattern.
  // It matched almost every response since most text doesn't end with punctuation
  // right at the last character. Bracket/brace balance checks are more reliable.
];

const COMPLETE_PATTERNS = [
  // Ends with proper punctuation
  /[.!?]\s*$/,
  // Ends with code block closure
  /```\s*$/,
  // Ends with a complete sentence
  /\w+[.!?]["']?\s*$/,
  // Ends with a section marker
  /---\s*$/,
  // Ends with explicit completion markers
  /\*\*(?:End|Done|Complete|Summary)\*\*/i,
];

// ── Stream Tracking ───────────────────────────────────────────────────────────

const activeStreams: Map<string, StreamState> = new Map();
let completedCount = 0;
let truncatedCount = 0;
let continuationsTriggered = 0;
const completionRates: number[] = [];

/**
 * Start monitoring a new stream
 */
export function startStream(sessionId: string, streamId: string, estimatedOutputTokens?: number): void {
  const state: StreamState = {
    sessionId,
    streamId,
    startedAt: Date.now(),
    expectedTokens: estimatedOutputTokens || 0,
    actualTokens: 0,
    chunks: 0,
    lastChunkAt: Date.now(),
    isComplete: false,
    wasTruncated: false,
    continuationCount: 0,
  };
  activeStreams.set(streamId, state);
}

/**
 * Record a chunk being sent in the stream
 */
export function recordChunk(streamId: string, chunkText: string): void {
  const state = activeStreams.get(streamId);
  if (!state) return;

  state.chunks++;
  state.actualTokens += estimateTokenCount(chunkText);
  state.lastChunkAt = Date.now();
}

/**
 * Check if the stream appears to be truncating
 * Call this periodically during streaming to detect early
 */
export function checkStreamHealth(streamId: string): {
  healthy: boolean;
  warning?: string;
} {
  const state = activeStreams.get(streamId);
  if (!state) return { healthy: true };

  // Check if we're approaching budget limit
  const allocation = allocateTokens(state.sessionId, 1000, "stream");
  if (allocation.warningLevel === "critical") {
    return {
      healthy: false,
      warning: `Stream approaching token budget limit (${allocation.message})`,
    };
  }

  // Check for stalled stream (no chunks in 30s)
  if (Date.now() - state.lastChunkAt > 30_000 && state.chunks > 0) {
    return {
      healthy: false,
      warning: "Stream appears stalled (no chunks in 30s)",
    };
  }

  return { healthy: true };
}

/**
 * End a stream and check for completeness
 */
export function endStream(streamId: string, finalContent: string): IntegrityCheck {
  const state = activeStreams.get(streamId);
  if (!state) {
    return { isComplete: true, confidence: 0.5, indicators: ["Stream not tracked"], suggestedAction: "none" };
  }

  state.isComplete = true;
  const check = checkCompleteness(finalContent);

  if (!check.isComplete) {
    state.wasTruncated = true;
    state.truncationReason = check.indicators.join("; ");
    truncatedCount++;
  }

  // Record completion rate
  const completionRate = state.expectedTokens > 0
    ? Math.min(1, state.actualTokens / state.expectedTokens)
    : (check.isComplete ? 1 : 0.5);
  completionRates.push(completionRate);
  if (completionRates.length > 1000) completionRates.shift();

  // Record usage in budget manager
  recordUsage(state.sessionId, 0, state.actualTokens);

  completedCount++;
  activeStreams.delete(streamId);

  return check;
}

/**
 * Check if content appears complete or truncated
 */
export function checkCompleteness(content: string): IntegrityCheck {
  if (!content || content.trim().length === 0) {
    return {
      isComplete: false,
      confidence: 1.0,
      indicators: ["Empty content"],
      suggestedAction: "retry",
    };
  }

  const indicators: string[] = [];
  let incompleteScore = 0;
  let completeScore = 0;

  // Check for incomplete patterns
  const lastChunk = content.slice(-500); // Check last 500 chars
  for (const pattern of INCOMPLETE_PATTERNS) {
    if (pattern.test(lastChunk)) {
      incompleteScore++;
      indicators.push(`Matches incomplete pattern: ${pattern.source.slice(0, 30)}`);
    }
  }

  // Check for complete patterns
  for (const pattern of COMPLETE_PATTERNS) {
    if (pattern.test(lastChunk)) {
      completeScore++;
    }
  }

  // Check bracket balance (for code responses)
  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (openBraces > closeBraces + 2) {
    incompleteScore += 2;
    indicators.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check code block balance
  const codeBlocks = (content.match(/```/g) || []).length;
  if (codeBlocks % 2 !== 0) {
    incompleteScore += 2;
    indicators.push("Unclosed code block");
  }

  // Calculate confidence
  const totalSignals = incompleteScore + completeScore;
  const confidence = totalSignals > 0 ? Math.min(1, Math.max(0.3, completeScore / totalSignals)) : 0.5;
  const isComplete = incompleteScore <= 1 && completeScore >= 1;

  let suggestedAction: IntegrityCheck["suggestedAction"] = "none";
  if (!isComplete) {
    if (incompleteScore >= 3) suggestedAction = "continue";
    else if (confidence < 0.3) suggestedAction = "retry";
    else suggestedAction = "continue";
  }

  return { isComplete, confidence, indicators, suggestedAction };
}

/**
 * Pre-flight check: Can this response fit within budget?
 */
export function preFlightCheck(sessionId: string, estimatedContent: string): {
  canProceed: boolean;
  adjustedContent?: string;
  message: string;
} {
  const estimatedTokens = estimateTokenCount(estimatedContent);
  const fitCheck = canFitResponse(sessionId, estimatedTokens);

  if (fitCheck.canFit) {
    return { canProceed: true, message: "Within budget" };
  }

  // If it doesn't fit, suggest splitting
  if (fitCheck.availableTokens > 1000) {
    // Truncate to available budget with a note
    const charBudget = fitCheck.availableTokens * 4; // Reverse the 4 chars/token estimate
    const truncated = estimatedContent.slice(0, charBudget - 200) +
      "\n\n---\n*[Response truncated to fit budget. Use /continue for the rest.]*";
    return {
      canProceed: true,
      adjustedContent: truncated,
      message: fitCheck.suggestion,
    };
  }

  return {
    canProceed: false,
    message: `Insufficient budget: need ~${estimatedTokens} tokens, only ${fitCheck.availableTokens} available`,
  };
}

/**
 * Record that a continuation was triggered
 */
export function recordContinuation(streamId: string): void {
  const state = activeStreams.get(streamId);
  if (state) {
    state.continuationCount++;
  }
  continuationsTriggered++;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getMonitorStats(): MonitorStats {
  const avgCompletion = completionRates.length > 0
    ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
    : 1;

  return {
    activeStreams: activeStreams.size,
    completedStreams: completedCount,
    truncatedStreams: truncatedCount,
    averageCompletionRate: avgCompletion,
    continuationsTriggered,
  };
}

// ── Initialization ────────────────────────────────────────────────────────────

export function initStreamIntegrityMonitor(): void {
  // Cleanup stale streams every minute
  setInterval(() => {
    const now = Date.now();
    for (const [id, state] of Array.from(activeStreams.entries())) {
      // Remove streams that have been inactive for 5 minutes
      if (now - state.lastChunkAt > 5 * 60 * 1000) {
        state.wasTruncated = true;
        state.truncationReason = "Stream abandoned (5min timeout)";
        truncatedCount++;
        activeStreams.delete(id);
      }
    }
  }, 60_000);

  console.log("[StreamIntegrity] Initialized: monitoring all output streams");
}

// v5.26: Alias for diagnostics endpoint
export const getStreamStats = getMonitorStats;
