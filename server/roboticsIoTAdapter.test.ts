/**
 * roboticsIoTAdapter.test.ts — v1.0.0
 */
import { describe, it, expect } from "vitest";
import {
  registerRoboticsArtifact,
  evaluateRoboticsProposal,
  approveRoboticsProposal,
  getRoboticsStats,
  initRoboticsIoTAdapter,
} from "./roboticsIoTAdapter.js";

describe("roboticsIoTAdapter", () => {
  it("module loads without throwing", () => {
    expect(registerRoboticsArtifact).toBeDefined();
    expect(evaluateRoboticsProposal).toBeDefined();
    expect(approveRoboticsProposal).toBeDefined();
    expect(getRoboticsStats).toBeDefined();
    expect(initRoboticsIoTAdapter).toBeDefined();
  });

  it("initRoboticsIoTAdapter does not throw", () => {
    expect(() => initRoboticsIoTAdapter()).not.toThrow();
  });

  it("registerRoboticsArtifact creates a valid artifact", () => {
    const artifact = registerRoboticsArtifact(
      "iot_config",
      "Temperature Sensor",
      '{ "poll_interval": 60, "report_threshold": 0.5 }',
      { deviceId: "sensor-001" }
    );
    expect(artifact).toBeDefined();
    expect(artifact.id).toBeTruthy();
    expect(artifact.type).toBe("iot_config");
    expect(artifact.name).toBe("Temperature Sensor");
    expect(artifact.content).toContain("poll_interval");
    expect(typeof artifact.createdAt).toBe("number");
  });

  it("registerRoboticsArtifact supports all artifact types", () => {
    const types = ["ros_node", "gcode", "iot_config", "smart_home_rule", "plc_ladder", "energy_schedule"] as const;
    for (const type of types) {
      const artifact = registerRoboticsArtifact(type, `Test ${type}`, "content", {});
      expect(artifact.type).toBe(type);
    }
  });

  it("getRoboticsStats returns valid stats object", () => {
    const stats = getRoboticsStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalArtifacts).toBe("number");
    expect(typeof stats.totalProposals).toBe("number");
    expect(typeof stats.approvedProposals).toBe("number");
    expect(typeof stats.pendingProposals).toBe("number");
    expect(typeof stats.estimatedEnergySavingsKwhPerDay).toBe("number");
    expect(stats.artifactsByType).toBeDefined();
    expect(typeof stats.artifactsByType.iot_config).toBe("number");
  });

  it("evaluateRoboticsProposal returns null for unknown proposal", () => {
    const result = evaluateRoboticsProposal("nonexistent-proposal-id");
    expect(result).toBeNull();
  });

  it("approveRoboticsProposal returns false for unknown proposal", () => {
    const result = approveRoboticsProposal("nonexistent-proposal-id");
    expect(result).toBe(false);
  });

  it("getRoboticsStats reflects registered artifacts", () => {
    const before = getRoboticsStats().totalArtifacts;
    registerRoboticsArtifact("energy_schedule", "HVAC Schedule", "schedule data", {});
    const after = getRoboticsStats().totalArtifacts;
    expect(after).toBe(before + 1);
  });
});
