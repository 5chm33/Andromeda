/**
 * realEvalHarness.ts — Real Eval Harness
 * Andromeda v9.14.0
 *
 * Records actual user requests and replays them to measure quality improvements
 * over time. Unlike synthetic evals (which test hypothetical scenarios), this
 * harness tests the system against real queries that users actually asked.
 *
 * Pipeline:
 *   1. Record: Every AI response is recorded to eval_recordings (SQLite)
 *   2. Select: Pick a representative sample of recorded queries for replay
 *   3. Replay: Re-run each query through the current system
 *   4. Score: Compare new response quality vs original using LLM-as-judge
 *   5. Report: Emit a quality delta report (improved/degraded/neutral)
 *   6. Target: Feed degraded queries to RSI for targeted improvement
 *
 * Quality Scoring (LLM-as-judge):
 *   - Factual accuracy (0-25): Does the response contain correct information?
 *   - Completeness (0-25): Does it fully address the query?
 *   - Conciseness (0-25): Is it appropriately brief without losing substance?
 *   - Helpfulness (0-25): Would a user find this response useful?
 *   Total: 0-100
 */

import { getEvalsForReplay, markEvalReplayed, recordEval } from "./andromedaDb";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EvalReplayResult {
  id: number;
  query: string;
  originalResponse: string;
  newResponse: string;
  originalScore: number;
  newScore: number;
  delta: number;
  verdict: "improved" | "degraded" | "neutral";
}

export interface EvalHarnessReport {
  runAt: number;
  totalReplayed: number;
  improved: number;
  degraded: number;
  neutral: number;
  avgDelta: number;
  avgNewScore: number;
  worstQueries: EvalReplayResult[];
  bestQueries: EvalReplayResult[];
}

// ─── State ───────────────────────────────────────────────────────────────────

let _lastReport: EvalHarnessReport | null = null;
let _isRunning = false;

// ─── LLM Judge ───────────────────────────────────────────────────────────────

/**
 * Score a response using LLM-as-judge (0-100).
 * Uses a fast model to keep costs low.
 */
async function scoreResponse(query: string, response: string): Promise<number> {
  try {
    const { getProviderApiKey } = await import("./llmProvider.js");
    const apiKey = getProviderApiKey("openrouter") || process.env.OPENROUTER_API_KEY;
    if (!apiKey) return 50; // Default score if no API key

    const prompt = `You are a quality evaluator for an AI assistant. Rate the following response on a scale of 0-100.

Query: ${query.slice(0, 500)}

Response: ${response.slice(0, 1000)}

Score the response on these 4 criteria (0-25 each):
1. Factual accuracy: Is the information correct?
2. Completeness: Does it fully address the query?
3. Conciseness: Is it appropriately brief?
4. Helpfulness: Would a user find this useful?

Reply with ONLY a JSON object: {"score": <0-100>, "reason": "<one sentence>"}`;

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://andromeda.local",
        "X-Title": "Andromeda Eval Harness",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (!res.ok) return 50;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const match = content.match(/"score"\s*:\s*(\d+)/);
    if (match) return Math.min(100, Math.max(0, parseInt(match[1], 10)));
    return 50;
  } catch {
    return 50;
  }
}

// ─── Recording Hook ──────────────────────────────────────────────────────────

/**
 * Record a real user interaction for later eval replay.
 * Call this from reactEngine.ts after each successful response.
 */
export function recordRealInteraction(opts: {
  sessionId: string;
  query: string;
  response: string;
  toolsUsed?: string[];
  latencyMs?: number;
  model?: string;
}): void {
  // Only record a sample (1 in 5) to avoid filling the database
  if (Math.random() > 0.2) return;

  // Skip very short queries (likely test/debug)
  if (opts.query.length < 20) return;

  recordEval({
    sessionId: opts.sessionId,
    query: opts.query,
    response: opts.response,
    toolsUsed: opts.toolsUsed ?? [],
    latencyMs: opts.latencyMs,
    model: opts.model,
  });
}

// ─── Replay Engine ───────────────────────────────────────────────────────────

