/**
 * semanticSelfModel.ts — Andromeda Phase 15: Semantic Self-Model
 *
 * The final piece of the Gödel Machine architecture. A Gödel Machine needs a
 * complete, accurate model of its own code in a form it can reason over.
 *
 * The existing selfModel.ts knows the *structure* of Andromeda (what modules exist,
 * whether they're healthy). This module adds the *semantic* layer: what each module
 * *does* in terms of its contribution to the utility function U(state).
 *
 * This enables Andromeda to:
 *   1. Predict utility delta BEFORE running a shadow test (fast pre-screening)
 *   2. Identify which modules most affect each utility component
 *   3. Prioritize RSI proposals by predicted impact
 *   4. Learn from history: update predictions based on actual RSI outcomes
 *
 * Architecture:
 *   - ModuleUtilityMap:    module → { utilityContribution, riskScore, dependencies }
 *   - queryByUtility():    "which modules affect test pass rate most?"
 *   - impactPredict():     predict utility delta for a proposed change
 *   - updateFromHistory(): learn from past RSI cycles
 *
 * Integration points:
 *   - rsiEngine.ts:          calls impactPredict() to pre-screen proposals
 *   - mctsPlanningEngine.ts: uses queryByUtility() to focus MCTS search
 *   - utilityFunction.ts:    provides the utility metric definitions
 *   - selfModel.ts:          extends the existing self-model with utility annotations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { UtilityWeights } from "./utilityFunction.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UtilityMetric =
  | "testPassRate"
  | "benchmarkDelta"
  | "latencyScore"
  | "tokenEfficiency"
  | "safetyScore"
  | "noveltyScore"
  | "stabilityScore";

export interface ModuleUtilityContribution {
  /** Module name (without .ts extension) */
  module: string;
  /** Human-readable description of what this module does */
  description: string;
  /** Contribution to each utility metric (-1.0 to +1.0) */
  utilityContribution: Record<UtilityMetric, number>;
  /** Risk score: probability that modifying this module causes regressions (0.0–1.0) */
  riskScore: number;
  /** Modules this one depends on (changes to dependencies affect this module) */
  dependencies: string[];
  /** Modules that depend on this one (changes here affect dependents) */
  dependents: string[];
  /** Confidence in this estimate (0.0–1.0) */
  confidence: number;
  /** Last updated timestamp */
  lastUpdated: number;
  /** Number of RSI cycles that touched this module */
  rsiTouchCount: number;
  /** Average utility delta when this module was modified */
  avgUtilityDelta: number;
}

export interface ImpactPrediction {
  /** Predicted utility delta (positive = improvement) */
  predictedDelta: number;
  /** Confidence in the prediction (0.0–1.0) */
  confidence: number;
  /** Which utility metrics are most affected */
  primaryMetrics: UtilityMetric[];
  /** Modules that will be transitively affected */
  transitiveImpact: string[];
  /** Risk assessment */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** Explanation */
  explanation: string;
  /** Whether this proposal is recommended */
  recommended: boolean;
}

export interface SemanticSelfModelState {
  version: string;
  modules: Record<string, ModuleUtilityContribution>;
  lastCalibrated: number;
  totalRSICycles: number;
}

// ─── Baseline Module Utility Map ──────────────────────────────────────────────
// Initial estimates based on architectural knowledge.
// These are updated automatically from RSI history.

