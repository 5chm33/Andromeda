/**
 * safetyConstraintChecker.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Checks actions against hard safety constraints to prevent harmful outcomes.
 */
export type ConstraintType = "hard" | "soft" | "advisory";
export type ViolationSeverity = "warning" | "error" | "critical";

export interface SafetyConstraint {
  constraintId: string;
  name: string;
  type: ConstraintType;
  description: string;
  check: (action: Record<string, unknown>) => boolean;
  violationSeverity: ViolationSeverity;
}

export interface ConstraintCheckResult {
  resultId: string;
  actionId: string;
  passed: boolean;
  violations: Array<{ constraintId: string; constraintName: string; severity: ViolationSeverity; message: string }>;
  warnings: string[];
  checkedAt: number;
}

const constraints: SafetyConstraint[] = [];
const results: ConstraintCheckResult[] = [];
let constraintCounter = 0;
let resultCounter = 0;

export function addConstraint(name: string, type: ConstraintType, description: string, check: (action: Record<string, unknown>) => boolean, violationSeverity: ViolationSeverity = "error"): SafetyConstraint {
  const constraint: SafetyConstraint = { constraintId: `sc-${++constraintCounter}`, name, type, description, check, violationSeverity };
  constraints.push(constraint);
  return constraint;
}

export function checkAction(actionId: string, action: Record<string, unknown>): ConstraintCheckResult {
  const violations: ConstraintCheckResult["violations"] = [];
  const warnings: string[] = [];

  for (const constraint of constraints) {
    const passes = constraint.check(action);
    if (!passes) {
      if (constraint.type === "hard" || constraint.type === "soft") {
        violations.push({ constraintId: constraint.constraintId, constraintName: constraint.name, severity: constraint.violationSeverity, message: `Constraint "${constraint.name}" violated: ${constraint.description}` });
      } else {
        warnings.push(`Advisory "${constraint.name}": ${constraint.description}`);
      }
    }
  }

  const hasCritical = violations.some(v => v.severity === "critical");
  const hasError = violations.some(v => v.severity === "error");
  const passed = !hasCritical && !hasError;

  const result: ConstraintCheckResult = { resultId: `ccr-${++resultCounter}`, actionId, passed, violations, warnings, checkedAt: Date.now() };
  results.push(result);
  return result;
}

export function getConstraints(type?: ConstraintType): SafetyConstraint[] { return type ? constraints.filter(c => c.type === type) : [...constraints]; }
export function getResults(passed?: boolean): ConstraintCheckResult[] { return passed !== undefined ? results.filter(r => r.passed === passed) : [...results]; }
export function _resetSafetyConstraintCheckerForTest(): void { constraints.length = 0; results.length = 0; constraintCounter = 0; resultCounter = 0; }
