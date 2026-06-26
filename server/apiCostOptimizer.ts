/**
 * apiCostOptimizer.ts — v53.0.0
 *
 * Tracks and optimizes API usage costs: per-call pricing, budget enforcement,
 * cost forecasting, and optimization recommendations.
 */

export interface ApiCostConfig {
  apiId: string;
  name: string;
  costPerCall: number;     // USD
  costPerKbRequest?: number;
  costPerKbResponse?: number;
  monthlyBudget?: number;
}

export interface CostRecord {
  apiId: string;
  calls: number;
  requestKb: number;
  responseKb: number;
  totalCost: number;
  periodStart: number;
  periodEnd: number;
}

export interface CostOptimizationRecommendation {
  apiId: string;
  type: "cache" | "batch" | "reduce-frequency" | "switch-tier" | "budget-alert";
  description: string;
  estimatedSavingsUsd: number;
  priority: "high" | "medium" | "low";
}

const configs = new Map<string, ApiCostConfig>();
const callCounts = new Map<string, number>();
const requestKbTotals = new Map<string, number>();
const responseKbTotals = new Map<string, number>();
const periodStart = new Map<string, number>();

export function registerCostConfig(config: ApiCostConfig): void {
  configs.set(config.apiId, config);
  if (!callCounts.has(config.apiId)) {
    callCounts.set(config.apiId, 0);
    requestKbTotals.set(config.apiId, 0);
    responseKbTotals.set(config.apiId, 0);
    periodStart.set(config.apiId, Date.now());
  }
}

export function recordApiUsage(apiId: string, requestKb = 0, responseKb = 0): void {
  callCounts.set(apiId, (callCounts.get(apiId) ?? 0) + 1);
  requestKbTotals.set(apiId, (requestKbTotals.get(apiId) ?? 0) + requestKb);
  responseKbTotals.set(apiId, (responseKbTotals.get(apiId) ?? 0) + responseKb);
}

export function getCostRecord(apiId: string): CostRecord | null {
  const config = configs.get(apiId);
  if (!config) return null;

  const calls = callCounts.get(apiId) ?? 0;
  const reqKb = requestKbTotals.get(apiId) ?? 0;
  const resKb = responseKbTotals.get(apiId) ?? 0;

  const callCost = calls * config.costPerCall;
  const reqCost = reqKb * (config.costPerKbRequest ?? 0);
  const resCost = resKb * (config.costPerKbResponse ?? 0);

  return {
    apiId,
    calls,
    requestKb: reqKb,
    responseKb: resKb,
    totalCost: callCost + reqCost + resCost,
    periodStart: periodStart.get(apiId) ?? Date.now(),
    periodEnd: Date.now(),
  };
}

export function getOptimizationRecommendations(apiId: string): CostOptimizationRecommendation[] {
  const config = configs.get(apiId);
  const record = getCostRecord(apiId);
  if (!config || !record) return [];

  const recommendations: CostOptimizationRecommendation[] = [];

  // Budget alert
  if (config.monthlyBudget && record.totalCost > config.monthlyBudget * 0.8) {
    recommendations.push({
      apiId,
      type: "budget-alert",
      description: `Cost ($${record.totalCost.toFixed(2)}) is at ${Math.round(record.totalCost / config.monthlyBudget * 100)}% of monthly budget`,
      estimatedSavingsUsd: 0,
      priority: "high",
    });
  }

  // Caching recommendation for high-frequency APIs
  if (record.calls > 1000) {
    const savingsFromCache = record.calls * 0.3 * config.costPerCall;
    recommendations.push({
      apiId,
      type: "cache",
      description: `High call volume (${record.calls} calls). Caching 30% of responses could save ~$${savingsFromCache.toFixed(2)}`,
      estimatedSavingsUsd: savingsFromCache,
      priority: savingsFromCache > 10 ? "high" : "medium",
    });
  }

  return recommendations;
}

export function _resetCostOptimizerForTest(): void {
  configs.clear();
  callCounts.clear();
  requestKbTotals.clear();
  responseKbTotals.clear();
  periodStart.clear();
}
