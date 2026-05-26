/**
 * modelRegistry.ts — v5.17
 *
 * Model-Aware Context Windows & LLM Self-Optimization Module.
 *
 * Replaces the hardcoded 131072 context window with per-model lookups.
 * Also implements dynamic LLM configuration optimization based on:
 * - Task type (code gen, analysis, creative, search)
 * - Performance history (latency, quality, cost)
 * - Error patterns (rate limits, timeouts, truncation)
 *
 * Features:
 * - Per-model context window, max output tokens, pricing
 * - Task-type routing (optimal model per task)
 * - Performance tracking and auto-tuning
 * - A/B testing support for model comparisons
 * - Fallback chains when primary model is unavailable
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  id: string;
  provider: "deepseek" | "openai" | "anthropic" | "google" | "local" | "custom";
  contextWindow: number; // Total context window in tokens
  maxOutputTokens: number; // Max tokens in a single response
  inputCostPer1M: number; // USD per 1M input tokens
  outputCostPer1M: number; // USD per 1M output tokens
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean; // Chain-of-thought / thinking mode
  latencyClass: "fast" | "medium" | "slow"; // Typical response speed
  qualityTier: "flagship" | "standard" | "economy"; // Quality level
  deprecated: boolean;
}

export interface TaskProfile {
  type: "code_generation" | "code_analysis" | "creative_writing" | "research" | "conversation" | "file_analysis" | "self_improvement" | "planning" | "search_synthesis";
  optimalTemperature: number;
  optimalMaxTokens: number;
  preferredModels: string[]; // Ordered by preference
  requiresReasoning: boolean;
  requiresLargeContext: boolean;
  requiresVision: boolean;
}

export interface PerformanceRecord {
  modelId: string;
  taskType: string;
  timestamp: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  truncated: boolean;
  qualityScore?: number; // 0-1, if available
}

export interface OptimizationResult {
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoning: string;
}

// ─── Model Registry ───────────────────────────────────────────────────────────

const MODEL_SPECS: ModelSpec[] = [
  // v6.17: Short-form aliases for DeepSeek direct API (no slash prefix)
  {
    id: "deepseek-chat",
    provider: "deepseek",
    contextWindow: 131072,
    maxOutputTokens: 65536,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    supportsJsonMode: true,
    tier: "fast" as const,
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    contextWindow: 131072,
    maxOutputTokens: 65536,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
    supportsJsonMode: false,
    tier: "reasoning" as const,
  },
  // DeepSeek Models
  {
    id: "deepseek/deepseek-chat",
    provider: "deepseek",
    contextWindow: 131072,
    maxOutputTokens: 32768,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: false,
    latencyClass: "fast",
    qualityTier: "standard",
    deprecated: false,
  },
  {
    id: "deepseek/deepseek-reasoner",
    provider: "deepseek",
    contextWindow: 131072,
    maxOutputTokens: 32768,
    inputCostPer1M: 0.55,
    outputCostPer1M: 2.19,
    supportsStreaming: true,
    supportsTools: false,
    supportsVision: false,
    supportsReasoning: true,
    latencyClass: "slow",
    qualityTier: "flagship",
    deprecated: false,
  },
  // OpenAI Models
  {
    id: "gpt-4o",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1M: 2.50,
    outputCostPer1M: 10.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "medium",
    qualityTier: "flagship",
    deprecated: false,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.60,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "fast",
    qualityTier: "economy",
    deprecated: false,
  },
  {
    id: "gpt-4-turbo",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputCostPer1M: 10.00,
    outputCostPer1M: 30.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "medium",
    qualityTier: "flagship",
    deprecated: false,
  },
  {
    id: "o1",
    provider: "openai",
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputCostPer1M: 15.00,
    outputCostPer1M: 60.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    latencyClass: "slow",
    qualityTier: "flagship",
    deprecated: false,
  },
  {
    id: "o1-mini",
    provider: "openai",
    contextWindow: 128000,
    maxOutputTokens: 65536,
    inputCostPer1M: 3.00,
    outputCostPer1M: 12.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsReasoning: true,
    latencyClass: "medium",
    qualityTier: "standard",
    deprecated: false,
  },
  // Anthropic Models
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "medium",
    qualityTier: "flagship",
    deprecated: false,
  },
  {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "slow",
    qualityTier: "flagship",
    deprecated: false,
  },
  {
    id: "claude-3-haiku-20240307",
    provider: "anthropic",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputCostPer1M: 0.25,
    outputCostPer1M: 1.25,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "fast",
    qualityTier: "economy",
    deprecated: false,
  },
  // Google Models
  {
    id: "gemini-2.0-flash",
    provider: "google",
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputCostPer1M: 0.075,
    outputCostPer1M: 0.30,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
    latencyClass: "fast",
    qualityTier: "standard",
    deprecated: false,
  },
  {
    id: "gemini-2.5-pro",
    provider: "google",
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.00,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
    latencyClass: "medium",
    qualityTier: "flagship",
    deprecated: false,
  },
];

// ─── Task Profiles ────────────────────────────────────────────────────────────

const TASK_PROFILES: TaskProfile[] = [
  {
    type: "code_generation",
    optimalTemperature: 0.3,
    optimalMaxTokens: 16000,
    preferredModels: ["deepseek/deepseek-chat", "claude-3-5-sonnet-20241022", "gpt-4o"],
    requiresReasoning: false,
    requiresLargeContext: false,
    requiresVision: false,
  },
  {
    type: "code_analysis",
    optimalTemperature: 0.2,
    optimalMaxTokens: 32000,
    preferredModels: ["deepseek/deepseek-reasoner", "o1", "claude-3-5-sonnet-20241022"],
    requiresReasoning: true,
    requiresLargeContext: true,
    requiresVision: false,
  },
  {
    type: "creative_writing",
    optimalTemperature: 0.9,
    optimalMaxTokens: 8000,
    preferredModels: ["claude-3-5-sonnet-20241022", "gpt-4o", "deepseek/deepseek-chat"],
    requiresReasoning: false,
    requiresLargeContext: false,
    requiresVision: false,
  },
  {
    type: "research",
    optimalTemperature: 0.4,
    optimalMaxTokens: 16000,
    preferredModels: ["deepseek/deepseek-chat", "gpt-4o", "gemini-2.5-pro"],
    requiresReasoning: false,
    requiresLargeContext: true,
    requiresVision: false,
  },
  {
    type: "conversation",
    optimalTemperature: 0.7,
    optimalMaxTokens: 4000,
    preferredModels: ["deepseek/deepseek-chat", "gpt-4o-mini", "claude-3-haiku-20240307"],
    requiresReasoning: false,
    requiresLargeContext: false,
    requiresVision: false,
  },
  {
    type: "file_analysis",
    optimalTemperature: 0.2,
    optimalMaxTokens: 32000,
    preferredModels: ["deepseek/deepseek-chat", "gemini-2.5-pro", "claude-3-5-sonnet-20241022"],
    requiresReasoning: false,
    requiresLargeContext: true,
    requiresVision: false,
  },
  {
    type: "self_improvement",
    optimalTemperature: 0.3,
    optimalMaxTokens: 32000,
    preferredModels: ["deepseek/deepseek-reasoner", "o1", "deepseek/deepseek-chat"],
    requiresReasoning: true,
    requiresLargeContext: true,
    requiresVision: false,
  },
  {
    type: "planning",
    optimalTemperature: 0.5,
    optimalMaxTokens: 8000,
    preferredModels: ["deepseek/deepseek-reasoner", "o1", "gpt-4o"],
    requiresReasoning: true,
    requiresLargeContext: false,
    requiresVision: false,
  },
  {
    type: "search_synthesis",
    optimalTemperature: 0.4,
    optimalMaxTokens: 8000,
    preferredModels: ["deepseek/deepseek-chat", "gpt-4o-mini", "gemini-2.0-flash"],
    requiresReasoning: false,
    requiresLargeContext: false,
    requiresVision: false,
  },
];

// ─── Performance Tracking ─────────────────────────────────────────────────────

const performanceHistory: PerformanceRecord[] = [];
const MAX_PERF_HISTORY = 1000;

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getPerfStorePath(): string {
  const workspaceDir = path.resolve(getServerDir(), "..", "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_model_perf.json");
}

function loadPerfHistory(): void {
  const p = getPerfStorePath();
  if (!fs.existsSync(p)) return;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (Array.isArray(data)) {
      performanceHistory.push(...data.slice(-MAX_PERF_HISTORY));
    }
  } catch { /* ignore */ }
}

