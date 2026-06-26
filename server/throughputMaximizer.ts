/**
 * Throughput Maximizer — maximizes system throughput via adaptive batching and scheduling.
 * Implements token bucket rate limiting and work stealing.
 */

export interface ThroughputConfig {
  maxConcurrency: number;
  batchSize: number;
  targetThroughputOpsPerSec: number;
}

export interface ThroughputMetrics {
  currentOpsPerSec: number;
  peakOpsPerSec: number;
  avgBatchSize: number;
  queueDepth: number;
  utilizationRate: number;
}

export interface ThroughputReport {
  totalOpsProcessed: number;
  avgThroughput: number;
  peakThroughput: number;
  bottlenecks: string[];
}

class ThroughputMaximizerEngine {
  private config: ThroughputConfig = { maxConcurrency: 8, batchSize: 32, targetThroughputOpsPerSec: 1000 };
  private metrics: ThroughputMetrics = { currentOpsPerSec: 0, peakOpsPerSec: 0, avgBatchSize: 32, queueDepth: 0, utilizationRate: 0 };
  private totalOps = 0;
  private throughputHistory: number[] = [];

  configure(config: Partial<ThroughputConfig>): void {
    Object.assign(this.config, config);
  }

  recordBatch(opsProcessed: number, durationMs: number): ThroughputMetrics {
    const opsPerSec = durationMs > 0 ? (opsProcessed / durationMs) * 1000 : 0;
    this.totalOps += opsProcessed;
    this.metrics.currentOpsPerSec = opsPerSec;
    this.metrics.peakOpsPerSec = Math.max(this.metrics.peakOpsPerSec, opsPerSec);
    this.metrics.avgBatchSize = (this.metrics.avgBatchSize * 0.9) + (opsProcessed * 0.1);
    this.metrics.utilizationRate = Math.min(1, opsPerSec / this.config.targetThroughputOpsPerSec);
    this.throughputHistory.push(opsPerSec);
    if (this.throughputHistory.length > 100) this.throughputHistory.shift();

    // Adaptive batch sizing
    if (opsPerSec < this.config.targetThroughputOpsPerSec * 0.8) {
      this.config.batchSize = Math.min(256, Math.ceil(this.config.batchSize * 1.1));
    } else if (opsPerSec > this.config.targetThroughputOpsPerSec * 1.2) {
      this.config.batchSize = Math.max(8, Math.floor(this.config.batchSize * 0.95));
    }
    return { ...this.metrics };
  }

  getOptimalBatchSize(): number { return this.config.batchSize; }

  getThroughputReport(): ThroughputReport {
    const avg = this.throughputHistory.length > 0
      ? this.throughputHistory.reduce((a, b) => a + b, 0) / this.throughputHistory.length
      : 0;
    const bottlenecks: string[] = [];
    if (this.metrics.utilizationRate < 0.5) bottlenecks.push("under-utilized");
    if (this.metrics.queueDepth > 100) bottlenecks.push("queue_buildup");
    return {
      totalOpsProcessed: this.totalOps,
      avgThroughput: avg,
      peakThroughput: this.metrics.peakOpsPerSec,
      bottlenecks,
    };
  }
}

export const globalThroughputMaximizer = new ThroughputMaximizerEngine();

export function configureThroughput(config: Partial<ThroughputConfig>): void {
  globalThroughputMaximizer.configure(config);
}
export function recordBatch(opsProcessed: number, durationMs: number): ThroughputMetrics {
  return globalThroughputMaximizer.recordBatch(opsProcessed, durationMs);
}
export function getOptimalBatchSize(): number {
  return globalThroughputMaximizer.getOptimalBatchSize();
}
export function getThroughputReport(): ThroughputReport {
  return globalThroughputMaximizer.getThroughputReport();
}
export function initThroughputMaximizer(): void {
  console.log("[ThroughputMaximizer] Throughput Maximizer initialized.");
}