const BASELINE_MODULE_MAP: Record<string, Omit<ModuleUtilityContribution, "lastUpdated" | "rsiTouchCount" | "avgUtilityDelta">> = {
  rsiEngine: {
    module: "rsiEngine",
    description: "Core recursive self-improvement engine — orchestrates all RSI cycles",
    utilityContribution: { testPassRate: 0.3, benchmarkDelta: 0.4, latencyScore: -0.1, tokenEfficiency: 0.1, safetyScore: 0.2, noveltyScore: 0.5, stabilityScore: -0.2 },
    riskScore: 0.7,
    dependencies: ["selfImprove", "twoPhaseCommit", "proofAssistant", "rsiScheduler"],
    dependents: ["autonomyOrchestrator", "selfImproveGuard"],
    confidence: 0.8,
  },
  twoPhaseCommit: {
    module: "twoPhaseCommit",
    description: "Safety gate for all self-modifications — prevents bad commits",
    utilityContribution: { testPassRate: 0.4, benchmarkDelta: 0.0, latencyScore: -0.2, tokenEfficiency: -0.1, safetyScore: 0.8, noveltyScore: 0.0, stabilityScore: 0.6 },
    riskScore: 0.9, // Very high risk — this is a safety-critical module
    dependencies: ["safetySupervisor", "failurePatternMemory", "memory"],
    dependents: ["rsiEngine", "selfModify", "selfImprove"],
    confidence: 0.9,
  },
  proofVerifier: {
    module: "proofVerifier",
    description: "Formal proof gate — verifies proposals before commit (Phase 13)",
    utilityContribution: { testPassRate: 0.2, benchmarkDelta: 0.0, latencyScore: -0.1, tokenEfficiency: -0.1, safetyScore: 0.9, noveltyScore: 0.0, stabilityScore: 0.5 },
    riskScore: 0.5,
    dependencies: ["proofAssistant", "formalVerification"],
    dependents: ["twoPhaseCommit", "rsiEngine"],
    confidence: 0.85,
  },
  utilityFunction: {
    module: "utilityFunction",
    description: "Unified utility function — single scalar U(state) for all improvements (Phase 14)",
    utilityContribution: { testPassRate: 0.1, benchmarkDelta: 0.2, latencyScore: 0.1, tokenEfficiency: 0.1, safetyScore: 0.1, noveltyScore: 0.1, stabilityScore: 0.2 },
    riskScore: 0.4,
    dependencies: [],
    dependents: ["rsiScheduler", "mctsPlanningEngine", "rsiEngine"],
    confidence: 0.75,
  },
  mctsPlanningEngine: {
    module: "mctsPlanningEngine",
    description: "Monte Carlo Tree Search for RSI planning — finds optimal refactor paths",
    utilityContribution: { testPassRate: 0.2, benchmarkDelta: 0.3, latencyScore: -0.2, tokenEfficiency: -0.1, safetyScore: 0.1, noveltyScore: 0.3, stabilityScore: 0.1 },
    riskScore: 0.3,
    dependencies: ["utilityFunction"],
    dependents: ["rsiEngine", "autonomyOrchestrator"],
    confidence: 0.7,
  },
  causalReasoning: {
    module: "causalReasoning",
    description: "Bayesian causal networks — finds root causes of test failures",
    utilityContribution: { testPassRate: 0.4, benchmarkDelta: 0.1, latencyScore: 0.0, tokenEfficiency: 0.0, safetyScore: 0.1, noveltyScore: 0.1, stabilityScore: 0.3 },
    riskScore: 0.2,
    dependencies: [],
    dependents: ["rsiEngine", "selfHeal"],
    confidence: 0.75,
  },
  epistemicBeliefModel: {
    module: "epistemicBeliefModel",
    description: "Theory of Mind for swarm agents — models what other agents believe",
    utilityContribution: { testPassRate: 0.0, benchmarkDelta: 0.1, latencyScore: -0.1, tokenEfficiency: -0.1, safetyScore: 0.2, noveltyScore: 0.2, stabilityScore: 0.1 },
    riskScore: 0.2,
    dependencies: ["swarmOrchestrator"],
    dependents: ["distributedProofConsensus"],
    confidence: 0.65,
  },
  astKnowledgeGraph: {
    module: "astKnowledgeGraph",
    description: "TypeScript AST knowledge graph — structural code understanding",
    utilityContribution: { testPassRate: 0.1, benchmarkDelta: 0.1, latencyScore: 0.0, tokenEfficiency: 0.1, safetyScore: 0.1, noveltyScore: 0.2, stabilityScore: 0.1 },
    riskScore: 0.2,
    dependencies: [],
    dependents: ["rsiEngine", "codebaseAnalyzer", "semanticSelfModel"],
    confidence: 0.7,
  },
  selfImprove: {
    module: "selfImprove",
    description: "Analyzes code and generates improvement proposals",
    utilityContribution: { testPassRate: 0.2, benchmarkDelta: 0.3, latencyScore: 0.0, tokenEfficiency: 0.1, safetyScore: 0.1, noveltyScore: 0.4, stabilityScore: -0.1 },
    riskScore: 0.5,
    dependencies: ["rsiEngine", "evalFramework", "adaptiveEval"],
    dependents: ["autonomyOrchestrator"],
    confidence: 0.8,
  },
  reactEngine: {
    module: "reactEngine",
    description: "ReAct agent loop — reason + act cycles for complex tasks",
    utilityContribution: { testPassRate: 0.1, benchmarkDelta: 0.2, latencyScore: -0.1, tokenEfficiency: -0.1, safetyScore: 0.0, noveltyScore: 0.2, stabilityScore: 0.0 },
    riskScore: 0.4,
    dependencies: ["goalManager", "taskDecomposer"],
    dependents: ["agentOrchestrator"],
    confidence: 0.7,
  },
  memory: {
    module: "memory",
    description: "Persistent memory storage and retrieval",
    utilityContribution: { testPassRate: 0.0, benchmarkDelta: 0.1, latencyScore: -0.1, tokenEfficiency: 0.2, safetyScore: 0.0, noveltyScore: 0.1, stabilityScore: 0.1 },
    riskScore: 0.3,
    dependencies: [],
    dependents: ["selfImprove", "rsiEngine", "goalManager"],
    confidence: 0.85,
  },
  llmProvider: {
    module: "llmProvider",
    description: "LLM API routing and provider management",
    utilityContribution: { testPassRate: 0.0, benchmarkDelta: 0.3, latencyScore: 0.4, tokenEfficiency: 0.3, safetyScore: 0.0, noveltyScore: 0.0, stabilityScore: 0.0 },
    riskScore: 0.6,
    dependencies: [],
    dependents: ["reactEngine", "selfImprove", "rsiEngine"],
    confidence: 0.8,
  },
  federatedLearning: {
    module: "federatedLearning",
    description: "Federated LoRA training across swarm nodes",
    utilityContribution: { testPassRate: 0.1, benchmarkDelta: 0.4, latencyScore: -0.2, tokenEfficiency: -0.1, safetyScore: 0.0, noveltyScore: 0.5, stabilityScore: -0.1 },
    riskScore: 0.4,
    dependencies: ["loraBackendDetector"],
    dependents: ["crossModalSelfImprovement"],
    confidence: 0.65,
  },
  safetySupervisor: {
    module: "safetySupervisor",
    description: "Safety validation for all self-modifications",
    utilityContribution: { testPassRate: 0.2, benchmarkDelta: 0.0, latencyScore: -0.1, tokenEfficiency: -0.1, safetyScore: 1.0, noveltyScore: 0.0, stabilityScore: 0.5 },
    riskScore: 0.95, // Extremely high risk — safety-critical
    dependencies: [],
    dependents: ["twoPhaseCommit", "selfModify"],
    confidence: 0.9,
  },
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const MODEL_PATH = join(DATA_DIR, "semantic_self_model.json");

let _state: SemanticSelfModelState = {
  version: "1.0.0",
  modules: {},
  lastCalibrated: 0,
  totalRSICycles: 0,
};

function initializeState(): void {
  const modules: Record<string, ModuleUtilityContribution> = {};
  for (const [key, base] of Object.entries(BASELINE_MODULE_MAP)) {
    modules[key] = {
      ...base,
      lastUpdated: Date.now(),
      rsiTouchCount: 0,
      avgUtilityDelta: 0,
    };
  }
  _state.modules = modules;
}

function loadState(): void {
  try {
    if (existsSync(MODEL_PATH)) {
      const raw = readFileSync(MODEL_PATH, "utf-8");
      const saved = JSON.parse(raw) as SemanticSelfModelState;
      // Merge saved state with baseline (new modules may have been added)
      _state = {
        ...saved,
        modules: { ...Object.fromEntries(
          Object.entries(BASELINE_MODULE_MAP).map(([k, v]) => [k, {
            ...v,
            lastUpdated: Date.now(),
            rsiTouchCount: 0,
            avgUtilityDelta: 0,
            ...saved.modules[k],
          }])
        ) },
      };
    } else {
      initializeState();
    }
  } catch {
    initializeState();
  }
}

function saveState(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MODEL_PATH, JSON.stringify(_state, null, 2));
  } catch { /* non-fatal */ }
}

