/**
 * ontologicalModel.ts — Ontological Self-Modeling & Action Routing
 * Andromeda v10.0.0
 *
 * Implements a formal self-model that allows Andromeda to reason about its own
 * capabilities, knowledge gaps, and optimal action strategies. Given a task,
 * the ontological model computes:
 *
 *   1. Whether to answer directly (knowledge is sufficient)
 *   2. Whether to write a new tool (capability gap identified)
 *   3. Whether to train a LoRA (knowledge gap that requires fine-tuning)
 *   4. Whether to delegate to the swarm (task exceeds local compute budget)
 *
 * This is the "Gödelian self-reference" layer — Andromeda models itself as an
 * object within its own reasoning framework, enabling truly autonomous
 * decision-making about how to grow.
 *
 * Architecture:
 *   - The self-model is a JSON document stored in data/self_model.json
 *   - It tracks: known capabilities, knowledge domains, performance metrics,
 *     compute budget, and historical action outcomes
 *   - The router uses a multi-criteria decision matrix to select the optimal action
 *   - All routing decisions are logged for meta-learning
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionType =
  | "answer_directly"    // Use existing knowledge/tools
  | "write_tool"         // Create a new capability
  | "train_lora"         // Fine-tune on new domain knowledge
  | "delegate_swarm"     // Offload to peer nodes
  | "request_human"      // Escalate to human operator
  | "gather_data";       // Collect more information first

export interface Capability {
  name: string;
  description: string;
  /** Confidence in this capability (0.0–1.0) */
  confidence: number;
  /** Number of times this capability has been used successfully */
  successCount: number;
  /** Number of times this capability has failed */
  failureCount: number;
  /** Last time this capability was used (Unix ms) */
  lastUsed: number;
  /** Tags for capability matching */
  tags: string[];
}

export interface KnowledgeDomain {
  name: string;
  description: string;
  /** Estimated coverage of this domain (0.0–1.0) */
  coverage: number;
  /** Number of successful tasks in this domain */
  taskCount: number;
  /** Average performance score in this domain */
  avgScore: number;
  /** Whether a LoRA has been trained for this domain */
  hasLora: boolean;
  lastUpdated: number;
}

export interface ComputeBudget {
  /** Maximum tokens per LLM call */
  maxTokensPerCall: number;
  /** Maximum parallel LLM calls */
  maxParallelCalls: number;
  /** Maximum LoRA training time (ms) */
  maxLoraTrainingMs: number;
  /** Current estimated cost per task (USD) */
  estimatedCostPerTask: number;
  /** Daily budget remaining (USD) */
  dailyBudgetRemaining: number;
}

export interface SelfModel {
  instanceId: string;
  version: string;
  capabilities: Capability[];
  knowledgeDomains: KnowledgeDomain[];
  computeBudget: ComputeBudget;
  /** Total tasks processed */
  totalTasks: number;
  /** Overall success rate */
  successRate: number;
  /** Model's self-assessed intelligence score (0.0–1.0) */
  intelligenceScore: number;
  lastUpdated: number;
  createdAt: number;
}

export interface RoutingDecision {
  taskDescription: string;
  selectedAction: ActionType;
  confidence: number;
  reasoning: string;
  alternativeActions: Array<{ action: ActionType; score: number; reason: string }>;
  estimatedCost: number;
  estimatedLatencyMs: number;
  matchedCapabilities: string[];
  matchedDomains: string[];
  timestamp: number;
}

