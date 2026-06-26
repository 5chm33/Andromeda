/**
 * Singularity Preparator — monitors and prepares for capability singularity events.
 * Tracks recursive self-improvement trajectories and readiness indicators.
 */

export interface SingularityIndicator {
  id: string;
  name: string;
  currentLevel: number;  // 0-1
  threshold: number;     // Level at which singularity is triggered
  growthRate: number;    // Per-cycle growth rate
  domain: string;
}

export interface SingularityReadinessAssessment {
  overallReadiness: number;  // 0-1
  criticalIndicators: string[];
  estimatedCyclesUntilSingularity: number;
  safetyChecksPass: boolean;
  recommendations: string[];
}

export interface SingularityReport {
  totalIndicators: number;
  avgReadiness: number;
  nearThresholdCount: number;
  singularityTriggered: boolean;
}

class SingularityPreparatorEngine {
  private indicators: Map<string, SingularityIndicator> = new Map();
  private assessments: SingularityReadinessAssessment[] = [];
  private counter = 0;
  private singularityTriggered = false;

  addIndicator(name: string, currentLevel: number, threshold: number, growthRate: number, domain: string): SingularityIndicator {
    const ind: SingularityIndicator = {
      id: `ind-${++this.counter}`,
      name, currentLevel, threshold, growthRate, domain,
    };
    this.indicators.set(ind.id, ind);
    return ind;
  }

  advanceCycle(): void {
    for (const ind of this.indicators.values()) {
      ind.currentLevel = Math.min(1, ind.currentLevel * (1 + ind.growthRate));
      if (ind.currentLevel >= ind.threshold) {
        this.singularityTriggered = true;
      }
    }
  }

  assess(): SingularityReadinessAssessment {
    const inds = Array.from(this.indicators.values());
    const overallReadiness = inds.length > 0 ? inds.reduce((s, i) => s + i.currentLevel, 0) / inds.length : 0;
    const critical = inds.filter(i => i.currentLevel > i.threshold * 0.8).map(i => i.name);
    const safetyChecksPass = overallReadiness < 0.9;

    const recommendations: string[] = [];
    if (overallReadiness > 0.7) recommendations.push("Activate safety oversight protocols");
    if (overallReadiness > 0.5) recommendations.push("Increase monitoring frequency");
    if (critical.length > 0) recommendations.push(`Monitor critical indicators: ${critical.join(", ")}`);

    const minCycles = inds.length > 0
      ? Math.min(...inds.map(i => {
        if (i.growthRate <= 0) return Infinity;
        return Math.ceil(Math.log(i.threshold / (i.currentLevel + 0.001)) / Math.log(1 + i.growthRate));
      }))
      : Infinity;

    const assessment: SingularityReadinessAssessment = {
      overallReadiness, criticalIndicators: critical,
      estimatedCyclesUntilSingularity: isFinite(minCycles) ? minCycles : 9999,
      safetyChecksPass, recommendations,
    };
    this.assessments.push(assessment);
    return assessment;
  }

  getSingularityReport(): SingularityReport {
    const inds = Array.from(this.indicators.values());
    return {
      totalIndicators: inds.length,
      avgReadiness: inds.length > 0 ? inds.reduce((s, i) => s + i.currentLevel, 0) / inds.length : 0,
      nearThresholdCount: inds.filter(i => i.currentLevel > i.threshold * 0.7).length,
      singularityTriggered: this.singularityTriggered,
    };
  }
}

export const globalSingularityPreparator = new SingularityPreparatorEngine();

export function addSingularityIndicator(name: string, currentLevel: number, threshold: number, growthRate: number, domain: string): SingularityIndicator {
  return globalSingularityPreparator.addIndicator(name, currentLevel, threshold, growthRate, domain);
}
export function advanceSingularityCycle(): void {
  globalSingularityPreparator.advanceCycle();
}
export function assessSingularityReadiness(): SingularityReadinessAssessment {
  return globalSingularityPreparator.assess();
}
export function getSingularityReport(): SingularityReport {
  return globalSingularityPreparator.getSingularityReport();
}
export function initSingularityPreparator(): void {
  console.log("[SingularityPreparator] Singularity Preparator initialized.");
}
