/**
 * v75.test.ts — Incident Management & SRE
 * Comprehensive tests for all 6 v75 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { openIncident, updateIncidentStatus, assignIncident, getIncident, getAllIncidents, getOpenIncidents, _resetIncidentManagerForTest } from "./incidentManager";
import { registerRunbook, executeRunbook, getRunbook, getExecutions, _resetRunbookExecutorForTest } from "./runbookExecutor";
import { generatePostmortem, getPostmortems, _resetPostmortemAnalyzerForTest } from "./postmortemAnalyzer";
import { registerSlo, recordMeasurement, getSloStatus, getAllSloStatuses, getMeasurements, _resetSloTrackerForTest } from "./sloTracker";
import { initErrorBudget, consumeErrorBudget, getErrorBudget, getAllErrorBudgets, _resetErrorBudgetMonitorForTest } from "./errorBudgetMonitor";
import { registerOncallSchedule, routeIncident, getRoutingHistory, getSchedules, _resetOncallRouterForTest } from "./oncallRouter";

// ─── incidentManager ─────────────────────────────────────────────────────────
describe("incidentManager", () => {
  beforeEach(() => _resetIncidentManagerForTest());

  it("opens an incident with correct fields", () => {
    const incident = openIncident("API latency spike", "sev2", "api-gateway", ["latency"]);
    expect(incident.incidentId).toMatch(/^INC-/);
    expect(incident.severity).toBe("sev2");
    expect(incident.status).toBe("open");
    expect(incident.affectedService).toBe("api-gateway");
    expect(incident.timeline.length).toBe(1);
  });

  it("updates incident status and adds timeline entry", () => {
    const incident = openIncident("DB failure", "sev1", "database");
    const updated = updateIncidentStatus(incident.incidentId, "investigating", "alice", "Investigating DB logs");
    expect(updated).toBe(true);
    const retrieved = getIncident(incident.incidentId);
    expect(retrieved?.status).toBe("investigating");
    expect(retrieved?.timeline.length).toBe(2);
  });

  it("sets resolvedAt when status is resolved", () => {
    const incident = openIncident("Cache miss", "sev3", "cache");
    updateIncidentStatus(incident.incidentId, "resolved", "bob", "Cache flushed");
    const retrieved = getIncident(incident.incidentId);
    expect(retrieved?.resolvedAt).not.toBeNull();
  });

  it("assigns an incident to an engineer", () => {
    const incident = openIncident("Memory leak", "sev2", "worker");
    assignIncident(incident.incidentId, "charlie");
    expect(getIncident(incident.incidentId)?.assignee).toBe("charlie");
  });

  it("returns open incidents only", () => {
    const i1 = openIncident("Open issue", "sev3", "svc-a");
    const i2 = openIncident("Resolved issue", "sev4", "svc-b");
    updateIncidentStatus(i2.incidentId, "resolved", "system", "Fixed");
    const open = getOpenIncidents();
    expect(open.some(i => i.incidentId === i1.incidentId)).toBe(true);
    expect(open.some(i => i.incidentId === i2.incidentId)).toBe(false);
  });

  it("returns false for unknown incident update", () => {
    expect(updateIncidentStatus("INC-9999", "resolved", "x", "y")).toBe(false);
  });
});

// ─── runbookExecutor ─────────────────────────────────────────────────────────
describe("runbookExecutor", () => {
  beforeEach(() => _resetRunbookExecutorForTest());

  it("registers and retrieves a runbook", () => {
    const rb = { runbookId: "rb-1", name: "Restart Service", applicableSeverities: ["sev2"], steps: [{ stepId: "s1", name: "Check health", description: "Ping service", automated: true, timeoutMs: 5000 }] };
    registerRunbook(rb);
    expect(getRunbook("rb-1")).toBeDefined();
    expect(getRunbook("rb-1")?.name).toBe("Restart Service");
  });

  it("executes a runbook and returns execution record", () => {
    registerRunbook({ runbookId: "rb-2", name: "Failover", applicableSeverities: ["sev1"], steps: [{ stepId: "s1", name: "Switch traffic", description: "Redirect", automated: true, timeoutMs: 3000 }] });
    const exec = executeRunbook("rb-2", "INC-0001");
    expect(exec).not.toBeNull();
    expect(exec?.overallStatus).toBe("completed");
    expect(exec?.stepResults.length).toBe(1);
    expect(exec?.stepResults[0].status).toBe("success");
  });

  it("skips manual steps", () => {
    registerRunbook({ runbookId: "rb-3", name: "Manual", applicableSeverities: ["sev3"], steps: [{ stepId: "s1", name: "Call vendor", description: "Phone call", automated: false, timeoutMs: 0 }] });
    const exec = executeRunbook("rb-3", "INC-0002");
    expect(exec?.stepResults[0].status).toBe("skipped");
  });

  it("returns null for unknown runbook", () => {
    expect(executeRunbook("rb-unknown", "INC-0001")).toBeNull();
  });

  it("accumulates executions", () => {
    registerRunbook({ runbookId: "rb-4", name: "Test", applicableSeverities: [], steps: [] });
    executeRunbook("rb-4", "INC-0001");
    executeRunbook("rb-4", "INC-0002");
    expect(getExecutions().length).toBe(2);
  });

  it("resets cleanly", () => {
    registerRunbook({ runbookId: "rb-5", name: "X", applicableSeverities: [], steps: [] });
    _resetRunbookExecutorForTest();
    expect(getRunbook("rb-5")).toBeUndefined();
  });
});

// ─── postmortemAnalyzer ──────────────────────────────────────────────────────
describe("postmortemAnalyzer", () => {
  beforeEach(() => _resetPostmortemAnalyzerForTest());

  it("generates a postmortem with correct fields", () => {
    const pm = generatePostmortem({
      incidentId: "INC-0001", title: "DB Outage", severity: "sev1",
      affectedService: "database", openedAt: 1000000, resolvedAt: 1003600000,
      timeline: [{ timestamp: 1000000, actor: "system", description: "Alert fired" }],
      contributingFactors: ["High connection pool", "Missing index"],
      impactDescription: "All writes failed for 60 minutes.",
    });
    expect(pm.postmortemId).toMatch(/^PM-/);
    expect(pm.title).toContain("DB Outage");
    expect(pm.rootCauses.length).toBeGreaterThan(0);
    expect(pm.summary).toContain("database");
  });

  it("includes action items in postmortem", () => {
    const pm = generatePostmortem(
      { incidentId: "INC-0002", title: "Cache Miss", severity: "sev3", affectedService: "cache", openedAt: 0, resolvedAt: 300000, timeline: [], contributingFactors: [], impactDescription: "Slow responses." },
      [{ description: "Add cache warming", owner: "alice", priority: "high", dueInDays: 7 }],
    );
    expect(pm.actionItems.length).toBe(1);
    expect(pm.actionItems[0].actionId).toMatch(/^action-/);
  });

  it("handles unresolved incidents", () => {
    const pm = generatePostmortem({ incidentId: "INC-0003", title: "Ongoing", severity: "sev2", affectedService: "svc", openedAt: 0, resolvedAt: null, timeline: [], contributingFactors: [], impactDescription: "Still ongoing." });
    expect(pm.summary).toContain("unresolved");
  });

  it("accumulates postmortems", () => {
    generatePostmortem({ incidentId: "INC-0004", title: "A", severity: "sev4", affectedService: "x", openedAt: 0, resolvedAt: 1000, timeline: [], contributingFactors: [], impactDescription: "Minor." });
    generatePostmortem({ incidentId: "INC-0005", title: "B", severity: "sev4", affectedService: "y", openedAt: 0, resolvedAt: 1000, timeline: [], contributingFactors: [], impactDescription: "Minor." });
    expect(getPostmortems().length).toBe(2);
  });

  it("resets cleanly", () => {
    generatePostmortem({ incidentId: "INC-0006", title: "C", severity: "sev4", affectedService: "z", openedAt: 0, resolvedAt: 1000, timeline: [], contributingFactors: [], impactDescription: "Minor." });
    _resetPostmortemAnalyzerForTest();
    expect(getPostmortems().length).toBe(0);
  });
});

// ─── sloTracker ──────────────────────────────────────────────────────────────
describe("sloTracker", () => {
  beforeEach(() => _resetSloTrackerForTest());

  it("registers an SLO and records measurements", () => {
    registerSlo({ sloId: "slo-1", name: "API Availability", service: "api", sloType: "availability", targetPercent: 99.9, windowDays: 30 });
    const meas = recordMeasurement("slo-1", 999, 1000);
    expect(meas).not.toBeNull();
    expect(meas?.compliancePercent).toBeCloseTo(99.9);
    expect(meas?.withinTarget).toBe(true);
  });

  it("marks measurement as out of target when below threshold", () => {
    registerSlo({ sloId: "slo-2", name: "Error Rate", service: "api", sloType: "error_rate", targetPercent: 99.5, windowDays: 7 });
    const meas = recordMeasurement("slo-2", 900, 1000);
    expect(meas?.withinTarget).toBe(false);
  });

  it("returns null for unknown SLO measurement", () => {
    expect(recordMeasurement("slo-unknown", 100, 100)).toBeNull();
  });

  it("computes SLO status correctly", () => {
    registerSlo({ sloId: "slo-3", name: "Latency", service: "api", sloType: "latency", targetPercent: 95, windowDays: 7 });
    recordMeasurement("slo-3", 950, 1000);
    recordMeasurement("slo-3", 960, 1000);
    const status = getSloStatus("slo-3");
    expect(status?.currentCompliancePercent).toBeCloseTo(95.5);
    expect(status?.withinTarget).toBe(true);
  });

  it("returns all SLO statuses", () => {
    registerSlo({ sloId: "slo-4", name: "A", service: "x", sloType: "availability", targetPercent: 99, windowDays: 30 });
    registerSlo({ sloId: "slo-5", name: "B", service: "y", sloType: "error_rate", targetPercent: 99, windowDays: 30 });
    expect(getAllSloStatuses().length).toBe(2);
  });

  it("resets cleanly", () => {
    registerSlo({ sloId: "slo-6", name: "X", service: "z", sloType: "throughput", targetPercent: 90, windowDays: 7 });
    _resetSloTrackerForTest();
    expect(getAllSloStatuses().length).toBe(0);
  });
});

// ─── errorBudgetMonitor ──────────────────────────────────────────────────────
describe("errorBudgetMonitor", () => {
  beforeEach(() => _resetErrorBudgetMonitorForTest());

  it("initializes error budget correctly", () => {
    const state = initErrorBudget("slo-1", "api", 99.9, 30);
    expect(state.targetPercent).toBe(99.9);
    expect(state.remainingPercent).toBeCloseTo(0.1);
    expect(state.budgetExhausted).toBe(false);
  });

  it("consumes budget proportionally", () => {
    initErrorBudget("slo-2", "svc", 99, 30);
    const state = consumeErrorBudget("slo-2", 99.5);
    expect(state?.consumedPercent).toBeCloseTo(50);
    expect(state?.budgetExhausted).toBe(false);
  });

  it("marks budget as exhausted when compliance drops below target", () => {
    initErrorBudget("slo-3", "svc", 99, 30);
    const state = consumeErrorBudget("slo-3", 97);
    expect(state?.budgetExhausted).toBe(true);
    expect(state?.consumedPercent).toBe(100);
  });

  it("returns null for unknown SLO", () => {
    expect(consumeErrorBudget("slo-unknown", 99)).toBeNull();
  });

  it("returns all error budgets", () => {
    initErrorBudget("slo-4", "a", 99, 30);
    initErrorBudget("slo-5", "b", 99.9, 7);
    expect(getAllErrorBudgets().length).toBe(2);
  });

  it("resets cleanly", () => {
    initErrorBudget("slo-6", "c", 99, 30);
    _resetErrorBudgetMonitorForTest();
    expect(getAllErrorBudgets().length).toBe(0);
  });
});

// ─── oncallRouter ────────────────────────────────────────────────────────────
describe("oncallRouter", () => {
  beforeEach(() => _resetOncallRouterForTest());

  it("routes to primary engineer by default", () => {
    registerOncallSchedule({ scheduleId: "sch-1", service: "api", primaryEngineer: "alice", secondaryEngineer: "bob", escalationAfterMinutes: 30 });
    const decision = routeIncident("INC-0001", "api", 0);
    expect(decision.assignedTo).toBe("alice");
    expect(decision.escalationLevel).toBe(0);
  });

  it("escalates to secondary after threshold", () => {
    registerOncallSchedule({ scheduleId: "sch-2", service: "db", primaryEngineer: "charlie", secondaryEngineer: "dave", escalationAfterMinutes: 15 });
    const decision = routeIncident("INC-0002", "db", 20);
    expect(decision.assignedTo).toBe("dave");
    expect(decision.escalationLevel).toBe(1);
  });

  it("routes to default on-call for unknown service", () => {
    const decision = routeIncident("INC-0003", "unknown-service", 0);
    expect(decision.assignedTo).toBe("default-oncall");
  });

  it("accumulates routing history", () => {
    registerOncallSchedule({ scheduleId: "sch-3", service: "cache", primaryEngineer: "eve", secondaryEngineer: "frank", escalationAfterMinutes: 10 });
    routeIncident("INC-0004", "cache", 0);
    routeIncident("INC-0005", "cache", 0);
    expect(getRoutingHistory().length).toBe(2);
  });

  it("returns registered schedules", () => {
    registerOncallSchedule({ scheduleId: "sch-4", service: "worker", primaryEngineer: "grace", secondaryEngineer: "henry", escalationAfterMinutes: 20 });
    expect(getSchedules().length).toBe(1);
  });

  it("resets cleanly", () => {
    registerOncallSchedule({ scheduleId: "sch-5", service: "svc", primaryEngineer: "x", secondaryEngineer: "y", escalationAfterMinutes: 5 });
    _resetOncallRouterForTest();
    expect(getSchedules().length).toBe(0);
    expect(getRoutingHistory().length).toBe(0);
  });
});
