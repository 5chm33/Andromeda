/**
 * v78.test.ts — Cost Management & FinOps
 * Comprehensive tests for all 6 v78 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { recordCostEvent, getCostSummary, getCostEvents, _resetCostTrackerForTest } from "./costTracker";
import { createBudget, checkBudget, getBudget, getAllAlerts, _resetBudgetAlertEngineForTest } from "./budgetAlertEngine";
import { generateOptimizationReport, getOptimizationReports, _resetResourceCostOptimizerForTest } from "./resourceCostOptimizer";
import { analyzeSpend, getSpendAnalysisReports, _resetCloudSpendAnalyzerForTest } from "./cloudSpendAnalyzer";
import { createAllocationRule, allocateCost, getAllocations, _resetCostAllocationEngineForTest } from "./costAllocationEngine";
import { generateBillingReport, getBillingReports, getBillingReportsForRecipient, _resetBillingReporterForTest } from "./billingReporter";

// ─── costTracker ─────────────────────────────────────────────────────────────
describe("costTracker", () => {
  beforeEach(() => _resetCostTrackerForTest());

  it("records a cost event", () => {
    const event = recordCostEvent({ service: "ec2", team: "platform", category: "compute", amountUsd: 12.50, resourceId: "i-001", tags: {} });
    expect(event.eventId).toMatch(/^cost-/);
    expect(event.amountUsd).toBe(12.50);
  });

  it("computes cost summary by service and team", () => {
    recordCostEvent({ service: "ec2", team: "platform", category: "compute", amountUsd: 10, resourceId: "r1", tags: {} });
    recordCostEvent({ service: "s3", team: "data", category: "storage", amountUsd: 5, resourceId: "r2", tags: {} });
    const summary = getCostSummary();
    expect(summary.totalUsd).toBe(15);
    expect(summary.byService["ec2"]).toBe(10);
    expect(summary.byTeam["data"]).toBe(5);
  });

  it("filters by time range", () => {
    const before = Date.now() - 1000;
    recordCostEvent({ service: "ec2", team: "t", category: "compute", amountUsd: 10, resourceId: "r1", tags: {} });
    const summary = getCostSummary(Date.now() + 1000);
    expect(summary.totalUsd).toBe(0);
  });

  it("accumulates events", () => {
    recordCostEvent({ service: "ec2", team: "t", category: "compute", amountUsd: 1, resourceId: "r1", tags: {} });
    recordCostEvent({ service: "rds", team: "t", category: "database", amountUsd: 2, resourceId: "r2", tags: {} });
    expect(getCostEvents().length).toBe(2);
  });

  it("resets cleanly", () => {
    recordCostEvent({ service: "ec2", team: "t", category: "compute", amountUsd: 1, resourceId: "r1", tags: {} });
    _resetCostTrackerForTest();
    expect(getCostEvents().length).toBe(0);
  });
});

// ─── budgetAlertEngine ───────────────────────────────────────────────────────
describe("budgetAlertEngine", () => {
  beforeEach(() => _resetBudgetAlertEngineForTest());

  it("creates a budget", () => {
    const budget = createBudget("Platform Budget", "platform-team", 1000);
    expect(budget.budgetId).toMatch(/^budget-/);
    expect(budget.limitUsd).toBe(1000);
  });

  it("fires warning alert at 80%", () => {
    const budget = createBudget("Test Budget", "scope", 1000);
    const fired = checkBudget(budget.budgetId, 850);
    expect(fired.some(a => a.severity === "warning")).toBe(true);
  });

  it("fires critical alert at 100%", () => {
    const budget = createBudget("Test Budget", "scope", 1000);
    const fired = checkBudget(budget.budgetId, 1000);
    expect(fired.some(a => a.severity === "critical")).toBe(true);
  });

  it("fires no alerts below threshold", () => {
    const budget = createBudget("Test Budget", "scope", 1000);
    const fired = checkBudget(budget.budgetId, 500);
    expect(fired.length).toBe(0);
  });

  it("returns null for unknown budget", () => {
    expect(checkBudget("budget-unknown", 100)).toEqual([]);
  });

  it("resets cleanly", () => {
    const budget = createBudget("X", "scope", 100);
    checkBudget(budget.budgetId, 100);
    _resetBudgetAlertEngineForTest();
    expect(getAllAlerts().length).toBe(0);
  });
});

// ─── resourceCostOptimizer ───────────────────────────────────────────────────
describe("resourceCostOptimizer", () => {
  beforeEach(() => _resetResourceCostOptimizerForTest());

  it("recommends terminating idle resources", () => {
    const report = generateOptimizationReport([{ resourceId: "i-001", resourceType: "ec2", service: "compute", currentCostUsd: 100, cpuUtilizationPercent: 0, memoryUtilizationPercent: 0, idleDays: 14 }]);
    expect(report.recommendations.some(r => r.category === "idle_resources")).toBe(true);
    expect(report.totalEstimatedSavingsUsd).toBeGreaterThan(0);
  });

  it("recommends rightsizing over-provisioned resources", () => {
    const report = generateOptimizationReport([{ resourceId: "i-002", resourceType: "ec2", service: "compute", currentCostUsd: 200, cpuUtilizationPercent: 10, memoryUtilizationPercent: 15, idleDays: 0 }]);
    expect(report.recommendations.some(r => r.category === "rightsizing")).toBe(true);
  });

  it("recommends reserved instances for high-utilization resources", () => {
    const report = generateOptimizationReport([{ resourceId: "i-003", resourceType: "ec2", service: "compute", currentCostUsd: 300, cpuUtilizationPercent: 80, memoryUtilizationPercent: 70, idleDays: 0 }]);
    expect(report.recommendations.some(r => r.category === "reserved_instances")).toBe(true);
  });

  it("generates no recommendations for optimally-used resources", () => {
    const report = generateOptimizationReport([{ resourceId: "i-004", resourceType: "ec2", service: "compute", currentCostUsd: 100, cpuUtilizationPercent: 50, memoryUtilizationPercent: 60, idleDays: 0 }]);
    expect(report.recommendations.length).toBe(0);
  });

  it("accumulates reports", () => {
    generateOptimizationReport([]);
    generateOptimizationReport([]);
    expect(getOptimizationReports().length).toBe(2);
  });

  it("resets cleanly", () => {
    generateOptimizationReport([]);
    _resetResourceCostOptimizerForTest();
    expect(getOptimizationReports().length).toBe(0);
  });
});

// ─── cloudSpendAnalyzer ──────────────────────────────────────────────────────
describe("cloudSpendAnalyzer", () => {
  beforeEach(() => _resetCloudSpendAnalyzerForTest());

  it("analyzes spend trends", () => {
    const report = analyzeSpend([
      { periodLabel: "2024-01", spendUsd: 100, service: "ec2" },
      { periodLabel: "2024-02", spendUsd: 120, service: "ec2" },
      { periodLabel: "2024-03", spendUsd: 150, service: "ec2" },
    ]);
    expect(report.trends.length).toBe(1);
    expect(report.trends[0].trend).toBe("increasing");
  });

  it("detects spend anomalies", () => {
    const report = analyzeSpend([
      { periodLabel: "2024-01", spendUsd: 100, service: "rds" },
      { periodLabel: "2024-02", spendUsd: 105, service: "rds" },
      { periodLabel: "2024-03", spendUsd: 500, service: "rds" },
    ]);
    expect(report.anomalies.length).toBeGreaterThan(0);
    expect(report.anomalies[0].service).toBe("rds");
  });

  it("computes period-over-period change", () => {
    const report = analyzeSpend([
      { periodLabel: "2024-01", spendUsd: 100, service: "ec2" },
      { periodLabel: "2024-02", spendUsd: 200, service: "ec2" },
    ]);
    expect(report.overallChangePercent).toBeCloseTo(100);
  });

  it("handles single service with stable spend", () => {
    const report = analyzeSpend([
      { periodLabel: "2024-01", spendUsd: 100, service: "s3" },
      { periodLabel: "2024-02", spendUsd: 102, service: "s3" },
    ]);
    expect(report.trends[0].trend).toBe("stable");
  });

  it("accumulates reports", () => {
    analyzeSpend([{ periodLabel: "2024-01", spendUsd: 100, service: "ec2" }]);
    analyzeSpend([{ periodLabel: "2024-01", spendUsd: 50, service: "s3" }]);
    expect(getSpendAnalysisReports().length).toBe(2);
  });

  it("resets cleanly", () => {
    analyzeSpend([{ periodLabel: "2024-01", spendUsd: 100, service: "ec2" }]);
    _resetCloudSpendAnalyzerForTest();
    expect(getSpendAnalysisReports().length).toBe(0);
  });
});

// ─── costAllocationEngine ────────────────────────────────────────────────────
describe("costAllocationEngine", () => {
  beforeEach(() => _resetCostAllocationEngineForTest());

  it("allocates cost equally", () => {
    const rule = createAllocationRule("Equal Split", "equal_split", [
      { entityId: "team-a", entityType: "team" },
      { entityId: "team-b", entityType: "team" },
    ]);
    const allocation = allocateCost(rule.ruleId, 100);
    expect(allocation?.allocations[0].allocatedUsd).toBe(50);
    expect(allocation?.allocations[1].allocatedUsd).toBe(50);
  });

  it("allocates cost proportionally by weight", () => {
    const rule = createAllocationRule("Proportional", "proportional", [
      { entityId: "team-a", entityType: "team", weight: 3 },
      { entityId: "team-b", entityType: "team", weight: 1 },
    ]);
    const allocation = allocateCost(rule.ruleId, 100);
    expect(allocation?.allocations[0].allocatedUsd).toBeCloseTo(75);
    expect(allocation?.allocations[1].allocatedUsd).toBeCloseTo(25);
  });

  it("returns null for unknown rule", () => {
    expect(allocateCost("rule-unknown", 100)).toBeNull();
  });

  it("accumulates allocations", () => {
    const rule = createAllocationRule("R", "equal_split", [{ entityId: "t", entityType: "team" }]);
    allocateCost(rule.ruleId, 50);
    allocateCost(rule.ruleId, 100);
    expect(getAllocations().length).toBe(2);
  });

  it("resets cleanly", () => {
    createAllocationRule("R", "equal_split", []);
    _resetCostAllocationEngineForTest();
    expect(getAllocations().length).toBe(0);
  });
});

// ─── billingReporter ─────────────────────────────────────────────────────────
describe("billingReporter", () => {
  beforeEach(() => _resetBillingReporterForTest());

  it("generates a billing report with correct totals", () => {
    const report = generateBillingReport({
      recipientId: "team-platform",
      recipientType: "team",
      periodLabel: "2024-03",
      lineItems: [
        { description: "EC2 compute", service: "ec2", quantity: 720, unitCostUsd: 0.1, tags: {} },
        { description: "S3 storage", service: "s3", quantity: 100, unitCostUsd: 0.023, tags: {} },
      ],
    });
    expect(report.subtotalUsd).toBeCloseTo(74.3);
    expect(report.taxUsd).toBe(0);
    expect(report.totalUsd).toBeCloseTo(74.3);
  });

  it("applies tax rate correctly", () => {
    const report = generateBillingReport({
      recipientId: "team-data",
      recipientType: "team",
      periodLabel: "2024-03",
      lineItems: [{ description: "RDS", service: "rds", quantity: 1, unitCostUsd: 100, tags: {} }],
      taxRatePercent: 10,
    });
    expect(report.taxUsd).toBeCloseTo(10);
    expect(report.totalUsd).toBeCloseTo(110);
  });

  it("retrieves reports for specific recipient", () => {
    generateBillingReport({ recipientId: "team-a", recipientType: "team", periodLabel: "2024-03", lineItems: [] });
    generateBillingReport({ recipientId: "team-b", recipientType: "team", periodLabel: "2024-03", lineItems: [] });
    expect(getBillingReportsForRecipient("team-a").length).toBe(1);
  });

  it("accumulates reports", () => {
    generateBillingReport({ recipientId: "t", recipientType: "team", periodLabel: "2024-01", lineItems: [] });
    generateBillingReport({ recipientId: "t", recipientType: "team", periodLabel: "2024-02", lineItems: [] });
    expect(getBillingReports().length).toBe(2);
  });

  it("resets cleanly", () => {
    generateBillingReport({ recipientId: "t", recipientType: "team", periodLabel: "2024-01", lineItems: [] });
    _resetBillingReporterForTest();
    expect(getBillingReports().length).toBe(0);
  });
});