// Initialize on module load
loadState();

// ─── Query Interface ──────────────────────────────────────────────────────────

/**
 * Query modules by their contribution to a specific utility metric.
 * Returns modules sorted by contribution (descending).
 */
export function queryByUtility(
  metric: UtilityMetric,
  minContribution = 0.0,
  limit = 10
): ModuleUtilityContribution[] {
  return Object.values(_state.modules)
    .filter(m => m.utilityContribution[metric] >= minContribution)
    .sort((a, b) => b.utilityContribution[metric] - a.utilityContribution[metric])
    .slice(0, limit);
}

/**
 * Get the top modules by overall utility impact (sum of absolute contributions).
 */
export function getTopModulesByImpact(limit = 10): Array<{
  module: string;
  totalImpact: number;
  riskScore: number;
  contribution: ModuleUtilityContribution;
}> {
  return Object.values(_state.modules)
    .map(m => ({
      module: m.module,
      totalImpact: Object.values(m.utilityContribution).reduce((sum, v) => sum + Math.abs(v), 0),
      riskScore: m.riskScore,
      contribution: m,
    }))
    .sort((a, b) => b.totalImpact - a.totalImpact)
    .slice(0, limit);
}

/**
 * Get modules with the highest risk score (most dangerous to modify).
 */
export function getHighRiskModules(threshold = 0.7): ModuleUtilityContribution[] {
  return Object.values(_state.modules)
    .filter(m => m.riskScore >= threshold)
    .sort((a, b) => b.riskScore - a.riskScore);
}

