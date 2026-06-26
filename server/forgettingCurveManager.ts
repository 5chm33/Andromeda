/**
 * forgettingCurveManager.ts — v58.0.0 "The Memory Palace"
 * Implements Ebbinghaus forgetting curve with spaced repetition scheduling.
 */

export interface MemoryTrace {
  traceId: string;
  content: string;
  stability: number;     // higher = slower forgetting
  retrievability: number; // 0–1, current recall probability
  repetitions: number;
  nextReviewAt: number;
  createdAt: number;
}

const traces = new Map<string, MemoryTrace>();
let traceCounter = 0;

export function createTrace(content: string, initialStability = 1.0): MemoryTrace {
  const trace: MemoryTrace = {
    traceId: `trace-${++traceCounter}`,
    content,
    stability: initialStability,
    retrievability: 1.0,
    repetitions: 0,
    nextReviewAt: Date.now() + initialStability * 24 * 60 * 60 * 1000,
    createdAt: Date.now(),
  };
  traces.set(trace.traceId, trace);
  return trace;
}

export function updateRetrievability(traceId: string): MemoryTrace | null {
  const trace = traces.get(traceId);
  if (!trace) return null;
  const elapsedDays = (Date.now() - trace.createdAt) / (24 * 60 * 60 * 1000);
  trace.retrievability = Math.exp(-elapsedDays / trace.stability);
  return trace;
}

export function reviewTrace(traceId: string, recalled: boolean): MemoryTrace | null {
  const trace = traces.get(traceId);
  if (!trace) return null;
  trace.repetitions++;
  if (recalled) {
    trace.stability *= 2.0;  // Double stability on successful recall
    trace.retrievability = 1.0;
  } else {
    trace.stability = Math.max(0.5, trace.stability * 0.5);
    trace.retrievability = 0.3;
  }
  trace.nextReviewAt = Date.now() + trace.stability * 24 * 60 * 60 * 1000;
  return trace;
}

export function getDueForReview(now = Date.now()): MemoryTrace[] {
  return Array.from(traces.values()).filter(t => t.nextReviewAt <= now);
}

export function _resetForgettingCurveManagerForTest(): void { traces.clear(); traceCounter = 0; }
