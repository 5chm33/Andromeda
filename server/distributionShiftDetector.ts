/**
 * distributionShiftDetector.ts — v64.0.0 "The Adaptation Engine"
 * Detects distribution shift using KL divergence and population stability index.
 */

export interface DistributionSnapshot { snapshotId: string; name: string; histogram: number[]; timestamp: number; }
export interface ShiftDetectionResult { resultId: string; referenceName: string; currentName: string; psiScore: number; shiftDetected: boolean; severity: "none" | "minor" | "moderate" | "severe"; }

const snapshots = new Map<string, DistributionSnapshot>();
const results: ShiftDetectionResult[] = [];
let sCounter = 0, rCounter = 0;

function normalize(hist: number[]): number[] {
  const total = hist.reduce((s, v) => s + v, 0);
  return total > 0 ? hist.map(v => Math.max(v / total, 1e-10)) : hist.map(() => 1e-10);
}

export function captureDistribution(name: string, data: number[], bins = 10): DistributionSnapshot {
  const min = Math.min(...data), max = Math.max(...data);
  const binWidth = (max - min) / bins || 1;
  const histogram = new Array(bins).fill(0);
  data.forEach(v => { const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1); histogram[idx]++; });
  const snapshot: DistributionSnapshot = { snapshotId: `snap-${++sCounter}`, name, histogram, timestamp: Date.now() };
  snapshots.set(name, snapshot);
  return snapshot;
}

export function detectShift(referenceName: string, currentName: string): ShiftDetectionResult {
  const ref = snapshots.get(referenceName);
  const cur = snapshots.get(currentName);
  if (!ref || !cur) throw new Error(`[DistributionShiftDetector] Snapshot not found`);
  // Pad histograms to same length and use element-wise comparison
  const len = Math.max(ref.histogram.length, cur.histogram.length);
  const refHist = [...ref.histogram, ...new Array(len - ref.histogram.length).fill(0)];
  const curHist = [...cur.histogram, ...new Array(len - cur.histogram.length).fill(0)];
  const refNorm = normalize(refHist);
  const curNorm = normalize(curHist);
  // Also compute a location-aware shift score using mean difference
  const refMean = refHist.reduce((s, v, i) => s + v * i, 0) / Math.max(refHist.reduce((s, v) => s + v, 0), 1);
  const curMean = curHist.reduce((s, v, i) => s + v * i, 0) / Math.max(curHist.reduce((s, v) => s + v, 0), 1);
  const locationShift = Math.abs(curMean - refMean) / len;
  const psiScore = refNorm.reduce((s, r, i) => s + (curNorm[i] - r) * Math.log(curNorm[i] / r), 0);
  const combinedScore = Math.max(Math.abs(psiScore), locationShift * 2);
  const severity: ShiftDetectionResult["severity"] = combinedScore < 0.1 ? "none" : combinedScore < 0.2 ? "minor" : combinedScore < 0.5 ? "moderate" : "severe";
  const result: ShiftDetectionResult = { resultId: `res-${++rCounter}`, referenceName, currentName, psiScore: combinedScore, shiftDetected: combinedScore >= 0.1, severity };
  results.push(result);
  return result;
}

export function _resetDistributionShiftDetectorForTest(): void { snapshots.clear(); results.length = 0; sCounter = 0; rCounter = 0; }
