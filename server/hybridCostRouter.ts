/**
 * hybridCostRouter.ts — v1.0.0
 *
 * Intelligent Hybrid Cost Router for RSI Cycles
 *
 * Based on the performance analysis in the project notes:
 * - Top cloud models (GPT-5.5, Claude Opus 4.7) are ~20-24% better on coding tasks
 * - Best local/open-weight models (DeepSeek V4-Pro) are within ~7% on SWE-Bench
 * - The real-world sweet spot is a HYBRID system:
 *   1. Use cheap/fast models for routine tasks (readability, refactoring)
 *   2. Reserve premium models for high-stakes RSI phases (proposal, verification)
 *   3. Use Ollama (local) for pre-screening and simple checks
 *
 * This router implements a 3-tier system:
 *   Tier 1 (FREE): Ollama local models — pre-screening, simple checks
 *   Tier 2 (CHEAP): DeepSeek Flash, Gemini Flash — routine proposals
 *   Tier 3 (PREMIUM): DeepSeek V4-Pro, Claude Opus — high-impact proposals
 *
 * The router tracks cost per cycle, proposal success rate per tier, and
 * automatically adjusts tier selection based on observed performance.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const _hDir = path.dirname(fileURLToPath(import.meta.url));
function _findRoot(): string {
  let cur = _hDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(_hDir, "..", "..");
}
const PROJECT_ROOT = _findRoot();

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModelTier = "local" | "cheap" | "premium";

export interface ModelConfig {
  modelId: string;
  providerName: string;
  tier: ModelTier;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  maxComplexityScore: number;
  isLocal: boolean;
  successRate: number; // 0-1, tracked over time
  avgLatencyMs: number;
  envKey?: string;
}

export interface RoutingDecision {
  selectedModel: ModelConfig;
  tier: ModelTier;
  reason: string;
  estimatedCost: number;
  estimatedLatencyMs: number;
  fallbackModels: ModelConfig[];
}

export interface CycleRoutingStats {
  cycleId: string;
  proposalCount: number;
  tierBreakdown: Record<ModelTier, number>;
  totalCost: number;
  successRate: number;
  timestamp: string;
}

export interface HybridRouterStats {
  totalCycles: number;
  totalProposals: number;
  totalCostUsd: number;
  averageCostPerProposal: number;
  tierSuccessRates: Record<ModelTier, number>;
  savingsVsPremiumOnly: number; // % saved vs always using premium
  lastUpdated: string;
}

// ─── Model Registry ───────────────────────────────────────────────────────────

const MODEL_REGISTRY: ModelConfig[] = [
  // Tier 1: Local (FREE)
  {
    modelId: "llama3.2:3b",
    providerName: "Ollama (Local)",
    tier: "local",
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxComplexityScore: 4,
    isLocal: true,
    successRate: 0.55,
    avgLatencyMs: 8000,
    envKey: "OLLAMA_BASE_URL",
  },
  {
    modelId: "deepseek-coder:6.7b",
    providerName: "Ollama (Local DeepSeek Coder)",
    tier: "local",
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxComplexityScore: 6,
    isLocal: true,
    successRate: 0.65,
    avgLatencyMs: 12000,
    envKey: "OLLAMA_BASE_URL",
  },
  // Tier 2: Cheap cloud
  {
    modelId: "deepseek/deepseek-chat-v3-0324:free",
    providerName: "OpenRouter (DeepSeek V3 Free)",
    tier: "cheap",
    costPer1kInputTokens: 0,
    costPer1kOutputTokens: 0,
    maxComplexityScore: 7,
    isLocal: false,
    successRate: 0.72,
    avgLatencyMs: 4000,
    envKey: "OPENROUTER_API_KEY",
  },
  {
    modelId: "google/gemini-2.5-flash",
    providerName: "OpenRouter (Gemini 2.5 Flash)",
    tier: "cheap",
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
    maxComplexityScore: 7,
    isLocal: false,
    successRate: 0.74,
    avgLatencyMs: 3000,
    envKey: "OPENROUTER_API_KEY",
  },
  {
    modelId: "openai/gpt-4.1-mini",
    providerName: "OpenRouter (GPT-4.1 Mini)",
    tier: "cheap",
    costPer1kInputTokens: 0.0004,
    costPer1kOutputTokens: 0.0016,
    maxComplexityScore: 7,
    isLocal: false,
    successRate: 0.76,
    avgLatencyMs: 2500,
    envKey: "OPENROUTER_API_KEY",
  },
  // Tier 3: Premium
  {
    modelId: "deepseek/deepseek-r1",
    providerName: "DeepSeek (R1 Reasoning)",
    tier: "premium",
    costPer1kInputTokens: 0.0014,
    costPer1kOutputTokens: 0.0028,
    maxComplexityScore: 10,
    isLocal: false,
    successRate: 0.85,
    avgLatencyMs: 8000,
    envKey: "DEEPSEEK_API_KEY",
  },
  {
    modelId: "anthropic/claude-opus-4-5",
    providerName: "OpenRouter (Claude Opus 4.5)",
    tier: "premium",
    costPer1kInputTokens: 0.015,
    costPer1kOutputTokens: 0.075,
    maxComplexityScore: 10,
    isLocal: false,
    successRate: 0.88,
    avgLatencyMs: 6000,
    envKey: "OPENROUTER_API_KEY",
  },
  {
    modelId: "deepseek/deepseek-prover-v2",
    providerName: "DeepSeek (Prover V2)",
    tier: "premium",
    costPer1kInputTokens: 0.002,
    costPer1kOutputTokens: 0.004,
    maxComplexityScore: 10,
    isLocal: false,
    successRate: 0.87,
    avgLatencyMs: 7000,
    envKey: "DEEPSEEK_API_KEY",
  },
];

// ─── Routing Logic ────────────────────────────────────────────────────────────

/**
 * Determine the appropriate model tier for a given proposal.
 *
 * Routing rules (based on the performance analysis):
 * - complexity <= 4 AND impact == "low" → local (free)
 * - complexity <= 7 AND impact != "high" AND no dependents → cheap
 * - complexity > 7 OR impact == "high" OR many dependents → premium
 * - After 3 consecutive failures on cheap → escalate to premium
 */
