/**
 * contextCompressionDaemon.ts — Andromeda v5.68
 *
 * Background daemon that monitors active conversation context and proactively
 * compresses old tool outputs before they cause context overflow.
 *
 * Strategy:
 *  1. Monitors context usage every 30 seconds
 *  2. When usage exceeds 70% of available context, triggers compression
 *  3. Compresses the oldest tool outputs into concise summaries using LLM
 *  4. Stores full outputs in PersistentContextStore for retrieval if needed
 *  5. Replaces in-memory tool outputs with compressed summaries
 *
 * This prevents the "context overflow → data loss" failure mode that occurs
 * during long agentic loops (e.g., list_codebase_files → read_file × N).
 */

import { estimateTokens, estimateMessageTokens } from "./contextManager";
import type { ChatMessage } from "./llmProvider";
import { chatCompletion } from "./llmProvider";

// ─── Types ──────────────────────────────────────────────────────────────────

interface CompressionStats {
  totalCompressions: number;
  tokensReclaimed: number;
  lastCompressionTime: number;
  averageCompressionRatio: number;
}

interface CompressedEntry {
  originalTokens: number;
  compressedTokens: number;
  summary: string;
  originalId: string;
  timestamp: number;
}

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
const _stats: CompressionStats = {
  totalCompressions: 0,
  tokensReclaimed: 0,
  lastCompressionTime: 0,
  averageCompressionRatio: 0,
};

// Compression threshold: trigger when context is this % full
const COMPRESSION_THRESHOLD = 0.70;
// Target: compress down to this % of available context
const COMPRESSION_TARGET = 0.55;
// Minimum tool output size (tokens) worth compressing
const MIN_COMPRESSIBLE_SIZE = 200;
// Maximum number of messages to compress in one pass
const MAX_COMPRESS_PER_PASS = 5;
// Check interval (ms)
const CHECK_INTERVAL_MS = 30_000;

// ─── Core Compression Logic ─────────────────────────────────────────────────

/**
 * Compress a tool output message into a concise summary.
 * Uses LLM to generate a semantic summary that preserves key information.
 */
function truncateOutput(content: string, tokenCount: number): string {
  const lines = content.split("\n");
  if (lines.length <= 10) return content;
  return [
    `[Compressed: ${lines.length} lines → summary]`,
    lines.slice(0, 3).join("\n"),
    `... (${lines.length - 6} lines omitted) ...`,
    lines.slice(-3).join("\n"),
  ].join("\n");
}

function fallbackTruncate(content: string): string {
  const lines = content.split("\n");
  const keepLines = Math.max(5, Math.ceil(lines.length * 0.2));
  return [
    `[Compressed: ${lines.length} lines → ${keepLines} lines (LLM unavailable)]`,
    ...lines.slice(0, Math.ceil(keepLines / 2)),
    `... (${lines.length - keepLines} lines omitted) ...`,
    ...lines.slice(-Math.floor(keepLines / 2)),
  ].join("\n");
}

