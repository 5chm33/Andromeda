/**
 * fairnessAuditor.ts — v88.0.0 "Explainability & Interpretability"
 * Audits model outputs for fairness across demographic groups using standard metrics.
 */
export type FairnessMetric = "demographic_parity" | "equalized_odds" | "equal_opportunity" | "predictive_parity";

export interface GroupStats {
  groupId: string;
  groupValue: string;
  totalCount: number;
  positiveCount: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  positiveRate: number;
  truePositiveRate: number;
  falsePositiveRate: number;
  precision: number;
}

export interface FairnessReport {
  reportId: string;
  modelId: string;
  sensitiveAttribute: string;
  groups: GroupStats[];
  metrics: Record<FairnessMetric, { value: number; passed: boolean; threshold: number }>;
  overallFair: boolean;
  recommendations: string[];
  computedAt: number;
}

const reports: FairnessReport[] = [];
let reportCounter = 0;

export function auditFairness(
  modelId: string,
  sensitiveAttribute: string,
  predictions: Array<{ groupValue: string; predicted: boolean; actual: boolean }>,
  thresholds: Partial<Record<FairnessMetric, number>> = {}
): FairnessReport {
  const groupMap = new Map<string, { total: number; pos: number; tp: number; fp: number; tn: number; fn: number }>();

  for (const p of predictions) {
    if (!groupMap.has(p.groupValue)) groupMap.set(p.groupValue, { total: 0, pos: 0, tp: 0, fp: 0, tn: 0, fn: 0 });
    const g = groupMap.get(p.groupValue)!;
    g.total++;
    if (p.predicted) g.pos++;
    if (p.predicted && p.actual) g.tp++;
    if (p.predicted && !p.actual) g.fp++;
    if (!p.predicted && !p.actual) g.tn++;
    if (!p.predicted && p.actual) g.fn++;
  }

  const groups: GroupStats[] = [...groupMap.entries()].map(([groupValue, g]) => ({
    groupId: groupValue,
    groupValue,
    totalCount: g.total,
    positiveCount: g.pos,
    truePositives: g.tp,
    falsePositives: g.fp,
    trueNegatives: g.tn,
    falseNegatives: g.fn,
    positiveRate: g.total > 0 ? g.pos / g.total : 0,
    truePositiveRate: (g.tp + g.fn) > 0 ? g.tp / (g.tp + g.fn) : 0,
    falsePositiveRate: (g.fp + g.tn) > 0 ? g.fp / (g.fp + g.tn) : 0,
    precision: (g.tp + g.fp) > 0 ? g.tp / (g.tp + g.fp) : 0,
  }));

  const positiveRates = groups.map(g => g.positiveRate);
  const tpRates = groups.map(g => g.truePositiveRate);
  const fpRates = groups.map(g => g.falsePositiveRate);
  const precisions = groups.map(g => g.precision);

  const maxMinRatio = (arr: number[]) => {
    if (arr.length < 2) return 1;
    const maxVal = Math.max(...arr);
    if (maxVal === 0) return 1; // all zero, no disparity
    const minVal = Math.min(...arr);
    return minVal / maxVal; // 0/1 = 0 when one group has zero rate
  };
  const dpThreshold = thresholds.demographic_parity ?? 0.8;
  const eoThreshold = thresholds.equalized_odds ?? 0.8;
  const eopThreshold = thresholds.equal_opportunity ?? 0.8;
  const ppThreshold = thresholds.predictive_parity ?? 0.8;

  const dpRatio = maxMinRatio(positiveRates);
  const eoRatio = Math.min(maxMinRatio(tpRates), maxMinRatio(fpRates));
  const eopRatio = maxMinRatio(tpRates);
  const ppRatio = maxMinRatio(precisions);

  const metrics: FairnessReport["metrics"] = {
    demographic_parity: { value: dpRatio, passed: dpRatio >= dpThreshold, threshold: dpThreshold },
    equalized_odds: { value: eoRatio, passed: eoRatio >= eoThreshold, threshold: eoThreshold },
    equal_opportunity: { value: eopRatio, passed: eopRatio >= eopThreshold, threshold: eopThreshold },
    predictive_parity: { value: ppRatio, passed: ppRatio >= ppThreshold, threshold: ppThreshold },
  };

  const failedMetrics = Object.entries(metrics).filter(([, m]) => !m.passed).map(([k]) => k);
  const recommendations = failedMetrics.map(m => `Address ${m.replace(/_/g, " ")} disparity across ${sensitiveAttribute} groups`);
  const overallFair = failedMetrics.length === 0;

  const report: FairnessReport = {
    reportId: `fr-${++reportCounter}`,
    modelId, sensitiveAttribute, groups, metrics, overallFair, recommendations,
    computedAt: Date.now(),
  };
  reports.push(report);
  return report;
}

export function getReport(reportId: string): FairnessReport | undefined { return reports.find(r => r.reportId === reportId); }
export function _resetFairnessAuditorForTest(): void { reports.length = 0; reportCounter = 0; }
