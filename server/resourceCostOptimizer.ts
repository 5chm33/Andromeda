/**
 * resourceCostOptimizer.ts — v78.0.0 "Cost Management & FinOps"
 * Analyzes resource utilization and generates cost optimization recommendations.
 */
export type OptimizationCategory = "rightsizing" | "reserved_instances" | "idle_resources" | "storage_tiering" | "spot_instances" | "scheduling";

export interface ResourceUtilization {
  resourceId: string;
  resourceType: string;
  service: string;
  currentCostUsd: number;
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
  idleDays: number;
}

export interface OptimizationRecommendation {
  recommendationId: string;
  resourceId: string;
  category: OptimizationCategory;
  description: string;
  estimatedSavingsUsd: number;
  effort: "low" | "medium" | "high";
  priority: "high" | "medium" | "low";
}

export interface OptimizationReport {
  reportId: string;
  recommendations: OptimizationRecommendation[];
  totalEstimatedSavingsUsd: number;
  generatedAt: number;
}

const reports: OptimizationReport[] = [];
let reportCounter = 0;
let recCounter = 0;

export function generateOptimizationReport(resources: ResourceUtilization[]): OptimizationReport {
  const recommendations: OptimizationRecommendation[] = [];

  for (const resource of resources) {
    // Idle resource
    if (resource.idleDays >= 7) {
      recommendations.push({
        recommendationId: `rec-${++recCounter}`,
        resourceId: resource.resourceId,
        category: "idle_resources",
        description: `Resource "${resource.resourceId}" has been idle for ${resource.idleDays} days — consider terminating`,
        estimatedSavingsUsd: resource.currentCostUsd * 0.9,
        effort: "low",
        priority: "high",
      });
    }

    // Rightsizing: low CPU + memory
    if (resource.cpuUtilizationPercent < 20 && resource.memoryUtilizationPercent < 30 && resource.idleDays < 7) {
      recommendations.push({
        recommendationId: `rec-${++recCounter}`,
        resourceId: resource.resourceId,
        category: "rightsizing",
        description: `Resource "${resource.resourceId}" is over-provisioned (CPU: ${resource.cpuUtilizationPercent}%, Mem: ${resource.memoryUtilizationPercent}%) — downsize instance`,
        estimatedSavingsUsd: resource.currentCostUsd * 0.4,
        effort: "medium",
        priority: "medium",
      });
    }

    // Reserved instances for long-running resources
    if (resource.idleDays === 0 && resource.cpuUtilizationPercent > 60) {
      recommendations.push({
        recommendationId: `rec-${++recCounter}`,
        resourceId: resource.resourceId,
        category: "reserved_instances",
        description: `Resource "${resource.resourceId}" runs consistently at high utilization — consider reserved instance pricing`,
        estimatedSavingsUsd: resource.currentCostUsd * 0.3,
        effort: "low",
        priority: "medium",
      });
    }
  }

  const report: OptimizationReport = {
    reportId: `opt-report-${++reportCounter}`,
    recommendations,
    totalEstimatedSavingsUsd: recommendations.reduce((sum, r) => sum + r.estimatedSavingsUsd, 0),
    generatedAt: Date.now(),
  };

  reports.push(report);
  console.log(`[ResourceCostOptimizer] Generated ${recommendations.length} recommendations, estimated savings: $${report.totalEstimatedSavingsUsd.toFixed(2)}`);
  return report;
}

export function getOptimizationReports(): OptimizationReport[] { return [...reports]; }
export function _resetResourceCostOptimizerForTest(): void { reports.length = 0; reportCounter = 0; recCounter = 0; }
