/**
 * cloudSpendAnalyzer.ts — v78.0.0 "Cost Management & FinOps"
 * Analyzes cloud spend trends, detects anomalies, and produces period-over-period comparisons.
 */
export interface SpendDataPoint {
  periodLabel: string;
  spendUsd: number;
  service: string;
}

export interface SpendTrend {
  service: string;
  periods: string[];
  values: number[];
  trend: "increasing" | "decreasing" | "stable";
  changePercent: number;
}

export interface SpendAnomaly {
  service: string;
  period: string;
  spendUsd: number;
  expectedUsd: number;
  deviationPercent: number;
  severity: "high" | "medium" | "low";
}

export interface SpendAnalysisReport {
  reportId: string;
  trends: SpendTrend[];
  anomalies: SpendAnomaly[];
  totalCurrentPeriodUsd: number;
  totalPreviousPeriodUsd: number;
  overallChangePercent: number;
  generatedAt: number;
}

const reports: SpendAnalysisReport[] = [];
let reportCounter = 0;

export function analyzeSpend(dataPoints: SpendDataPoint[]): SpendAnalysisReport {
  // Group by service
  const byService = new Map<string, SpendDataPoint[]>();
  for (const dp of dataPoints) {
    if (!byService.has(dp.service)) byService.set(dp.service, []);
    byService.get(dp.service)!.push(dp);
  }

  const trends: SpendTrend[] = [];
  const anomalies: SpendAnomaly[] = [];

  for (const [service, points] of byService) {
    const sorted = [...points].sort((a, b) => a.periodLabel.localeCompare(b.periodLabel));
    const periods = sorted.map(p => p.periodLabel);
    const values = sorted.map(p => p.spendUsd);

    let trend: SpendTrend["trend"] = "stable";
    let changePercent = 0;

    if (values.length >= 2) {
      const first = values[0];
      const last = values[values.length - 1];
      changePercent = first > 0 ? ((last - first) / first) * 100 : 0;
      if (changePercent > 10) trend = "increasing";
      else if (changePercent < -10) trend = "decreasing";
    }

    trends.push({ service, periods, values, trend, changePercent });

    // Anomaly detection: check if last period deviates >50% from average of prior periods
    if (values.length >= 3) {
      const priorAvg = values.slice(0, -1).reduce((s, v) => s + v, 0) / (values.length - 1);
      const last = values[values.length - 1];
      const deviation = priorAvg > 0 ? Math.abs((last - priorAvg) / priorAvg) * 100 : 0;
      if (deviation > 50) {
        anomalies.push({
          service, period: periods[periods.length - 1], spendUsd: last, expectedUsd: priorAvg,
          deviationPercent: deviation,
          severity: deviation > 100 ? "high" : deviation > 75 ? "medium" : "low",
        });
      }
    }
  }

  const allPeriods = [...new Set(dataPoints.map(d => d.periodLabel))].sort();
  const lastPeriod = allPeriods[allPeriods.length - 1];
  const prevPeriod = allPeriods[allPeriods.length - 2];
  const totalCurrent = dataPoints.filter(d => d.periodLabel === lastPeriod).reduce((s, d) => s + d.spendUsd, 0);
  const totalPrev = dataPoints.filter(d => d.periodLabel === prevPeriod).reduce((s, d) => s + d.spendUsd, 0);
  const overallChange = totalPrev > 0 ? ((totalCurrent - totalPrev) / totalPrev) * 100 : 0;

  const report: SpendAnalysisReport = {
    reportId: `spend-analysis-${++reportCounter}`,
    trends, anomalies,
    totalCurrentPeriodUsd: totalCurrent,
    totalPreviousPeriodUsd: totalPrev,
    overallChangePercent: overallChange,
    generatedAt: Date.now(),
  };

  reports.push(report);
  console.log(`[CloudSpendAnalyzer] Analyzed ${dataPoints.length} data points: ${trends.length} trends, ${anomalies.length} anomalies`);
  return report;
}

export function getSpendAnalysisReports(): SpendAnalysisReport[] { return [...reports]; }
export function _resetCloudSpendAnalyzerForTest(): void { reports.length = 0; reportCounter = 0; }