export function selectModelForProposal(
  complexityScore: number,
  impact: "low" | "medium" | "high",
  dependentCount: number,
  consecutiveFailures: number,
  forceLocal: boolean = false,
): RoutingDecision {
  // Input validation
  if (typeof complexityScore !== 'number' || complexityScore < 0 || complexityScore > 10) {
    complexityScore = 5;
  }
  if (!['low', 'medium', 'high'].includes(impact)) {
    impact = 'medium';
  }
  if (typeof dependentCount !== 'number' || dependentCount < 0) {
    dependentCount = 0;
  }
  if (typeof consecutiveFailures !== 'number' || consecutiveFailures < 0) {
    consecutiveFailures = 0;
  }
  // Force local if requested (e.g. Ollama is available and we want zero cost)
  if (forceLocal) {
    const localModels = getAvailableModels("local");
    if (localModels.length > 0) {
      return buildDecision(localModels[0], "local", "Forced local execution", complexityScore, localModels.slice(1));
    }
  }

  // Escalate to premium after consecutive failures
  if (consecutiveFailures >= 3) {
    const premiumModels = getAvailableModels("premium");
    if (premiumModels.length > 0) {
      return buildDecision(
        premiumModels[0],
        "premium",
        `Escalated to premium after ${consecutiveFailures} consecutive failures`,
        complexityScore,
        premiumModels.slice(1),
      );
    }
  }

  // High-impact or high-complexity → premium
  if (impact === "high" || complexityScore > 7 || dependentCount > 10) {
    const premiumModels = getAvailableModels("premium");
    if (premiumModels.length > 0) {
      return buildDecision(
        premiumModels[0],
        "premium",
        `Premium required: impact=${impact}, complexity=${complexityScore}, dependents=${dependentCount}`,
        complexityScore,
        [...getAvailableModels("cheap"), ...premiumModels.slice(1)],
      );
    }
  }

  // Low complexity + low impact → try local first
  if (complexityScore <= 4 && impact === "low") {
    const localModels = getAvailableModels("local");
    if (localModels.length > 0) {
      return buildDecision(
        localModels[0],
        "local",
        `Local model sufficient: complexity=${complexityScore}, impact=${impact}`,
        complexityScore,
        [...getAvailableModels("cheap"), ...getAvailableModels("premium")],
      );
    }
  }

  // Default: cheap cloud
  const cheapModels = getAvailableModels("cheap");
  if (cheapModels.length > 0) {
    return buildDecision(
      cheapModels[0],
      "cheap",
      `Cheap model selected: complexity=${complexityScore}, impact=${impact}`,
      complexityScore,
      [...cheapModels.slice(1), ...getAvailableModels("premium")],
    );
  }

  // Last resort: any available model
  const allModels = MODEL_REGISTRY.filter(m => isModelAvailable(m));
  if (allModels.length > 0) {
    return buildDecision(allModels[0], allModels[0].tier, "Last resort fallback", complexityScore, allModels.slice(1));
  }

  // No models available — return a dummy decision
  return buildDecision(MODEL_REGISTRY[2], "cheap", "No models available — using default", complexityScore, []);
}

