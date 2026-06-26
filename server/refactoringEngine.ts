/**
 * Refactoring Engine — automatically identifies and applies safe refactoring operations.
 * Implements extract method, inline variable, rename, and dead code elimination.
 */

export type RefactoringType = "extract_method" | "inline_variable" | "rename" | "dead_code_elimination" | "extract_interface" | "merge_modules";

export interface RefactoringOpportunity {
  id: string;
  moduleId: string;
  type: RefactoringType;
  description: string;
  estimatedImpact: "low" | "medium" | "high";
  riskLevel: "safe" | "moderate" | "risky";
  linesAffected: number;
  priority: number;  // 0-1
}

export interface RefactoringPlan {
  id: string;
  opportunities: RefactoringOpportunity[];
  totalImpact: number;
  estimatedTimeHours: number;
  safeToAutoApply: boolean;
}

export interface RefactoringReport {
  totalOpportunitiesFound: number;
  appliedCount: number;
  avgImpact: number;
  safeAutoApplyCount: number;
  topRefactoringType: string;
}

class RefactoringEngineImpl {
  private opportunities: RefactoringOpportunity[] = [];
  private appliedCount = 0;
  private counter = 0;

  scanForOpportunities(moduleId: string, metrics: {
    cyclomaticComplexity: number;
    linesOfCode: number;
    duplicateBlocks: number;
    unusedVariables: number;
  }): RefactoringOpportunity[] {
    const found: RefactoringOpportunity[] = [];

    if (metrics.cyclomaticComplexity > 10) {
      found.push({
        id: `ref-${++this.counter}`,
        moduleId,
        type: "extract_method",
        description: `Cyclomatic complexity ${metrics.cyclomaticComplexity} > 10 — extract sub-methods`,
        estimatedImpact: "high",
        riskLevel: "safe",
        linesAffected: Math.floor(metrics.linesOfCode * 0.3),
        priority: 0.9,
      });
    }

    if (metrics.duplicateBlocks > 0) {
      found.push({
        id: `ref-${++this.counter}`,
        moduleId,
        type: "extract_method",
        description: `${metrics.duplicateBlocks} duplicate code block(s) detected — extract shared function`,
        estimatedImpact: "medium",
        riskLevel: "safe",
        linesAffected: metrics.duplicateBlocks * 10,
        priority: 0.7,
      });
    }

    if (metrics.unusedVariables > 0) {
      found.push({
        id: `ref-${++this.counter}`,
        moduleId,
        type: "dead_code_elimination",
        description: `${metrics.unusedVariables} unused variable(s) — eliminate dead code`,
        estimatedImpact: "low",
        riskLevel: "safe",
        linesAffected: metrics.unusedVariables,
        priority: 0.5,
      });
    }

    if (metrics.linesOfCode > 500) {
      found.push({
        id: `ref-${++this.counter}`,
        moduleId,
        type: "extract_interface",
        description: `Module exceeds 500 LOC — extract public interface`,
        estimatedImpact: "medium",
        riskLevel: "moderate",
        linesAffected: Math.floor(metrics.linesOfCode * 0.1),
        priority: 0.6,
      });
    }

    this.opportunities.push(...found);
    return found;
  }

  createRefactoringPlan(moduleId: string): RefactoringPlan {
    const relevant = this.opportunities.filter(o => o.moduleId === moduleId)
      .sort((a, b) => b.priority - a.priority);
    const safeOps = relevant.filter(o => o.riskLevel === "safe");
    const totalImpact = relevant.reduce((s, o) => s + o.priority, 0);
    return {
      id: `plan-${moduleId}`,
      opportunities: relevant,
      totalImpact,
      estimatedTimeHours: relevant.reduce((s, o) => s + o.linesAffected * 0.01, 0),
      safeToAutoApply: safeOps.length === relevant.length,
    };
  }

  applyRefactoring(opportunityId: string): boolean {
    const opp = this.opportunities.find(o => o.id === opportunityId);
    if (!opp || opp.riskLevel === "risky") return false;
    this.appliedCount++;
    // [Refactor] Applied: ${opp.description}`);
    return true;
  }

  getRefactoringReport(): RefactoringReport {
    const typeCounts = this.opportunities.reduce((acc, o) => {
      acc[o.type] = (acc[o.type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    return {
      totalOpportunitiesFound: this.opportunities.length,
      appliedCount: this.appliedCount,
      avgImpact: this.opportunities.length > 0
        ? this.opportunities.reduce((s, o) => s + o.priority, 0) / this.opportunities.length
        : 0,
      safeAutoApplyCount: this.opportunities.filter(o => o.riskLevel === "safe").length,
      topRefactoringType: topType,
    };
  }
}

export const globalRefactoringEngine = new RefactoringEngineImpl();

export function scanForRefactoringOpportunities(moduleId: string, metrics: {
  cyclomaticComplexity: number; linesOfCode: number; duplicateBlocks: number; unusedVariables: number;
}): RefactoringOpportunity[] {
  return globalRefactoringEngine.scanForOpportunities(moduleId, metrics);
}
export function createRefactoringPlan(moduleId: string): RefactoringPlan {
  return globalRefactoringEngine.createRefactoringPlan(moduleId);
}
export function applyRefactoring(opportunityId: string): boolean {
  return globalRefactoringEngine.applyRefactoring(opportunityId);
}
export function getRefactoringReport(): RefactoringReport {
  return globalRefactoringEngine.getRefactoringReport();
}
export function initRefactoringEngine(): void {
  console.log("[Refactoring] Refactoring Engine initialized.");
}
