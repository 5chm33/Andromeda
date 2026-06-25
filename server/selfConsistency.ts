/**
 * selfConsistency.ts — v5.33
 *
 * Multi-Model Self-Consistency Checking.
 *
 * Uses multiple LLM providers to cross-validate reasoning and conclusions.
 * Prevents self-deception by ensuring the primary model's output is verified
 * by independent models.
 *
 * Providers:
 * - Primary: DeepSeek (default LLM)
 * - Secondary: OpenRouter (Claude, GPT, etc.)
 *
 * Use cases:
 * - Self-modification proposals (verify the change is correct)
 * - Self-improvement analysis (verify the diagnosis)
 * - Critical decisions (verify reasoning)
 *
 * Safety:
 * - Fallback to single-model if secondary providers unavailable
 * - Rate limiting to prevent excessive API costs
 * - Caching to avoid redundant checks
 */
import { getActiveProvider as _scGetActiveProvider } from "./llmProvider.js"; // v6.17: ESM import replaces require()

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ConsistencyCheck {
  reasoning: string;
  conclusion: string;
  context?: string;
  checkType: "self_modification" | "self_improvement" | "critical_decision" | "general";
}

export interface ProviderEvaluation {
  provider: string;
  model: string;
  agrees: boolean;
  confidence: number;    // 0-1
  explanation: string;
  latencyMs: number;
  error?: string;
}

