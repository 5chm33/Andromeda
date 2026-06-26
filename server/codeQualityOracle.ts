/**
 * Code Quality Oracle — predicts and measures code quality metrics.
 * Implements cyclomatic complexity, maintainability index, and technical debt estimation.
 */

export interface QualityMetrics {
  moduleId: string;
  cyclomaticComplexity: number;
  maintainabilityIndex: number;  // 0-100, higher = better
  technicalDebt: number;         // hours
  testCoverage: number;          // 0-1
  couplingScore: number;         // 0-1, lower = better
  cohesionScore: number;         // 0-1, higher = better
  overallGrade: "A" | "B" | "C" | "D" | "F";
}

export interface QualityTrend {
  moduleId: string;
  trend: "improving" | "degrading" | "stable";
  changeRate: number;
  recommendation: string;
}

export interface QualityReport {
  totalModulesAnalyzed: number;
  avgMaintainabilityIndex: number;
  avgTechnicalDebt: number;
  gradeDistribution: Record<string, number>;
  topIssues: string[];
}

class CodeQualityOracleEngine {
  private metrics: Map<string, QualityMetrics[]> = new Map();

  analyzeModule(moduleId: string, linesOfCode: number, branchCount: number, dependencies: number, testCount: number): QualityMetrics {
    // Cyclomatic complexity approximation
    const cyclomaticComplexity = 1 + branchCount;

    // Maintainability Index (simplified Halstead/McCabe formula)
    const mi = Math.max(0, Math.min(100,
      171 - 5.2 * Math.log(Math.max(linesOfCode, 1)) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(Math.max(linesOfCode, 1))
    ));

    // Technical debt: 30 min per complexity unit above threshold
    const debtHours = Math.max(0, (cyclomaticComplexity - 10) * 0.5);

    // Test coverage estimate
    const testCoverage = Math.min(1, testCount / Math.max(branchCount, 1));

    // Coupling: based on dependency count
    const couplingScore = Math.min(1, dependencies / 20);

    // Cohesion: inverse of coupling
    const cohesionScore = 1 - couplingScore * 0.5;

    // Grade
    let overallGrade: QualityMetrics["overallGrade"];
    const score = mi * 0.4 + testCoverage * 100 * 0.3 + cohesionScore * 100 * 0.3;
    if (score >= 80) overallGrade = "A";
    else if (score >= 65) overallGrade = "B";
    else if (score >= 50) overallGrade = "C";
    else if (score >= 35) overallGrade = "D";
    else overallGrade = "F";

    const m: QualityMetrics = {
      moduleId, cyclomaticComplexity, maintainabilityIndex: mi,
      technicalDebt: debtHours, testCoverage, couplingScore, cohesionScore, overallGrade,
    };
    if (!this.metrics.has(moduleId)) this.metrics.set(moduleId, []);
    this.metrics.get(moduleId)!.push(m);
    return m;
  }

  getQualityTrend(moduleId: string): QualityTrend {
    const history = this.metrics.get(moduleId) ?? [];
    if (history.length < 2) {
      return { moduleId, trend: "stable", changeRate: 0, recommendation: "Insufficient history" };
    }
    const recent = history[history.length - 1]!;
    const prev = history[history.length - 2]!;
    const change = recent.maintainabilityIndex - prev.maintainabilityIndex;
    const trend = change > 1 ? "improving" : change < -1 ? "degrading" : "stable";
    return {
      moduleId,
      trend,
      changeRate: change,
      recommendation: trend === "degrading"
        ? `Refactor ${moduleId}: MI dropped by ${Math.abs(change).toFixed(1)} points`
        : "Continue current development practices",
    };
  }

  getQualityReport(): QualityReport {
    const allMetrics = Array.from(this.metrics.values()).map(h => h[h.length - 1]!);
    const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    const topIssues: string[] = [];
    for (const m of allMetrics) {
      gradeDistribution[m.overallGrade] = (gradeDistribution[m.overallGrade] ?? 0) + 1;
      if (m.cyclomaticComplexity > 15) topIssues.push(`${m.moduleId}: High complexity (${m.cyclomaticComplexity})`);
      if (m.testCoverage < 0.5) topIssues.push(`${m.moduleId}: Low test coverage (${(m.testCoverage * 100).toFixed(0)}%)`);
    }
    return {
      totalModulesAnalyzed: allMetrics.length,
      avgMaintainabilityIndex: allMetrics.length > 0
        ? allMetrics.reduce((s, m) => s + m.maintainabilityIndex, 0) / allMetrics.length
        : 0,
      avgTechnicalDebt: allMetrics.length > 0
        ? allMetrics.reduce((s, m) => s + m.technicalDebt, 0) / allMetrics.length
        : 0,
      gradeDistribution,
      topIssues: topIssues.slice(0, 5),
    };
  }
}

export const globalCodeQualityOracle = new CodeQualityOracleEngine();

export function analyzeModuleQuality(moduleId: string, linesOfCode: number, branchCount: number, dependencies: number, testCount: number): QualityMetrics {
  return globalCodeQualityOracle.analyzeModule(moduleId, linesOfCode, branchCount, dependencies, testCount);
}
export function getQualityTrend(moduleId: string): QualityTrend {
  return globalCodeQualityOracle.getQualityTrend(moduleId);
}
export function getQualityReport(): QualityReport {
  return globalCodeQualityOracle.getQualityReport();
}
export function initCodeQualityOracle(): void {
  console.log("[CodeQuality] Code Quality Oracle initialized.");
  globalCodeQualityOracle.analyzeModule("rsiEngine", 500, 25, 8, 30);
  globalCodeQualityOracle.analyzeModule("selfImprove", 300, 15, 5, 20);
}
