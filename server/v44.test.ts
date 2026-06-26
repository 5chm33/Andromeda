import { describe, it, expect } from "vitest";

import {
  registerAction, planToGoal, getPlannerReport, initActionSpacePlanner,
} from "./actionSpacePlanner";

import {
  addSensorReading, fuseSensorReadings, getFusionReport, initSensorFusionEngine,
} from "./sensorFusionEngine";

import {
  learnMotorSkill, executeMotorSkill, getSkillLibraryReport, initMotorSkillLibrary,
} from "./motorSkillLibrary";

import {
  addWorldObject, updateWorldObject, captureWorldState, queryWorldObjects, getEnvironmentReport, initEnvironmentModeler,
} from "./environmentModeler";

import {
  decomposeEmbodiedTask, getEmbodiedDecomposerReport, initTaskDecomposerV44,
} from "./taskDecomposerV44";

import {
  startPlanExecution, recordExecutionStep, getPlanStatus, getExecutionReport, initExecutionMonitor,
} from "./executionMonitor";

describe("v44 Embodied Planner Enhancements", () => {

  // ─── Action Space Planner ─────────────────────────────────────────────────────
  describe("Action Space Planner", () => {
    it("should initialize without errors", () => {
      expect(() => initActionSpacePlanner()).not.toThrow();
    });

    it("should register an action", () => {
      const action = registerAction("fetch_data", [], ["data_available"], 1.0, 500);
      expect(action.id).toBeTruthy();
      expect(action.name).toBe("fetch_data");
    });

    it("should plan to a reachable goal", () => {
      registerAction("preprocess", ["data_available"], ["data_clean"], 0.5, 200);
      registerAction("train", ["data_clean"], ["model_trained"], 2.0, 5000);
      const plan = planToGoal("model_trained", ["data_available"]);
      expect(plan.feasible).toBe(true);
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it("should return infeasible plan for unreachable goal", () => {
      const plan = planToGoal("impossible_goal_xyz", []);
      expect(plan.feasible).toBe(false);
    });

    it("should compute total cost and duration", () => {
      const plan = planToGoal("model_trained", ["data_available"]);
      if (plan.feasible) {
        expect(plan.totalCost).toBeGreaterThan(0);
        expect(plan.totalDuration).toBeGreaterThan(0);
      }
    });

    it("should return planner report", () => {
      const report = getPlannerReport();
      expect(typeof report.totalPlans).toBe("number");
      expect(typeof report.feasiblePlans).toBe("number");
    });
  });

  // ─── Sensor Fusion Engine ─────────────────────────────────────────────────────
  describe("Sensor Fusion Engine", () => {
    it("should initialize without errors", () => {
      expect(() => initSensorFusionEngine()).not.toThrow();
    });

    it("should add sensor readings", () => {
      const reading = addSensorReading("camera1", "vision", [0.8, 0.2, 0.5], 0.9);
      expect(reading.sensorId).toBe("camera1");
      expect(reading.modality).toBe("vision");
    });

    it("should fuse multiple sensor readings", () => {
      addSensorReading("sensor_a", "numeric", [1.0, 2.0, 3.0], 0.8);
      addSensorReading("sensor_b", "numeric", [1.2, 1.8, 3.2], 0.7);
      const fused = fuseSensorReadings(["sensor_a", "sensor_b"]);
      expect(fused.fusedValue.length).toBeGreaterThan(0);
      expect(fused.confidence).toBeGreaterThan(0);
    });

    it("should weight by confidence", () => {
      addSensorReading("high_conf", "numeric", [10.0], 0.95);
      addSensorReading("low_conf", "numeric", [0.0], 0.05);
      const fused = fuseSensorReadings(["high_conf", "low_conf"]);
      // High confidence sensor should dominate
      expect(fused.fusedValue[0]!).toBeGreaterThan(5.0);
    });

    it("should return fusion report", () => {
      const report = getFusionReport();
      expect(typeof report.totalReadings).toBe("number");
      expect(Array.isArray(report.modalityCoverage)).toBe(true);
    });
  });

  // ─── Motor Skill Library ──────────────────────────────────────────────────────
  describe("Motor Skill Library", () => {
    it("should initialize without errors", () => {
      expect(() => initMotorSkillLibrary()).not.toThrow();
    });

    it("should learn a motor skill", () => {
      const skill = learnMotorSkill("grasp", "manipulation", { force: 0.5, speed: 0.3 });
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBe("grasp");
    });

    it("should execute a skill with matching parameters", () => {
      const skill = learnMotorSkill("reach", "manipulation", { distance: 0.5, angle: 45 });
      const result = executeMotorSkill(skill.id, { distance: 0.5, angle: 45 });
      expect(result.skillId).toBe(skill.id);
      expect(typeof result.success).toBe("boolean");
    });

    it("should return false for unknown skill", () => {
      const result = executeMotorSkill("non-existent-skill", {});
      expect(result.success).toBe(false);
    });

    it("should update execution count", () => {
      const skill = learnMotorSkill("push", "manipulation", { force: 0.3 });
      executeMotorSkill(skill.id, { force: 0.3 });
      executeMotorSkill(skill.id, { force: 0.3 });
      const report = getSkillLibraryReport();
      expect(report.totalExecutions).toBeGreaterThan(0);
    });

    it("should return skill library report", () => {
      const report = getSkillLibraryReport();
      expect(typeof report.totalSkills).toBe("number");
      expect(typeof report.avgSuccessRate).toBe("number");
    });
  });

  // ─── Environment Modeler ──────────────────────────────────────────────────────
  describe("Environment Modeler", () => {
    it("should initialize without errors", () => {
      expect(() => initEnvironmentModeler()).not.toThrow();
    });

    it("should add world objects", () => {
      const obj = addWorldObject("robot", { battery: 0.8, active: true }, { x: 0, y: 0, z: 0 });
      expect(obj.id).toBeTruthy();
      expect(obj.type).toBe("robot");
    });

    it("should update world objects", () => {
      const obj = addWorldObject("sensor", { reading: 0.5 }, { x: 1, y: 1, z: 0 });
      const updated = updateWorldObject(obj.id, { properties: { reading: 0.9 } });
      expect(updated).toBe(true);
    });

    it("should capture world state", () => {
      addWorldObject("obstacle", { height: 1.5 }, { x: 5, y: 5, z: 0 });
      const state = captureWorldState();
      expect(state.objects.length).toBeGreaterThan(0);
      expect(state.confidence).toBeGreaterThan(0);
    });

    it("should query objects by type", () => {
      addWorldObject("target", { value: 100 }, { x: 10, y: 0, z: 0 });
      const targets = queryWorldObjects("target");
      expect(targets.length).toBeGreaterThan(0);
    });

    it("should return environment report", () => {
      const report = getEnvironmentReport();
      expect(typeof report.totalObjects).toBe("number");
      expect(typeof report.visibleObjects).toBe("number");
    });
  });

  // ─── Task Decomposer V44 ──────────────────────────────────────────────────────
  describe("Task Decomposer V44 (Embodied)", () => {
    it("should initialize without errors", () => {
      expect(() => initTaskDecomposerV44()).not.toThrow();
    });

    it("should decompose a task into subtasks", () => {
      const result = decomposeEmbodiedTask("Navigate to target", [
        { name: "localize", description: "Determine current position", durationMs: 100, deps: [] },
        { name: "plan_path", description: "Plan path to target", durationMs: 200, deps: [] },
        { name: "execute_motion", description: "Execute movement", durationMs: 500, deps: ["localize", "plan_path"] },
      ]);
      expect(result.subtasks.length).toBe(3);
      expect(result.originalTask).toBe("Navigate to target");
    });

    it("should identify parallelizable tasks", () => {
      const result = decomposeEmbodiedTask("Parallel task", [
        { name: "task_a", description: "Independent A", durationMs: 100, deps: [] },
        { name: "task_b", description: "Independent B", durationMs: 150, deps: [] },
      ]);
      expect(result.parallelizable).toBe(true);
    });

    it("should compute shorter duration for parallel tasks", () => {
      const result = decomposeEmbodiedTask("Parallel compute", [
        { name: "a", description: "A", durationMs: 100, deps: [] },
        { name: "b", description: "B", durationMs: 200, deps: [] },
      ]);
      expect(result.estimatedTotalMs).toBe(200); // max, not sum
    });

    it("should return decomposer report", () => {
      const report = getEmbodiedDecomposerReport();
      expect(typeof report.totalDecompositions).toBe("number");
      expect(typeof report.parallelizableRate).toBe("number");
    });
  });

  // ─── Execution Monitor ────────────────────────────────────────────────────────
  describe("Execution Monitor", () => {
    it("should initialize without errors", () => {
      expect(() => initExecutionMonitor()).not.toThrow();
    });

    it("should start plan execution", () => {
      const status = startPlanExecution("plan-1", 5);
      expect(status.planId).toBe("plan-1");
      expect(status.totalSteps).toBe(5);
      expect(status.completedSteps).toBe(0);
    });

    it("should record a successful step", () => {
      startPlanExecution("plan-2", 3);
      const trace = recordExecutionStep("plan-2", "step1", 100, 95, "success", "success");
      expect(trace.status).toBe("success");
      expect(trace.deviation).toBeLessThan(0.2);
    });

    it("should detect deviation on outcome mismatch", () => {
      startPlanExecution("plan-3", 3);
      const trace = recordExecutionStep("plan-3", "step1", 100, 100, "success", "failure");
      expect(trace.status).not.toBe("success");
      expect(trace.deviation).toBeGreaterThan(0.5);
    });

    it("should update plan status after steps", () => {
      startPlanExecution("plan-4", 2);
      recordExecutionStep("plan-4", "step1", 100, 100, "done", "done");
      const status = getPlanStatus("plan-4");
      expect(status?.completedSteps).toBe(1);
    });

    it("should return execution report", () => {
      const report = getExecutionReport();
      expect(typeof report.totalTraces).toBe("number");
      expect(typeof report.successRate).toBe("number");
    });
  });
});
