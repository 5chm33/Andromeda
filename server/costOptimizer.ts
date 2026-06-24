/**
 * costOptimizer.ts — v1.0.0
 *
 * Phase 1: Intelligent cost-aware model routing for RSI cycles.
 *
 * Strategy:
 *   - Track per-model cost per 1k tokens and actual usage
 *   - Score proposals by complexity (diff size, file criticality, area)
 *   - Route simple/low-risk proposals to cheap models (DeepSeek, Gemini Flash, Ollama)
 *   - Reserve premium models (Claude Sonnet/Opus) only for high-stakes proposals
 *   - Enforce daily/hourly spend caps to prevent runaway costs
 *   - Expose cost stats via /api/cost/stats
 */
import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const log = createLogger("costOptimizer");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface ModelCostProfile {
  modelId: string;
  providerName: string;
  costPer1kInputTokens: number;   // USD
  costPer1kOutputTokens: number;  // USD
  maxComplexityScore: number;     // 0-10: only use for proposals at or below this complexity
  isLocal: boolean;               // true = free (Ollama)
}

export interface ProposalComplexity {
  score: number;          // 0-10 (0=trivial, 10=critical architectural change)
  diffLines: number;
  fileCriticality: "critical" | "high" | "medium" | "low";
  area: string;
  reasoning: string;
}

export interface CostRecord {
  timestamp: number;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  proposalId?: string;
  area?: string;
}

export interface CostStats {
  totalSpentUsd: number;
  todaySpentUsd: number;
  thisHourSpentUsd: number;
  totalCalls: number;
  byModel: Record<string, { calls: number; totalUsd: number; avgCostUsd: number }>;
  savingsFromCheapRouting: number;  // estimated USD saved vs always using premium
  projectedMonthlyUsd: number;
}

// ─── Model Cost Registry ───────────────────────────────────────────────────────
const MODEL_PROFILES: ModelCostProfile[] = [
  // Free / local
  { modelId: "ollama/qwen2.5-coder:7b", providerName: "Ollama (Local)", costPer1kInputTokens: 0, costPer1kOutputTokens: 0, maxComplexityScore: 4, isLocal: true },
  { modelId: "ollama/llama3:8b", providerName: "Ollama (Local)", costPer1kInputTokens: 0, costPer1kOutputTokens: 0, maxComplexityScore: 3, isLocal: true },
  // Ultra-cheap cloud
  { modelId: "deepseek-chat", providerName: "DeepSeek", costPer1kInputTokens: 0.00014, costPer1kOutputTokens: 0.00028, maxComplexityScore: 6, isLocal: false },
  { modelId: "google/gemini-2.5-flash", providerName: "OpenRouter (Gemini Flash)", costPer1kInputTokens: 0.00015, costPer1kOutputTokens: 0.0006, maxComplexityScore: 6, isLocal: false },
  { modelId: "openai/gpt-4.1-mini", providerName: "OpenRouter (GPT-4.1 Mini)", costPer1kInputTokens: 0.0004, costPer1kOutputTokens: 0.0016, maxComplexityScore: 7, isLocal: false },
  // Mid-tier
  { modelId: "anthropic/claude-haiku-4", providerName: "OpenRouter (Claude Haiku 4)", costPer1kInputTokens: 0.0008, costPer1kOutputTokens: 0.004, maxComplexityScore: 8, isLocal: false },
  { modelId: "deepseek-reasoner", providerName: "DeepSeek Reasoner", costPer1kInputTokens: 0.00055, costPer1kOutputTokens: 0.00219, maxComplexityScore: 8, isLocal: false },
  // Premium
  { modelId: "anthropic/claude-sonnet-4", providerName: "OpenRouter (Claude Sonnet 4)", costPer1kInputTokens: 0.003, costPer1kOutputTokens: 0.015, maxComplexityScore: 10, isLocal: false },
  { modelId: "anthropic/claude-opus-4", providerName: "OpenRouter (Claude Opus 4)", costPer1kInputTokens: 0.015, costPer1kOutputTokens: 0.075, maxComplexityScore: 10, isLocal: false },
];

// ─── State ─────────────────────────────────────────────────────────────────────
const COST_LOG_FILE = path.join(__dirname, "..", "workspace", "cost-log.jsonl");
const costRecords: CostRecord[] = [];
let totalSavingsUsd = 0;

