/**
 * v80.test.ts — Distributed Tracing & Observability
 * Comprehensive tests for all 6 v80 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { startSpan, finishSpan, addSpanLog, getTrace, getAllSpans, _resetTraceCollectorForTest } from "./traceCollector";
import { configureProcessor, processSpan, flushBatch, getProcessedBatches, getCurrentBatch, _resetSpanProcessorForTest } from "./spanProcessor";
import { configureSampler, shouldSample, getSamplingStats, _resetTraceSamplerForTest } from "./traceSampler";
import { registerExportTarget, exportTrace, getExportHistory, getTarget, _resetTraceExporterForTest } from "./traceExporter";
import { injectContext, extractContext, propagate } from "./contextPropagator";
import { indexTrace, queryTraces, getTraceCount, _resetTraceQueryEngineForTest } from "./traceQueryEngine";

// ─── traceCollector ──────────────────────────────────────────────────────────
describe("traceCollector", () => {
  beforeEach(() => _resetTraceCollectorForTest());

  it("starts and finishes a span", () => {
    const span = startSpan("trace-1", "http.request", "api-gateway");
    expect(span.status).toBe("in_progress");
    finishSpan(span.spanId, "ok");
    const spans = getAllSpans();
    expect(spans[0].status).toBe("ok");
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("builds a trace from multiple spans", () => {
    const root = startSpan("trace-2", "http.request", "gateway");
    const child = startSpan("trace-2", "db.query", "database", root.spanId);
    finishSpan(child.spanId, "ok");
    finishSpan(root.spanId, "ok");
    const trace = getTrace("trace-2");
    expect(trace?.spans.length).toBe(2);
    expect(trace?.rootSpan.spanId).toBe(root.spanId);
  });

  it("adds logs to a span", () => {
    const span = startSpan("trace-3", "cache.get", "cache");
    addSpanLog(span.spanId, "Cache miss");
    expect(getAllSpans()[0].logs.length).toBe(1);
  });

  it("marks trace as having errors", () => {
    const span = startSpan("trace-4", "db.query", "db");
    finishSpan(span.spanId, "error");
    const trace = getTrace("trace-4");
    expect(trace?.hasErrors).toBe(true);
  });

  it("returns null for unknown trace", () => {
    expect(getTrace("unknown-trace")).toBeNull();
  });

  it("resets cleanly", () => {
    startSpan("trace-5", "op", "svc");
    _resetTraceCollectorForTest();
    expect(getAllSpans().length).toBe(0);
  });
});

// ─── spanProcessor ───────────────────────────────────────────────────────────
describe("spanProcessor", () => {
  beforeEach(() => _resetSpanProcessorForTest());

  it("processes a span and adds enrichments", () => {
    configureProcessor({ enrichments: [{ key: "env", value: "production" }] });
    const result = processSpan({ spanId: "s1", traceId: "t1", operationName: "http.get", service: "api", durationMs: 50 });
    expect(result.enrichments[0].key).toBe("env");
    expect(result.filtered).toBe(false);
  });

  it("filters spans based on predicate", () => {
    configureProcessor({ filterPredicate: span => span.service !== "health-check" });
    const result = processSpan({ spanId: "s2", traceId: "t2", operationName: "health", service: "health-check", durationMs: 1 });
    expect(result.filtered).toBe(true);
  });

  it("batches spans and flushes", () => {
    configureProcessor({ batchSize: 2 });
    processSpan({ spanId: "s3", traceId: "t3", operationName: "op", service: "svc", durationMs: 10 });
    processSpan({ spanId: "s4", traceId: "t4", operationName: "op", service: "svc", durationMs: 10 });
    expect(getProcessedBatches().length).toBe(1);
  });

  it("flushes current batch manually", () => {
    processSpan({ spanId: "s5", traceId: "t5", operationName: "op", service: "svc", durationMs: 5 });
    const flushed = flushBatch();
    expect(flushed.length).toBe(1);
    expect(getCurrentBatch().length).toBe(0);
  });

  it("resets cleanly", () => {
    processSpan({ spanId: "s6", traceId: "t6", operationName: "op", service: "svc", durationMs: 5 });
    _resetSpanProcessorForTest();
    expect(getProcessedBatches().length).toBe(0);
  });
});

// ─── traceSampler ────────────────────────────────────────────────────────────
describe("traceSampler", () => {
  beforeEach(() => _resetTraceSamplerForTest());

  it("always samples with always strategy", () => {
    configureSampler({ strategy: "always" });
    const d = shouldSample("trace-1");
    expect(d.sampled).toBe(true);
  });

  it("never samples with never strategy", () => {
    configureSampler({ strategy: "never" });
    const d = shouldSample("trace-2");
    expect(d.sampled).toBe(false);
  });

  it("samples deterministically with probabilistic strategy", () => {
    configureSampler({ strategy: "probabilistic", sampleRate: 1.0 });
    const d = shouldSample("trace-3");
    expect(d.sampled).toBe(true);
  });

  it("does not sample with 0% rate", () => {
    configureSampler({ strategy: "probabilistic", sampleRate: 0 });
    const d = shouldSample("trace-4");
    expect(d.sampled).toBe(false);
  });

  it("rate-limits sampling", () => {
    configureSampler({ strategy: "rate_limited", maxTracesPerSecond: 2 });
    shouldSample("t1");
    shouldSample("t2");
    const d = shouldSample("t3");
    expect(d.sampled).toBe(false);
  });

  it("returns sampling stats", () => {
    configureSampler({ strategy: "always" });
    shouldSample("t1");
    shouldSample("t2");
    const stats = getSamplingStats();
    expect(stats.total).toBe(2);
    expect(stats.sampled).toBe(2);
  });
});

// ─── traceExporter ───────────────────────────────────────────────────────────
describe("traceExporter", () => {
  beforeEach(() => _resetTraceExporterForTest());

  it("registers export target and exports trace", () => {
    registerExportTarget({ targetId: "t1", backend: "jaeger", endpoint: "http://jaeger:14268", enabled: true });
    const results = exportTrace("trace-1", 5);
    expect(results.length).toBe(1);
    expect(results[0].backend).toBe("jaeger");
    expect(results[0].success).toBe(true);
  });

  it("exports to multiple targets", () => {
    registerExportTarget({ targetId: "t2", backend: "jaeger", endpoint: "http://jaeger", enabled: true });
    registerExportTarget({ targetId: "t3", backend: "zipkin", endpoint: "http://zipkin", enabled: true });
    const results = exportTrace("trace-2", 3);
    expect(results.length).toBe(2);
  });

  it("skips disabled targets", () => {
    registerExportTarget({ targetId: "t4", backend: "otlp", endpoint: "http://otlp", enabled: false });
    const results = exportTrace("trace-3", 1);
    expect(results.length).toBe(0);
  });

  it("accumulates export history", () => {
    registerExportTarget({ targetId: "t5", backend: "console", endpoint: "stdout", enabled: true });
    exportTrace("trace-4", 2);
    exportTrace("trace-5", 3);
    expect(getExportHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    registerExportTarget({ targetId: "t6", backend: "jaeger", endpoint: "http://j", enabled: true });
    _resetTraceExporterForTest();
    expect(getTarget("t6")).toBeUndefined();
  });
});

// ─── contextPropagator ───────────────────────────────────────────────────────
describe("contextPropagator", () => {
  it("injects W3C traceparent header", () => {
    const ctx = { traceId: "abc123", spanId: "def456", traceFlags: 1 };
    const headers = injectContext(ctx, "w3c");
    expect(headers.traceparent).toContain("abc123");
    expect(headers.traceparent).toContain("def456");
  });

  it("injects B3 single header", () => {
    const ctx = { traceId: "abc123", spanId: "def456", traceFlags: 1 };
    const headers = injectContext(ctx, "b3");
    expect(headers["b3"]).toContain("abc123");
  });

  it("injects B3 multi headers", () => {
    const ctx = { traceId: "abc123", spanId: "def456", traceFlags: 0 };
    const headers = injectContext(ctx, "b3_multi");
    expect(headers["x-b3-traceid"]).toBe("abc123");
    expect(headers["x-b3-sampled"]).toBe("0");
  });

  it("extracts W3C context from headers", () => {
    const ctx = extractContext({ traceparent: "00-abc123-def456-01" });
    expect(ctx?.traceId).toBe("abc123");
    expect(ctx?.traceFlags).toBe(1);
  });

  it("extracts B3 multi context from headers", () => {
    const ctx = extractContext({ "x-b3-traceid": "trace1", "x-b3-spanid": "span1", "x-b3-sampled": "1" });
    expect(ctx?.traceId).toBe("trace1");
    expect(ctx?.traceFlags).toBe(1);
  });

  it("returns null for missing context", () => {
    expect(extractContext({})).toBeNull();
  });
});

// ─── traceQueryEngine ────────────────────────────────────────────────────────
describe("traceQueryEngine", () => {
  beforeEach(() => _resetTraceQueryEngineForTest());

  it("indexes and queries traces by service", () => {
    indexTrace({ traceId: "t1", rootService: "api", rootOperation: "GET /users", startTime: 1000, durationMs: 50, spanCount: 3, hasErrors: false, services: ["api", "db"], tags: {} });
    indexTrace({ traceId: "t2", rootService: "worker", rootOperation: "process.job", startTime: 2000, durationMs: 200, spanCount: 5, hasErrors: false, services: ["worker"], tags: {} });
    const result = queryTraces({ service: "api" });
    expect(result.traces.length).toBe(1);
    expect(result.traces[0].traceId).toBe("t1");
  });

  it("filters by duration range", () => {
    indexTrace({ traceId: "t3", rootService: "api", rootOperation: "op", startTime: 1000, durationMs: 500, spanCount: 2, hasErrors: false, services: ["api"], tags: {} });
    indexTrace({ traceId: "t4", rootService: "api", rootOperation: "op", startTime: 1000, durationMs: 10, spanCount: 1, hasErrors: false, services: ["api"], tags: {} });
    const result = queryTraces({ minDurationMs: 100 });
    expect(result.traces.length).toBe(1);
    expect(result.traces[0].traceId).toBe("t3");
  });

  it("filters error traces", () => {
    indexTrace({ traceId: "t5", rootService: "api", rootOperation: "op", startTime: 1000, durationMs: 100, spanCount: 2, hasErrors: true, services: ["api"], tags: {} });
    indexTrace({ traceId: "t6", rootService: "api", rootOperation: "op", startTime: 1000, durationMs: 50, spanCount: 1, hasErrors: false, services: ["api"], tags: {} });
    const result = queryTraces({ hasErrors: true });
    expect(result.traces.length).toBe(1);
    expect(result.traces[0].traceId).toBe("t5");
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) indexTrace({ traceId: `t${i}`, rootService: "api", rootOperation: "op", startTime: i * 100, durationMs: 10, spanCount: 1, hasErrors: false, services: ["api"], tags: {} });
    const result = queryTraces({ limit: 3 });
    expect(result.traces.length).toBe(3);
    expect(result.totalFound).toBe(5);
  });

  it("resets cleanly", () => {
    indexTrace({ traceId: "t99", rootService: "api", rootOperation: "op", startTime: 0, durationMs: 10, spanCount: 1, hasErrors: false, services: ["api"], tags: {} });
    _resetTraceQueryEngineForTest();
    expect(getTraceCount()).toBe(0);
  });
});
