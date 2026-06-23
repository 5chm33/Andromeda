/**
 * taskDecomposer.ts — Automatic Task Decomposition
 *
 * Analyzes incoming queries for complexity and automatically decomposes
 * complex ones into sub-tasks that can be routed to the multi-agent
 * orchestrator. Makes multi-agent coordination the default for
 * research-heavy or multi-step queries.
 *
 * Architecture:
 *   1. Complexity Analysis — scores query complexity (0-1)
 *   2. Decomposition — splits into typed sub-tasks
 *   3. Dependency Graph — determines execution order
 *   4. Agent Assignment — maps sub-tasks to specialist agents
 *   5. Result Merging — combines sub-task outputs
 *
 * Integrations:
 *   - agentOrchestrator.ts: Spawns multi-agent teams for complex sub-tasks
 *   - llmRouter.ts: Uses task classification for agent assignment
 *   - goalManager.ts: Complex decompositions can be tracked as goals
 */

import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComplexitySignal =
  | "multi_topic"          // Query spans multiple distinct topics
  | "requires_research"    // Needs web search or data gathering
  | "requires_code"        // Needs code generation or execution
  | "requires_analysis"    // Needs data analysis or comparison
  | "requires_creative"    // Needs creative writing or design
  | "multi_step"           // Explicitly multi-step ("first... then...")
  | "comparison"           // Comparing multiple things
  | "long_query"           // Query is unusually long (>100 words)
  | "conditional"          // Has if/then logic
  | "aggregation";         // Needs to combine info from multiple sources

export type ComplexityAnalysis = {
  score: number;           // 0-1, higher = more complex
  signals: ComplexitySignal[];
  shouldDecompose: boolean;
  reasoning: string;
  estimatedSubTasks: number;
};

export type SubTaskType = "research" | "code" | "analysis" | "creative" | "review" | "synthesis";

export type SubTask = {
  id: string;
  parentQueryId: string;
  title: string;
  description: string;
  type: SubTaskType;
  assignedAgent: string;
  dependencies: string[];  // IDs of sub-tasks that must complete first
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  priority: number;        // 1 = highest
};

export type DecomposedQuery = {
  id: string;
  originalQuery: string;
  complexity: ComplexityAnalysis;
  subTasks: SubTask[];
  status: "pending" | "running" | "completed" | "failed";
  mergedResult?: string;
  createdAt: number;
  completedAt?: number;
};

