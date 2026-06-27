/**
 * costAllocationEngine.ts — v78.0.0 "Cost Management & FinOps"
 * Allocates shared infrastructure costs to teams and projects using configurable rules.
 */
export type AllocationMethod = "equal_split" | "proportional" | "tag_based" | "fixed";

export interface AllocationRule {
  ruleId: string;
  name: string;
  method: AllocationMethod;
  targets: Array<{ entityId: string; entityType: "team" | "project"; weight?: number }>;
}

export interface CostAllocation {
  allocationId: string;
  ruleId: string;
  totalCostUsd: number;
  allocations: Array<{ entityId: string; entityType: string; allocatedUsd: number; percent: number }>;
  generatedAt: number;
}

const rules = new Map<string, AllocationRule>();
const allocations: CostAllocation[] = [];
let ruleCounter = 0;
let allocationCounter = 0;

export function createAllocationRule(name: string, method: AllocationMethod, targets: AllocationRule["targets"]): AllocationRule {
  const rule: AllocationRule = { ruleId: `rule-${++ruleCounter}`, name, method, targets };
  rules.set(rule.ruleId, rule);
  return rule;
}

export function allocateCost(ruleId: string, totalCostUsd: number): CostAllocation | null {
  const rule = rules.get(ruleId);
  if (!rule || rule.targets.length === 0) return null;

  let allocations_: CostAllocation["allocations"] = [];

  if (rule.method === "equal_split") {
    const share = totalCostUsd / rule.targets.length;
    allocations_ = rule.targets.map(t => ({ entityId: t.entityId, entityType: t.entityType, allocatedUsd: share, percent: 100 / rule.targets.length }));
  } else if (rule.method === "proportional" || rule.method === "tag_based") {
    const totalWeight = rule.targets.reduce((sum, t) => sum + (t.weight ?? 1), 0);
    allocations_ = rule.targets.map(t => {
      const w = t.weight ?? 1;
      const pct = (w / totalWeight) * 100;
      return { entityId: t.entityId, entityType: t.entityType, allocatedUsd: (w / totalWeight) * totalCostUsd, percent: pct };
    });
  } else if (rule.method === "fixed") {
    const totalWeight = rule.targets.reduce((sum, t) => sum + (t.weight ?? 0), 0);
    allocations_ = rule.targets.map(t => {
      const w = t.weight ?? 0;
      return { entityId: t.entityId, entityType: t.entityType, allocatedUsd: w, percent: totalWeight > 0 ? (w / totalWeight) * 100 : 0 };
    });
  }

  const allocation: CostAllocation = {
    allocationId: `alloc-${++allocationCounter}`,
    ruleId, totalCostUsd, allocations: allocations_, generatedAt: Date.now(),
  };
  allocations.push(allocation);
  return allocation;
}

export function getAllocationRule(ruleId: string): AllocationRule | undefined { return rules.get(ruleId); }
export function getAllocations(): CostAllocation[] { return [...allocations]; }
export function _resetCostAllocationEngineForTest(): void { rules.clear(); allocations.length = 0; ruleCounter = 0; allocationCounter = 0; }
