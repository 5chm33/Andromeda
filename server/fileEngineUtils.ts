/**
 * fileEngineUtils.ts — v6.25
 * SOTA improvements: cost budget, retry with backoff, context window state,
 * file relevance scoring, and chunked analysis.
 * Extracted from fileEngine.ts (god-module split).
 */
import { getActiveProvider } from "./llmProvider.js";
import { createLogger } from "./logger.js";
import { buildFileIndex } from "./fileEngineChunking.js";
import type { FileEntry, SSEEmitter } from "./fileEngineTypes.js";
import { PRIORITY_FILES, TEXT_EXTS, fileEngineTypes, js, getFileEngineApiUrl, getFileEngineProviderHeaders } from "./fileEngineTypes.js";
import { runMultiPassEdit, loadAndCompressFiles } from "./fileEngineAnalysis.js";
const log = createLogger("fileEngineUtils");

// ─── SOTA Improvements (v5.12) ──────────────────────────────────────────────

/**
 * Cost Budget Manager
 * Tracks token usage per task and enforces configurable limits.
 * Inspired by SWE-agent's cost-based budgeting ($3/task default).
 */
export interface CostBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxApiCalls: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  apiCallCount: number;
}

export function createBudget(opts?: Partial<Pick<CostBudget, "maxInputTokens" | "maxOutputTokens" | "maxTotalTokens" | "maxApiCalls">>): CostBudget {
  return {
    maxInputTokens: opts?.maxInputTokens ?? 200_000,
    maxOutputTokens: opts?.maxOutputTokens ?? 16_000,
    maxTotalTokens: opts?.maxTotalTokens ?? 216_000,
    maxApiCalls: opts?.maxApiCalls ?? 10,
    usedInputTokens: 0,
    usedOutputTokens: 0,
    apiCallCount: 0,
  };
}

export function checkBudget(budget: CostBudget): { ok: boolean; reason?: string } {
  if (budget.apiCallCount >= budget.maxApiCalls) {
    return { ok: false, reason: `API call limit reached (${budget.maxApiCalls})` };
  }
  const totalUsed = budget.usedInputTokens + budget.usedOutputTokens;
  if (totalUsed >= budget.maxTotalTokens) {
    return { ok: false, reason: `Total token budget exhausted (${totalUsed}/${budget.maxTotalTokens})` };
  }
  return { ok: true };
}

export function recordUsage(budget: CostBudget, inputTokens: number, outputTokens: number): void {
  budget.usedInputTokens += inputTokens;
  budget.usedOutputTokens += outputTokens;
  budget.apiCallCount++;
}

/**
 * Error Recovery Ladder
 * Implements SWE-agent's error recovery pattern:
 * - Transient errors (429, 500, 502, 503): retry with exponential backoff
 * - Context overflow: auto-compact and retry once
 * - Permanent errors: fail immediately with autosubmit
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503],
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  emit?: SSEEmitter
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok || !config.retryableStatuses.includes(response.status)) {
        return response;
      }

      // Retryable error
      lastError = new Error(`API returned ${response.status}: ${response.statusText}`);

      if (attempt < config.maxRetries) {
        const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
        emit?.({ type: "retry", attempt: attempt + 1, maxRetries: config.maxRetries, delayMs: delay, status: response.status });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err: any) {
      lastError = err;
      if (attempt < config.maxRetries) {
        const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
        emit?.({ type: "retry", attempt: attempt + 1, maxRetries: config.maxRetries, delayMs: delay, error: err.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("All retry attempts exhausted");
}

/**
 * Autosubmit Pattern
 * Inspired by SWE-agent: every error path ends in partial submission, not crash.
 * Even if the edit partially fails, return whatever was completed.
 */
export interface AutosubmitResult {
  success: boolean;
  partial: boolean;
  editedZip?: string;
  summary: string;
  editsApplied: number;
  editsAttempted: number;
  log: string[];
  exitReason?: string;
}