export type DecomposerConfig = {
  enabled: boolean;
  autoDecomposeThreshold: number;  // Complexity score above which to auto-decompose (default: 0.6)
  maxSubTasks: number;             // Maximum sub-tasks per query (default: 8)
  enableParallelExecution: boolean; // Run independent sub-tasks in parallel (default: true)
  agentMapping: Record<SubTaskType, string>; // Which agent handles each type
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const decomposedQueries = new Map<string, DecomposedQuery>();
const MAX_STORED = 200;

const defaultConfig: DecomposerConfig = {
  enabled: true,
  autoDecomposeThreshold: 0.6,
  maxSubTasks: 8,
  enableParallelExecution: true,
  agentMapping: {
    research: "researcher",
    code: "coder",
    analysis: "analyst",
    creative: "writer",
    review: "security_auditor",
    synthesis: "architect",
  },
};

let config: DecomposerConfig = { ...defaultConfig, agentMapping: { ...defaultConfig.agentMapping } };

// ─── Complexity Analysis ──────────────────────────────────────────────────────

// Signal detection patterns
const RESEARCH_PATTERNS = [
  /\b(research|find|search|look up|investigate|discover|what is|who is|when did|where is|how does)\b/i,
  /\b(latest|recent|current|news|update|trend)\b/i,
  /\b(compare|versus|vs\.?|difference between|pros and cons)\b/i,
];

const CODE_PATTERNS = [
  /\b(write|create|build|implement|code|program|script|function|class|api|app)\b/i,
  /\b(debug|fix|refactor|optimize|test|deploy)\b/i,
  /\b(python|javascript|typescript|react|node|sql|html|css)\b/i,
];

const ANALYSIS_PATTERNS = [
  /\b(analyze|analysis|evaluate|assess|measure|calculate|statistics|data|chart|graph)\b/i,
  /\b(summarize|summary|overview|breakdown|report)\b/i,
];

const CREATIVE_PATTERNS = [
  /\b(write|compose|draft|design|create|generate|brainstorm)\b/i,
  /\b(story|poem|essay|article|blog|content|copy|slogan|tagline)\b/i,
];

const MULTI_STEP_PATTERNS = [
  /\b(first|then|next|after that|finally|step \d|phase \d)\b/i,
  /\b(and also|additionally|furthermore|moreover|plus)\b/i,
  /\d\.\s/,  // Numbered lists
];

const COMPARISON_PATTERNS = [
  /\b(compare|comparison|versus|vs\.?|better|worse|difference|similarities)\b/i,
  /\b(which one|which is|should i use|choose between)\b/i,
];

const CONDITIONAL_PATTERNS = [
  /\b(if|when|unless|depending on|in case|should .+ then)\b/i,
];

function detectSignals(query: string): ComplexitySignal[] {
  const signals: ComplexitySignal[] = [];
  const words = query.split(/\s+/);

  if (RESEARCH_PATTERNS.some(p => p.test(query))) signals.push("requires_research");
  if (CODE_PATTERNS.some(p => p.test(query))) signals.push("requires_code");
  if (ANALYSIS_PATTERNS.some(p => p.test(query))) signals.push("requires_analysis");
  if (CREATIVE_PATTERNS.some(p => p.test(query))) signals.push("requires_creative");
  if (MULTI_STEP_PATTERNS.some(p => p.test(query))) signals.push("multi_step");
  if (COMPARISON_PATTERNS.some(p => p.test(query))) signals.push("comparison");
  if (CONDITIONAL_PATTERNS.some(p => p.test(query))) signals.push("conditional");
  if (words.length > 100) signals.push("long_query");

  // Multi-topic detection: count distinct noun phrases / topic shifts
  const sentences = query.split(/[.!?;]+/).filter(s => s.trim().length > 10);
  if (sentences.length >= 3) signals.push("multi_topic");

  // Aggregation: needs info from multiple sources
  if (signals.includes("requires_research") && (signals.includes("comparison") || signals.includes("multi_topic"))) {
    signals.push("aggregation");
  }

  return Array.from(new Set(signals)); // Deduplicate
}

/**
 * Analyze the complexity of a query and determine if it should be decomposed.
 */
export function analyzeComplexity(query: string): ComplexityAnalysis {
  const signals = detectSignals(query);
  const words = query.split(/\s+/);

  // Score components
  let score = 0;

  // Signal-based scoring
  const signalWeights: Record<ComplexitySignal, number> = {
    multi_topic: 0.20,
    requires_research: 0.12,
    requires_code: 0.12,
    requires_analysis: 0.10,
    requires_creative: 0.08,
    multi_step: 0.18,
    comparison: 0.12,
    long_query: 0.08,
    conditional: 0.06,
    aggregation: 0.15,
  };

  for (const signal of signals) {
    score += signalWeights[signal] ?? 0;
  }

  // Length bonus
  if (words.length > 50) score += 0.05;
  if (words.length > 150) score += 0.10;

  // Cap at 1.0
  score = Math.min(1, score);

  // Estimate sub-tasks
  let estimatedSubTasks = 1;
  if (score > 0.3) estimatedSubTasks = 2;
  if (score > 0.5) estimatedSubTasks = 3;
  if (score > 0.7) estimatedSubTasks = Math.min(config.maxSubTasks, 4 + signals.length);

  const shouldDecompose = score >= config.autoDecomposeThreshold;

  const reasoning = shouldDecompose
    ? `Query complexity ${(score * 100).toFixed(0)}% exceeds threshold. Signals: ${signals.join(", ")}. Recommending decomposition into ${estimatedSubTasks} sub-tasks.`
    : `Query complexity ${(score * 100).toFixed(0)}% is below threshold. Signals: ${signals.join(", ") || "none"}. Single-agent handling recommended.`;

  return { score, signals, shouldDecompose, reasoning, estimatedSubTasks };
}

// ─── Task Decomposition ───────────────────────────────────────────────────────

const signalToSubTaskTypeMap: Record<ComplexitySignal, SubTaskType> = {
  "requires_research": "research",
  "aggregation": "research",
  "requires_code": "code",
  "requires_analysis": "analysis",
  "comparison": "analysis",
  "requires_creative": "creative",
  "multi_topic": "synthesis", // Default for signals not explicitly mapped
  "multi_step": "synthesis",
  "long_query": "synthesis",
  "conditional": "synthesis"
};

function signalToSubTaskType(signal: ComplexitySignal): SubTaskType {
  return signalToSubTaskTypeMap[signal] || "synthesis";
}

/**
 * Decompose a query into sub-tasks based on complexity analysis.
 * Uses heuristic decomposition — in production, this would call the LLM.
 */
export function decomposeQuery(query: string, complexity?: ComplexityAnalysis): DecomposedQuery {
  const analysis = complexity ?? analyzeComplexity(query);
  const queryId = randomUUID();
  const subTasks: SubTask[] = [];

  if (!analysis.shouldDecompose) {
    // Single task — no decomposition needed
    const task: SubTask = {
      id: randomUUID(),
      parentQueryId: queryId,
      title: "Direct response",
      description: query,
      type: "synthesis",
      assignedAgent: config.agentMapping.synthesis,
      dependencies: [],
      status: "pending",
      createdAt: Date.now(),
      priority: 1,
    };
    subTasks.push(task);
  } else {
    // Decompose based on signals
    let priority = 1;

    function createSubTask(overrides: Partial<SubTask> & { title: string; description: string; type: SubTaskType }): SubTask {
    return {
      id: randomUUID(),
      parentQueryId: queryId,
      dependencies: [],
      status: "pending",
      createdAt: Date.now(),
      priority: priority,
      assignedAgent: config.agentMapping[overrides.type],
      ...overrides,
    };
  }

  // Phase 1: Research / Information gathering (parallel)
    if (analysis.signals.includes("requires_research") || analysis.signals.includes("aggregation")) {
      // Split comparison queries into separate research tasks
      if (analysis.signals.includes("comparison")) {
        const comparisonMatch = query.match(/(?:compare|versus|vs\.?|between)\s+(.+?)\s+(?:and|vs\.?|versus|or)\s+(.+?)(?:\.|$|\?)/i);
        if (comparisonMatch) {
          subTasks.push(createSubTask({
            title: `Research: ${comparisonMatch[1].trim().slice(0, 50)}`,
            description: `Gather information about ${comparisonMatch[1].trim()}`,
            type: "research",
          }));
          subTasks.push(createSubTask({
            title: `Research: ${comparisonMatch[2].trim().slice(0, 50)}`,
            description: `Gather information about ${comparisonMatch[2].trim()}`,
            type: "research",
          }));
        } else {
          subTasks.push(createSubTask({
            title: "Research phase",
            description: `Research the topics in: ${query.slice(0, 200)}`,
            type: "research",
          }));
        }
      } else {
        subTasks.push(createSubTask({
          title: "Research phase",
          description: `Research and gather information for: ${query.slice(0, 200)}`,
          type: "research",
        }));
      }
      priority++;
    }

    // Phase 2: Analysis / Code (depends on research if present)
    const researchIds = subTasks.filter(t => t.type === "research").map(t => t.id);

    if (analysis.signals.includes("requires_analysis") || analysis.signals.includes("comparison")) {
      subTasks.push({
        id: randomUUID(), parentQueryId: queryId,
        title: "Analysis phase",
        description: `Analyze and compare findings for: ${query.slice(0, 200)}`,
        type: "analysis", assignedAgent: config.agentMapping.analysis,
        dependencies: researchIds, status: "pending", createdAt: Date.now(), priority: priority,
      });
      priority++;
    }

    if (analysis.signals.includes("requires_code")) {
      subTasks.push({
        id: randomUUID(), parentQueryId: queryId,
        title: "Code generation phase",
        description: `Write code for: ${query.slice(0, 200)}`,
        type: "code", assignedAgent: config.agentMapping.code,
        dependencies: researchIds, status: "pending", createdAt: Date.now(), priority: priority,
      });
      priority++;
    }

    if (analysis.signals.includes("requires_creative")) {
      subTasks.push({
        id: randomUUID(), parentQueryId: queryId,
        title: "Creative writing phase",
        description: `Create content for: ${query.slice(0, 200)}`,
        type: "creative", assignedAgent: config.agentMapping.creative,
        dependencies: researchIds, status: "pending", createdAt: Date.now(), priority: priority,
      });
      priority++;
    }

    // Phase 3: Review (depends on code if present)
    const codeIds = subTasks.filter(t => t.type === "code").map(t => t.id);
    if (codeIds.length > 0) {
      subTasks.push({
        id: randomUUID(), parentQueryId: queryId,
        title: "Code review phase",
        description: "Review generated code for correctness, security, and best practices",
        type: "review", assignedAgent: config.agentMapping.review,
        dependencies: codeIds, status: "pending", createdAt: Date.now(), priority: priority,
      });
      priority++;
    }

    // Phase 4: Synthesis (depends on all previous)
    const allPreviousIds = subTasks.map(t => t.id);
    subTasks.push({
      id: randomUUID(), parentQueryId: queryId,
      title: "Synthesis phase",
      description: "Combine all findings into a coherent final response",
      type: "synthesis", assignedAgent: config.agentMapping.synthesis,
      dependencies: allPreviousIds, status: "pending", createdAt: Date.now(), priority: priority,
    });
  }

  // Cap sub-tasks
  const capped = subTasks.slice(0, config.maxSubTasks);

  const decomposed: DecomposedQuery = {
    id: queryId,
    originalQuery: query,
    complexity: analysis,
    subTasks: capped,
    status: "pending",
    createdAt: Date.now(),
  };

  decomposedQueries.set(queryId, decomposed);

  // Evict old entries
  if (decomposedQueries.size > MAX_STORED) {
    const oldest = Array.from(decomposedQueries.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (let i = 0; i < decomposedQueries.size - MAX_STORED; i++) {
      decomposedQueries.delete(oldest[i][0]);
    }
  }

  return decomposed;
}

// ─── Execution Helpers ────────────────────────────────────────────────────────

/**
 * Get the next batch of sub-tasks ready to execute (all dependencies met).
 */
export function getReadySubTasks(queryId: string): SubTask[] {
  const dq = decomposedQueries.get(queryId);
  if (!dq) return [];

  const completedIds = new Set(
    dq.subTasks.filter(t => t.status === "completed").map(t => t.id)
  );

  return dq.subTasks.filter(t => {
    if (t.status !== "pending") return false;
    return t.dependencies.every(depId => completedIds.has(depId));
  });
}

/**
 * Mark a sub-task as completed with its result.
 */
export function completeSubTask(queryId: string, subTaskId: string, result: string): boolean {
  const dq = decomposedQueries.get(queryId);
  if (!dq) return false;
  const task = dq.subTasks.find(t => t.id === subTaskId);
  if (!task) return false;

  task.status = "completed";
  task.result = result;
  task.completedAt = Date.now();

  // Check if all tasks are done
  const allDone = dq.subTasks.every(t => t.status === "completed" || t.status === "failed");
  if (allDone) {
    dq.status = "completed";
    dq.completedAt = Date.now();
    // Merge results
    dq.mergedResult = dq.subTasks
      .filter(t => t.status === "completed" && t.result)
      .map(t => `### ${t.title}\n${t.result}`)
      .join("\n\n");
  }

  return true;
}

/**
 * Mark a sub-task as failed.
 */
export function failSubTask(queryId: string, subTaskId: string, error: string): boolean {
  const dq = decomposedQueries.get(queryId);
  if (!dq) return false;
  const task = dq.subTasks.find(t => t.id === subTaskId);
  if (!task) return false;

  task.status = "failed";
  task.error = error;

  // If a dependency fails, mark dependents as failed too
  const failedId = task.id;
  for (const t of dq.subTasks) {
    if (t.dependencies.includes(failedId) && t.status === "pending") {
      t.status = "failed";
      t.error = `Dependency ${task.title} failed`;
    }
  }

  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getDecomposerConfig(): DecomposerConfig {
  return { ...config, agentMapping: { ...config.agentMapping } };
}

export function setDecomposerConfig(updates: Partial<DecomposerConfig>): DecomposerConfig {
  if (updates.agentMapping) {
    config.agentMapping = { ...config.agentMapping, ...updates.agentMapping };
  }
  const { agentMapping, ...rest } = updates;
  config = { ...config, ...rest, agentMapping: config.agentMapping };
  return getDecomposerConfig();
}

export function getDecomposedQuery(queryId: string): DecomposedQuery | undefined {
  return decomposedQueries.get(queryId);
}

export function listDecomposedQueries(limit: number = 20): DecomposedQuery[] {
  return Array.from(decomposedQueries.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function getDecomposerStats(): {
  totalDecomposed: number;
  averageComplexity: number;
  averageSubTasks: number;
  typeDistribution: Record<SubTaskType, number>;
} {
  const all = Array.from(decomposedQueries.values());
  const totalSubTasks = all.reduce((sum, dq) => sum + dq.subTasks.length, 0);

  const typeDist: Record<SubTaskType, number> = {
    research: 0, code: 0, analysis: 0, creative: 0, review: 0, synthesis: 0,
  };
  for (const dq of all) {
    for (const task of dq.subTasks) {
      typeDist[task.type]++;
    }
  }

  return {
    totalDecomposed: all.length,
    averageComplexity: all.length > 0
      ? all.reduce((sum, dq) => sum + dq.complexity.score, 0) / all.length
      : 0,
    averageSubTasks: all.length > 0 ? totalSubTasks / all.length : 0,
    typeDistribution: typeDist,
  };
}

/**
 * Quick check: should this query be auto-decomposed?
 * Call this before processing any query to decide routing.
 */
export function shouldAutoDecompose(query: string): { decompose: boolean; complexity: ComplexityAnalysis } {
  if (!config.enabled) return { decompose: false, complexity: analyzeComplexity(query) };
  const complexity = analyzeComplexity(query);
  return { decompose: complexity.shouldDecompose, complexity };
}
