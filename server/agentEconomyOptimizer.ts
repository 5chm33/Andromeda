/**
 * agentEconomyOptimizer.ts — v50.0.0
 *
 * Applies optimization strategies to the sub-agent economy:
 * dynamic pricing, task routing optimization, and resource reallocation.
 */

export interface OptimizationTarget {
  metric: "throughput" | "cost" | "latency" | "utilization" | "quality";
  weight: number;
  currentValue: number;
  targetValue: number;
}

export interface OptimizationAction {
  actionId: string;
  type: "reprice" | "reroute" | "reallocate" | "spawn" | "terminate";
  description: string;
  expectedImprovement: number;  // 0.0–1.0
  priority: number;             // 1–10
  timestamp: number;
}

export interface OptimizationResult {
  cycleId: number;
  targets: OptimizationTarget[];
  actions: OptimizationAction[];
  overallScore: number;
  timestamp: number;
}

const results: OptimizationResult[] = [];
let cycleCounter = 0;
let actionCounter = 0;

export function optimize(targets: OptimizationTarget[]): OptimizationResult {
  const actions: OptimizationAction[] = [];

  for (const target of targets) {
    const gap = target.targetValue - target.currentValue;
    if (Math.abs(gap) < 0.05) continue; // already close enough

    if (target.metric === "throughput" && gap > 0) {
      actions.push({
        actionId: `opt-${++actionCounter}`,
        type: "spawn",
        description: `Spawn additional agents to increase throughput by ${(gap * 100).toFixed(0)}%`,
        expectedImprovement: Math.min(gap, 0.3),
        priority: Math.ceil(gap * 10),
        timestamp: Date.now(),
      });
    } else if (target.metric === "cost" && gap < 0) {
      actions.push({
        actionId: `opt-${++actionCounter}`,
        type: "terminate",
        description: `Terminate idle agents to reduce cost by ${Math.abs(gap * 100).toFixed(0)}%`,
        expectedImprovement: Math.min(Math.abs(gap), 0.25),
        priority: Math.ceil(Math.abs(gap) * 8),
        timestamp: Date.now(),
      });
    } else if (target.metric === "latency" && gap < 0) {
      actions.push({
        actionId: `opt-${++actionCounter}`,
        type: "reroute",
        description: `Reroute tasks to lower-latency agents`,
        expectedImprovement: Math.min(Math.abs(gap), 0.2),
        priority: 7,
        timestamp: Date.now(),
      });
    } else if (target.metric === "utilization" && gap > 0) {
      actions.push({
        actionId: `opt-${++actionCounter}`,
        type: "reallocate",
        description: `Reallocate tasks to underutilized agents`,
        expectedImprovement: Math.min(gap, 0.35),
        priority: 5,
        timestamp: Date.now(),
      });
    }
  }

  // Sort by priority descending
  actions.sort((a, b) => b.priority - a.priority);

  // Compute overall score: weighted average of (currentValue / targetValue) clamped to 1
  const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
  const overallScore = totalWeight > 0
    ? targets.reduce((s, t) => s + (Math.min(t.currentValue, t.targetValue) / t.targetValue) * t.weight, 0) / totalWeight
    : 0;

  const result: OptimizationResult = {
    cycleId: ++cycleCounter,
    targets,
    actions,
    overallScore,
    timestamp: Date.now(),
  };
  results.push(result);
  return result;
}

export function getLatestResult(): OptimizationResult | null {
  return results.length > 0 ? results[results.length - 1] : null;
}

export function getOptimizationHistory(): OptimizationResult[] {
  return [...results];
}

export function _resetEconomyOptimizerForTest(): void {
  results.length = 0;
  cycleCounter = 0;
  actionCounter = 0;
}