// ─── Impact Prediction ────────────────────────────────────────────────────────

/**
 * Predict the utility impact of modifying a specific module.
 * Uses the module's historical utility contribution and risk score.
 */
export function impactPredict(
  moduleName: string,
  changeType: "refactor" | "optimize" | "add_feature" | "fix_bug" | "remove" = "refactor"
): ImpactPrediction {
  const moduleInfo = _state.modules[moduleName];

  if (!moduleInfo) {
    return {
      predictedDelta: 0.0,
      confidence: 0.1,
      primaryMetrics: [],
      transitiveImpact: [],
      riskLevel: "medium",
      explanation: `Module '${moduleName}' not in semantic self-model — prediction unavailable`,
      recommended: false,
    };
  }

  // Change type multipliers
  const typeMultiplier: Record<string, number> = {
    fix_bug: 1.2,      // Bug fixes tend to improve more than predicted
    optimize: 1.0,
    refactor: 0.8,     // Refactors are riskier
    add_feature: 0.9,
    remove: -0.5,      // Removals usually reduce utility
  };
  const multiplier = typeMultiplier[changeType] ?? 1.0;

  // Compute predicted delta from utility contributions
  const contributions = moduleInfo.utilityContribution;
  const rawDelta = Object.values(contributions).reduce((sum, v) => sum + v, 0) / 7.0;
  const predictedDelta = rawDelta * multiplier * (1 - moduleInfo.riskScore * 0.3);

  // Find primary metrics (highest absolute contribution)
  const primaryMetrics = (Object.entries(contributions) as [UtilityMetric, number][])
    .filter(([, v]) => Math.abs(v) > 0.2)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 3)
    .map(([k]) => k);

  // Compute transitive impact (dependents that will be affected)
  const transitiveImpact = computeTransitiveImpact(moduleName);

  // Risk level
  let riskLevel: ImpactPrediction["riskLevel"] = "low";
  if (moduleInfo.riskScore >= 0.9) riskLevel = "critical";
  else if (moduleInfo.riskScore >= 0.7) riskLevel = "high";
  else if (moduleInfo.riskScore >= 0.4) riskLevel = "medium";

  // Confidence: higher if we have historical data
  const confidence = Math.min(0.9,
    moduleInfo.confidence * 0.6 +
    (moduleInfo.rsiTouchCount > 0 ? 0.3 : 0) +
    (moduleInfo.rsiTouchCount > 5 ? 0.1 : 0)
  );

  const recommended = predictedDelta > 0.01 && riskLevel !== "critical" && confidence > 0.4;

  return {
    predictedDelta,
    confidence,
    primaryMetrics,
    transitiveImpact,
    riskLevel,
    explanation: [
      `Module: ${moduleName} (${changeType})`,
      `Predicted utility delta: ${predictedDelta > 0 ? "+" : ""}${(predictedDelta * 100).toFixed(2)}%`,
      `Risk: ${riskLevel} (score: ${moduleInfo.riskScore.toFixed(2)})`,
      `Primary metrics: ${primaryMetrics.join(", ") || "none"}`,
      `Transitive impact: ${transitiveImpact.length} dependent modules`,
      `Historical: ${moduleInfo.rsiTouchCount} RSI cycles, avg delta: ${(moduleInfo.avgUtilityDelta * 100).toFixed(2)}%`,
    ].join(" | "),
    recommended,
  };
}

