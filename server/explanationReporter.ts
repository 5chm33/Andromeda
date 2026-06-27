/**
 * explanationReporter.ts — v88.0.0 "Explainability & Interpretability"
 * Aggregates explanations and generates structured XAI reports.
 */
export type ReportFormat = "summary" | "detailed" | "technical" | "executive";

export interface XAIReport {
  reportId: string;
  modelId: string;
  format: ReportFormat;
  sections: Array<{ title: string; content: string; data?: Record<string, unknown> }>;
  overallTransparencyScore: number;
  recommendations: string[];
  generatedAt: number;
}

export interface ExplanationSummary {
  totalExplanations: number;
  averageConfidence: number;
  topPredictions: Array<{ prediction: string; count: number; avgConfidence: number }>;
  topFeatures: string[];
  fairnessStatus: "fair" | "unfair" | "unknown";
}

const reports: XAIReport[] = [];
let reportCounter = 0;

export function generateXAIReport(
  modelId: string,
  format: ReportFormat,
  explanationData: {
    predictions: Array<{ prediction: string; confidence: number; features: Record<string, number> }>;
    topFeatures: string[];
    fairnessScore?: number;
    biasFlags?: string[];
  }
): XAIReport {
  const { predictions, topFeatures, fairnessScore = 1.0, biasFlags = [] } = explanationData;

  const avgConfidence = predictions.length > 0 ? predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length : 0;
  const predictionCounts: Record<string, { count: number; totalConf: number }> = {};
  for (const p of predictions) {
    if (!predictionCounts[p.prediction]) predictionCounts[p.prediction] = { count: 0, totalConf: 0 };
    predictionCounts[p.prediction].count++;
    predictionCounts[p.prediction].totalConf += p.confidence;
  }

  const transparencyScore = (avgConfidence * 0.4 + fairnessScore * 0.4 + (topFeatures.length > 0 ? 0.2 : 0));

  const sections = [
    { title: "Model Overview", content: `Model ${modelId} analyzed with ${predictions.length} predictions. Average confidence: ${(avgConfidence * 100).toFixed(1)}%.` },
    { title: "Feature Importance", content: `Top influential features: ${topFeatures.slice(0, 5).join(", ")}.`, data: { topFeatures } },
    { title: "Fairness Assessment", content: `Fairness score: ${(fairnessScore * 100).toFixed(1)}%. ${biasFlags.length > 0 ? `Bias flags: ${biasFlags.join(", ")}.` : "No bias flags detected."}` },
    { title: "Prediction Distribution", content: `${Object.keys(predictionCounts).length} distinct prediction classes observed.`, data: predictionCounts },
  ];

  if (format === "technical") {
    sections.push({ title: "Technical Details", content: `Transparency score: ${(transparencyScore * 100).toFixed(1)}%. Computed using correlation-based feature importance.` });
  }

  const recommendations: string[] = [];
  if (avgConfidence < 0.7) recommendations.push("Consider improving model calibration — average confidence is below 70%");
  if (fairnessScore < 0.8) recommendations.push("Address fairness disparities across sensitive attributes");
  if (topFeatures.length < 3) recommendations.push("Increase feature diversity to improve model interpretability");

  const report: XAIReport = {
    reportId: `xai-${++reportCounter}`,
    modelId, format, sections,
    overallTransparencyScore: transparencyScore,
    recommendations,
    generatedAt: Date.now(),
  };
  reports.push(report);
  return report;
}

export function summarizeExplanations(predictions: Array<{ prediction: string; confidence: number }>, topFeatures: string[], fairnessStatus: "fair" | "unfair" | "unknown" = "unknown"): ExplanationSummary {
  const avgConf = predictions.length > 0 ? predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length : 0;
  const counts: Record<string, { count: number; totalConf: number }> = {};
  for (const p of predictions) {
    if (!counts[p.prediction]) counts[p.prediction] = { count: 0, totalConf: 0 };
    counts[p.prediction].count++;
    counts[p.prediction].totalConf += p.confidence;
  }
  const topPredictions = Object.entries(counts).map(([prediction, { count, totalConf }]) => ({ prediction, count, avgConfidence: totalConf / count })).sort((a, b) => b.count - a.count).slice(0, 5);
  return { totalExplanations: predictions.length, averageConfidence: avgConf, topPredictions, topFeatures, fairnessStatus };
}

export function getReport(reportId: string): XAIReport | undefined { return reports.find(r => r.reportId === reportId); }
export function _resetExplanationReporterForTest(): void { reports.length = 0; reportCounter = 0; }
