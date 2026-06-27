/**
 * traceCorrelator.ts — v70.0.0 "Observability Stack"
 * Distributed trace correlation with span tracking, latency analysis, and critical path detection.
 */
export interface Span { spanId: string; traceId: string; parentSpanId?: string; operation: string; service: string; startTime: number; endTime?: number; status: "ok" | "error"; tags: Record<string, string>; }
export interface Trace { traceId: string; spans: Span[]; rootSpan?: Span; totalDurationMs: number; errorCount: number; }

const traces = new Map<string, Trace>();
let spanCounter = 0;

export function startSpan(traceId: string, operation: string, service: string, parentSpanId?: string, tags: Record<string, string> = {}): Span {
  if (!traces.has(traceId)) traces.set(traceId, { traceId, spans: [], totalDurationMs: 0, errorCount: 0 });
  const span: Span = { spanId: `span-${++spanCounter}`, traceId, parentSpanId, operation, service, startTime: Date.now(), status: "ok", tags };
  traces.get(traceId)!.spans.push(span);
  if (!parentSpanId) traces.get(traceId)!.rootSpan = span;
  return span;
}

export function finishSpan(span: Span, status: "ok" | "error" = "ok"): void {
  span.endTime = Date.now();
  span.status = status;
  const trace = traces.get(span.traceId);
  if (trace) {
    if (status === "error") trace.errorCount++;
    if (!span.parentSpanId && span.endTime) trace.totalDurationMs = span.endTime - span.startTime;
  }
}

export function getTrace(traceId: string): Trace | undefined { return traces.get(traceId); }
export function getCriticalPath(traceId: string): Span[] {
  const trace = traces.get(traceId);
  if (!trace) return [];
  return trace.spans.filter(s => s.endTime).sort((a, b) => (b.endTime! - b.startTime) - (a.endTime! - a.startTime));
}
export function _resetTraceCorrelatorForTest(): void { traces.clear(); spanCounter = 0; }
