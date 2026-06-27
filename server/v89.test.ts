/**
 * v89.test.ts — Autonomous Planning & Goal Management
 * Comprehensive tests for all 6 v89 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { definePrimitiveTask, defineCompoundTask, decompose, createPlan, getPlan, _resetHierarchicalPlannerForTest } from "./hierarchicalPlanner";
import { startPlanExecution, executeNextStep, abortExecution, getExecution, getCompletedSteps, _resetPlanExecutorForTest } from "./planExecutor";
import { checkStateDeviation, recordDeviation, requiresReplanning, getDeviations, getCheckpoints, _resetPlanMonitorForTest } from "./planMonitor";
import { createRevisionRequest, revisePlan, getRevisionHistory, _resetPlanReviserForTest } from "./planReviser";
import { createObjective, addKeyResult, updateKeyResult, getObjective, getObjectivesByStatus, _resetObjectiveTrackerForTest } from "./objectiveTracker";
import { createProblem, addVariable, addConstraint, solve, _resetConstraintSolverForTest } from "./constraintSolver";

// ─── hierarchicalPlanner ─────────────────────────────────────────────────────
describe("hierarchicalPlanner", () => {
  beforeEach(() => _resetHierarchicalPlannerForTest());

  it("defines and decomposes primitive tasks", () => {
    const pt = definePrimitiveTask("Fetch Data", "fetch", { url: "http://api" }, [], ["data_fetched"], 500);
    const result = decompose(pt.taskId, new Set());
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Fetch Data");
  });

  it("decomposes compound task into primitives", () => {
    const pt1 = definePrimitiveTask("Step1", "act1", {}, [], ["s1_done"], 100);
    const pt2 = definePrimitiveTask("Step2", "act2", {}, [], ["s2_done"], 200);
    defineCompoundTask("CompositeTask", [{ methodId: "m1", name: "Method1", subtasks: [pt1.taskId, pt2.taskId] }]);
    const ct = defineCompoundTask("Root", [{ methodId: "m0", name: "Main", subtasks: [pt1.taskId, pt2.taskId] }]);
    const result = decompose(ct.taskId, new Set());
    expect(result.length).toBe(2);
  });

  it("creates a plan", () => {
    const pt = definePrimitiveTask("Task", "do", {}, [], [], 1000);
    const plan = createPlan("goal-1", pt.taskId, []);
    expect(plan.planId).toMatch(/^plan-/);
    expect(plan.orderedTasks.length).toBe(1);
    expect(plan.totalEstimatedDurationMs).toBe(1000);
  });

  it("retrieves plan by ID", () => {
    const pt = definePrimitiveTask("T", "a", {}, [], [], 100);
    const plan = createPlan("g", pt.taskId, []);
    expect(getPlan(plan.planId)?.planId).toBe(plan.planId);
  });

  it("resets cleanly", () => {
    definePrimitiveTask("X", "x", {}, [], []);
    _resetHierarchicalPlannerForTest();
    expect(decompose("pt-1", new Set()).length).toBe(0);
  });
});

// ─── planExecutor ────────────────────────────────────────────────────────────
describe("planExecutor", () => {
  beforeEach(() => _resetPlanExecutorForTest());

  it("starts plan execution", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "Task1", action: "act1", preconditions: [], effects: ["done"] }], []);
    expect(exec.executionId).toMatch(/^exec-/);
    expect(exec.status).toBe("executing");
  });

  it("executes a step successfully", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "Task1", action: "act1", preconditions: [], effects: ["done"] }], []);
    const step = executeNextStep(exec.executionId, [], ["done"]);
    expect(step?.status).toBe("completed");
    expect(exec.worldState.has("done")).toBe(true);
  });

  it("fails when preconditions not met", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "Task1", action: "act1", preconditions: ["required_state"], effects: [] }], []);
    const step = executeNextStep(exec.executionId, ["required_state"], []);
    expect(step?.status).toBe("failed");
    expect(exec.status).toBe("failed");
  });

  it("completes when all steps done", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "T1", action: "a1", preconditions: [], effects: [] }], []);
    executeNextStep(exec.executionId, [], []);
    expect(exec.status).toBe("completed");
  });

  it("aborts execution", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "T1", action: "a1", preconditions: [], effects: [] }], []);
    abortExecution(exec.executionId, "User cancelled");
    expect(exec.status).toBe("aborted");
  });

  it("tracks completed steps", () => {
    const exec = startPlanExecution("plan-1", [{ taskId: "t1", name: "T1", action: "a1", preconditions: [], effects: [] }], []);
    executeNextStep(exec.executionId, [], []);
    expect(getCompletedSteps(exec.executionId).length).toBe(1);
  });
});

// ─── planMonitor ─────────────────────────────────────────────────────────────
describe("planMonitor", () => {
  beforeEach(() => _resetPlanMonitorForTest());

  it("checks state deviation — match", () => {
    const cp = checkStateDeviation("exec-1", 0, ["state_a", "state_b"], ["state_a", "state_b", "state_c"]);
    expect(cp.stateMatch).toBe(true);
  });

  it("checks state deviation — mismatch", () => {
    const cp = checkStateDeviation("exec-1", 1, ["state_a", "state_b"], ["state_a"]);
    expect(cp.stateMatch).toBe(false);
    expect(requiresReplanning("exec-1")).toBe(true);
  });

  it("records deviations", () => {
    recordDeviation("exec-2", "timeout", "Timed out after 5s", "high", true);
    const devs = getDeviations("exec-2");
    expect(devs.length).toBe(1);
    expect(devs[0].type).toBe("timeout");
  });

  it("requiresReplanning returns false when no deviations", () => {
    expect(requiresReplanning("exec-3")).toBe(false);
  });

  it("retrieves checkpoints", () => {
    checkStateDeviation("exec-4", 0, [], []);
    expect(getCheckpoints("exec-4").length).toBe(1);
  });

  it("resets cleanly", () => {
    recordDeviation("e", "timeout", "t", "low", false);
    _resetPlanMonitorForTest();
    expect(getDeviations().length).toBe(0);
  });
});

// ─── planReviser ─────────────────────────────────────────────────────────────
describe("planReviser", () => {
  beforeEach(() => _resetPlanReviserForTest());

  it("revises plan by skipping failed step", () => {
    const req = createRevisionRequest("plan-1", "exec-1", "precondition_failure", [], 2, "skip_failed");
    const revised = revisePlan(req);
    expect(revised.revisedPlanId).toMatch(/^rp-/);
    expect(revised.removedSteps).toContain("step-2");
  });

  it("revises plan with partial replan", () => {
    const req = createRevisionRequest("plan-1", "exec-1", "unexpected_state", [], 1, "partial_replan");
    const revised = revisePlan(req, ["alt-step-1", "alt-step-2"]);
    expect(revised.addedSteps.length).toBeGreaterThan(0);
  });

  it("revises plan with fallback", () => {
    const req = createRevisionRequest("plan-1", "exec-1", "goal_drift", [], 0, "fallback_plan");
    const revised = revisePlan(req, ["fallback-1", "fallback-2"]);
    expect(revised.addedSteps).toContain("fallback-1");
  });

  it("tracks revision history", () => {
    const req = createRevisionRequest("plan-2", "exec-2", "timeout", [], 0, "replan_from_scratch");
    revisePlan(req);
    expect(getRevisionHistory("plan-2").length).toBe(1);
  });

  it("resets cleanly", () => {
    const req = createRevisionRequest("p", "e", "t", [], 0, "skip_failed");
    revisePlan(req);
    _resetPlanReviserForTest();
    expect(getRevisionHistory().length).toBe(0);
  });
});

// ─── objectiveTracker ────────────────────────────────────────────────────────
describe("objectiveTracker", () => {
  beforeEach(() => _resetObjectiveTrackerForTest());

  it("creates an objective", () => {
    const obj = createObjective("Improve Performance", "Reduce latency by 50%", Date.now() + 86400000);
    expect(obj.objectiveId).toMatch(/^obj-/);
    expect(obj.status).toBe("not_started");
  });

  it("adds and updates key results", () => {
    const obj = createObjective("Goal", "Description", Date.now() + 86400000);
    const kr = addKeyResult(obj.objectiveId, "Reduce p99 latency", 100, "ms");
    expect(kr).not.toBeNull();
    updateKeyResult(obj.objectiveId, kr!.krId, 50);
    expect(getObjective(obj.objectiveId)?.keyResults[0].progress).toBeCloseTo(0.5, 2);
  });

  it("marks objective completed when all KRs done", () => {
    const obj = createObjective("Complete", "All done", Date.now() + 86400000);
    const kr = addKeyResult(obj.objectiveId, "KR1", 10, "units");
    updateKeyResult(obj.objectiveId, kr!.krId, 10);
    expect(getObjective(obj.objectiveId)?.status).toBe("completed");
  });

  it("filters objectives by status", () => {
    const obj = createObjective("Active", "desc", Date.now() + 86400000);
    const kr = addKeyResult(obj.objectiveId, "KR", 10, "x");
    updateKeyResult(obj.objectiveId, kr!.krId, 5);
    expect(getObjectivesByStatus("in_progress").length).toBeGreaterThan(0);
  });

  it("resets cleanly", () => {
    createObjective("X", "y", Date.now());
    _resetObjectiveTrackerForTest();
    expect(getObjective("obj-1")).toBeUndefined();
  });
});

// ─── constraintSolver ────────────────────────────────────────────────────────
describe("constraintSolver", () => {
  beforeEach(() => _resetConstraintSolverForTest());

  it("solves a simple equality constraint", () => {
    const p = createProblem();
    addVariable(p.problemId, "x", [1, 2, 3]);
    addVariable(p.problemId, "y", [1, 2, 3]);
    addConstraint(p.problemId, "equality", ["x", "y"]);
    const sol = solve(p.problemId);
    expect(sol.solvable).toBe(true);
    expect(sol.assignments["x"]).toBe(sol.assignments["y"]);
  });

  it("solves an inequality constraint", () => {
    const p = createProblem();
    addVariable(p.problemId, "a", [1, 2]);
    addVariable(p.problemId, "b", [1, 2]);
    addConstraint(p.problemId, "inequality", ["a", "b"]);
    const sol = solve(p.problemId);
    expect(sol.solvable).toBe(true);
    expect(sol.assignments["a"]).not.toBe(sol.assignments["b"]);
  });

  it("detects unsolvable problem", () => {
    const p = createProblem();
    addVariable(p.problemId, "x", [1]);
    addVariable(p.problemId, "y", [1]);
    addConstraint(p.problemId, "inequality", ["x", "y"]);
    const sol = solve(p.problemId);
    expect(sol.solvable).toBe(false);
  });

  it("solves range constraint", () => {
    const p = createProblem();
    addVariable(p.problemId, "temp", [10, 20, 30, 40]);
    addConstraint(p.problemId, "range", ["temp"], { min: 15, max: 35 });
    const sol = solve(p.problemId);
    expect(sol.solvable).toBe(true);
    expect(Number(sol.assignments["temp"])).toBeGreaterThanOrEqual(15);
  });

  it("solves all_different constraint", () => {
    const p = createProblem();
    addVariable(p.problemId, "v1", [1, 2, 3]);
    addVariable(p.problemId, "v2", [1, 2, 3]);
    addVariable(p.problemId, "v3", [1, 2, 3]);
    addConstraint(p.problemId, "all_different", ["v1", "v2", "v3"]);
    const sol = solve(p.problemId);
    expect(sol.solvable).toBe(true);
    const vals = [sol.assignments["v1"], sol.assignments["v2"], sol.assignments["v3"]];
    expect(new Set(vals).size).toBe(3);
  });

  it("resets cleanly", () => {
    createProblem();
    _resetConstraintSolverForTest();
    expect(solve("csp-1").solvable).toBe(false);
  });
});
