/**
 * contextPropagator.ts — v80.0.0 "Distributed Tracing & Observability"
 * Propagates trace context across service boundaries using W3C TraceContext and B3 formats.
 */
export type PropagationFormat = "w3c" | "b3" | "b3_multi";

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

export interface PropagationResult {
  format: PropagationFormat;
  headers: Record<string, string>;
  context: TraceContext;
}

export function injectContext(context: TraceContext, format: PropagationFormat = "w3c"): Record<string, string> {
  const flags = context.traceFlags.toString(16).padStart(2, "0");

  if (format === "w3c") {
    const traceparent = `00-${context.traceId}-${context.spanId}-${flags}`;
    const headers: Record<string, string> = { traceparent };
    if (context.traceState) headers.tracestate = context.traceState;
    return headers;
  }

  if (format === "b3") {
    return {
      "b3": `${context.traceId}-${context.spanId}-${context.traceFlags === 1 ? "1" : "0"}`,
    };
  }

  if (format === "b3_multi") {
    return {
      "x-b3-traceid": context.traceId,
      "x-b3-spanid": context.spanId,
      "x-b3-sampled": context.traceFlags === 1 ? "1" : "0",
    };
  }

  return {};
}

export function extractContext(headers: Record<string, string>): TraceContext | null {
  // Try W3C
  if (headers.traceparent) {
    const parts = headers.traceparent.split("-");
    if (parts.length >= 4) {
      return { traceId: parts[1], spanId: parts[2], traceFlags: parseInt(parts[3], 16), traceState: headers.tracestate };
    }
  }

  // Try B3 single
  if (headers["b3"]) {
    const parts = headers["b3"].split("-");
    if (parts.length >= 3) {
      return { traceId: parts[0], spanId: parts[1], traceFlags: parts[2] === "1" ? 1 : 0 };
    }
  }

  // Try B3 multi
  if (headers["x-b3-traceid"] && headers["x-b3-spanid"]) {
    return {
      traceId: headers["x-b3-traceid"],
      spanId: headers["x-b3-spanid"],
      traceFlags: headers["x-b3-sampled"] === "1" ? 1 : 0,
    };
  }

  return null;
}

export function propagate(context: TraceContext, format: PropagationFormat = "w3c"): PropagationResult {
  return { format, headers: injectContext(context, format), context };
}
