/**
 * observability.ts — Structured Observability Layer
 * Andromeda v6.19
 *
 * OpenTelemetry-inspired observability without the heavy SDK dependency.
 * Provides:
 *  - Structured JSON logging with trace/span IDs
 *  - Request tracing (correlate logs across a request lifecycle)
 *  - Metrics collection (counters, histograms, gauges)
 *  - Metrics dashboard endpoint (/api/metrics)
 *  - Slow operation detection and alerting
 *
 * Design: lightweight, zero external dependencies, drop-in alongside existing logger.ts
 */

import { randomUUID } from "crypto";
import { appendFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import type { Express, Request, Response, NextFunction } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startTime: number;
  attributes: Record<string, string | number | boolean>;
}

export interface Span {
  context: TraceContext;
  end(status?: "ok" | "error", error?: string): SpanResult;
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
}

export interface SpanResult {
  traceId: string;
  spanId: string;
  operation: string;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
  attributes: Record<string, string | number | boolean>;
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, string | number | boolean> }>;
}

// ─── Metrics Store ────────────────────────────────────────────────────────────

interface Counter { type: "counter"; name: string; value: number; labels: Record<string, string> }
interface Gauge   { type: "gauge";   name: string; value: number; labels: Record<string, string>; updatedAt: number }
interface Histogram {
  type: "histogram";
  name: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number[]; // last 1000 samples
  labels: Record<string, string>;
}

type Metric = Counter | Gauge | Histogram;

const metrics = new Map<string, Metric>();

function metricKey(name: string, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(",");
  return labelStr ? `${name}{${labelStr}}` : name;
}

// ─── Metrics API ──────────────────────────────────────────────────────────────

export function incrementCounter(name: string, labels: Record<string, string> = {}, by: number = 1): void {
  if (typeof by !== 'number' || !Number.isFinite(by) || by < 0) {
    console.warn(`[Observability] Invalid increment value for counter "${name}": ${by}`);
    return;
  }
  const key = metricKey(name, labels);
  const existing = metrics.get(key) as Counter | undefined;
  if (existing) {
    existing.value += by;
  } else {
    metrics.set(key, { type: "counter", name, value: by, labels });
  }
}

export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  metrics.set(key, { type: "gauge", name, value, labels, updatedAt: Date.now() });
}

export function recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
  const key = metricKey(name, labels);
  const existing = metrics.get(key) as Histogram | undefined;
  if (existing) {
    existing.count++;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    existing.samples.push(value);
    if (existing.samples.length > 1000) existing.samples.shift();
    // Update percentiles
    const sorted = [...existing.samples].sort((a, b) => a - b);
    existing.p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    existing.p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    existing.p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  } else {
    metrics.set(key, {
      type: "histogram", name, count: 1, sum: value, min: value, max: value,
      p50: value, p95: value, p99: value, samples: [value], labels,
    });
  }
}

export function getAllMetrics(): Record<string, Metric> {
  return Object.fromEntries(metrics.entries());
}

// ─── Tracing ──────────────────────────────────────────────────────────────────

const TRACE_LOG_DIR = resolve(process.cwd(), "workspace", "traces");

function ensureTraceDir(): void {
  if (!existsSync(TRACE_LOG_DIR)) mkdirSync(TRACE_LOG_DIR, { recursive: true });
}

export function startSpan(operation: string, parentContext?: TraceContext, attributes: Record<string, string | number | boolean> = {}): Span {
  const context: TraceContext = {
    traceId: parentContext?.traceId ?? randomUUID().replace(/-/g, ""),
    spanId: randomUUID().replace(/-/g, "").slice(0, 16),
    parentSpanId: parentContext?.spanId,
    operation,
    startTime: Date.now(),
    attributes,
  };

  const events: SpanResult["events"] = [];

  const span: Span = {
    context,
    setAttribute(key, value) { context.attributes[key] = value; },
    addEvent(name, attrs) { events.push({ name, timestamp: Date.now(), attributes: attrs }); },
    end(status = "ok", error?: string): SpanResult {
      const durationMs = Date.now() - context.startTime;
      const result: SpanResult = {
        traceId: context.traceId,
        spanId: context.spanId,
        operation,
        durationMs,
        status,
        error,
        attributes: context.attributes,
        events,
      };

      // Record metrics
      recordHistogram(`span.duration_ms`, durationMs, { operation });
      if (status === "error") incrementCounter("span.errors", { operation });

      // Warn on slow operations
      if (durationMs > 5000) {
        console.warn(`[Observability] SLOW SPAN: ${operation} took ${durationMs}ms (traceId: ${context.traceId})`);
        incrementCounter("span.slow", { operation });
      }

      // Append to trace log
      try {
        ensureTraceDir();
        const today = new Date().toISOString().slice(0, 10);
        appendFileSync(
          resolve(TRACE_LOG_DIR, `traces-${today}.jsonl`),
          JSON.stringify({ ...result, timestamp: new Date().toISOString() }) + "\n"
        );
      } catch { /* non-critical */ }

      return result;
    },
  };

  return span;
}

