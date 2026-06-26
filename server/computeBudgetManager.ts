/**
 * Compute Budget Manager — dynamic compute allocation using Thompson sampling.
 * Tracks LLM token usage, CPU time, and memory across all modules.
 * Reallocates budget from underperforming to high-impact modules.
 */

export interface ComputeBudget {
  moduleId: string;
  allocatedTokens: number;
  allocatedCpuMs: number;
  allocatedMemoryMb: number;
}

export interface ComputeUsage {
  moduleId: string;
  tokensUsed: number;
  cpuMs: number;
  memoryMb: number;
  capabilityGain: number;  // actual improvement achieved
  timestamp: number;
}

export interface BudgetReport {
  totalAllocated: { tokens: number; cpuMs: number; memoryMb: number };
  totalUsed: { tokens: number; cpuMs: number; memoryMb: number };
  efficiency: number;  // 0-1
  giniCoefficient: number;  // 0=perfect equality, 1=perfect inequality
  topModules: Array<{ moduleId: string; roi: number }>;
  recommendations: string[];
}

class ComputeBudgetManager {
  private budgets: Map<string, ComputeBudget> = new Map();
  private usageHistory: ComputeUsage[] = [];
  // Thompson sampling: alpha (successes) and beta (failures) per module
  private thompsonAlpha: Map<string, number> = new Map();
  private thompsonBeta: Map<string, number> = new Map();

  allocateBudget(moduleId: string, budget: Omit<ComputeBudget, "moduleId">): void {
    this.budgets.set(moduleId, { moduleId, ...budget });
    if (!this.thompsonAlpha.has(moduleId)) {
      this.thompsonAlpha.set(moduleId, 1);
      this.thompsonBeta.set(moduleId, 1);
    }
    console.log(`[Budget] Allocated to ${moduleId}: ${budget.allocatedTokens} tokens, ${budget.allocatedCpuMs}ms CPU`);
  }

  trackUsage(moduleId: string, usage: Omit<ComputeUsage, "moduleId" | "timestamp">): void {
    const record: ComputeUsage = { moduleId, ...usage, timestamp: Date.now() };
    this.usageHistory.push(record);
    if (this.usageHistory.length > 10000) this.usageHistory.shift();

    // Update Thompson sampling parameters
    const alpha = this.thompsonAlpha.get(moduleId) ?? 1;
    const beta = this.thompsonBeta.get(moduleId) ?? 1;
    if (usage.capabilityGain > 0.001) {
      this.thompsonAlpha.set(moduleId, alpha + usage.capabilityGain * 100);
    } else {
      this.thompsonBeta.set(moduleId, beta + 1);
    }
  }

  /**
   * Thompson sampling: sample from Beta(alpha, beta) for each module.
   * Allocate more budget to modules with higher sampled values.
   */
  rebalanceBudgets(): Map<string, ComputeBudget> {
    const totalTokens = Array.from(this.budgets.values()).reduce((s, b) => s + b.allocatedTokens, 0);
    const totalCpu = Array.from(this.budgets.values()).reduce((s, b) => s + b.allocatedCpuMs, 0);

    // Sample from Beta distribution for each module
    const samples: Map<string, number> = new Map();
    let totalSample = 0;
    for (const [moduleId] of this.budgets) {
      const alpha = this.thompsonAlpha.get(moduleId) ?? 1;
      const beta = this.thompsonBeta.get(moduleId) ?? 1;
      // Approximate Beta sample using normal approximation
      const mean = alpha / (alpha + beta);
      const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
      const sample = Math.max(0.01, mean + Math.sqrt(variance) * (Math.random() * 2 - 1));
      samples.set(moduleId, sample);
      totalSample += sample;
    }

    // Reallocate proportionally
    for (const [moduleId, budget] of this.budgets) {
      const share = (samples.get(moduleId) ?? 0.1) / totalSample;
      budget.allocatedTokens = Math.round(totalTokens * share);
      budget.allocatedCpuMs = Math.round(totalCpu * share);
    }

    console.log(`[Budget] Rebalanced ${this.budgets.size} module budgets via Thompson sampling`);
    return new Map(this.budgets);
  }

  getBudgetReport(): BudgetReport {
    const allBudgets = Array.from(this.budgets.values());
    const recentUsage = this.usageHistory.slice(-100);

    const totalAllocated = {
      tokens: allBudgets.reduce((s, b) => s + b.allocatedTokens, 0),
      cpuMs: allBudgets.reduce((s, b) => s + b.allocatedCpuMs, 0),
      memoryMb: allBudgets.reduce((s, b) => s + b.allocatedMemoryMb, 0),
    };

    const totalUsed = {
      tokens: recentUsage.reduce((s, u) => s + u.tokensUsed, 0),
      cpuMs: recentUsage.reduce((s, u) => s + u.cpuMs, 0),
      memoryMb: recentUsage.reduce((s, u) => s + u.memoryMb, 0),
    };

    const efficiency = totalAllocated.tokens > 0
      ? Math.min(1, totalUsed.tokens / totalAllocated.tokens)
      : 0;

    // Gini coefficient on token allocations
    const allocations = allBudgets.map(b => b.allocatedTokens).sort((a, b) => a - b);
    const n = allocations.length;
    const gini = n > 1
      ? allocations.reduce((sum, val, i) => sum + (2 * i - n + 1) * val, 0) / (n * allocations.reduce((s, v) => s + v, 0))
      : 0;

    // ROI per module
    const roiMap = new Map<string, number>();
    for (const usage of recentUsage) {
      const budget = this.budgets.get(usage.moduleId);
      if (budget && budget.allocatedTokens > 0) {
        const roi = usage.capabilityGain / (usage.tokensUsed / budget.allocatedTokens);
        roiMap.set(usage.moduleId, (roiMap.get(usage.moduleId) ?? 0) + roi);
      }
    }

    const topModules = Array.from(roiMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([moduleId, roi]) => ({ moduleId, roi }));

    return {
      totalAllocated,
      totalUsed,
      efficiency,
      giniCoefficient: Math.abs(gini),
      topModules,
      recommendations: efficiency < 0.5
        ? ["Reduce allocated budgets — many modules are underutilizing their allocation"]
        : ["Budget allocation is healthy"],
    };
  }

  getBudget(moduleId: string): ComputeBudget | undefined {
    return this.budgets.get(moduleId);
  }
}

export const globalComputeBudgetManager = new ComputeBudgetManager();

export function allocateBudget(moduleId: string, budget: Omit<ComputeBudget, "moduleId">): void {
  globalComputeBudgetManager.allocateBudget(moduleId, budget);
}

export function trackUsage(moduleId: string, usage: Omit<ComputeUsage, "moduleId" | "timestamp">): void {
  globalComputeBudgetManager.trackUsage(moduleId, usage);
}

export function rebalanceBudgets(): Map<string, ComputeBudget> {
  return globalComputeBudgetManager.rebalanceBudgets();
}

export function getBudgetReport(): BudgetReport {
  return globalComputeBudgetManager.getBudgetReport();
}

export function initComputeBudgetManager(): void {
  console.log("[Budget] Compute Budget Manager initialized.");
  // Seed default budgets for core modules
  const coreModules = ["rsiEngine", "llmProvider", "selfImprove", "rewardModel", "constitutionalConstraints"];
  for (const mod of coreModules) {
    globalComputeBudgetManager.allocateBudget(mod, {
      allocatedTokens: 10000,
      allocatedCpuMs: 5000,
      allocatedMemoryMb: 256,
    });
  }
}