const DAILY_BUDGET_USD = parseFloat(process.env.RSI_DAILY_BUDGET_USD ?? "2.00");
const HOURLY_BUDGET_USD = parseFloat(process.env.RSI_HOURLY_BUDGET_USD ?? "0.50");

// ─── Critical file list (high complexity floor) ────────────────────────────────
const CRITICAL_FILES = new Set([
  "selfImprove.ts", "selfImproveGuard.ts", "rsiEngine.ts", "constitutionalConstraints.ts",
  "continuousImprover.ts", "evalDrivenTargeting.ts", "multiAgentImprover.ts",
  "sandboxVerifier.ts", "consensusEngine.ts", "zkProofSigning.ts",
]);

const HIGH_FILES = new Set([
  "adaptiveRouter.ts", "llmProvider.ts", "llmRouter.ts", "autonomyOrchestrator.ts",
  "swarmOrchestrator.ts", "algorithmicDiscovery.ts", "crossModalSelfImprovement.ts",
]);

// ─── Core Functions ────────────────────────────────────────────────────────────

/**
 * Score a proposal's complexity to determine which model tier to use.
 */
export function scoreProposalComplexity(
  targetFile: string,
  diff: string,
  area: string,
): ProposalComplexity {
  const filename = path.basename(targetFile);
  const diffLines = diff.split("\n").filter(l => l.startsWith("+") || l.startsWith("-")).length;

  // File criticality
  let fileCriticality: ProposalComplexity["fileCriticality"] = "low";
  let baseScore = 0;
  if (CRITICAL_FILES.has(filename)) { fileCriticality = "critical"; baseScore = 7; }
  else if (HIGH_FILES.has(filename)) { fileCriticality = "high"; baseScore = 5; }
  else if (filename.includes("test")) { fileCriticality = "low"; baseScore = 1; }
  else { fileCriticality = "medium"; baseScore = 3; }

  // Diff size modifier
  let diffScore = 0;
  if (diffLines > 100) diffScore = 3;
  else if (diffLines > 50) diffScore = 2;
  else if (diffLines > 20) diffScore = 1;

  // Area modifier
  let areaScore = 0;
  if (area === "security") areaScore = 2;
  else if (area === "architecture") areaScore = 1;
  else if (area === "readability") areaScore = -1;

  const score = Math.min(10, Math.max(0, baseScore + diffScore + areaScore));
  return {
    score,
    diffLines,
    fileCriticality,
    area,
    reasoning: `File=${fileCriticality}(+${baseScore}), diffLines=${diffLines}(+${diffScore}), area=${area}(+${areaScore}) → complexity=${score}/10`,
  };
}

/**
 * Select the cheapest model that can handle a given complexity score.
 * Respects daily/hourly budget caps.
 */
export function selectCostOptimalModel(
  complexity: ProposalComplexity,
  ollamaAvailable: boolean = !!process.env.OLLAMA_BASE_URL,
): { modelId: string; profile: ModelCostProfile; reason: string } {
  // Check budget caps
  const stats = getCostStats();
  if (stats.todaySpentUsd >= DAILY_BUDGET_USD) {
    // Force Ollama or cheapest available
    const fallback = MODEL_PROFILES.find(m => m.isLocal) || MODEL_PROFILES[2];
    return { modelId: fallback.modelId, profile: fallback, reason: `Daily budget cap reached ($${DAILY_BUDGET_USD}) — forced to ${fallback.providerName}` };
  }
  if (stats.thisHourSpentUsd >= HOURLY_BUDGET_USD) {
    const fallback = MODEL_PROFILES.find(m => m.isLocal) || MODEL_PROFILES[2];
    return { modelId: fallback.modelId, profile: fallback, reason: `Hourly budget cap reached ($${HOURLY_BUDGET_USD}) — forced to ${fallback.providerName}` };
  }

  // Find cheapest model that meets the complexity requirement
  const eligible = MODEL_PROFILES
    .filter(m => m.maxComplexityScore >= complexity.score)
    .filter(m => !m.isLocal || ollamaAvailable)
    .sort((a, b) => (a.costPer1kInputTokens + a.costPer1kOutputTokens) - (b.costPer1kInputTokens + b.costPer1kOutputTokens));

  if (eligible.length === 0) {
    // Fallback to premium
    const premium = MODEL_PROFILES[MODEL_PROFILES.length - 1];
    return { modelId: premium.modelId, profile: premium, reason: "No eligible model found — using premium fallback" };
  }

  const chosen = eligible[0];
  // Estimate savings vs always using Claude Sonnet
  const premiumProfile = MODEL_PROFILES.find(m => m.modelId === "anthropic/claude-sonnet-4")!;
  const estimatedTokens = Math.max(complexity.diffLines * 50, 1000);
  const premiumCost = (estimatedTokens / 1000) * (premiumProfile.costPer1kInputTokens + premiumProfile.costPer1kOutputTokens);
  const chosenCost = (estimatedTokens / 1000) * (chosen.costPer1kInputTokens + chosen.costPer1kOutputTokens);
  totalSavingsUsd += Math.max(0, premiumCost - chosenCost);

  return {
    modelId: chosen.modelId,
    profile: chosen,
    reason: `Complexity ${complexity.score}/10 → ${chosen.providerName} (est. $${chosenCost.toFixed(5)} vs $${premiumCost.toFixed(5)} for Claude Sonnet)`,
  };
}

