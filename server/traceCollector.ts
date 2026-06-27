/**
 * traceCollector.ts — v80.0.0 "Distributed Tracing & Observability"
 * Collects distributed trace spans and assembles them into complete traces.
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  service: string;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  status: "ok" | "error" | "in_progress";
  tags: Record<string, string>;
  logs: Array<{ timestamp: number; message: string }>;
}

export interface Trace {
  traceId: string;
  rootSpan: TraceSpan;
  spans: TraceSpan[];
  totalDurationMs: number | null;
  hasErrors: boolean;
}

const spans = new Map<string, TraceSpan>();
let spanCounter = 0;

export function startSpan(traceId: string, operationName: string, service: string, parentSpanId: string | null = null, tags: Record<string, string> = {}): TraceSpan {
  const span: TraceSpan = {
    traceId,
    spanId: `span-${++spanCounter}`,
    parentSpanId,
    operationName,
    service,
    startTime: Date.now(),
    endTime: null,
    durationMs: null,
    status: "in_progress",
    tags,
    logs: [],
  };
  spans.set(span.spanId, span);
  return span;
}

export function finishSpan(spanId: string, status: "ok" | "error" = "ok"): boolean {
  const span = spans.get(spanId);
  if (!span) return false;
  span.endTime = Date.now();
  span.durationMs = span.endTime - span.startTime;
  span.status = status;
  return true;
}

export function addSpanLog(spanId: string, message: string): boolean {
  const span = spans.get(spanId);
  if (!span) return false;
  span.logs.push({ timestamp: Date.now(), message });
  return true;
}

export function getTrace(traceId: string): Trace | null {
  const traceSpans = [...spans.values()].filter(s => s.traceId === traceId);
  if (traceSpans.length === 0) return null;
  const root = traceSpans.find(s => s.parentSpanId === null) ?? traceSpans[0];
  const totalDurationMs = root.durationMs;
  return { traceId, rootSpan: root, spans: traceSpans, totalDurationMs, hasErrors: traceSpans.some(s => s.status === "error") };
}

export function getAllSpans(): TraceSpan[] { return [...spans.values()]; }
export function _resetTraceCollectorForTest(): void { spans.clear(); spanCounter = 0; }
