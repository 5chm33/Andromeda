/**
 * v77.test.ts — Feature Flags & Experimentation
 * Comprehensive tests for all 6 v77 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createFlag, updateFlag, evaluateFlag, getFlag, getAllFlags, getEvaluations, _resetFeatureFlagManagerForTest } from "./featureFlagManager";
import { createExperiment, exposeUser, recordConversion, getExperimentResults, getExperiment, _resetAbTestingEngineForTest } from "./abTestingEngine";
import { trackExperiment, updateExperimentStatus, addNote, getExperimentRecord, getRunningExperiments, _resetExperimentTrackerForTest } from "./experimentTracker";
import { createCanaryDeployment, activateCanary, recordHealthCheck, promoteCanary, increaseCanaryTraffic, getDeployment, _resetCanaryDeployerForTest } from "./canaryDeployer";
import { createRolloutPlan, advanceRollout, pauseRollout, resumeRollout, getRolloutPlan, _resetRolloutControllerForTest } from "./rolloutController";
import { logAuditEntry, getAuditLog, getAuditLogForEntity, getAuditLogByActor, getAuditLogByAction, _resetFeatureAuditLogForTest } from "./featureAuditLog";

// ─── featureFlagManager ──────────────────────────────────────────────────────
describe("featureFlagManager", () => {
  beforeEach(() => _resetFeatureFlagManagerForTest());

  it("creates and retrieves a feature flag", () => {
    const flag = createFlag("ff-1", "New UI", "Test new UI", "disabled");
    expect(flag.flagId).toBe("ff-1");
    expect(flag.status).toBe("disabled");
    expect(getFlag("ff-1")).toBeDefined();
  });

  it("evaluates disabled flag as false", () => {
    createFlag("ff-2", "Disabled", "desc", "disabled");
    const eval_ = evaluateFlag("ff-2", "user-1");
    expect(eval_.enabled).toBe(false);
    expect(eval_.reason).toContain("disabled");
  });

  it("evaluates enabled flag as true", () => {
    createFlag("ff-3", "Enabled", "desc", "enabled");
    const eval_ = evaluateFlag("ff-3", "user-1");
    expect(eval_.enabled).toBe(true);
  });

  it("evaluates rollout flag based on user bucket", () => {
    createFlag("ff-4", "Rollout", "desc", "rollout", 100);
    const eval_ = evaluateFlag("ff-4", "any-user");
    expect(eval_.enabled).toBe(true);
  });

  it("updates flag status", () => {
    createFlag("ff-5", "Toggle", "desc", "disabled");
    updateFlag("ff-5", { status: "enabled" });
    expect(getFlag("ff-5")?.status).toBe("enabled");
  });

  it("evaluates targeting rules", () => {
    createFlag("ff-6", "Targeted", "desc", "rollout", 0);
    updateFlag("ff-6", { targetingRules: [{ attribute: "country", operator: "equals", value: "US" }] });
    const eval1 = evaluateFlag("ff-6", "user-1", { country: "US" });
    const eval2 = evaluateFlag("ff-6", "user-2", { country: "UK" });
    expect(eval1.enabled).toBe(true);
    expect(eval2.enabled).toBe(false);
  });
});

// ─── abTestingEngine ─────────────────────────────────────────────────────────
describe("abTestingEngine", () => {
  beforeEach(() => _resetAbTestingEngineForTest());

  it("creates experiment and exposes user to a variant", () => {
    createExperiment("exp-1", "Button Color", [
      { variantId: "control", name: "Blue", weight: 50 },
      { variantId: "treatment", name: "Green", weight: 50 },
    ]);
    const exposure = exposeUser("exp-1", "user-1");
    expect(exposure).not.toBeNull();
    expect(["control", "treatment"]).toContain(exposure?.variantId);
  });

  it("records conversion for exposed user", () => {
    createExperiment("exp-2", "CTA Test", [
      { variantId: "v1", name: "A", weight: 100 },
    ]);
    exposeUser("exp-2", "user-2");
    const conversion = recordConversion("exp-2", "user-2", "click", 1);
    expect(conversion).not.toBeNull();
    expect(conversion?.metric).toBe("click");
  });

  it("returns null conversion for unexposed user", () => {
    createExperiment("exp-3", "Test", [{ variantId: "v1", name: "A", weight: 100 }]);
    const conversion = recordConversion("exp-3", "unexposed-user", "click", 1);
    expect(conversion).toBeNull();
  });

  it("computes experiment results", () => {
    createExperiment("exp-4", "Results Test", [{ variantId: "v1", name: "A", weight: 100 }]);
    exposeUser("exp-4", "user-3");
    recordConversion("exp-4", "user-3", "purchase", 50);
    const results = getExperimentResults("exp-4");
    expect(results["v1"].exposures).toBe(1);
    expect(results["v1"].conversions).toBe(1);
    expect(results["v1"].avgValue).toBe(50);
  });

  it("returns null exposure for inactive experiment", () => {
    const exp = createExperiment("exp-5", "Inactive", [{ variantId: "v1", name: "A", weight: 100 }]);
    exp.active = false;
    const exposure = exposeUser("exp-5", "user-4");
    expect(exposure).toBeNull();
  });

  it("resets cleanly", () => {
    createExperiment("exp-6", "X", [{ variantId: "v1", name: "A", weight: 100 }]);
    _resetAbTestingEngineForTest();
    expect(getExperiment("exp-6")).toBeUndefined();
  });
});

// ─── experimentTracker ───────────────────────────────────────────────────────
describe("experimentTracker", () => {
  beforeEach(() => _resetExperimentTrackerForTest());

  it("tracks experiment lifecycle", () => {
    const record = trackExperiment("exp-1", "Button Test", "Green button increases CTR", "alice", ["ui"]);
    expect(record.status).toBe("draft");
    expect(record.owner).toBe("alice");
  });

  it("transitions status and sets startedAt", () => {
    trackExperiment("exp-2", "Test", "Hypothesis", "bob");
    updateExperimentStatus("exp-2", "running", "Launched");
    const record = getExperimentRecord("exp-2");
    expect(record?.status).toBe("running");
    expect(record?.startedAt).not.toBeNull();
  });

  it("adds notes to experiment", () => {
    trackExperiment("exp-3", "Test", "H", "charlie");
    addNote("exp-3", "Preliminary results look good");
    expect(getExperimentRecord("exp-3")?.notes.length).toBe(1);
  });

  it("returns running experiments only", () => {
    trackExperiment("exp-4", "Running", "H", "dave");
    trackExperiment("exp-5", "Draft", "H", "eve");
    updateExperimentStatus("exp-4", "running");
    const running = getRunningExperiments();
    expect(running.some(r => r.experimentId === "exp-4")).toBe(true);
    expect(running.some(r => r.experimentId === "exp-5")).toBe(false);
  });

  it("returns false for unknown experiment", () => {
    expect(updateExperimentStatus("unknown", "running")).toBe(false);
  });

  it("resets cleanly", () => {
    trackExperiment("exp-6", "X", "H", "frank");
    _resetExperimentTrackerForTest();
    expect(getExperimentRecord("exp-6")).toBeUndefined();
  });
});

// ─── canaryDeployer ──────────────────────────────────────────────────────────
describe("canaryDeployer", () => {
  beforeEach(() => _resetCanaryDeployerForTest());

  it("creates a canary deployment", () => {
    const d = createCanaryDeployment("api", "v1.0.0", "v1.1.0", 5);
    expect(d.serviceName).toBe("api");
    expect(d.canaryTrafficPercent).toBe(5);
    expect(d.status).toBe("pending");
  });

  it("activates a pending canary", () => {
    const d = createCanaryDeployment("svc", "v1", "v2");
    expect(activateCanary(d.deploymentId)).toBe(true);
    expect(getDeployment(d.deploymentId)?.status).toBe("active");
  });

  it("auto-rolls back after threshold failures", () => {
    const d = createCanaryDeployment("svc", "v1", "v2", 10, 2);
    activateCanary(d.deploymentId);
    recordHealthCheck(d.deploymentId, false);
    const { rolledBack } = recordHealthCheck(d.deploymentId, false);
    expect(rolledBack).toBe(true);
    expect(getDeployment(d.deploymentId)?.status).toBe("rolled_back");
  });

  it("promotes a healthy canary", () => {
    const d = createCanaryDeployment("svc", "v1", "v2");
    activateCanary(d.deploymentId);
    expect(promoteCanary(d.deploymentId)).toBe(true);
    expect(getDeployment(d.deploymentId)?.status).toBe("completed");
  });

  it("increases canary traffic", () => {
    const d = createCanaryDeployment("svc", "v1", "v2", 5);
    activateCanary(d.deploymentId);
    increaseCanaryTraffic(d.deploymentId, 25);
    expect(getDeployment(d.deploymentId)?.canaryTrafficPercent).toBe(25);
  });

  it("resets cleanly", () => {
    createCanaryDeployment("svc", "v1", "v2");
    _resetCanaryDeployerForTest();
    expect(getDeployment("canary-1")).toBeUndefined();
  });
});

// ─── rolloutController ───────────────────────────────────────────────────────
describe("rolloutController", () => {
  beforeEach(() => _resetRolloutControllerForTest());

  it("creates a rollout plan with stages", () => {
    const plan = createRolloutPlan("dark-mode", [
      { name: "5% rollout", targetPercent: 5, durationMinutes: 30 },
      { name: "50% rollout", targetPercent: 50, durationMinutes: 60 },
    ]);
    expect(plan.stages.length).toBe(2);
    expect(plan.featureName).toBe("dark-mode");
  });

  it("advances rollout through stages", () => {
    const plan = createRolloutPlan("feature-x", [
      { name: "Stage 1", targetPercent: 10, durationMinutes: 10 },
    ]);
    const { advanced, stage } = advanceRollout(plan.planId);
    expect(advanced).toBe(true);
    expect(stage?.status).toBe("active");
  });

  it("pauses and resumes rollout", () => {
    const plan = createRolloutPlan("feature-y", [{ name: "S1", targetPercent: 10, durationMinutes: 5 }]);
    pauseRollout(plan.planId);
    expect(getRolloutPlan(plan.planId)?.paused).toBe(true);
    resumeRollout(plan.planId);
    expect(getRolloutPlan(plan.planId)?.paused).toBe(false);
  });

  it("does not advance when paused", () => {
    const plan = createRolloutPlan("feature-z", [{ name: "S1", targetPercent: 10, durationMinutes: 5 }]);
    pauseRollout(plan.planId);
    const { advanced } = advanceRollout(plan.planId);
    expect(advanced).toBe(false);
  });

  it("resets cleanly", () => {
    const plan = createRolloutPlan("feature-w", []);
    _resetRolloutControllerForTest();
    expect(getRolloutPlan(plan.planId)).toBeUndefined();
  });
});

// ─── featureAuditLog ─────────────────────────────────────────────────────────
describe("featureAuditLog", () => {
  beforeEach(() => _resetFeatureAuditLogForTest());

  it("logs an audit entry", () => {
    const entry = logAuditEntry({ entityType: "feature_flag", entityId: "ff-1", action: "enable", actor: "alice", reason: "Launch day" });
    expect(entry.entryId).toMatch(/^audit-/);
    expect(entry.actor).toBe("alice");
    expect(entry.action).toBe("enable");
  });

  it("retrieves audit log for specific entity", () => {
    logAuditEntry({ entityType: "feature_flag", entityId: "ff-1", action: "create", actor: "bob" });
    logAuditEntry({ entityType: "feature_flag", entityId: "ff-2", action: "enable", actor: "bob" });
    expect(getAuditLogForEntity("ff-1").length).toBe(1);
  });

  it("retrieves audit log by actor", () => {
    logAuditEntry({ entityType: "experiment", entityId: "exp-1", action: "create", actor: "charlie" });
    logAuditEntry({ entityType: "experiment", entityId: "exp-2", action: "update", actor: "dave" });
    expect(getAuditLogByActor("charlie").length).toBe(1);
  });

  it("retrieves audit log by action", () => {
    logAuditEntry({ entityType: "canary", entityId: "c-1", action: "rollback", actor: "system" });
    logAuditEntry({ entityType: "canary", entityId: "c-2", action: "promote", actor: "system" });
    expect(getAuditLogByAction("rollback").length).toBe(1);
  });

  it("accumulates entries", () => {
    logAuditEntry({ entityType: "rollout", entityId: "r-1", action: "create", actor: "alice" });
    logAuditEntry({ entityType: "rollout", entityId: "r-1", action: "update", actor: "alice" });
    expect(getAuditLog().length).toBe(2);
  });

  it("resets cleanly", () => {
    logAuditEntry({ entityType: "feature_flag", entityId: "ff-1", action: "create", actor: "alice" });
    _resetFeatureAuditLogForTest();
    expect(getAuditLog().length).toBe(0);
  });
});
