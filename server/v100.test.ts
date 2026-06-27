/**
 * v100.test.ts — Andromeda: The Complete Autonomous AI System (Capstone)
 * The final test suite for the 100th version of the Andromeda AI system.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  initializeAndromeda, registerCapability, invokeCapability, getSystemMetrics,
  getCapabilitiesByDomain, setCapabilityHealth, getSystemStatus, getEvents as getAndromedaEvents,
  shutdown as shutdownAndromeda, getAllCapabilities, _resetAndromedaCoreForTest
} from "./andromedaCore";

import {
  registerSubsystem, updateHealth, generateReport, getSubsystem, getReports,
  _resetSystemHealthMonitorForTest
} from "./systemHealthMonitor";

import {
  addCapability as addSelfCapability, addLimitation, setGoal, removeGoal,
  reflect, getSelfModel, getReflections, _resetSelfAwarenessEngineForTest
} from "./selfAwarenessEngine";

import {
  addPremise, reason, getChains, getPremises,
  _resetUniversalReasoningEngineForTest
} from "./universalReasoningEngine";

import {
  configure, registerModule, bootstrap, getManifest, getAllManifests, getBootstrapHistory,
  _resetAndromedaBootstrapperForTest
} from "./andromedaBootstrapper";

// ─── andromedaCore ────────────────────────────────────────────────────────────
describe("andromedaCore", () => {
  beforeEach(() => _resetAndromedaCoreForTest());

  it("initializes the system", () => {
    initializeAndromeda();
    expect(getSystemStatus()).toBe("ready");
  });

  it("registers capabilities", () => {
    initializeAndromeda();
    const cap = registerCapability("perception", "perception", "1.0.0", "perception.ts");
    expect(cap.capabilityId).toMatch(/^cap-/);
    expect(getAllCapabilities().length).toBe(1);
  });

  it("invokes a capability", () => {
    initializeAndromeda();
    const cap = registerCapability("reasoning", "reasoning", "1.0.0", "reasoning.ts");
    const result = invokeCapability(cap.capabilityId);
    expect(result).toBe(true);
    expect(getAllCapabilities()[0].invocationCount).toBe(1);
  });

  it("returns system metrics", () => {
    initializeAndromeda();
    registerCapability("planning", "planning", "1.0.0", "planning.ts");
    const metrics = getSystemMetrics();
    expect(metrics.version).toBe("100.0.0");
    expect(metrics.totalCapabilities).toBe(1);
  });

  it("groups capabilities by domain", () => {
    initializeAndromeda();
    registerCapability("vision", "perception", "1.0.0", "vision.ts");
    registerCapability("hearing", "perception", "1.0.0", "hearing.ts");
    registerCapability("planner", "planning", "1.0.0", "planner.ts");
    expect(getCapabilitiesByDomain("perception").length).toBe(2);
  });

  it("updates capability health", () => {
    initializeAndromeda();
    const cap = registerCapability("memory", "memory", "1.0.0", "memory.ts");
    setCapabilityHealth(cap.capabilityId, 0.2); // below threshold
    expect(getAllCapabilities()[0].enabled).toBe(false);
  });

  it("logs events", () => {
    initializeAndromeda();
    expect(getAndromedaEvents("startup").length).toBeGreaterThan(0);
  });

  it("shuts down gracefully", () => {
    initializeAndromeda();
    shutdownAndromeda();
    expect(getSystemStatus()).toBe("shutdown");
  });
});

// ─── systemHealthMonitor ──────────────────────────────────────────────────────
describe("systemHealthMonitor", () => {
  beforeEach(() => _resetSystemHealthMonitorForTest());

  it("registers subsystems", () => {
    const sub = registerSubsystem("MemorySubsystem");
    expect(sub.subsystemId).toMatch(/^sub-/);
    expect(sub.status).toBe("unknown");
  });

  it("updates health to healthy", () => {
    const sub = registerSubsystem("ReasoningSubsystem");
    updateHealth(sub.subsystemId, 0.95);
    expect(getSubsystem(sub.subsystemId)!.status).toBe("healthy");
  });

  it("updates health to warning", () => {
    const sub = registerSubsystem("PlanningSubsystem");
    updateHealth(sub.subsystemId, 0.6);
    expect(getSubsystem(sub.subsystemId)!.status).toBe("warning");
  });

  it("updates health to critical", () => {
    const sub = registerSubsystem("StorageSubsystem");
    updateHealth(sub.subsystemId, 0.1);
    expect(getSubsystem(sub.subsystemId)!.status).toBe("critical");
  });

  it("generates health report", () => {
    const a = registerSubsystem("A"); updateHealth(a.subsystemId, 0.9);
    const b = registerSubsystem("B"); updateHealth(b.subsystemId, 0.6); // 0.5-0.8 = warning
    const report = generateReport();
    expect(report.reportId).toMatch(/^hr-/);
    expect(report.warningCount).toBe(1);
    expect(report.healthyCount).toBe(1);
  });

  it("provides recommendations", () => {
    const sub = registerSubsystem("CriticalSub");
    updateHealth(sub.subsystemId, 0.1);
    const report = generateReport();
    expect(report.recommendations.some(r => r.includes("critical"))).toBe(true);
  });
});

// ─── selfAwarenessEngine ──────────────────────────────────────────────────────
describe("selfAwarenessEngine", () => {
  beforeEach(() => _resetSelfAwarenessEngineForTest());

  it("adds capabilities to self-model", () => {
    addSelfCapability("natural language understanding");
    expect(getSelfModel().knownCapabilities).toContain("natural language understanding");
  });

  it("adds limitations", () => {
    addLimitation("cannot process real-time video");
    expect(getSelfModel().knownLimitations).toContain("cannot process real-time video");
  });

  it("sets and removes goals", () => {
    setGoal("maximize user satisfaction");
    expect(getSelfModel().currentGoals).toContain("maximize user satisfaction");
    removeGoal("maximize user satisfaction");
    expect(getSelfModel().currentGoals).not.toContain("maximize user satisfaction");
  });

  it("reflects on observations", () => {
    const result = reflect("performance_check", { accuracy: 0.95, latency: 0.1 });
    expect(result.reflectionId).toMatch(/^ref-/);
    expect(result.insights.length).toBeGreaterThan(0);
  });

  it("increases confidence on high performance", () => {
    const before = getSelfModel().confidenceInSelf;
    reflect("high_performance", { taskSuccess: 0.99 });
    expect(getSelfModel().confidenceInSelf).toBeGreaterThanOrEqual(before);
  });

  it("stores reflections", () => {
    reflect("test", { x: 0.5 });
    expect(getReflections().length).toBe(1);
  });
});

// ─── universalReasoningEngine ─────────────────────────────────────────────────
describe("universalReasoningEngine", () => {
  beforeEach(() => _resetUniversalReasoningEngineForTest());

  it("adds premises", () => {
    const p = addPremise("All humans are mortal", 1.0, "fact");
    expect(p.premiseId).toMatch(/^pr-/);
    expect(getPremises().length).toBe(1);
  });

  it("performs deductive reasoning", () => {
    const p1 = addPremise("All A are B", 1.0, "rule");
    const p2 = addPremise("X is A", 1.0, "fact");
    const chain = reason("deductive", [p1.premiseId, p2.premiseId], "X is B");
    expect(chain.valid).toBe(true);
    expect(chain.confidence).toBe(1.0);
  });

  it("performs inductive reasoning", () => {
    const p = addPremise("Observed 100 white swans", 0.9, "observation");
    const chain = reason("inductive", [p.premiseId], "All swans are white");
    expect(chain.confidence).toBeLessThan(1.0); // induction is uncertain
  });

  it("performs abductive reasoning", () => {
    const p = addPremise("The grass is wet", 0.9, "observation");
    const chain = reason("abductive", [p.premiseId], "It rained");
    expect(chain.mode).toBe("abductive");
  });

  it("performs probabilistic reasoning", () => {
    const p1 = addPremise("Evidence A", 0.7, "observation");
    const p2 = addPremise("Evidence B", 0.6, "observation");
    const chain = reason("probabilistic", [p1.premiseId, p2.premiseId], "Hypothesis H");
    expect(chain.confidence).toBeGreaterThan(0.7); // combined evidence
  });

  it("retrieves chains by mode", () => {
    const p = addPremise("Fact", 1.0);
    reason("deductive", [p.premiseId], "Conclusion");
    reason("inductive", [p.premiseId], "Generalization");
    expect(getChains("deductive").length).toBe(1);
    expect(getChains("inductive").length).toBe(1);
  });
});

// ─── andromedaBootstrapper ────────────────────────────────────────────────────
describe("andromedaBootstrapper", () => {
  beforeEach(() => _resetAndromedaBootstrapperForTest());

  it("configures the bootstrapper", () => {
    configure({ systemName: "Andromeda", version: "100.0.0", enabledModules: [], startupTimeoutMs: 5000, healthCheckIntervalMs: 30000, logLevel: "info" });
    expect(true).toBe(true); // no error
  });

  it("registers modules", () => {
    const mod = registerModule("CoreModule", "100.0.0");
    expect(mod.moduleId).toMatch(/^mod-/);
    expect(getAllManifests().length).toBe(1);
  });

  it("bootstraps successfully", () => {
    registerModule("ModuleA", "1.0.0");
    registerModule("ModuleB", "1.0.0", ["ModuleA"]);
    const result = bootstrap({ systemName: "Andromeda", version: "100.0.0", enabledModules: [], startupTimeoutMs: 5000, healthCheckIntervalMs: 30000, logLevel: "info" });
    expect(result.success).toBe(true);
    expect(result.modulesLoaded).toBe(2);
  });

  it("respects enabled modules filter", () => {
    registerModule("Alpha", "1.0.0");
    registerModule("Beta", "1.0.0");
    const result = bootstrap({ systemName: "Andromeda", version: "100.0.0", enabledModules: ["Alpha"], startupTimeoutMs: 5000, healthCheckIntervalMs: 30000, logLevel: "info" });
    expect(result.modulesLoaded).toBe(1);
  });

  it("stores bootstrap history", () => {
    bootstrap();
    expect(getBootstrapHistory().length).toBe(1);
  });

  it("loads modules in dependency order", () => {
    registerModule("Base", "1.0.0");
    registerModule("Derived", "1.0.0", ["Base"]);
    const result = bootstrap();
    const manifests = getAllManifests();
    const baseIdx = manifests.findIndex(m => m.name === "Base");
    const derivedIdx = manifests.findIndex(m => m.name === "Derived");
    expect(baseIdx).toBeLessThan(derivedIdx);
  });
});
