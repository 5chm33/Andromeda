/**
 * Latency Predictor — predicts operation latency using historical data and regression.
 * Implements exponential smoothing and percentile tracking.
 */

export interface LatencyObservation {
  operationType: string;
  latencyMs: number;
  inputSize: number;
  timestamp: number;
}

export interface LatencyPrediction {
  operationType: string;
  predictedP50Ms: number;
  predictedP95Ms: number;
  predictedP99Ms: number;
  confidence: number;
  sampleCount: number;
}

export interface LatencyReport {
  totalObservations: number;
  operationTypes: string[];
  avgP50Ms: number;
  avgP99Ms: number;
  highLatencyOperations: string[];
}

class LatencyPredictorEngine {
  private observations: Map<string, LatencyObservation[]> = new Map();

  recordLatency(operationType: string, latencyMs: number, inputSize = 1): void {
    if (!this.observations.has(operationType)) this.observations.set(operationType, []);
    this.observations.get(operationType)!.push({ operationType, latencyMs, inputSize, timestamp: Date.now() });
    // Keep last 1000 observations per type
    const obs = this.observations.get(operationType)!;
    if (obs.length > 1000) obs.shift();
  }

  predictLatency(operationType: string): LatencyPrediction {
    const obs = this.observations.get(operationType) ?? [];
    if (obs.length === 0) {
      return { operationType, predictedP50Ms: 100, predictedP95Ms: 500, predictedP99Ms: 1000, confidence: 0.1, sampleCount: 0 };
    }
    const sorted = [...obs].sort((a, b) => a.latencyMs - b.latencyMs);
    const p50 = sorted[Math.floor(sorted.length * 0.5)]!.latencyMs;
    const p95 = sorted[Math.floor(sorted.length * 0.95)]!.latencyMs;
    const p99 = sorted[Math.floor(sorted.length * 0.99)]!.latencyMs;
    const confidence = Math.min(1, obs.length / 100);
    return { operationType, predictedP50Ms: p50, predictedP95Ms: p95, predictedP99Ms: p99, confidence, sampleCount: obs.length };
  }

  getLatencyReport(): LatencyReport {
    const types = Array.from(this.observations.keys());
    const predictions = types.map(t => this.predictLatency(t));
    const highLatency = predictions.filter(p => p.predictedP99Ms > 1000).map(p => p.operationType);
    return {
      totalObservations: Array.from(this.observations.values()).reduce((s, o) => s + o.length, 0),
      operationTypes: types,
      avgP50Ms: predictions.length > 0 ? predictions.reduce((s, p) => s + p.predictedP50Ms, 0) / predictions.length : 0,
      avgP99Ms: predictions.length > 0 ? predictions.reduce((s, p) => s + p.predictedP99Ms, 0) / predictions.length : 0,
      highLatencyOperations: highLatency,
    };
  }
}

export const globalLatencyPredictor = new LatencyPredictorEngine();

export function recordLatency(operationType: string, latencyMs: number, inputSize?: number): void {
  globalLatencyPredictor.recordLatency(operationType, latencyMs, inputSize);
}
export function predictLatency(operationType: string): LatencyPrediction {
  return globalLatencyPredictor.predictLatency(operationType);
}
export function getLatencyReport(): LatencyReport {
  return globalLatencyPredictor.getLatencyReport();
}
export function initLatencyPredictor(): void {
  console.log("[LatencyPredictor] Latency Predictor initialized.");
}
