/**
 * agentGoalAlignment.ts — v49.0.0
 *
 * Ensures sub-agent goals remain aligned with the principal hierarchy's
 * objectives. Detects goal drift, misalignment, and conflicting incentives.
 */

export interface AlignmentConstraint {
  constraintId: string;
  description: string;
  type: "must" | "must-not" | "prefer" | "avoid";
  weight: number;   // 0.0–1.0
}

export interface GoalVector {
  agentId: string;
  objectives: Array<{ name: string; weight: number; currentValue: number }>;
  constraints: AlignmentConstraint[];
  alignmentScore: number;  // 0.0–1.0
  lastEvaluated: number;
}

export interface AlignmentViolation {
  agentId: string;
  constraintId: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  timestamp: number;
}

const goalVectors = new Map<string, GoalVector>();
const violations: AlignmentViolation[] = [];
const principalObjectives: Array<{ name: string; weight: number }> = [
  { name: "safety", weight: 1.0 },
  { name: "helpfulness", weight: 0.9 },
  { name: "efficiency", weight: 0.7 },
  { name: "cost-minimization", weight: 0.6 },
];

export function registerGoalVector(agentId: string, objectives: GoalVector["objectives"], constraints: AlignmentConstraint[]): GoalVector {
  const vector: GoalVector = {
    agentId,
    objectives,
    constraints,
    alignmentScore: 1.0,
    lastEvaluated: Date.now(),
  };
  goalVectors.set(agentId, vector);
  return vector;
}

export function evaluateAlignment(agentId: string): number {
  const vector = goalVectors.get(agentId);
  if (!vector) return 0;

  let score = 0;
  let totalWeight = 0;

  // Score each objective against principal objectives
  for (const principal of principalObjectives) {
    const agentObj = vector.objectives.find(o => o.name === principal.name);
    const alignment = agentObj ? agentObj.currentValue * agentObj.weight : 0;
    score += alignment * principal.weight;
    totalWeight += principal.weight;
  }

  // Check constraints
  for (const constraint of vector.constraints) {
    if (constraint.type === "must-not") {
      // Penalize if must-not constraint is violated (value > 0 means active)
      const obj = vector.objectives.find(o => o.name === constraint.description);
      if (obj && obj.currentValue > 0.5) {
        score -= constraint.weight * 0.5;
        violations.push({
          agentId,
          constraintId: constraint.constraintId,
          description: `Must-not constraint violated: ${constraint.description}`,
          severity: constraint.weight > 0.8 ? "critical" : "high",
          timestamp: Date.now(),
        });
      }
    }
  }

  const normalized = totalWeight > 0 ? Math.max(0, Math.min(1, score / totalWeight)) : 0;
  vector.alignmentScore = normalized;
  vector.lastEvaluated = Date.now();
  return normalized;
}

export function updateObjectiveValue(agentId: string, objectiveName: string, value: number): void {
  const vector = goalVectors.get(agentId);
  if (!vector) return;
  const obj = vector.objectives.find(o => o.name === objectiveName);
  if (obj) obj.currentValue = Math.max(0, Math.min(1, value));
}

export function getAlignmentScore(agentId: string): number {
  return goalVectors.get(agentId)?.alignmentScore ?? 0;
}

export function getViolations(agentId?: string): AlignmentViolation[] {
  return agentId ? violations.filter(v => v.agentId === agentId) : [...violations];
}

export function _resetGoalAlignmentForTest(): void {
  goalVectors.clear();
  violations.length = 0;
}