function savePerfHistory(): void {
  try {
    fs.writeFileSync(getPerfStorePath(), JSON.stringify(performanceHistory.slice(-MAX_PERF_HISTORY), null, 2), "utf-8");
  } catch { /* ignore */ }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Get the context window size for a specific model.
 * This replaces the hardcoded 131072 throughout the codebase.
 */
export function getContextWindow(modelId: string): number {
  const spec = MODEL_SPECS.find(m => m.id === modelId);
  if (spec) return spec.contextWindow;

  // Fallback: check if model name contains hints
  if (modelId.includes("gemini")) return 1048576;
  if (modelId.includes("claude")) return 200000;
  if (modelId.includes("gpt-4")) return 128000;
  if (modelId.includes("deepseek")) return 131072;

  // Default fallback
  return 131072;
}

/**
 * Get the max output tokens for a specific model.
 */
export function getMaxOutputTokens(modelId: string): number {
  const spec = MODEL_SPECS.find(m => m.id === modelId);
  if (spec) return spec.maxOutputTokens;

  // Default fallback
  return 32000;
}

/**
 * Get full model spec.
 */
export function getModelSpec(modelId: string): ModelSpec | undefined {
  return MODEL_SPECS.find(m => m.id === modelId);
}

/**
 * List all available models.
 */
export function listModels(filter?: { provider?: string; qualityTier?: string; supportsVision?: boolean }): ModelSpec[] {
  let models = MODEL_SPECS.filter(m => !m.deprecated);

  if (filter?.provider) models = models.filter(m => m.provider === filter.provider);
  if (filter?.qualityTier) models = models.filter(m => m.qualityTier === filter.qualityTier);
  if (filter?.supportsVision !== undefined) models = models.filter(m => m.supportsVision === filter.supportsVision);

  return models;
}

/**
 * Get the optimal model configuration for a given task type.
 * This is the core self-optimization function.
 */
export function getOptimalConfig(taskType: TaskProfile["type"], constraints?: {
  maxCostPer1M?: number;
  maxLatencyMs?: number;
  requireVision?: boolean;
  contextNeeded?: number;
}): OptimizationResult {
  const profile = TASK_PROFILES.find(p => p.type === taskType);
  if (!profile) {
    return {
      modelId: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
      temperature: 0.7,
      maxTokens: 32000,
      reasoning: "No profile found for task type, using defaults",
    };
  }

  // Find the best available model from preferred list
  const currentModel = process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat";
  let selectedModel = currentModel;
  let reasoning = "";

  // Check performance history for this task type
  const recentPerf = performanceHistory
    .filter(r => r.taskType === taskType && r.timestamp > Date.now() - 86400_000)
    .reduce((acc, r) => {
      if (!acc[r.modelId]) acc[r.modelId] = { total: 0, success: 0, avgLatency: 0, latencies: [] };
      acc[r.modelId].total++;
      if (r.success) acc[r.modelId].success++;
      acc[r.modelId].latencies.push(r.latencyMs);
      return acc;
    }, {} as Record<string, { total: number; success: number; avgLatency: number; latencies: number[] }>);

  // Calculate average latencies
  for (const [_modelId, stats] of Object.entries(recentPerf)) {
    stats.avgLatency = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;
  }

  // Select model based on performance + constraints
  for (const preferredId of profile.preferredModels) {
    const spec = MODEL_SPECS.find(m => m.id === preferredId);
    if (!spec || spec.deprecated) continue;

    // Check constraints
    if (constraints?.maxCostPer1M && spec.outputCostPer1M > constraints.maxCostPer1M) continue;
    if (constraints?.requireVision && !spec.supportsVision) continue;
    if (constraints?.contextNeeded && spec.contextWindow < constraints.contextNeeded) continue;
    if (profile.requiresReasoning && !spec.supportsReasoning) continue;

    // Check if this model has good performance history
    const perf = recentPerf[preferredId];
    if (perf && perf.total > 5) {
      const successRate = perf.success / perf.total;
      if (successRate < 0.8) {
        reasoning += `Skipping ${preferredId} (success rate: ${(successRate * 100).toFixed(0)}%). `;
        continue;
      }
      if (constraints?.maxLatencyMs && perf.avgLatency > constraints.maxLatencyMs) {
        reasoning += `Skipping ${preferredId} (avg latency: ${perf.avgLatency.toFixed(0)}ms). `;
        continue;
      }
    }

    selectedModel = preferredId;
    reasoning += `Selected ${preferredId} (preferred for ${taskType}).`;
    break;
  }

  if (!reasoning) {
    reasoning = `Using current model ${currentModel} (no better option found).`;
  }

  // Determine optimal max tokens based on model
  const modelSpec = MODEL_SPECS.find(m => m.id === selectedModel);
  const maxTokens = Math.min(
    profile.optimalMaxTokens,
    modelSpec?.maxOutputTokens || 32000
  );

  return {
    modelId: selectedModel,
    temperature: profile.optimalTemperature,
    maxTokens,
    reasoning,
  };
}

/**
 * Record a performance observation for model optimization.
 */
export function recordPerformance(record: PerformanceRecord): void {
  performanceHistory.push(record);
  if (performanceHistory.length > MAX_PERF_HISTORY) {
    performanceHistory.splice(0, performanceHistory.length - MAX_PERF_HISTORY);
  }

  // Persist periodically (every 50 records)
  if (performanceHistory.length % 50 === 0) {
    savePerfHistory();
  }
}

/**
 * Get performance statistics for a model or task type.
 */
export function getPerformanceStats(filter?: { modelId?: string; taskType?: string; sinceMs?: number }): {
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  truncationRate: number;
  costEstimate: number;
} {
  let records = [...performanceHistory];

  if (filter?.modelId) records = records.filter(r => r.modelId === filter.modelId);
  if (filter?.taskType) records = records.filter(r => r.taskType === filter.taskType);
  if (filter?.sinceMs) records = records.filter(r => r.timestamp > Date.now() - filter.sinceMs!);

  if (records.length === 0) {
    return { totalRequests: 0, successRate: 1, avgLatencyMs: 0, avgInputTokens: 0, avgOutputTokens: 0, truncationRate: 0, costEstimate: 0 };
  }

  const successful = records.filter(r => r.success).length;
  const truncated = records.filter(r => r.truncated).length;
  const totalLatency = records.reduce((sum, r) => sum + r.latencyMs, 0);
  const totalInput = records.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutput = records.reduce((sum, r) => sum + r.outputTokens, 0);

  // Estimate cost
  let costEstimate = 0;
  for (const record of records) {
    const spec = MODEL_SPECS.find(m => m.id === record.modelId);
    if (spec) {
      costEstimate += (record.inputTokens / 1_000_000) * spec.inputCostPer1M;
      costEstimate += (record.outputTokens / 1_000_000) * spec.outputCostPer1M;
    }
  }

  return {
    totalRequests: records.length,
    successRate: successful / records.length,
    avgLatencyMs: totalLatency / records.length,
    avgInputTokens: totalInput / records.length,
    avgOutputTokens: totalOutput / records.length,
    truncationRate: truncated / records.length,
    costEstimate,
  };
}

/**
 * Calculate the maximum tokens available for output given current context.
 * Model-aware replacement for the hardcoded calculation.
 */
export function calculateAvailableTokens(modelId: string, currentContextTokens: number): number {
  const contextWindow = getContextWindow(modelId);
  const maxOutput = getMaxOutputTokens(modelId);

  // Available = min(maxOutput, contextWindow - currentContext - safety_margin)
  const safetyMargin = 500; // Reserve tokens for system overhead
  const available = Math.min(maxOutput, contextWindow - currentContextTokens - safetyMargin);

  return Math.max(1000, available); // Never go below 1000
}

/**
 * Register a custom model (for self-hosted or new models).
 */
export function registerModel(spec: ModelSpec): void {
  const existing = MODEL_SPECS.findIndex(m => m.id === spec.id);
  if (existing >= 0) {
    MODEL_SPECS[existing] = spec;
  } else {
    MODEL_SPECS.push(spec);
  }
}

/**
 * Initialize the model registry on startup.
 */
export function initModelRegistry(): void {
  loadPerfHistory();
  console.log(`[ModelRegistry] Initialized. ${MODEL_SPECS.length} models registered. ${performanceHistory.length} performance records loaded.`);
}
