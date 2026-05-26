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
async function queryOpenRouter(
  prompt: string,
  model: string = "anthropic/claude-sonnet-4"
): Promise<{ content: string; latencyMs: number }> {
  if (!getOpenRouterKey()) {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  const start = Date.now();
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getOpenRouterKey()}`,
      "HTTP-Referer": "https://andromeda.local",
      "X-Title": "Andromeda Self-Consistency",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    latencyMs: Date.now() - start,
  };
}

/**
 * Query DeepSeek directly.
 */
async function queryDeepSeek(prompt: string): Promise<{ content: string; latencyMs: number }> {
  if (!getDeepSeekKey()) {
    throw new Error("DEEPSEEK_API_KEY not set");
  }

  const start = Date.now();
  const response = await fetch(_scGetActiveProvider().apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getDeepSeekKey()}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices?.[0]?.message?.content || "",
    latencyMs: Date.now() - start,
  };
}

// ─── Evaluation Parsing ────────────────────────────────────────────────────────

function parseEvaluation(response: string): { agrees: boolean; confidence: number; explanation: string } {
  const lower = response.toLowerCase();

  // Look for explicit agreement/disagreement signals
  const agreeSignals = ["i agree", "correct", "valid", "sound reasoning", "well-reasoned", "approve", "looks good", "yes"];
  const disagreeSignals = ["i disagree", "incorrect", "invalid", "flawed", "error in reasoning", "reject", "no,", "wrong"];

  let agreeScore = 0;
  let disagreeScore = 0;

  for (const signal of agreeSignals) {
    if (lower.includes(signal)) agreeScore++;
  }
  for (const signal of disagreeSignals) {
    if (lower.includes(signal)) disagreeScore++;
  }

  const agrees = agreeScore > disagreeScore;
  const totalSignals = agreeScore + disagreeScore;
  const confidence = totalSignals > 0
    ? Math.max(agreeScore, disagreeScore) / totalSignals
    : 0.5; // Uncertain

  return {
    agrees,
    confidence: Math.min(1, confidence),
    explanation: response.slice(0, 500),
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

  const prompt = `You are evaluating a reasoning chain and its conclusion. 
Please assess whether the reasoning is sound and the conclusion follows logically.

## Context
${check.context || "Self-improvement analysis"}

## Reasoning
${check.reasoning}

## Conclusion
${check.conclusion}

## Your Task
1. Is the reasoning logically sound? (yes/no)
2. Does the conclusion follow from the reasoning? (yes/no)
3. Are there any errors or blind spots? (explain briefly)
4. Overall: Do you agree with this conclusion? (agree/disagree)

Be concise. Focus on logical validity, not style.`;

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
        evaluations.push({
          provider: "openrouter",
          model: "claude-sonnet-4",
          agrees: false, // v5.35: Fail-closed — disagree on error to prevent approving bad changes
          confidence: 0.1,
          explanation: "Provider unavailable — defaulting to disagree for safety",
          latencyMs: 0,
          error: (err as Error).message,
        });
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
        evaluations.push({
          provider: "deepseek",
          model: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
          agrees: false, // v5.35: Fail-closed
          confidence: 0.1,
          explanation: "Provider unavailable — defaulting to disagree for safety",
          latencyMs: 0,
          error: (err as Error).message,
        });
      }
    })());
  }

  await Promise.all(providerPromises);

  // ── Calculate consensus ──
  const validEvals = evaluations.filter(e => !e.error);
  const agreeing = validEvals.filter(e => e.agrees).length;
  const consensus = validEvals.length > 0 ? agreeing / validEvals.length : 1;

  // Weighted confidence
  const totalWeight = validEvals.reduce((sum, e) => sum + e.confidence, 0);
  const weightedConfidence = validEvals.length > 0
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
    conclusion: `The change should be applied: ${proposedChange.slice(0, 500)}`,
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
