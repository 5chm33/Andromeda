/**
 * dataQualityMonitor.ts — v69.0.0 "Data Pipeline"
 * Monitors data quality metrics: completeness, uniqueness, freshness, and accuracy.
 */
export interface QualityReport { datasetName: string; totalRecords: number; completeness: number; uniqueness: number; freshness: number; accuracyScore: number; issues: string[]; generatedAt: number; }

const reports: QualityReport[] = [];

export function analyzeDataQuality(datasetName: string, records: Record<string, unknown>[], options: { requiredFields?: string[]; freshnessThresholdMs?: number; timestampField?: string } = {}): QualityReport {
  const issues: string[] = [];
  const total = records.length;
  if (total === 0) return { datasetName, totalRecords: 0, completeness: 0, uniqueness: 0, freshness: 0, accuracyScore: 0, issues: ["Empty dataset"], generatedAt: Date.now() };
  let completeCount = 0;
  if (options.requiredFields?.length) {
    records.forEach(r => { if (options.requiredFields!.every(f => r[f] !== null && r[f] !== undefined)) completeCount++; });
  } else completeCount = total;
  const completeness = completeCount / total;
  if (completeness < 0.9) issues.push(`Low completeness: ${(completeness * 100).toFixed(1)}%`);
  const unique = new Set(records.map(r => JSON.stringify(r))).size;
  const uniqueness = unique / total;
  if (uniqueness < 0.95) issues.push(`Duplicate records detected: ${total - unique}`);
  let freshness = 1;
  if (options.timestampField && options.freshnessThresholdMs) {
    const now = Date.now();
    const fresh = records.filter(r => { const ts = r[options.timestampField!]; return typeof ts === "number" && now - ts < options.freshnessThresholdMs!; });
    freshness = fresh.length / total;
    if (freshness < 0.8) issues.push(`Stale data: ${((1 - freshness) * 100).toFixed(1)}% records exceed freshness threshold`);
  }
  const accuracyScore = (completeness + uniqueness + freshness) / 3;
  const report: QualityReport = { datasetName, totalRecords: total, completeness, uniqueness, freshness, accuracyScore, issues, generatedAt: Date.now() };
  reports.push(report);
  return report;
}

export function getQualityReports(): QualityReport[] { return [...reports]; }
export function _resetDataQualityMonitorForTest(): void { reports.length = 0; }
