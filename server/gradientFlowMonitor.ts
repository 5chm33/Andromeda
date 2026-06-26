/**
 * gradientFlowMonitor.ts — v56.0.0 "The Neural Fabric"
 *
 * Monitors gradient flow through neural layers to detect vanishing/exploding
 * gradients, dead layers, and training instability.
 */

export interface GradientSnapshot {
  snapshotId: string;
  layerId: string;
  step: number;
  gradientNorm: number;
  maxGradient: number;
  minGradient: number;
  hasNaN: boolean;
  hasInf: boolean;
  timestamp: number;
}

export type GradientStatus = "healthy" | "vanishing" | "exploding" | "dead" | "unstable";

export interface GradientFlowReport {
  layerId: string;
  sampleCount: number;
  avgNorm: number;
  trendSlope: number;        // positive = growing, negative = shrinking
  status: GradientStatus;
  recommendations: string[];
}

const snapshots = new Map<string, GradientSnapshot[]>();
let snapshotCounter = 0;

export function recordGradient(layerId: string, step: number, gradients: number[]): GradientSnapshot {
  const norms = gradients.map(g => g * g);
  const gradientNorm = Math.sqrt(norms.reduce((s, v) => s + v, 0));
  const hasNaN = gradients.some(g => isNaN(g));
  const hasInf = gradients.some(g => !isFinite(g));

  const snapshot: GradientSnapshot = {
    snapshotId: `gs-${++snapshotCounter}`,
    layerId,
    step,
    gradientNorm,
    maxGradient: Math.max(...gradients.map(Math.abs)),
    minGradient: Math.min(...gradients.map(Math.abs)),
    hasNaN,
    hasInf,
    timestamp: Date.now(),
  };

  if (!snapshots.has(layerId)) snapshots.set(layerId, []);
  snapshots.get(layerId)!.push(snapshot);
  return snapshot;
}

export function analyzeGradientFlow(layerId: string): GradientFlowReport | null {
  const layerSnaps = snapshots.get(layerId);
  if (!layerSnaps || layerSnaps.length === 0) return null;

  const norms = layerSnaps.map(s => s.gradientNorm);
  const avgNorm = norms.reduce((s, v) => s + v, 0) / norms.length;

  // Linear regression for trend
  const n = norms.length;
  const xMean = (n - 1) / 2;
  const yMean = avgNorm;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (norms[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const trendSlope = den > 0 ? num / den : 0;

  const hasNaN = layerSnaps.some(s => s.hasNaN);
  const hasInf = layerSnaps.some(s => s.hasInf);

  let status: GradientStatus;
  const recommendations: string[] = [];

  if (hasNaN || hasInf) {
    status = "unstable";
    recommendations.push("NaN/Inf gradients detected — reduce learning rate or add gradient clipping");
  } else if (avgNorm < 1e-7) {
    status = "vanishing";
    recommendations.push("Vanishing gradients — consider residual connections or gradient clipping");
  } else if (avgNorm > 100) {
    status = "exploding";
    recommendations.push("Exploding gradients — apply gradient clipping (max_norm=1.0)");
  } else if (avgNorm < 1e-5 && trendSlope < 0) {
    status = "dead";
    recommendations.push("Dead layer — gradients are near zero and shrinking");
  } else {
    status = "healthy";
  }

  return { layerId, sampleCount: n, avgNorm, trendSlope, status, recommendations };
}

export function getGradientHistory(layerId: string, limit = 50): GradientSnapshot[] {
  return (snapshots.get(layerId) ?? []).slice(-limit);
}

export function _resetGradientFlowMonitorForTest(): void {
  snapshots.clear();
  snapshotCounter = 0;
}
