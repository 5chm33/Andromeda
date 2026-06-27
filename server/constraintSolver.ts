/**
 * constraintSolver.ts — v89.0.0 "Autonomous Planning & Goal Management"
 * Solves constraint satisfaction problems (CSP) using backtracking search.
 */
export type ConstraintType = "equality" | "inequality" | "range" | "not_equal" | "all_different";

export interface Variable {
  name: string;
  domain: unknown[];
  assignedValue: unknown | null;
}

export interface Constraint {
  constraintId: string;
  type: ConstraintType;
  variables: string[];
  params: Record<string, unknown>;
}

export interface CSPSolution {
  solvable: boolean;
  assignments: Record<string, unknown>;
  constraintsSatisfied: number;
  totalConstraints: number;
  backtrackCount: number;
  solveTimeMs: number;
}

export interface CSPProblem {
  problemId: string;
  variables: Map<string, Variable>;
  constraints: Constraint[];
}

const problems = new Map<string, CSPProblem>();
let problemCounter = 0;
let constraintCounter = 0;

export function createProblem(): CSPProblem {
  const problem: CSPProblem = { problemId: `csp-${++problemCounter}`, variables: new Map(), constraints: [] };
  problems.set(problem.problemId, problem);
  return problem;
}

export function addVariable(problemId: string, name: string, domain: unknown[]): Variable | null {
  const problem = problems.get(problemId);
  if (!problem) return null;
  const variable: Variable = { name, domain, assignedValue: null };
  problem.variables.set(name, variable);
  return variable;
}

export function addConstraint(problemId: string, type: ConstraintType, variables: string[], params: Record<string, unknown> = {}): Constraint | null {
  const problem = problems.get(problemId);
  if (!problem) return null;
  const constraint: Constraint = { constraintId: `c-${++constraintCounter}`, type, variables, params };
  problem.constraints.push(constraint);
  return constraint;
}

function checkConstraint(constraint: Constraint, assignments: Record<string, unknown>): boolean {
  const vals = constraint.variables.map(v => assignments[v]);
  if (vals.some(v => v === undefined)) return true; // unassigned, skip
  switch (constraint.type) {
    case "equality": return vals[0] === vals[1];
    case "inequality": return vals[0] !== vals[1];
    case "not_equal": return vals.every((v, i) => vals.every((w, j) => i === j || v !== w));
    case "all_different": return new Set(vals).size === vals.length;
    case "range": return Number(vals[0]) >= Number(constraint.params.min) && Number(vals[0]) <= Number(constraint.params.max);
    default: return true;
  }
}

function backtrack(problem: CSPProblem, assignments: Record<string, unknown>, varNames: string[], index: number, backtrackCount: { count: number }): boolean {
  if (index === varNames.length) return true;
  const varName = varNames[index];
  const variable = problem.variables.get(varName)!;

  for (const value of variable.domain) {
    assignments[varName] = value;
    const consistent = problem.constraints.every(c => checkConstraint(c, assignments));
    if (consistent) {
      if (backtrack(problem, assignments, varNames, index + 1, backtrackCount)) return true;
    }
    backtrackCount.count++;
  }
  delete assignments[varName];
  return false;
}

export function solve(problemId: string): CSPSolution {
  const problem = problems.get(problemId);
  if (!problem) return { solvable: false, assignments: {}, constraintsSatisfied: 0, totalConstraints: 0, backtrackCount: 0, solveTimeMs: 0 };

  const start = Date.now();
  const assignments: Record<string, unknown> = {};
  const varNames = [...problem.variables.keys()];
  const backtrackCount = { count: 0 };
  const solvable = backtrack(problem, assignments, varNames, 0, backtrackCount);
  const constraintsSatisfied = problem.constraints.filter(c => checkConstraint(c, assignments)).length;

  return { solvable, assignments: solvable ? { ...assignments } : {}, constraintsSatisfied, totalConstraints: problem.constraints.length, backtrackCount: backtrackCount.count, solveTimeMs: Date.now() - start };
}

export function _resetConstraintSolverForTest(): void { problems.clear(); problemCounter = 0; constraintCounter = 0; }
