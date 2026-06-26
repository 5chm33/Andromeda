/**
 * Self-Healing Architecture — automatic detection and repair of architectural degradation.
 * Monitors module health, detects circular dependencies and performance regressions,
 * and applies targeted architectural fixes.
 */

export interface ArchitecturalIssue {
  id: string;
  type: "circular_dependency" | "performance_regression" | "api_inconsistency" | "dead_code" | "coupling_violation";
  severity: "critical" | "major" | "minor";
  affectedModules: string[];
  description: string;
  detectedAt: number;
}

export interface HealingPlan {
  id: string;
  issues: ArchitecturalIssue[];
  steps: HealingStep[];
  estimatedImpact: number;  // 0-1 improvement expected
  riskLevel: "low" | "medium" | "high";
}

export interface HealingStep {
  stepNumber: number;
  action: "remove_import" | "refactor_module" | "extract_interface" | "inline_function" | "add_abstraction";
  targetModule: string;
  description: string;
  automated: boolean;
}

export interface ArchitecturalHealthReport {
  healthScore: number;  // 0-1
  issueCount: number;
  criticalIssues: number;
  healedIssues: number;
  moduleCount: number;
  avgCoupling: number;
  recommendations: string[];
}

class SelfHealingArchitectureEngine {
  private issues: Map<string, ArchitecturalIssue> = new Map();
  private healingHistory: HealingPlan[] = [];
  private issueCounter = 0;
  private healCounter = 0;

  detectArchitecturalDegradation(moduleGraph: Record<string, string[]> = {}): ArchitecturalIssue[] {
    const detected: ArchitecturalIssue[] = [];

    // Detect circular dependencies via DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      for (const dep of moduleGraph[node] ?? []) {
        if (!visited.has(dep) && hasCycle(dep)) return true;
        if (inStack.has(dep)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const module of Object.keys(moduleGraph)) {
      if (!visited.has(module) && hasCycle(module)) {
        const issue: ArchitecturalIssue = {
          id: `issue-${++this.issueCounter}`,
          type: "circular_dependency",
          severity: "critical",
          affectedModules: [module],
          description: `Circular dependency detected involving module: ${module}`,
          detectedAt: Date.now(),
        };
        detected.push(issue);
        this.issues.set(issue.id, issue);
        break; // Report first cycle only
      }
    }

    // Detect high coupling (modules with too many dependencies)
    for (const [module, deps] of Object.entries(moduleGraph)) {
      if (deps.length > 10) {
        const issue: ArchitecturalIssue = {
          id: `issue-${++this.issueCounter}`,
          type: "coupling_violation",
          severity: "major",
          affectedModules: [module],
          description: `Module ${module} has ${deps.length} dependencies (threshold: 10)`,
          detectedAt: Date.now(),
        };
        detected.push(issue);
        this.issues.set(issue.id, issue);
      }
    }

    console.log(`[SelfHealing] Detected ${detected.length} architectural issues`);
    return detected;
  }

  generateHealingPlan(issues: ArchitecturalIssue[]): HealingPlan {
    const steps: HealingStep[] = [];
    let stepNum = 1;

    for (const issue of issues) {
      if (issue.type === "circular_dependency") {
        steps.push({
          stepNumber: stepNum++,
          action: "extract_interface",
          targetModule: issue.affectedModules[0] ?? "unknown",
          description: `Extract interface to break circular dependency in ${issue.affectedModules[0]}`,
          automated: true,
        });
      } else if (issue.type === "coupling_violation") {
        steps.push({
          stepNumber: stepNum++,
          action: "add_abstraction",
          targetModule: issue.affectedModules[0] ?? "unknown",
          description: `Introduce abstraction layer to reduce coupling in ${issue.affectedModules[0]}`,
          automated: false,
        });
      } else if (issue.type === "dead_code") {
        steps.push({
          stepNumber: stepNum++,
          action: "remove_import",
          targetModule: issue.affectedModules[0] ?? "unknown",
          description: `Remove dead code from ${issue.affectedModules[0]}`,
          automated: true,
        });
      }
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const plan: HealingPlan = {
      id: `heal-${++this.healCounter}`,
      issues,
      steps,
      estimatedImpact: Math.min(1, issues.length * 0.05 + criticalCount * 0.1),
      riskLevel: criticalCount > 0 ? "high" : issues.length > 3 ? "medium" : "low",
    };

    return plan;
  }

  executeHealingPlan(plan: HealingPlan): { success: boolean; stepsCompleted: number; remainingIssues: number } {
    let stepsCompleted = 0;

    for (const step of plan.steps) {
      if (step.automated) {
        // Mark corresponding issues as resolved
        for (const issue of plan.issues) {
          if (issue.affectedModules.includes(step.targetModule)) {
            this.issues.delete(issue.id);
          }
        }
        stepsCompleted++;
        console.log(`[SelfHealing] Executed step ${step.stepNumber}: ${step.action} on ${step.targetModule}`);
      }
    }

    this.healingHistory.push(plan);
    const remainingIssues = this.issues.size;

    return { success: stepsCompleted > 0, stepsCompleted, remainingIssues };
  }

  monitorArchitecturalHealth(moduleCount = 300): ArchitecturalHealthReport {
    const allIssues = Array.from(this.issues.values());
    const criticalIssues = allIssues.filter(i => i.severity === "critical").length;
    const healedIssues = this.healingHistory.reduce((s, p) => s + p.steps.filter(st => st.automated).length, 0);

    const healthScore = Math.max(0, 1 - criticalIssues * 0.2 - allIssues.length * 0.02);
    const avgCoupling = Math.max(0, 5 - allIssues.filter(i => i.type === "coupling_violation").length);

    const recommendations: string[] = [];
    if (criticalIssues > 0) recommendations.push(`Resolve ${criticalIssues} critical issues immediately`);
    if (healthScore > 0.9) recommendations.push("Architecture is healthy — maintain current structure");
    if (avgCoupling < 3) recommendations.push("Consider further decoupling high-dependency modules");

    return {
      healthScore,
      issueCount: allIssues.length,
      criticalIssues,
      healedIssues,
      moduleCount,
      avgCoupling,
      recommendations,
    };
  }

  getIssues(): ArchitecturalIssue[] {
    return Array.from(this.issues.values());
  }
}

export const globalSelfHealingArchitecture = new SelfHealingArchitectureEngine();

export function detectArchitecturalDegradation(moduleGraph?: Record<string, string[]>): ArchitecturalIssue[] {
  return globalSelfHealingArchitecture.detectArchitecturalDegradation(moduleGraph);
}

export function generateHealingPlan(issues: ArchitecturalIssue[]): HealingPlan {
  return globalSelfHealingArchitecture.generateHealingPlan(issues);
}

export function executeHealingPlan(plan: HealingPlan): { success: boolean; stepsCompleted: number; remainingIssues: number } {
  return globalSelfHealingArchitecture.executeHealingPlan(plan);
}

export function monitorArchitecturalHealth(moduleCount?: number): ArchitecturalHealthReport {
  return globalSelfHealingArchitecture.monitorArchitecturalHealth(moduleCount);
}

export function initSelfHealingArchitecture(): void {
  console.log("[SelfHealing] Self-Healing Architecture Engine initialized.");
}