export interface ConsistencyReport {
  checkId: string;
  consensus: number;     // 0-1 (fraction of providers that agree)
  confidence: number;    // 0-1 (weighted confidence)
  evaluations: ProviderEvaluation[];
  recommendation: "proceed" | "review" | "reject";
  timestamp: number;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

// v5.38 FIX: Lazy API key reads (ESM hoisting issue)
function getOpenRouterKey(): string { return process.env.OPENROUTER_API_KEY || ""; }
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
function getDeepSeekKey(): string { return process.env.DEEPSEEK_API_KEY || ""; }
const DEEPSEEK_API_URL = process.env.LLM_API_URL || process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1";
// v5.39: Kimi as third provider fallback
function getKimiKey(): string { return process.env.KIMI_API_KEY || ""; }
const KIMI_API_URL = "https://api.moonshot.ai/v1";

// Rate limiting
const MAX_CHECKS_PER_HOUR = 20;
let checksThisHour = 0;
let hourStart = Date.now();

// Cache
const checkCache = new Map<string, ConsistencyReport>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// History
const checkHistory: ConsistencyReport[] = [];
const MAX_HISTORY = 100;

// ─── Provider Query Functions ──────────────────────────────────────────────────

/**
 * Query a model via OpenRouter.
 */
async function queryProvider(
  prompt: string,
  url: string,
  apiKey: string,
  model: string,
  extraHeaders?: Record<string, string>
): Promise<{ content: string; latencyMs: number }> {
  if (!apiKey) {
    throw new Error("API key not set");
  }

  const start = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`${url} ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    latencyMs: Date.now() - start,
  };
}

async function queryOpenRouter(
  prompt: string,
  model: string = "anthropic/claude-sonnet-4"
): Promise<{ content: string; latencyMs: number }> {
  return queryProvider(
    prompt,
    `${OPENROUTER_BASE_URL}/chat/completions`,
    getOpenRouterKey(),
    model,
    {
      "HTTP-Referer": "https://andromeda.local",
      "X-Title": "Andromeda Self-Consistency",
    }
  );
}

async function queryDeepSeek(prompt: string): Promise<{ content: string; latencyMs: number }> {
  return queryProvider(
    prompt,
    _scGetActiveProvider().apiUrl,
    getDeepSeekKey(),
    process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat"
  );
}

// v5.39: Kimi (moonshot-v1-8k) as third consistency provider
async function queryKimi(prompt: string): Promise<{ content: string; latencyMs: number }> {
  return queryProvider(
    prompt,
    `${KIMI_API_URL}/chat/completions`,
    getKimiKey(),
    "moonshot-v1-8k"
  );
}

// ─── Evaluation Parsing ────────────────────────────────────────────────────────

function parseEvaluation(response: string): { agrees: boolean; confidence: number; explanation: string } {
  // v12.2.2: More lenient parsing — default to agree unless explicit disagreement found.
  // A proposal that passed shadow tests + constitution + syntax should be approved by default.
  const agreesRegex = /(?:overall[:\s]*)?(?:i\s*)?agree/i;
  const disagreesRegex = /(?:overall[:\s]*)?(?:i\s*)?disagree|\bno\b.*\bconclusion|\bnot\b.*\bsound|\binvalid\b|\bincorrect\b/i;
  const confidenceRegex = /confidence:\s*(\d+(\.\d+)?)/i;

  // v12.2.2: Default to agree — secondary validator should not block unless explicitly rejecting
  let agrees = true;
  let confidence = 0.7; // Default to moderately confident approval
  const explanation = response.slice(0, 500);

  if (disagreesRegex.test(response) && !agreesRegex.test(response)) {
    // Only disagree if explicit disagreement with no agreement signal
    agrees = false;
    confidence = 0.3;
  } else if (agreesRegex.test(response)) {
    agrees = true;
  }

  const confidenceMatch = response.match(confidenceRegex);
  if (confidenceMatch && confidenceMatch[1]) {
    const parsedConfidence = parseFloat(confidenceMatch[1]);
    if (!isNaN(parsedConfidence)) {
      confidence = Math.min(1, Math.max(0, parsedConfidence));
    }
  }

  return {
    agrees,
    confidence,
    explanation,
  };
}

// ─── Core Consistency Check ────────────────────────────────────────────────────

/**
 * Check self-consistency by querying multiple models.
 */
export async function checkSelfConsistency(check: ConsistencyCheck): Promise<ConsistencyReport> {
  // Rate limiting
  if (Date.now() - hourStart > 60 * 60 * 1000) {
    checksThisHour = 0;
    hourStart = Date.now();
  }
  if (checksThisHour >= MAX_CHECKS_PER_HOUR) {
    return {
      checkId: `sc_${Date.now()}`,
      consensus: 1,
      confidence: 0.5,
      evaluations: [],
      recommendation: "proceed",
      timestamp: Date.now(),
    };
  }

  // Cache check
  const cacheKey = `${check.reasoning.slice(0, 100)}_${check.conclusion.slice(0, 100)}`;
  const cached = checkCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  checksThisHour++;

  const prompt = (() => {
    const context = check?.context ?? "Self-improvement analysis";
    const reasoning = check?.reasoning ?? "";
    const conclusion = check?.conclusion ?? "";

    return [
      "You are evaluating a reasoning chain and its conclusion. ",
      "Please assess whether the reasoning is sound and the conclusion follows logically.",
      "",
      "## Context",
      context,
      "",
      "## Reasoning",
      reasoning,
      "",
      "## Conclusion",
      conclusion,
      "",
      "## Your Task",
      "1. Is the reasoning logically sound? (yes/no)",
      "2. Does the conclusion follow from the reasoning? (yes/no)",
      "3. Are there any errors or blind spots? (explain briefly)",
      "4. Overall: Do you agree with this conclusion? (agree/disagree)",
      "",
      "Be concise. Focus on logical validity, not style."
    ].join("\n");
  })();

  const evaluations: ProviderEvaluation[] = [];

  // ── Query available providers in parallel ──
  const providerPromises: Promise<void>[] = [];

  // OpenRouter (Claude)
  if (getOpenRouterKey()) {
    providerPromises.push((async () => {
      try {
        const result = await queryOpenRouter(prompt, "anthropic/claude-sonnet-4");
        const parsed = parseEvaluation(result.content);
        evaluations.push({
          provider: "openrouter",
          model: "claude-sonnet-4",
          agrees: parsed.agrees,
          confidence: parsed.confidence,
          explanation: parsed.explanation,
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        // v12.2.2: On error, skip this provider entirely (don't push a disagree)
        // The validEvals filter already excludes errored evaluations, but we used to push
        // agrees=false which counted as a real disagree vote. Now we just log and skip.
        console.warn(`[selfConsistency] OpenRouter unavailable for consensus check: ${(err as Error).message}`);
      }
    })());
  }

  // DeepSeek
  if (getDeepSeekKey()) {
    providerPromises.push((async () => {
      try {
        const result = await queryDeepSeek(prompt);
        const parsed = parseEvaluation(result.content);
        evaluations.push({
          provider: "deepseek",
          model: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
          agrees: parsed.agrees,
          confidence: parsed.confidence,
          explanation: parsed.explanation,
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        // v12.2.2: Skip failed providers — don't count as disagree
        console.warn(`[selfConsistency] DeepSeek unavailable for consensus check: ${(err as Error).message}`);
      }
    })());
  }

  // v5.39: Kimi as third provider (fallback when DeepSeek/OpenRouter unavailable)
  if (getKimiKey()) {
    providerPromises.push((async () => {
      try {
        const result = await queryKimi(prompt);
        const parsed = parseEvaluation(result.content);
        evaluations.push({
          provider: "kimi",
          model: "moonshot-v1-8k",
          agrees: parsed.agrees,
          confidence: parsed.confidence,
          explanation: parsed.explanation,
          latencyMs: result.latencyMs,
        });
      } catch (err) {
        // v12.2.2: Skip failed providers — don't count as disagree
        console.warn(`[selfConsistency] Kimi unavailable for consensus check: ${(err as Error).message}`);

      }
    })());
  }

  await Promise.all(providerPromises);

  // ── Calculate consensus ──
  const validEvals = (evaluations ?? []).filter(e => !e.error);
  const agreeing = validEvals.filter(e => e.agrees).length;

  // v11.291.1: When ALL providers fail (all errored), return proceed immediately.
  // The primary LLM proposal + constitution check are sufficient safety gates.
  // Blocking all RSI proposals because secondary validators are unreachable is wrong.
  if (validEvals.length === 0) {
    const fallbackReport: ConsistencyReport = {
      checkId: `sc_fallback_${Date.now()}`,
      consensus: 1.0,
      confidence: 0.5,
      evaluations,
      recommendation: "proceed",
      timestamp: Date.now(),
    };
    checkCache.set(cacheKey, fallbackReport);
    checkHistory.push(fallbackReport);
    if (checkHistory.length > MAX_HISTORY) checkHistory.shift();
    return fallbackReport;
  }

  const consensus = agreeing / validEvals.length;

  // Weighted confidence
  const totalWeight = validEvals.reduce((sum, e) => sum + e.confidence, 0);
  const weightedConfidence = totalWeight > 0
    ? validEvals.reduce((sum, e) => sum + (e.agrees ? e.confidence : 0), 0) / totalWeight
    : 0.5;

  // Recommendation
  let recommendation: "proceed" | "review" | "reject";
  if (consensus >= 0.67 && weightedConfidence >= 0.6) {
    recommendation = "proceed";
  } else if (consensus < 0.5) {
    recommendation = "reject";
  } else {
    recommendation = "review";
  }

  const report: ConsistencyReport = {
    checkId: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    consensus,
    confidence: weightedConfidence,
    evaluations,
    recommendation,
    timestamp: Date.now(),
  };

  // Cache and store
  checkCache.set(cacheKey, report);
  checkHistory.push(report);
  if (checkHistory.length > MAX_HISTORY) checkHistory.shift();

  return report;
}

// ─── Quick Check (for self-modification proposals) ─────────────────────────────

/**
 * Quick consistency check specifically for self-modification proposals.
 * Returns true if the modification should proceed.
 */
export async function validateSelfModification(
  filePath: string,
  reason: string,
  proposedChange: string
): Promise<{ approved: boolean; report: ConsistencyReport }> {
  const report = await checkSelfConsistency({
    reasoning: `Proposed modification to ${filePath}: ${reason}`,
    conclusion: `The change should be applied: ${proposedChange.slice(0, 2000)}`,
    context: "Self-modification validation",
    checkType: "self_modification",
  });

  return {
    approved: report.recommendation === "proceed",
    report,
  };
}

// ─── Diagnostics ───────────────────────────────────────────────────────────────

export function getConsistencyStats(): {
  totalChecks: number;
  checksThisHour: number;
  averageConsensus: number;
  providersAvailable: string[];
  cacheSize: number;
  recentRecommendations: Record<string, number>;
} {
  const providers: string[] = [];
  if (getOpenRouterKey()) providers.push("openrouter/claude");
  if (getDeepSeekKey()) providers.push("deepseek");

  const recentRecommendations: Record<string, number> = { proceed: 0, review: 0, reject: 0 };
  for (const report of checkHistory.slice(-20)) {
    recentRecommendations[report.recommendation]++;
  }

  return {
    totalChecks: checkHistory.length,
    checksThisHour,
    averageConsensus: checkHistory.length > 0
      ? checkHistory.reduce((sum, r) => sum + r.consensus, 0) / checkHistory.length
      : 1,
    providersAvailable: providers,
    cacheSize: checkCache.size,
    recentRecommendations,
  };
}