// ─── Request Tracing Middleware ───────────────────────────────────────────────

export function requestTracingMiddleware(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const traceId = (req.headers["x-trace-id"] as string) ?? randomUUID().replace(/-/g, "");
    const span = startSpan(`http.${req.method.toLowerCase()}.${req.path}`, undefined, {
      "http.method": req.method,
      "http.path": req.path,
      "http.user_agent": (req.headers["user-agent"] ?? "").slice(0, 100),
    });

    // Attach trace context to request
    (req as any).traceId = traceId;
    (req as any).span = span;
    res.setHeader("X-Trace-ID", traceId);

    res.on("finish", () => {
      span.setAttribute("http.status_code", res.statusCode);
      const status = res.statusCode >= 400 ? "error" : "ok";
      const result = span.end(status, res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined);

      // Record HTTP metrics
      incrementCounter("http.requests", { method: req.method, status_class: `${Math.floor(res.statusCode / 100)}xx` });
      recordHistogram("http.request_duration_ms", result.durationMs, { method: req.method });
    });

    next();
  });
}

// ─── Metrics Dashboard Route ──────────────────────────────────────────────────

export function registerMetricsRoute(app: Express): void {
  app.get("/api/metrics", (_req: Request, res: Response) => {
    const allMetrics = getAllMetrics();

    // Build a Prometheus-style text format + JSON
    const summary = {
      timestamp: new Date().toISOString(),
      uptime_seconds: process.uptime(),
      memory: {
        heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      metrics: allMetrics,
      top_slow_operations: Object.entries(allMetrics)
        .filter(([k]) => k.startsWith("span.duration_ms"))
        .map(([key, m]) => ({ key, ...(m as Histogram) }))
        .sort((a, b) => b.p95 - a.p95)
        .slice(0, 10),
    };

    res.json(summary);
  });

  // Prometheus-compatible text endpoint
  app.get("/api/metrics/prometheus", (_req: Request, res: Response) => {
    const lines: string[] = [
      `# HELP andromeda_uptime_seconds Server uptime`,
      `# TYPE andromeda_uptime_seconds gauge`,
      `andromeda_uptime_seconds ${process.uptime().toFixed(2)}`,
      `# HELP andromeda_heap_used_bytes Heap memory used`,
      `# TYPE andromeda_heap_used_bytes gauge`,
      `andromeda_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    ];

    for (const [key, metric] of metrics.entries()) {
      if (metric.type === "counter") {
        lines.push(`# TYPE ${metric.name} counter`);
        lines.push(`${key} ${metric.value}`);
      } else if (metric.type === "gauge") {
        lines.push(`# TYPE ${metric.name} gauge`);
        lines.push(`${key} ${metric.value}`);
      } else if (metric.type === "histogram") {
        lines.push(`# TYPE ${metric.name} histogram`);
        lines.push(`${key}_count ${metric.count}`);
        lines.push(`${key}_sum ${metric.sum}`);
        lines.push(`${key}_p50 ${metric.p50}`);
        lines.push(`${key}_p95 ${metric.p95}`);
        lines.push(`${key}_p99 ${metric.p99}`);
      }
    }

    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(lines.join("\n") + "\n");
  });
}

// ─── Convenience: Wrap async function with tracing ────────────────────────────

export async function traced<T>(
  operation: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {}
): Promise<T> {
  const span = startSpan(operation, undefined, attributes);
  try {
    const result = await fn(span);
    span.end("ok");
    return result;
  } catch (err: any) {
    span.end("error", err?.message ?? String(err));
    throw err;
  }
}