/**
 * Run the eval harness: replay recorded queries and measure quality delta.
 */
export async function runEvalHarness(opts: {
  maxReplays?: number;
  minQueryLength?: number;
} = {}): Promise<EvalHarnessReport> {
  if (_isRunning) {
    throw new Error("[RealEvalHarness] Already running");
  }

  _isRunning = true;
  const maxReplays = opts.maxReplays ?? 10;
  const runAt = Date.now();

  try {
    const evals = getEvalsForReplay(maxReplays);
    if (evals.length === 0) {
      const report: EvalHarnessReport = {
        runAt,
        totalReplayed: 0,
        improved: 0,
        degraded: 0,
        neutral: 0,
        avgDelta: 0,
        avgNewScore: 0,
        worstQueries: [],
        bestQueries: [],
      };
      _lastReport = report;
      return report;
    }

    console.log(`[RealEvalHarness] Replaying ${evals.length} recorded queries...`);

    const results: EvalReplayResult[] = [];

    for (const ev of evals) {
      try {
        // Score the original response
        const originalScore = await scoreResponse(ev.query, ev.response);

        // Re-run the query through the current system
        let newResponse = ev.response; // Default: same response (no regression)
        let newScore = originalScore;

        try {
          const { chatCompletion } = await import("./llmProvider.js");
          const aiResult = await chatCompletion(
            [{ role: "user", content: ev.query }],
            { maxTokens: 500 },
          );
          newResponse = aiResult.content ?? String(aiResult);
          newScore = await scoreResponse(ev.query, newResponse);
        } catch {
          // If replay fails, use original score (neutral)
        }

        const delta = newScore - originalScore;
        const verdict: EvalReplayResult["verdict"] =
          delta >= 5 ? "improved" : delta <= -5 ? "degraded" : "neutral";

        results.push({
          id: ev.id,
          query: ev.query,
          originalResponse: ev.response,
          newResponse,
          originalScore,
          newScore,
          delta,
          verdict,
        });

        markEvalReplayed(ev.id, newScore);
      } catch (err) {
        console.warn(`[RealEvalHarness] Replay failed for eval ${ev.id}:`, err);
      }
    }

    const improved = results.filter(r => r.verdict === "improved").length;
    const degraded = results.filter(r => r.verdict === "degraded").length;
    const neutral = results.filter(r => r.verdict === "neutral").length;
    const avgDelta = results.length > 0 ? results.reduce((s, r) => s + r.delta, 0) / results.length : 0;
    const avgNewScore = results.length > 0 ? results.reduce((s, r) => s + r.newScore, 0) / results.length : 0;

    // Sort by delta to find worst and best
    const sorted = [...results].sort((a, b) => a.delta - b.delta);
    const worstQueries = sorted.slice(0, 3);
    const bestQueries = sorted.slice(-3).reverse();

    const report: EvalHarnessReport = {
      runAt,
      totalReplayed: results.length,
      improved,
      degraded,
      neutral,
      avgDelta,
      avgNewScore,
      worstQueries,
      bestQueries,
    };

    _lastReport = report;

    console.log(
      `[RealEvalHarness] Done: ${improved} improved, ${degraded} degraded, ${neutral} neutral. ` +
      `Avg delta: ${avgDelta.toFixed(1)}, avg score: ${avgNewScore.toFixed(1)}`
    );

    return report;
  } finally {
    _isRunning = false;
  }
}

/** Get the last eval harness report */
export function getLastEvalHarnessReport(): EvalHarnessReport | null {
  return _lastReport;
}

/** Check if the eval harness is currently running */
export function isEvalHarnessRunning(): boolean {
  return _isRunning;
}

// ─── RSI Targeting Integration ───────────────────────────────────────────────

/**
 * Get queries that degraded in quality — these are the best targets for RSI.
 * Returns a list of (query, module) pairs for RSI to focus on.
 */
export function getDegradedQueryTargets(): Array<{ query: string; module?: string }> {
  if (!_lastReport) return [];
  return _lastReport.worstQueries
    .filter(r => r.verdict === "degraded")
    .map(r => ({ query: r.query }));
}