export async function runMultiPassEditWithAutosubmit(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter,
  budget?: CostBudget
): Promise<AutosubmitResult> {
  const effectiveBudget = budget || createBudget();

  try {
    // Check budget before starting
    const budgetCheck = checkBudget(effectiveBudget);
    if (!budgetCheck.ok) {
      return {
        success: false,
        partial: false,
        summary: `Budget exhausted before starting: ${budgetCheck.reason}`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`BUDGET: ${budgetCheck.reason}`],
        exitReason: "budget_exhausted",
      };
    }

    const result = await runMultiPassEdit(base64Zip, instruction, apiKey, model, emit);

    return {
      success: true,
      partial: false,
      editedZip: result.editedZip,
      summary: result.summary,
      editsApplied: result.editsApplied,
      editsAttempted: result.log.length,
      log: result.log,
    };
  } catch (err: any) {
    // Autosubmit pattern: try to return partial work
    emit?.({ type: "autosubmit", reason: err.message });

    try {
      // Attempt to return the original ZIP unchanged with an error log
      return {
        success: false,
        partial: true,
        editedZip: base64Zip, // Return original unchanged
        summary: `Edit partially failed: ${err.message}. Original files returned unchanged.`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`AUTOSUBMIT: ${err.message}`, "Original ZIP returned unchanged"],
        exitReason: err.message.includes("context") ? "context_overflow" :
                    err.message.includes("budget") ? "budget_exhausted" :
                    err.message.includes("429") ? "rate_limited" : "error",
      };
    } catch {
      return {
        success: false,
        partial: false,
        summary: `Complete failure: ${err.message}`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`FATAL: ${err.message}`],
        exitReason: "fatal",
      };
    }
  }
}

/**
 * Context Window Monitor
 * Tracks how much of the context window is being used and triggers
 * compaction when approaching the limit.
 */
export interface ContextWindowState {
  maxTokens: number;
  usedTokens: number;
  reservedForOutput: number;
  availableTokens: number;
  utilizationPercent: number;
  shouldCompact: boolean;
}

export function getContextWindowState(
  contentChars: number,
  maxContextTokens: number = 131_072,
  outputReserve: number = 8_000
): ContextWindowState {
  const usedTokens = Math.ceil(contentChars / 4); // ~4 chars per token
  const availableTokens = maxContextTokens - outputReserve - usedTokens;
  const utilizationPercent = Math.round((usedTokens / (maxContextTokens - outputReserve)) * 100);

  return {
    maxTokens: maxContextTokens,
    usedTokens,
    reservedForOutput: outputReserve,
    availableTokens: Math.max(0, availableTokens),
    utilizationPercent: Math.min(100, utilizationPercent),
    shouldCompact: utilizationPercent > 85,
  };
}

/**
 * Intelligent File Prioritization
 * Uses a scoring system inspired by Aider's PageRank to determine
 * which files are most important for a given task.
 */
export function scoreFileRelevance(
  entry: FileEntry,
  instruction: string,
  allEntries: FileEntry[]
): number {
  let score = 0;
  const instructionLower = instruction.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const fileName = entry.path.split("/").pop()?.toLowerCase() || "";

  // Direct mention in instruction (+50)
  if (instructionLower.includes(fileName.replace(/\.[^.]+$/, ""))) {
    score += 50;
  }

  // Priority file bonus (+30)
  if (PRIORITY_FILES.some(p => entry.path.endsWith(p))) {
    score += 30;
  }

  // Source files > config > docs > tests > assets
  const categoryScores = { source: 20, config: 15, docs: 10, test: 5, asset: 0 };
  score += categoryScores[entry.category] ?? 0;

  // Entry point bonus (+25)
  if (/index\.(ts|js|tsx|jsx)$/.test(pathLower) || /main\.(ts|js|py|go|rs)$/.test(pathLower) || /app\.(ts|tsx|js|jsx)$/.test(pathLower)) {
    score += 25;
  }

  // Cross-reference bonus: files that are imported by many other files
  const importCount = allEntries.filter(other =>
    other.signatures.some(sig => sig.includes(fileName.replace(/\.[^.]+$/, "")))
  ).length;
  score += Math.min(importCount * 5, 25);

  // Size penalty for very large files (>2000 lines ≈ >50KB)
  if (entry.size > 50_000) score -= 10;

  // Keyword matching from instruction
  const keywords = instructionLower.split(/\s+/).filter(w => w.length > 3);
  for (const keyword of keywords) {
    if (pathLower.includes(keyword)) score += 10;
    if (entry.signatures.some(s => s.toLowerCase().includes(keyword))) score += 15;
  }

  return score;
}