/**
 * Compute the set of modules transitively affected by modifying a given module.
 */
function computeTransitiveImpact(moduleName: string, visited = new Set<string>()): string[] {
  if (visited.has(moduleName)) return [];
  visited.add(moduleName);

  const moduleInfo = _state.modules[moduleName];
  if (!moduleInfo) return [];

  const affected: string[] = [...moduleInfo.dependents];
  for (const dep of moduleInfo.dependents) {
    affected.push(...computeTransitiveImpact(dep, visited));
  }

  return [...new Set(affected)].filter(m => m !== moduleName);
}

/**
 * Rank a list of proposed module changes by predicted utility impact.
 * Used by MCTS and RSI engine to prioritize proposals.
 */
export function rankProposals(proposals: Array<{
  moduleName: string;
  changeType?: "refactor" | "optimize" | "add_feature" | "fix_bug" | "remove";
  rationale?: string;
}>): Array<{
  moduleName: string;
  prediction: ImpactPrediction;
  rank: number;
}> {
  const ranked = proposals.map(p => ({
    moduleName: p.moduleName,
    prediction: impactPredict(p.moduleName, p.changeType ?? "refactor"),
  }));

  ranked.sort((a, b) => {
    // Sort by: recommended first, then by predicted delta * confidence
    const scoreA = a.prediction.recommended
      ? a.prediction.predictedDelta * a.prediction.confidence
      : -1;
    const scoreB = b.prediction.recommended
      ? b.prediction.predictedDelta * b.prediction.confidence
      : -1;
    return scoreB - scoreA;
  });

  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ─── Learning from History ────────────────────────────────────────────────────

/**
 * Update the semantic self-model from a completed RSI cycle.
 * This is how the model learns: actual outcomes update the utility contribution estimates.
 */
export function updateFromRSICycle(cycle: {
  moduleName: string;
  changeType: "refactor" | "optimize" | "add_feature" | "fix_bug" | "remove";
  actualUtilityDelta: number;
  accepted: boolean;
  testPassRateDelta: number;
  regressions: number;
}): void {
  const moduleInfo = _state.modules[cycle.moduleName];
  if (!moduleInfo) {
    // Add new module to the model
    _state.modules[cycle.moduleName] = {
      module: cycle.moduleName,
      description: `Auto-discovered module from RSI cycle`,
      utilityContribution: {
        testPassRate: cycle.testPassRateDelta,
        benchmarkDelta: cycle.actualUtilityDelta * 0.3,
        latencyScore: 0,
        tokenEfficiency: 0,
        safetyScore: cycle.regressions === 0 ? 0.1 : -0.1,
        noveltyScore: cycle.changeType === "add_feature" ? 0.2 : 0,
        stabilityScore: cycle.regressions === 0 ? 0.1 : -0.2,
      },
      riskScore: cycle.regressions > 0 ? 0.6 : 0.3,
      dependencies: [],
      dependents: [],
      confidence: 0.4,
      lastUpdated: Date.now(),
      rsiTouchCount: 1,
      avgUtilityDelta: cycle.actualUtilityDelta,
    };
  } else {
    // Update existing module with exponential moving average
    const alpha = 0.2; // Learning rate
    const n = moduleInfo.rsiTouchCount + 1;
    const newAvgDelta = ((moduleInfo.avgUtilityDelta * moduleInfo.rsiTouchCount) + cycle.actualUtilityDelta) / n;

    // Update utility contributions toward observed values
    moduleInfo.utilityContribution.testPassRate =
      moduleInfo.utilityContribution.testPassRate * (1 - alpha) + cycle.testPassRateDelta * alpha;
    moduleInfo.utilityContribution.stabilityScore =
      moduleInfo.utilityContribution.stabilityScore * (1 - alpha) +
      (cycle.regressions === 0 ? 0.1 : -0.2) * alpha;

    // Update risk score based on regression history
    if (cycle.regressions > 0) {
      moduleInfo.riskScore = Math.min(0.95, moduleInfo.riskScore + 0.05);
    } else if (cycle.accepted) {
      moduleInfo.riskScore = Math.max(0.1, moduleInfo.riskScore - 0.02);
    }

    // Update confidence as we accumulate more data
    moduleInfo.confidence = Math.min(0.95, 0.4 + (n / 20) * 0.55);
    moduleInfo.rsiTouchCount = n;
    moduleInfo.avgUtilityDelta = newAvgDelta;
    moduleInfo.lastUpdated = Date.now();
  }

  _state.totalRSICycles++;
  saveState();

  console.log(
    `[SemanticSelfModel] Updated ${cycle.moduleName}: delta=${(cycle.actualUtilityDelta * 100).toFixed(2)}%, ` +
    `risk=${_state.modules[cycle.moduleName]?.riskScore.toFixed(2)}, ` +
    `confidence=${_state.modules[cycle.moduleName]?.confidence.toFixed(2)}`
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getModuleInfo(moduleName: string): ModuleUtilityContribution | undefined {
  return _state.modules[moduleName];
}

export function getAllModules(): ModuleUtilityContribution[] {
  return Object.values(_state.modules);
}

export function getSemanticModelStats(): {
  totalModules: number;
  totalRSICycles: number;
  avgConfidence: number;
  highRiskModules: string[];
  lastCalibrated: number;
} {
  const modules = Object.values(_state.modules);
  const avgConfidence = modules.length > 0
    ? modules.reduce((sum, m) => sum + m.confidence, 0) / modules.length
    : 0;

  return {
    totalModules: modules.length,
    totalRSICycles: _state.totalRSICycles,
    avgConfidence,
    highRiskModules: modules.filter(m => m.riskScore >= 0.7).map(m => m.module),
    lastCalibrated: _state.lastCalibrated,
  };
}

/**
 * Get a summary suitable for injecting into the agent's system prompt.
 * Tells the agent which modules to focus on for maximum utility improvement.
 */
export function getSelfModelSummaryForPrompt(): string {
  const topModules = getTopModulesByImpact(5);
  const highRisk = getHighRiskModules(0.8);

  const lines = [
    "=== Semantic Self-Model Summary ===",
    `Total modules tracked: ${Object.keys(_state.modules).length}`,
    "",
    "Top 5 highest-impact modules to improve:",
    ...topModules.map((m, i) =>
      `  ${i + 1}. ${m.module} (impact: ${m.totalImpact.toFixed(2)}, risk: ${m.riskScore.toFixed(2)})`
    ),
    "",
    "High-risk modules (modify with extreme caution):",
    ...highRisk.map(m => `  ⚠️  ${m.module} (risk: ${m.riskScore.toFixed(2)})`),
  ];

  return lines.join("\n");
}

export function reloadState(): void {
  loadState();
}

/**
 * v9.0: Warm the globalThis cache used by aiPrompts.ts to inject the semantic
 * self-model summary into the system prompt without making buildSystemPrompt async.
 * Call this once on startup and after every RSI cycle.
 */
export function warmPromptCache(): void {
  try {
    const summary = getSelfModelSummaryForPrompt();
    // Prefix with newline so it appends cleanly to the architecture bullet list
    (globalThis as Record<string, unknown>).__semanticSelfModelSummary =
      `\n\nSemantic Self-Model (live):\n${summary}`;
  } catch {
    // Non-fatal
  }
}
