/**
 * traceSampler.ts — v80.0.0 "Distributed Tracing & Observability"
 * Implements trace sampling strategies: always-on, probabilistic, and adaptive.
 */
export type SamplingStrategy = "always" | "never" | "probabilistic" | "rate_limited";

export interface SamplerConfig {
  strategy: SamplingStrategy;
  sampleRate: number;
  maxTracesPerSecond: number;
}

export interface SamplingDecision {
  traceId: string;
  sampled: boolean;
  strategy: SamplingStrategy;
  reason: string;
}

let samplerConfig: SamplerConfig = { strategy: "probabilistic", sampleRate: 0.1, maxTracesPerSecond: 100 };
const decisions: SamplingDecision[] = [];
let tracesThisSecond = 0;
let windowStart = Date.now();

export function configureSampler(config: Partial<SamplerConfig>): void {
  samplerConfig = { ...samplerConfig, ...config };
}

function hashTraceId(traceId: string): number {
  let h = 0;
  for (let i = 0; i < traceId.length; i++) h = (h * 31 + traceId.charCodeAt(i)) >>> 0;
  return h / 0xFFFFFFFF;
}

export function shouldSample(traceId: string, now = Date.now()): SamplingDecision {
  // Reset rate window
  if (now - windowStart >= 1000) { tracesThisSecond = 0; windowStart = now; }

  let sampled = false;
  let reason = "";

  if (samplerConfig.strategy === "always") {
    sampled = true; reason = "Always-on sampling";
  } else if (samplerConfig.strategy === "never") {
    sampled = false; reason = "Sampling disabled";
  } else if (samplerConfig.strategy === "probabilistic") {
    const hash = hashTraceId(traceId);
    sampled = hash < samplerConfig.sampleRate;
    reason = sampled ? `Sampled (hash ${hash.toFixed(3)} < rate ${samplerConfig.sampleRate})` : `Not sampled (hash ${hash.toFixed(3)} >= rate ${samplerConfig.sampleRate})`;
  } else if (samplerConfig.strategy === "rate_limited") {
    if (tracesThisSecond < samplerConfig.maxTracesPerSecond) {
      sampled = true; tracesThisSecond++;
      reason = `Rate-limited sampling (${tracesThisSecond}/${samplerConfig.maxTracesPerSecond} this second)`;
    } else {
      sampled = false; reason = `Rate limit exceeded (${samplerConfig.maxTracesPerSecond}/s)`;
    }
  }

  const decision: SamplingDecision = { traceId, sampled, strategy: samplerConfig.strategy, reason };
  decisions.push(decision);
  return decision;
}

export function getSamplingStats(): { total: number; sampled: number; rate: number } {
  const sampled = decisions.filter(d => d.sampled).length;
  return { total: decisions.length, sampled, rate: decisions.length > 0 ? sampled / decisions.length : 0 };
}

export function _resetTraceSamplerForTest(): void { decisions.length = 0; tracesThisSecond = 0; windowStart = Date.now(); samplerConfig = { strategy: "probabilistic", sampleRate: 0.1, maxTracesPerSecond: 100 }; }