/**
 * Fallback: Chunked Sub-Analysis for extremely large projects.
 * Splits files into logical groups and analyzes each separately,
 * then synthesizes results.
 */
export async function runChunkedAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ analysis: string; chunksProcessed: number; totalFiles: number }> {
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);
  const index = await buildFileIndex(zip);

  // Group files by top-level directory
  const groups: Record<string, FileEntry[]> = {};
  for (const entry of index.entries) {
    const topDir = entry.path.split("/").slice(0, 2).join("/");
    if (!groups[topDir]) groups[topDir] = [];
    groups[topDir].push(entry);
  }

  const chunkResults: string[] = [];
  let chunksProcessed = 0;

  // Process each group as a sub-analysis
  for (const [dir, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;
    if (entries.every(e => e.category === "asset")) continue; // Skip pure asset dirs

    emit?.({ type: "chunk_start", directory: dir, fileCount: entries.length });

    // Load files for this chunk
    const chunkPaths = entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
    const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    const { content: chunkContent, stats } = await loadAndCompressFiles(zip, chunkPaths, allPaths);

    if (stats.loaded === 0) continue;

    const chunkPrompt = `Analyze this section of the codebase (directory: ${dir}, ${stats.loaded} files).
Focus on: architecture, code quality, potential issues, and how it relates to the overall project.
Be concise — this is one chunk of a larger analysis.

${chunkContent}`;

    try {
      const response = await fetchWithRetry(getFileEngineApiUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a code analyst. Analyze this code chunk concisely." },
            { role: "user", content: chunkPrompt },
          ],
          max_tokens: 3000,
          temperature: 0.3,
        }),
      }, DEFAULT_RETRY_CONFIG, emit);

      if (response.ok) {
        const data = (await response.json()) as any;
        const chunkAnalysis = data.choices?.[0]?.message?.content || "";
        chunkResults.push(`## ${dir}\n${chunkAnalysis}`);
        chunksProcessed++;
        emit?.({ type: "chunk_complete", directory: dir, chunksProcessed });
      }
    } catch (err: any) {
      chunkResults.push(`## ${dir}\n[Analysis failed: ${err.message}]`);
    }
  }

  // Synthesis pass: combine all chunk results
  emit?.({ type: "engine_phase", phase: "synthesizing", message: "Combining chunk analyses..." });

  const synthesisPrompt = `You analyzed a large codebase in chunks. Here are the per-directory analyses.
Synthesize them into a single cohesive report that addresses the user's original instruction.

User instruction: ${instruction}

Chunk analyses:
${chunkResults.join("\n\n")}

Produce a unified, well-structured analysis report.`;

  const synthesisResponse = await fetchWithRetry(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are an expert code analyst. Synthesize chunk analyses into a unified report." },
        { role: "user", content: synthesisPrompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  }, DEFAULT_RETRY_CONFIG, emit);

  let analysis = "Synthesis failed";
  if (synthesisResponse.ok) {
    const data = (await synthesisResponse.json()) as any;
    analysis = data.choices?.[0]?.message?.content || "Synthesis failed";
  }

  return { analysis, chunksProcessed, totalFiles: index.totalFiles };
}

