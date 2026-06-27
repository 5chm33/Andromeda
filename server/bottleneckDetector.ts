/**
 * bottleneckDetector.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Detects performance bottlenecks in agent pipelines and suggests targeted improvements.
 */
export type BottleneckSeverity = "low" | "medium" | "high" | "critical";

export interface PipelineStage {
  stageId: string;
  name: string;
  avgDurationMs: number;
  throughput: number;
  errorRate: number;
  queueDepth: number;
}

export interface Bottleneck {
  bottleneckId: string;
  stageId: string;
  stageName: string;
  severity: BottleneckSeverity;
  cause: string;
  impact: string;
  suggestedFix: string;
  detectedAt: number;
}

const stages = new Map<string, PipelineStage>();
const bottlenecks: Bottleneck[] = [];
let stageCounter = 0;
let bottleneckCounter = 0;

export function registerStage(name: string, avgDurationMs: number, throughput: number, errorRate: number, queueDepth: number): PipelineStage {
  const stage: PipelineStage = { stageId: `stg-${++stageCounter}`, name, avgDurationMs, throughput, errorRate, queueDepth };
  stages.set(stage.stageId, stage);
  return stage;
}

export function detectBottlenecks(): Bottleneck[] {
  const newBottlenecks: Bottleneck[] = [];
  const allStages = [...stages.values()];
  const avgDuration = allStages.reduce((s, st) => s + st.avgDurationMs, 0) / (allStages.length || 1);

  for (const stage of allStages) {
    let severity: BottleneckSeverity | null = null;
    let cause = "";
    let impact = "";
    let suggestedFix = "";

    if (stage.avgDurationMs > avgDuration * 3) {
      severity = "critical"; cause = "Extremely slow processing"; impact = "Blocking entire pipeline"; suggestedFix = "Parallelize or cache results";
    } else if (stage.avgDurationMs > avgDuration * 2) {
      severity = "high"; cause = "Slow processing relative to pipeline"; impact = "Significant latency increase"; suggestedFix = "Optimize algorithm or add caching";
    } else if (stage.errorRate > 0.1) {
      severity = "high"; cause = `High error rate (${(stage.errorRate * 100).toFixed(0)}%)`; impact = "Data loss and retry overhead"; suggestedFix = "Add error handling and retry logic";
    } else if (stage.queueDepth > 100) {
      severity = "medium"; cause = "Queue buildup"; impact = "Increased latency"; suggestedFix = "Scale up consumers or reduce input rate";
    }

    if (severity) {
      const b: Bottleneck = { bottleneckId: `bn-${++bottleneckCounter}`, stageId: stage.stageId, stageName: stage.name, severity, cause, impact, suggestedFix, detectedAt: Date.now() };
      bottlenecks.push(b);
      newBottlenecks.push(b);
    }
  }
  return newBottlenecks;
}

export function getBottlenecks(severity?: BottleneckSeverity): Bottleneck[] { return severity ? bottlenecks.filter(b => b.severity === severity) : [...bottlenecks]; }
export function getStage(stageId: string): PipelineStage | undefined { return stages.get(stageId); }
export function _resetBottleneckDetectorForTest(): void { stages.clear(); bottlenecks.length = 0; stageCounter = 0; bottleneckCounter = 0; }
