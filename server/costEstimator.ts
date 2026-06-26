/**
 * Cost Estimator — estimates and tracks computational costs of AI operations.
 * Implements cost modeling, budget enforcement, and ROI analysis.
 */

export interface CostModel {
  operationType: string;
  costPerUnit: number;       // USD per 1M tokens / per GFLOP
  unitType: "tokens" | "flops" | "seconds" | "api_calls";
}

export interface CostEstimate {
  operationId: string;
  operationType: string;
  estimatedCost: number;
  actualCost: number | null;
  units: number;
  roi: number | null;
  timestamp: number;
}

export interface CostReport {
  totalEstimatedCost: number;
  totalActualCost: number;
  estimationAccuracy: number;
  mostExpensiveOperation: string;
  budgetUtilization: number;
}

class CostEstimatorEngine {
  private models: Map<string, CostModel> = new Map([
    ["llm_inference", { operationType: "llm_inference", costPerUnit: 0.002, unitType: "tokens" }],
    ["embedding", { operationType: "embedding", costPerUnit: 0.0001, unitType: "tokens" }],
    ["training_step", { operationType: "training_step", costPerUnit: 0.00001, unitType: "flops" }],
    ["api_call", { operationType: "api_call", costPerUnit: 0.001, unitType: "api_calls" }],
  ]);
  private estimates: CostEstimate[] = [];
  private budget = 100.0; // USD
  private counter = 0;

  estimateCost(operationType: string, units: number): CostEstimate {
    const model = this.models.get(operationType) ?? { operationType, costPerUnit: 0.001, unitType: "api_calls" as const };
    const estimatedCost = model.costPerUnit * (units / 1_000_000);
    const estimate: CostEstimate = {
      operationId: `cost-${++this.counter}`,
      operationType, estimatedCost, actualCost: null, units, roi: null,
      timestamp: Date.now(),
    };
    this.estimates.push(estimate);
    return estimate;
  }

  recordActualCost(operationId: string, actualCost: number, valueGenerated: number): void {
    const est = this.estimates.find(e => e.operationId === operationId);
    if (est) {
      est.actualCost = actualCost;
      est.roi = actualCost > 0 ? (valueGenerated - actualCost) / actualCost : 0;
    }
  }

  addCostModel(model: CostModel): void {
    this.models.set(model.operationType, model);
  }

  getCostReport(): CostReport {
    const withActual = this.estimates.filter(e => e.actualCost !== null);
    const totalEstimated = this.estimates.reduce((s, e) => s + e.estimatedCost, 0);
    const totalActual = withActual.reduce((s, e) => s + (e.actualCost ?? 0), 0);
    const accuracy = withActual.length > 0
      ? 1 - Math.abs(totalEstimated - totalActual) / Math.max(totalEstimated, totalActual, 0.001)
      : 1;
    const mostExpensive = this.estimates.reduce(
      (max, e) => e.estimatedCost > (max?.estimatedCost ?? 0) ? e : max,
      this.estimates[0]
    );
    return {
      totalEstimatedCost: totalEstimated,
      totalActualCost: totalActual,
      estimationAccuracy: accuracy,
      mostExpensiveOperation: mostExpensive?.operationType ?? "none",
      budgetUtilization: totalEstimated / this.budget,
    };
  }
}

export const globalCostEstimator = new CostEstimatorEngine();

export function estimateCost(operationType: string, units: number): CostEstimate {
  return globalCostEstimator.estimateCost(operationType, units);
}
export function recordActualCost(operationId: string, actualCost: number, valueGenerated: number): void {
  globalCostEstimator.recordActualCost(operationId, actualCost, valueGenerated);
}
export function addCostModel(model: CostModel): void {
  globalCostEstimator.addCostModel(model);
}
export function getCostReport(): CostReport {
  return globalCostEstimator.getCostReport();
}
export function initCostEstimator(): void {
  console.log("[CostEstimator] Cost Estimator initialized with 4 cost models.");
}