function getAvailableModels(tier: ModelTier): ModelConfig[] {
  return MODEL_REGISTRY
    .filter(m => m.tier === tier && isModelAvailable(m))
    .sort((a, b) => b.successRate - a.successRate);
}

function isModelAvailable(model: ModelConfig): boolean {
  if (model.isLocal) {
    // Check if Ollama is running
    return !!process.env.OLLAMA_BASE_URL;
  }
  if (model.envKey) {
    return !!process.env[model.envKey];
  }
  return false;
}

function buildDecision(
  model: ModelConfig,
  tier: ModelTier,
  reason: string,
  complexityScore: number,
  fallbacks: ModelConfig[],
): RoutingDecision {
  // Estimate cost for a typical proposal (2000 input tokens, 500 output tokens)
  const estimatedCost =
    (2000 / 1000) * model.costPer1kInputTokens +
    (500 / 1000) * model.costPer1kOutputTokens;

  return {
    selectedModel: model,
    tier,
    reason,
    estimatedCost,
    estimatedLatencyMs: model.avgLatencyMs,
    fallbackModels: fallbacks.slice(0, 3),
  };
}

// ─── Cost Tracking ────────────────────────────────────────────────────────────

export function recordRoutingOutcome(
  decision: RoutingDecision,
  success: boolean,
  actualCost: number,
  actualLatencyMs: number,
): void {
  // Update the model's tracked success rate (exponential moving average)
  const model = MODEL_REGISTRY.find(m => m.modelId === decision.selectedModel.modelId);
  if (model) {
    const alpha = 0.1; // Learning rate
    model.successRate = model.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
    model.avgLatencyMs = Math.round(model.avgLatencyMs * (1 - alpha) + actualLatencyMs * alpha);
  }

  // Update global stats
  _stats.totalProposals++;
  _stats.totalCostUsd += actualCost;
  _stats.averageCostPerProposal = _stats.totalCostUsd / _stats.totalProposals;

  const tier = decision.tier;
  if (!_stats.tierSuccessRates[tier]) _stats.tierSuccessRates[tier] = 0;
  _stats.tierSuccessRates[tier] = _stats.tierSuccessRates[tier] * 0.9 + (success ? 1 : 0) * 0.1;

  // Calculate savings vs always using premium
  const premiumCost = (2000 / 1000) * 0.015 + (500 / 1000) * 0.075; // Claude Opus rates
  _stats.savingsVsPremiumOnly = Math.round(
    (1 - _stats.averageCostPerProposal / premiumCost) * 100
  );

  _stats.lastUpdated = new Date().toISOString();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

let _stats: HybridRouterStats = {
  totalCycles: 0,
  totalProposals: 0,
  totalCostUsd: 0,
  averageCostPerProposal: 0,
  tierSuccessRates: { local: 0, cheap: 0, premium: 0 },
  savingsVsPremiumOnly: 0,
  lastUpdated: new Date().toISOString(),
};

export function getHybridRouterStats(): HybridRouterStats {
  return { ..._stats };
}

export function getModelRegistry(): ModelConfig[] {
  return MODEL_REGISTRY.map(m => ({ ...m }));
}

export function initHybridCostRouter(): void {
  _stats = {
    totalCycles: 0,
    totalProposals: 0,
    totalCostUsd: 0,
    averageCostPerProposal: 0,
    tierSuccessRates: { local: 0, cheap: 0, premium: 0 },
    savingsVsPremiumOnly: 0,
    lastUpdated: new Date().toISOString(),
  };

  const availableLocal = MODEL_REGISTRY.filter(m => m.tier === "local" && isModelAvailable(m)).length;
  const availableCheap = MODEL_REGISTRY.filter(m => m.tier === "cheap" && isModelAvailable(m)).length;
  const availablePremium = MODEL_REGISTRY.filter(m => m.tier === "premium" && isModelAvailable(m)).length;

  console.log(
    `[HybridCostRouter] Initialized — local: ${availableLocal}, cheap: ${availableCheap}, premium: ${availablePremium} models available`
  );
}