export interface TaskContext {
  description: string;
  /** Keywords extracted from the task */
  keywords: string[];
  /** Estimated complexity (0.0–1.0) */
  complexity: number;
  /** Whether the task requires real-time data */
  requiresRealTimeData: boolean;
  /** Whether the task requires code execution */
  requiresCodeExecution: boolean;
  /** Whether the task requires external API calls */
  requiresExternalApi: boolean;
  /** Urgency (0.0 = low, 1.0 = immediate) */
  urgency: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.ANDROMEDA_WORKSPACE
  ? join(process.env.ANDROMEDA_WORKSPACE, "data")
  : join(process.cwd(), "data");

const SELF_MODEL_FILE = join(DATA_DIR, "self_model.json");
const ROUTING_LOG_FILE = join(DATA_DIR, "routing_log.jsonl");

const DEFAULT_SELF_MODEL: Omit<SelfModel, "instanceId" | "createdAt"> = {
  version: "10.0.0",
  capabilities: [
    {
      name: "code_generation",
      description: "Generate TypeScript/JavaScript code",
      confidence: 0.85,
      successCount: 0,
      failureCount: 0,
      lastUsed: 0,
      tags: ["code", "typescript", "javascript", "programming"],
    },
    {
      name: "text_analysis",
      description: "Analyze and summarize text documents",
      confidence: 0.9,
      successCount: 0,
      failureCount: 0,
      lastUsed: 0,
      tags: ["text", "analysis", "summarization", "nlp"],
    },
    {
      name: "tool_creation",
      description: "Create new Andromeda tools via RSI pipeline",
      confidence: 0.75,
      successCount: 0,
      failureCount: 0,
      lastUsed: 0,
      tags: ["rsi", "tool", "capability", "self-improvement"],
    },
    {
      name: "data_retrieval",
      description: "Search and retrieve information from the web",
      confidence: 0.8,
      successCount: 0,
      failureCount: 0,
      lastUsed: 0,
      tags: ["search", "web", "retrieval", "data"],
    },
  ],
  knowledgeDomains: [
    {
      name: "software_engineering",
      description: "Software development, architecture, and best practices",
      coverage: 0.8,
      taskCount: 0,
      avgScore: 0.85,
      hasLora: false,
      lastUpdated: 0,
    },
    {
      name: "machine_learning",
      description: "ML/AI concepts, training, and deployment",
      coverage: 0.7,
      taskCount: 0,
      avgScore: 0.75,
      hasLora: false,
      lastUpdated: 0,
    },
  ],
  computeBudget: {
    maxTokensPerCall: 8192,
    maxParallelCalls: 3,
    maxLoraTrainingMs: 3600_000, // 1 hour
    estimatedCostPerTask: 0.01,
    dailyBudgetRemaining: 10.0,
  },
  totalTasks: 0,
  successRate: 1.0,
  intelligenceScore: 0.75,
  lastUpdated: 0,
};

// ─── Self-Model CRUD ──────────────────────────────────────────────────────────

export function loadSelfModel(): SelfModel {
  if (existsSync(SELF_MODEL_FILE)) {
    try {
      return JSON.parse(readFileSync(SELF_MODEL_FILE, "utf-8")) as SelfModel;
    } catch {
      // Fall through to default
    }
  }

  const model: SelfModel = {
    ...DEFAULT_SELF_MODEL,
    instanceId: `andromeda-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
  };

  saveSelfModel(model);
  return model;
}

export function saveSelfModel(model: SelfModel): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const updated = { ...model, lastUpdated: Date.now() };
  writeFileSync(SELF_MODEL_FILE, JSON.stringify(updated, null, 2), "utf-8");
}

export function registerCapability(capability: Omit<Capability, "successCount" | "failureCount" | "lastUsed">): SelfModel {
  const model = loadSelfModel();
  const existing = model.capabilities.findIndex((c) => c.name === capability.name);

  const full: Capability = {
    ...capability,
    successCount: 0,
    failureCount: 0,
    lastUsed: Date.now(),
  };

  if (existing >= 0) {
    model.capabilities[existing] = { ...model.capabilities[existing], ...full };
  } else {
    model.capabilities.push(full);
  }

  saveSelfModel(model);
  return model;
}

export function updateCapabilityOutcome(
  capabilityName: string,
  success: boolean
): void {
  const model = loadSelfModel();
  const cap = model.capabilities.find((c) => c.name === capabilityName);
  if (!cap) return;

  if (success) {
    cap.successCount++;
    cap.confidence = Math.min(1.0, cap.confidence + 0.01);
  } else {
    cap.failureCount++;
    cap.confidence = Math.max(0.1, cap.confidence - 0.02);
  }
  cap.lastUsed = Date.now();

  // Update overall success rate
  const total = model.capabilities.reduce((a, c) => a + c.successCount + c.failureCount, 0);
  const successes = model.capabilities.reduce((a, c) => a + c.successCount, 0);
  model.successRate = total > 0 ? successes / total : 1.0;

  // Update intelligence score (weighted average of capability confidences)
  const avgConfidence = model.capabilities.reduce((a, c) => a + c.confidence, 0) / model.capabilities.length;
  model.intelligenceScore = avgConfidence * model.successRate;

  saveSelfModel(model);
}

// ─── Task Context Extraction ──────────────────────────────────────────────────

/**
 * Extract a TaskContext from a natural language task description.
 * Uses keyword matching and heuristics (no LLM call needed).
 */
export function extractTaskContext(description: string): TaskContext {
  const lower = description.toLowerCase();
  const words = lower.split(/\W+/).filter((w) => w.length > 2);

  const codeKeywords = ["code", "function", "class", "implement", "write", "build", "create", "fix", "debug", "typescript", "javascript", "python"];
  const dataKeywords = ["search", "find", "retrieve", "fetch", "get", "lookup", "query", "data", "api"];
  const mlKeywords = ["train", "lora", "model", "fine-tune", "finetune", "embedding", "inference"];
  const complexityKeywords = ["complex", "large", "full", "complete", "entire", "comprehensive", "advanced"];

  const hasCode = codeKeywords.some((k) => words.includes(k));
  const hasData = dataKeywords.some((k) => words.includes(k));
  const hasMl = mlKeywords.some((k) => words.includes(k));
  const isComplex = complexityKeywords.some((k) => words.includes(k));

  const keywords = words.filter((w) =>
    [...codeKeywords, ...dataKeywords, ...mlKeywords].includes(w)
  );

  return {
    description,
    keywords,
    complexity: isComplex ? 0.8 : hasCode ? 0.6 : 0.4,
    requiresRealTimeData: hasData,
    requiresCodeExecution: hasCode,
    requiresExternalApi: hasData,
    urgency: lower.includes("urgent") || lower.includes("immediately") ? 0.9 : 0.5,
  };
}

// ─── Action Router ────────────────────────────────────────────────────────────

/**
 * Compute a score for each possible action given the task context and self-model.
 */
function scoreAction(
  action: ActionType,
  context: TaskContext,
  model: SelfModel
): { score: number; reason: string } {
  switch (action) {
    case "answer_directly": {
      // Good when we have high-confidence matching capabilities
      const matchingCaps = model.capabilities.filter((c) =>
        c.tags.some((t) => context.keywords.includes(t))
      );
      const avgConfidence = matchingCaps.length > 0
        ? matchingCaps.reduce((a, c) => a + c.confidence, 0) / matchingCaps.length
        : 0.3;
      const score = avgConfidence * (1 - context.complexity * 0.3);
      return { score, reason: `${matchingCaps.length} matching capabilities with avg confidence ${avgConfidence.toFixed(2)}` };
    }

    case "write_tool": {
      // Good when complexity is high and we have tool_creation capability
      const toolCap = model.capabilities.find((c) => c.name === "tool_creation");
      const toolConfidence = toolCap?.confidence ?? 0.5;
      const score = context.complexity * toolConfidence * (context.requiresCodeExecution ? 1.2 : 0.8);
      return { score: Math.min(1.0, score), reason: `Complexity ${context.complexity.toFixed(2)}, tool_creation confidence ${toolConfidence.toFixed(2)}` };
    }

    case "train_lora": {
      // Good when we have a knowledge gap in the relevant domain
      const matchingDomains = model.knowledgeDomains.filter((d) =>
        context.keywords.some((k) => d.name.includes(k) || d.description.toLowerCase().includes(k))
      );
      const avgCoverage = matchingDomains.length > 0
        ? matchingDomains.reduce((a, d) => a + d.coverage, 0) / matchingDomains.length
        : 0.5;
      const knowledgeGap = 1 - avgCoverage;
      const score = knowledgeGap * context.complexity * 0.8;
      return { score, reason: `Knowledge gap ${knowledgeGap.toFixed(2)} in ${matchingDomains.map((d) => d.name).join(", ") || "unknown domain"}` };
    }

    case "delegate_swarm": {
      // Good when compute budget is tight or task is very complex
      const budgetPressure = 1 - Math.min(1, model.computeBudget.dailyBudgetRemaining / 10);
      const score = (context.complexity * 0.5 + budgetPressure * 0.5) * 0.7;
      return { score, reason: `Complexity ${context.complexity.toFixed(2)}, budget pressure ${budgetPressure.toFixed(2)}` };
    }

    case "gather_data": {
      // Good when we need real-time data
      const score = context.requiresRealTimeData ? 0.7 : 0.2;
      return { score, reason: context.requiresRealTimeData ? "Task requires real-time data" : "No real-time data needed" };
    }

    case "request_human": {
      // Last resort — only when everything else scores low
      const score = 0.1;
      return { score, reason: "Fallback action when all others are insufficient" };
    }

    default:
      return { score: 0, reason: "Unknown action" };
  }
}

/**
 * Route a task to the optimal action using the self-model.
 * This is the core Gödelian decision function.
 */
export function routeTask(
  taskDescription: string,
  config?: Partial<{ minConfidence: number }>
): RoutingDecision {
  const minConfidence = config?.minConfidence ?? 0.4;
  const model = loadSelfModel();
  const context = extractTaskContext(taskDescription);

  const actions: ActionType[] = [
    "answer_directly",
    "write_tool",
    "train_lora",
    "delegate_swarm",
    "gather_data",
    "request_human",
  ];

  const scored = actions.map((action) => {
    const { score, reason } = scoreAction(action, context, model);
    return { action, score, reason };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alternatives = scored.slice(1).map((s) => ({
    action: s.action,
    score: s.score,
    reason: s.reason,
  }));

  // Find matched capabilities and domains
  const matchedCapabilities = model.capabilities
    .filter((c) => c.tags.some((t) => context.keywords.includes(t)))
    .map((c) => c.name);

  const matchedDomains = model.knowledgeDomains
    .filter((d) => context.keywords.some((k) => d.name.includes(k) || d.description.toLowerCase().includes(k)))
    .map((d) => d.name);

  const decision: RoutingDecision = {
    taskDescription,
    selectedAction: best.action,
    confidence: best.score,
    reasoning: best.reason,
    alternativeActions: alternatives,
    estimatedCost: model.computeBudget.estimatedCostPerTask * (1 + context.complexity),
    estimatedLatencyMs: context.complexity > 0.7 ? 5000 : 1000,
    matchedCapabilities,
    matchedDomains,
    timestamp: Date.now(),
  };

  // Log the routing decision
  try {
    const { appendFileSync } = require("fs");
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(ROUTING_LOG_FILE, JSON.stringify(decision) + "\n", "utf-8");
  } catch { /* Non-fatal */ }

  return decision;
}

// ─── Meta-Learning ────────────────────────────────────────────────────────────

/**
 * Update the self-model based on the outcome of a routing decision.
 * This is the meta-learning loop — Andromeda learns which actions work best.
 */
export function recordRoutingOutcome(
  decision: RoutingDecision,
  success: boolean,
  actualLatencyMs?: number
): void {
  const model = loadSelfModel();

  // Update matched capabilities
  for (const capName of decision.matchedCapabilities) {
    updateCapabilityOutcome(capName, success);
  }

  // Update domain coverage
  for (const domainName of decision.matchedDomains) {
    const domain = model.knowledgeDomains.find((d) => d.name === domainName);
    if (domain) {
      domain.taskCount++;
      if (success) {
        domain.avgScore = (domain.avgScore * (domain.taskCount - 1) + 1.0) / domain.taskCount;
        domain.coverage = Math.min(1.0, domain.coverage + 0.005);
      } else {
        domain.avgScore = (domain.avgScore * (domain.taskCount - 1) + 0.0) / domain.taskCount;
      }
      domain.lastUpdated = Date.now();
    }
  }

  // Update compute budget estimate
  if (actualLatencyMs !== undefined) {
    const estimatedCost = (actualLatencyMs / 1000) * 0.001; // Rough cost estimate
    model.computeBudget.estimatedCostPerTask =
      model.computeBudget.estimatedCostPerTask * 0.9 + estimatedCost * 0.1;
  }

  model.totalTasks++;
  saveSelfModel(model);
}

// ─── Self-Model Introspection ─────────────────────────────────────────────────

export function getSelfModelSummary(): {
  instanceId: string;
  intelligenceScore: number;
  successRate: number;
  capabilityCount: number;
  domainCount: number;
  totalTasks: number;
  topCapabilities: string[];
  weakestDomains: string[];
  recommendedLoraTargets: string[];
} {
  const model = loadSelfModel();

  const topCapabilities = [...model.capabilities]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((c) => `${c.name} (${(c.confidence * 100).toFixed(0)}%)`);

  const weakestDomains = [...model.knowledgeDomains]
    .sort((a, b) => a.coverage - b.coverage)
    .slice(0, 3)
    .map((d) => `${d.name} (${(d.coverage * 100).toFixed(0)}%)`);

  const recommendedLoraTargets = model.knowledgeDomains
    .filter((d) => d.coverage < 0.6 && !d.hasLora && d.taskCount > 5)
    .map((d) => d.name);

  return {
    instanceId: model.instanceId,
    intelligenceScore: model.intelligenceScore,
    successRate: model.successRate,
    capabilityCount: model.capabilities.length,
    domainCount: model.knowledgeDomains.length,
    totalTasks: model.totalTasks,
    topCapabilities,
    weakestDomains,
    recommendedLoraTargets,
  };
}
