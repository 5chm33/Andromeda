/**
 * v84.test.ts — Workflow & Task Automation
 * Comprehensive tests for all 6 v84 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { defineWorkflow, startExecution, completeStep, getExecution, getDefinition, _resetWorkflowEngineForTest } from "./workflowEngine";
import { enqueue, dequeue, completeJob, failJob, getQueueDepth, getProcessingCount, getCompletedJobs, getJob, _resetJobQueueForTest } from "./jobQueue";
import { createRetryPolicy, computeDelay, shouldRetry, recordAttempt, getAttemptsForOperation, _resetRetryManagerForTest } from "./retryManager";
import { parseCron, getNextRun, isValidCron } from "./cronExpressionParser";
import { registerSLA, recordExecution, emitAlert, resolveAlert, getStats, getActiveAlerts, _resetWorkflowMonitorForTest } from "./workflowMonitor";
import { registerTrigger, processEvent, enableTrigger, disableTrigger, getTrigger, _resetEventDrivenTriggerForTest } from "./eventDrivenTrigger";

// ─── workflowEngine ──────────────────────────────────────────────────────────
describe("workflowEngine", () => {
  beforeEach(() => _resetWorkflowEngineForTest());

  it("defines and retrieves a workflow", () => {
    const def = defineWorkflow("ETL Pipeline", [
      { name: "Extract", action: "extract", params: {}, dependsOn: [], timeout: 5000 },
      { name: "Transform", action: "transform", params: {}, dependsOn: [], timeout: 5000 },
    ]);
    expect(def.workflowId).toMatch(/^wf-/);
    expect(def.steps.length).toBe(2);
    expect(getDefinition(def.workflowId)?.name).toBe("ETL Pipeline");
  });

  it("starts an execution", () => {
    const def = defineWorkflow("Simple", [{ name: "Step1", action: "act", params: {}, dependsOn: [], timeout: 1000 }]);
    const exec = startExecution(def.workflowId);
    expect(exec?.status).toBe("running");
    expect(exec?.executionId).toMatch(/^exec-/);
  });

  it("completes a step and marks workflow done", () => {
    const def = defineWorkflow("OneStep", [{ name: "Only", action: "act", params: {}, dependsOn: [], timeout: 1000 }]);
    const exec = startExecution(def.workflowId)!;
    const stepId = def.steps[0].stepId;
    completeStep(exec.executionId, stepId, "result", true);
    expect(getExecution(exec.executionId)?.status).toBe("completed");
  });

  it("marks workflow failed when step fails", () => {
    const def = defineWorkflow("Fail", [{ name: "Step", action: "act", params: {}, dependsOn: [], timeout: 1000 }]);
    const exec = startExecution(def.workflowId)!;
    completeStep(exec.executionId, def.steps[0].stepId, null, false);
    expect(getExecution(exec.executionId)?.status).toBe("failed");
  });

  it("returns null for unknown workflow", () => {
    expect(startExecution("unknown-wf")).toBeNull();
  });

  it("resets cleanly", () => {
    defineWorkflow("X", []);
    _resetWorkflowEngineForTest();
    expect(getDefinition("wf-1")).toBeUndefined();
  });
});

// ─── jobQueue ────────────────────────────────────────────────────────────────
describe("jobQueue", () => {
  beforeEach(() => _resetJobQueueForTest());

  it("enqueues and dequeues a job", () => {
    const job = enqueue("send_email", { to: "alice@example.com" }, "normal");
    expect(getQueueDepth()).toBe(1);
    const dequeued = dequeue();
    expect(dequeued?.jobId).toBe(job.jobId);
    expect(getQueueDepth()).toBe(0);
    expect(getProcessingCount()).toBe(1);
  });

  it("respects priority ordering", () => {
    enqueue("low_task", {}, "low");
    enqueue("critical_task", {}, "critical");
    enqueue("normal_task", {}, "normal");
    const first = dequeue();
    expect(first?.priority).toBe("critical");
  });

  it("completes a job", () => {
    const job = enqueue("task", {});
    dequeue();
    completeJob(job.jobId, "done");
    expect(getCompletedJobs()[0].status).toBe("completed");
    expect(getProcessingCount()).toBe(0);
  });

  it("retries a failed job", () => {
    const job = enqueue("task", {}, "normal", 3);
    dequeue();
    failJob(job.jobId, "timeout");
    expect(getQueueDepth()).toBe(1); // re-queued
  });

  it("moves to failed after max attempts", () => {
    const job = enqueue("task", {}, "normal", 1);
    dequeue();
    failJob(job.jobId, "error");
    expect(getCompletedJobs()[0].status).toBe("failed");
  });

  it("retrieves a job by ID", () => {
    const job = enqueue("task", {});
    expect(getJob(job.jobId)?.jobId).toBe(job.jobId);
  });
});

// ─── retryManager ────────────────────────────────────────────────────────────
describe("retryManager", () => {
  beforeEach(() => _resetRetryManagerForTest());

  it("creates a retry policy", () => {
    const policy = createRetryPolicy("default", { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000, backoffStrategy: "exponential", jitterPercent: 0, retryableErrors: [] });
    expect(policy.policyId).toMatch(/^rp-/);
  });

  it("computes exponential backoff delay", () => {
    const policy = createRetryPolicy("exp", { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 10000, backoffStrategy: "exponential", jitterPercent: 0, retryableErrors: [] });
    const d1 = computeDelay(policy.policyId, 1);
    const d2 = computeDelay(policy.policyId, 2);
    expect(d2).toBeGreaterThan(d1);
  });

  it("caps delay at maxDelayMs", () => {
    const policy = createRetryPolicy("capped", { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 2000, backoffStrategy: "exponential", jitterPercent: 0, retryableErrors: [] });
    const delay = computeDelay(policy.policyId, 10);
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("shouldRetry returns false after max attempts", () => {
    const policy = createRetryPolicy("limited", { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, backoffStrategy: "fixed", jitterPercent: 0, retryableErrors: [] });
    expect(shouldRetry(policy.policyId, 3, "error")).toBe(false);
  });

  it("shouldRetry respects retryable errors", () => {
    const policy = createRetryPolicy("selective", { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, backoffStrategy: "fixed", jitterPercent: 0, retryableErrors: ["timeout"] });
    expect(shouldRetry(policy.policyId, 1, "network timeout")).toBe(true);
    expect(shouldRetry(policy.policyId, 1, "auth error")).toBe(false);
  });

  it("records attempts", () => {
    recordAttempt("op-1", 1, 100, "failure", "timeout");
    recordAttempt("op-1", 2, 200, "success");
    expect(getAttemptsForOperation("op-1").length).toBe(2);
  });
});

// ─── cronExpressionParser ────────────────────────────────────────────────────
describe("cronExpressionParser", () => {
  it("parses a valid cron expression", () => {
    const result = parseCron("0 9 * * *");
    expect(result?.hour).toBe("9");
    expect(result?.minute).toBe("0");
  });

  it("validates cron expressions", () => {
    expect(isValidCron("0 9 * * *")).toBe(true);
    expect(isValidCron("invalid")).toBe(false);
    expect(isValidCron("* * * *")).toBe(false);
  });

  it("generates description", () => {
    const result = parseCron("0 9 * * *");
    expect(result?.description).toContain("9");
  });

  it("computes next run time", () => {
    const result = getNextRun("0 9 * * *", new Date("2024-01-01T08:00:00Z"));
    expect(result?.nextRunAt).toBeGreaterThan(new Date("2024-01-01T08:00:00Z").getTime());
  });

  it("handles every-minute cron", () => {
    const result = parseCron("* * * * *");
    expect(result?.description).toContain("minute");
  });

  it("returns null for invalid expression", () => {
    expect(parseCron("not a cron")).toBeNull();
  });
});

// ─── workflowMonitor ─────────────────────────────────────────────────────────
describe("workflowMonitor", () => {
  beforeEach(() => _resetWorkflowMonitorForTest());

  it("records executions and computes stats", () => {
    recordExecution("exec-1", "wf-1", "completed", 1000, 2000);
    recordExecution("exec-2", "wf-1", "failed", 1000, 1500);
    const stats = getStats();
    expect(stats.totalExecutions).toBe(2);
    expect(stats.completedCount).toBe(1);
    expect(stats.failedCount).toBe(1);
  });

  it("emits alert for failed execution", () => {
    recordExecution("exec-3", "wf-1", "failed", 1000, 1500);
    const alerts = getActiveAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].severity).toBe("critical");
  });

  it("detects SLA breaches", () => {
    registerSLA("wf-2", 1000, 500);
    recordExecution("exec-4", "wf-2", "completed", 0, 2000);
    const alerts = getActiveAlerts();
    expect(alerts.some(a => a.message.includes("SLA breach"))).toBe(true);
  });

  it("resolves alerts", () => {
    const alert = emitAlert("exec-5", "wf-1", "warning", "Test alert");
    expect(resolveAlert(alert.alertId)).toBe(true);
    expect(getActiveAlerts().find(a => a.alertId === alert.alertId)).toBeUndefined();
  });

  it("computes average duration", () => {
    recordExecution("exec-6", "wf-1", "completed", 0, 1000);
    recordExecution("exec-7", "wf-1", "completed", 0, 3000);
    expect(getStats().averageDurationMs).toBe(2000);
  });

  it("resets cleanly", () => {
    emitAlert("e", "w", "info", "test");
    _resetWorkflowMonitorForTest();
    expect(getActiveAlerts().length).toBe(0);
  });
});

// ─── eventDrivenTrigger ──────────────────────────────────────────────────────
describe("eventDrivenTrigger", () => {
  beforeEach(() => _resetEventDrivenTriggerForTest());

  it("registers and fires a trigger", () => {
    registerTrigger("High CPU Alert", "threshold", "system.cpu", [{ field: "value", operator: "gt", value: 80 }], "wf-1");
    const fired = processEvent("system.cpu", { value: 95 });
    expect(fired.length).toBe(1);
  });

  it("does not fire when condition not met", () => {
    registerTrigger("High CPU Alert", "threshold", "system.cpu", [{ field: "value", operator: "gt", value: 80 }], "wf-1");
    const fired = processEvent("system.cpu", { value: 50 });
    expect(fired.length).toBe(0);
  });

  it("does not fire when event pattern does not match", () => {
    registerTrigger("CPU Alert", "threshold", "system.cpu", [], "wf-1");
    const fired = processEvent("system.memory", { value: 95 });
    expect(fired.length).toBe(0);
  });

  it("disables and re-enables triggers", () => {
    const trigger = registerTrigger("Test", "event", "test.*", [], "wf-1");
    disableTrigger(trigger.triggerId);
    expect(processEvent("test.event", {}).length).toBe(0);
    enableTrigger(trigger.triggerId);
    expect(processEvent("test.event", {}).length).toBe(1);
  });

  it("increments fired count", () => {
    const trigger = registerTrigger("Counter", "event", "click", [], "wf-1");
    processEvent("click", {});
    processEvent("click", {});
    expect(getTrigger(trigger.triggerId)?.firedCount).toBe(2);
  });

  it("resets cleanly", () => {
    registerTrigger("X", "event", "x", [], "wf-1");
    _resetEventDrivenTriggerForTest();
    expect(processEvent("x", {}).length).toBe(0);
  });
});
