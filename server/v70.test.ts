/**
 * v70.test.ts — Observability Stack
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createDashboard, addPanel, updatePanel, listDashboards, _resetObservabilityDashboardForTest } from "./observabilityDashboard";
import { recordMetric, aggregateMetric, getMetricNames, _resetMetricsAggregatorForTest } from "./metricsAggregator";
import { ingestLog, queryLogs, getTopPatterns, getErrorRate, _resetLogAnalyzerForTest } from "./logAnalyzer";
import { startSpan, finishSpan, getTrace, getCriticalPath, _resetTraceCorrelatorForTest } from "./traceCorrelator";
import { defineAlertRule, evaluateMetric, resolveAlert, getActiveAlerts, getAllAlerts, _resetAlertingEngineForTest } from "./alertingEngine";
import { defineSLO, recordSLAEvent, generateSLAReport, _resetSLAMonitorForTest } from "./slaMonitor";

beforeEach(() => {
  _resetObservabilityDashboardForTest();
  _resetMetricsAggregatorForTest();
  _resetLogAnalyzerForTest();
  _resetTraceCorrelatorForTest();
  _resetAlertingEngineForTest();
  _resetSLAMonitorForTest();
});

describe("observabilityDashboard", () => {
  it("creates a dashboard and adds panels", () => {
    const d = createDashboard("Main");
    const p = addPanel(d.dashboardId, "CPU", "metric", { value: 75 });
    expect(p.panelId).toMatch(/^panel-/);
    expect(getDashboard(d.dashboardId)?.panels).toHaveLength(1);
  });

  it("updates panel data", () => {
    const d = createDashboard("Test");
    const p = addPanel(d.dashboardId, "Memory", "metric", { value: 50 });
    updatePanel(d.dashboardId, p.panelId, { value: 80 });
    const updated = getDashboard(d.dashboardId)?.panels[0];
    expect((updated?.data as { value: number }).value).toBe(80);
  });

  it("lists all dashboards", () => {
    createDashboard("A");
    createDashboard("B");
    expect(listDashboards()).toHaveLength(2);
  });
});

describe("metricsAggregator", () => {
  it("records and aggregates metrics", () => {
    recordMetric("latency", "histogram", 100);
    recordMetric("latency", "histogram", 200);
    recordMetric("latency", "histogram", 300);
    const agg = aggregateMetric("latency");
    expect(agg).not.toBeNull();
    expect(agg!.min).toBe(100);
    expect(agg!.max).toBe(300);
    expect(agg!.avg).toBe(200);
    expect(agg!.count).toBe(3);
  });

  it("returns null for unknown metric", () => {
    expect(aggregateMetric("unknown")).toBeNull();
  });

  it("lists metric names", () => {
    recordMetric("cpu", "gauge", 50);
    recordMetric("memory", "gauge", 60);
    expect(getMetricNames()).toContain("cpu");
    expect(getMetricNames()).toContain("memory");
  });
});

describe("logAnalyzer", () => {
  it("ingests and queries logs", () => {
    ingestLog("error", "Connection failed", "api");
    ingestLog("info", "Request processed", "api");
    const errors = queryLogs({ level: "error" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Connection failed");
  });

  it("detects log patterns", () => {
    ingestLog("error", "Timeout after 100ms", "svc");
    ingestLog("error", "Timeout after 200ms", "svc");
    ingestLog("error", "Timeout after 300ms", "svc");
    const patterns = getTopPatterns(1);
    expect(patterns[0].count).toBe(3);
  });

  it("calculates error rate", () => {
    ingestLog("error", "err1", "svc");
    ingestLog("error", "err2", "svc");
    ingestLog("info", "ok", "svc");
    ingestLog("info", "ok2", "svc");
    const rate = getErrorRate(60000);
    expect(rate).toBeCloseTo(0.5, 1);
  });
});

describe("traceCorrelator", () => {
  it("creates and finishes spans", () => {
    const span = startSpan("trace-1", "http.request", "api");
    finishSpan(span, "ok");
    const trace = getTrace("trace-1");
    expect(trace?.spans).toHaveLength(1);
    expect(trace?.spans[0].status).toBe("ok");
  });

  it("tracks error count", () => {
    const s1 = startSpan("trace-2", "db.query", "db");
    finishSpan(s1, "error");
    const trace = getTrace("trace-2");
    expect(trace?.errorCount).toBe(1);
  });

  it("returns critical path sorted by duration", () => {
    const s1 = startSpan("trace-3", "fast", "svc");
    const s2 = startSpan("trace-3", "slow", "svc");
    finishSpan(s1, "ok");
    finishSpan(s2, "ok");
    const path = getCriticalPath("trace-3");
    expect(path).toHaveLength(2);
  });
});

describe("alertingEngine", () => {
  it("fires an alert when condition is met", () => {
    const rule = defineAlertRule("high-cpu", v => v > 90, "critical", 0);
    const alert = evaluateMetric(rule.ruleId, 95);
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("critical");
    expect(getActiveAlerts()).toHaveLength(1);
  });

  it("does not fire when condition is not met", () => {
    const rule = defineAlertRule("low-cpu", v => v > 90, "warning", 0);
    const alert = evaluateMetric(rule.ruleId, 50);
    expect(alert).toBeNull();
  });

  it("resolves an alert", () => {
    const rule = defineAlertRule("mem", v => v > 80, "warning", 0);
    const alert = evaluateMetric(rule.ruleId, 85)!;
    resolveAlert(alert.alertId);
    expect(getActiveAlerts()).toHaveLength(0);
    expect(getAllAlerts()[0].state).toBe("resolved");
  });
});

describe("slaMonitor", () => {
  it("reports 100% compliance for all successes", () => {
    const slo = defineSLO("api-availability", 99.9, 30);
    recordSLAEvent(slo.sloId, true, 50);
    recordSLAEvent(slo.sloId, true, 60);
    const report = generateSLAReport(slo.sloId);
    expect(report?.compliant).toBe(true);
    expect(report?.actual).toBe(100);
  });

  it("reports non-compliance when too many failures", () => {
    const slo = defineSLO("strict-slo", 99, 30);
    for (let i = 0; i < 5; i++) recordSLAEvent(slo.sloId, false, 1000);
    for (let i = 0; i < 5; i++) recordSLAEvent(slo.sloId, true, 50);
    const report = generateSLAReport(slo.sloId);
    expect(report?.actual).toBe(50);
    expect(report?.compliant).toBe(false);
  });

  it("returns null for unknown SLO", () => {
    expect(generateSLAReport("nonexistent")).toBeNull();
  });
});

// Helper to avoid TS unused import error
import { getDashboard } from "./observabilityDashboard";