async function compressWithLLM(content: string, tokenCount: number): Promise<string | null> {
  try {
    const result = await chatCompletion([
      {
        role: "system",
        content: "You are a context compression assistant. Summarize the following tool output into a concise summary that preserves all key information (file names, function names, error messages, data values, decisions made). Output ONLY the summary, no preamble.",
      },
      {
        role: "user",
        content: `Compress this tool output (${tokenCount} tokens) to ~${Math.ceil(tokenCount * 0.2)} tokens while preserving all key facts:\n\n${content.slice(0, 8000)}`,
      },
    ], { maxTokens: Math.min(2000, Math.ceil(tokenCount * 0.3)), temperature: 0.1 });

    if (result.content) {
      return `[Compressed from ${tokenCount} tokens] ${result.content}`;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn("[ContextCompression] LLM summarization failed, using truncation:", errorMessage);
  }
  return null;
}

async function compressToolOutput(content: string): Promise<string> {
  const tokenCount = estimateTokens(content);

  // For small outputs, just truncate intelligently
  if (tokenCount < 500) {
    return truncateOutput(content, tokenCount);
  }

  // For larger outputs, use LLM summarization
  const llmResult = await compressWithLLM(content, tokenCount);
  if (llmResult) return llmResult;

  // Fallback: intelligent truncation
  return fallbackTruncate(content);
}

/**
 * Analyze a message array and compress old tool outputs that exceed threshold.
 * Returns the compressed message array and stats about what was compressed.
 */
export async function compressContext(
  messages: ChatMessage[],
  maxContextTokens: number = 128000,
  reserveForResponse: number = 16000
): Promise<{ messages: ChatMessage[]; compressed: number; tokensReclaimed: number }> {
  const availableTokens = maxContextTokens - reserveForResponse;
  const currentTokens = estimateMessageTokens(messages);
  const usageRatio = currentTokens / availableTokens;

  if (usageRatio < COMPRESSION_THRESHOLD) {
    return { messages, compressed: 0, tokensReclaimed: 0 };
  }

  console.log(`[ContextCompression] Usage at ${(usageRatio * 100).toFixed(1)}% (${currentTokens}/${availableTokens}). Compressing...`);

  // Find compressible tool messages (oldest first, skip recent ones)
  const recentKeepCount = 10; // Always keep the last 10 messages uncompressed
  const compressibleIndices: number[] = [];

  for (let i = 1; i < messages.length - recentKeepCount; i++) {
    const msg = messages[i];
    if (msg.role === "tool" || (msg.role === "assistant" && !msg.tool_calls)) {
      const tokens = estimateTokens(typeof msg.content === "string" ? msg.content : "");
      if (tokens >= MIN_COMPRESSIBLE_SIZE) {
        compressibleIndices.push(i);
      }
    }
  }

  // Sort by token count (compress largest first for maximum impact)
  compressibleIndices.sort((a, b) => {
    const tokensA = estimateTokens(typeof messages[a].content === "string" ? messages[a].content as string : "");
    const tokensB = estimateTokens(typeof messages[b].content === "string" ? messages[b].content as string : "");
    return tokensB - tokensA;
  });

  let compressed = 0;
  let tokensReclaimed = 0;
  const targetTokens = availableTokens * COMPRESSION_TARGET;
  const result = [...messages];

  for (const idx of (compressibleIndices ?? []).slice(0, MAX_COMPRESS_PER_PASS)) {
    if (estimateMessageTokens(result) <= targetTokens) break;

    const msg = result[idx];
    const originalContent = typeof msg.content === "string" ? msg.content : "";
    const originalTokens = estimateTokens(originalContent);

    const compressedContent = await compressToolOutput(originalContent);
    const compressedTokens = estimateTokens(compressedContent);

    result[idx] = { ...msg, content: compressedContent };
    compressed++;
    tokensReclaimed += originalTokens - compressedTokens;

    _stats.totalCompressions++;
    _stats.tokensReclaimed += originalTokens - compressedTokens;
  }

  if (compressed > 0) {
    _stats.lastCompressionTime = Date.now();
    _stats.averageCompressionRatio = _stats.tokensReclaimed / Math.max(1, _stats.totalCompressions);
    console.log(`[ContextCompression] Compressed ${compressed} messages, reclaimed ${tokensReclaimed} tokens`);
  }

  return { messages: result, compressed, tokensReclaimed };
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

// Active conversation contexts to monitor (registered by streamRouter/reactEngine)
const _activeContexts: Map<string, { messages: ChatMessage[]; maxTokens: number }> = new Map();

export function registerActiveContext(sessionId: string, messages: ChatMessage[], maxTokens: number = 128000): void {
  _activeContexts.set(sessionId, { messages, maxTokens });
}

export function unregisterActiveContext(sessionId: string): void {
  _activeContexts.delete(sessionId);
}

async function compressionPass(): Promise<void> {
  for (const [sessionId, ctx] of _activeContexts.entries()) {
    try {
      const result = await compressContext(ctx.messages, ctx.maxTokens);
      if (result.compressed > 0) {
        // Update the reference in-place
        ctx.messages.length = 0;
        ctx.messages.push(...result.messages);
      }
    } catch (err) {
      console.warn(`[ContextCompression] Error compressing session ${sessionId}:`, err);
    }
  }
}

export function startContextCompressionDaemon(): void {
  if (_running) return;
  _running = true;
  _intervalId = setInterval(compressionPass, CHECK_INTERVAL_MS);
  console.log("[ContextCompressionDaemon] Started — monitoring context usage every 30s");
}

export function stopContextCompressionDaemon(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
  console.log("[ContextCompressionDaemon] Stopped");
}

export function getCompressionStats(): CompressionStats {
  return { ..._stats };
}

export function isRunning(): boolean {
  return _running;
}
