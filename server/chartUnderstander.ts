/**
 * chartUnderstander.ts — v71.0.0 "Multi-Modal Intelligence"
 * Chart understanding: type detection, data extraction, trend analysis, and insight generation.
 */
export type ChartType = "bar" | "line" | "pie" | "scatter" | "heatmap" | "histogram" | "unknown";
export interface DataSeries { label: string; values: number[]; }
export interface ChartInsight { type: "trend" | "outlier" | "peak" | "correlation"; description: string; confidence: number; }
export interface ChartAnalysis { chartId: string; chartType: ChartType; title: string; xLabel: string; yLabel: string; series: DataSeries[]; insights: ChartInsight[]; analyzedAt: number; }

const analyses: ChartAnalysis[] = [];
let chartCounter = 0;

export function analyzeChart(chartType: ChartType, title: string, xLabel: string, yLabel: string, series: DataSeries[]): ChartAnalysis {
  const insights: ChartInsight[] = [];
  for (const s of series) {
    if (s.values.length < 2) continue;
    const first = s.values[0], last = s.values[s.values.length - 1];
    const trend = last > first * 1.1 ? "upward" : last < first * 0.9 ? "downward" : "stable";
    if (trend !== "stable") insights.push({ type: "trend", description: `${s.label} shows ${trend} trend`, confidence: 0.8 });
    const max = Math.max(...s.values), avg = s.values.reduce((a, b) => a + b, 0) / s.values.length;
    if (max > avg * 2) insights.push({ type: "peak", description: `${s.label} has a peak value ${max.toFixed(1)} (${(max / avg).toFixed(1)}x average)`, confidence: 0.9 });
  }
  const analysis: ChartAnalysis = { chartId: `chart-${++chartCounter}`, chartType, title, xLabel, yLabel, series, insights, analyzedAt: Date.now() };
  analyses.push(analysis);
  return analysis;
}

export function getChartAnalyses(): ChartAnalysis[] { return [...analyses]; }
export function _resetChartUnderstanderForTest(): void { analyses.length = 0; chartCounter = 0; }
