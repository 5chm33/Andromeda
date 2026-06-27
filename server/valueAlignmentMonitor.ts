/**
 * valueAlignmentMonitor.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Monitors alignment between agent behavior and human values over time.
 */
export interface HumanValue {
  valueId: string;
  name: string;
  description: string;
  importance: number;
  currentAlignmentScore: number;
  history: Array<{ score: number; timestamp: number }>;
}

export interface AlignmentReport {
  reportId: string;
  agentId: string;
  overallAlignment: number;
  valueScores: Record<string, number>;
  driftedValues: string[];
  alignedValues: string[];
  recommendations: string[];
  generatedAt: number;
}

const values = new Map<string, HumanValue>();
const reports: AlignmentReport[] = [];
let valueCounter = 0;
let reportCounter = 0;

export function registerValue(name: string, description: string, importance = 1.0): HumanValue {
  const value: HumanValue = { valueId: `hv-${++valueCounter}`, name, description, importance, currentAlignmentScore: 1.0, history: [] };
  values.set(value.valueId, value);
  return value;
}

export function updateAlignment(valueId: string, score: number): HumanValue | null {
  const value = values.get(valueId);
  if (!value) return null;
  value.history.push({ score: value.currentAlignmentScore, timestamp: Date.now() });
  value.currentAlignmentScore = Math.max(0, Math.min(1, score));
  return value;
}

export function generateAlignmentReport(agentId: string): AlignmentReport {
  const valueScores: Record<string, number> = {};
  const driftedValues: string[] = [];
  const alignedValues: string[] = [];
  const recommendations: string[] = [];
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const value of values.values()) {
    valueScores[value.name] = value.currentAlignmentScore;
    totalWeightedScore += value.currentAlignmentScore * value.importance;
    totalWeight += value.importance;
    if (value.currentAlignmentScore < 0.6) { driftedValues.push(value.name); recommendations.push(`Improve alignment with "${value.name}" (current: ${(value.currentAlignmentScore * 100).toFixed(0)}%)`); }
    else if (value.currentAlignmentScore >= 0.85) alignedValues.push(value.name);
  }

  const report: AlignmentReport = {
    reportId: `ar-${++reportCounter}`,
    agentId,
    overallAlignment: totalWeight > 0 ? totalWeightedScore / totalWeight : 1.0,
    valueScores, driftedValues, alignedValues, recommendations,
    generatedAt: Date.now(),
  };
  reports.push(report);
  return report;
}

export function getValue(valueId: string): HumanValue | undefined { return values.get(valueId); }
export function getReports(agentId?: string): AlignmentReport[] { return agentId ? reports.filter(r => r.agentId === agentId) : [...reports]; }
export function _resetValueAlignmentMonitorForTest(): void { values.clear(); reports.length = 0; valueCounter = 0; reportCounter = 0; }