/**
 * Record actual token usage and cost after an LLM call.
 */
const MODEL_PROFILE_MAP = new Map(MODEL_PROFILES.map(p => [p.modelId, p]));

export function recordCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  proposalId?: string,
  area?: string,
): void {
  const profile = MODEL_PROFILE_MAP.get(modelId);
  if (!profile) return;

  const costUsd = (inputTokens / 1000) * profile.costPer1kInputTokens
    + (outputTokens / 1000) * profile.costPer1kOutputTokens;

  const record: CostRecord = {
    timestamp: Date.now(),
    modelId,
    inputTokens,
    outputTokens,
    costUsd,
    proposalId,
    area,
  };

  costRecords.push(record);
  // Keep last 10000 records in memory
  if (costRecords.length > 10000) costRecords.splice(0, costRecords.length - 10000);

  // Persist to JSONL
  try {
    fs.mkdirSync(path.dirname(COST_LOG_FILE), { recursive: true });
    fs.appendFileSync(COST_LOG_FILE, JSON.stringify(record) + "\n");
  } catch { /* non-fatal */ }
}

/**
 * Get cost statistics for the dashboard.
 */
export function getCostStats(): CostStats {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const hourAgo = now - 60 * 60 * 1000;

  const todayRecords = costRecords.filter(r => r.timestamp >= dayAgo);
  const hourRecords = costRecords.filter(r => r.timestamp >= hourAgo);

  const totalSpentUsd = costRecords.reduce((s, r) => s + r.costUsd, 0);
  const todaySpentUsd = todayRecords.reduce((s, r) => s + r.costUsd, 0);
  const thisHourSpentUsd = hourRecords.reduce((s, r) => s + r.costUsd, 0);

  const byModel: CostStats["byModel"] = {};
  for (const r of costRecords) {
    if (!byModel[r.modelId]) byModel[r.modelId] = { calls: 0, totalUsd: 0, avgCostUsd: 0 };
    byModel[r.modelId].calls++;
    byModel[r.modelId].totalUsd += r.costUsd;
    byModel[r.modelId].avgCostUsd = byModel[r.modelId].totalUsd / byModel[r.modelId].calls;
  }

  // Project monthly based on daily average
  const daysOfData = Math.max(1, (now - (costRecords[0]?.timestamp ?? now)) / (24 * 60 * 60 * 1000));
  const projectedMonthlyUsd = (totalSpentUsd / daysOfData) * 30;

  return {
    totalSpentUsd,
    todaySpentUsd,
    thisHourSpentUsd,
    totalCalls: costRecords.length,
    byModel,
    savingsFromCheapRouting: totalSavingsUsd,
    projectedMonthlyUsd,
  };
}

/**
 * Load historical cost records from disk on startup.
 */
export function initCostOptimizer(): void {
  try {
    if (fs.existsSync(COST_LOG_FILE)) {
      const lines = fs.readFileSync(COST_LOG_FILE, "utf-8").trim().split("\n").filter(Boolean);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // Keep last 30 days
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as CostRecord;
          if (record.timestamp >= cutoff) costRecords.push(record);
        } catch { /* skip malformed lines */ }
      }
      log.info(`[CostOptimizer] Loaded ${costRecords.length} cost records from disk`);
    }
  } catch { /* non-fatal */ }
  log.info(`[CostOptimizer] Initialized — daily budget: $${DAILY_BUDGET_USD}, hourly: $${HOURLY_BUDGET_USD}`);
}

export function getModelProfiles(): ModelCostProfile[] {
  return [...MODEL_PROFILES];
}
