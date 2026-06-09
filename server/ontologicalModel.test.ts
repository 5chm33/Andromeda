import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `ontological-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ontologicalModel", () => {
  describe("loadSelfModel / saveSelfModel", () => {
    it("creates a default self-model on first load", async () => {
      const { loadSelfModel } = await import("./ontologicalModel.js");
      const model = loadSelfModel();

      expect(model.instanceId).toMatch(/^andromeda-/);
      expect(model.version).toBe("10.0.0");
      expect(model.capabilities.length).toBeGreaterThan(0);
      expect(model.knowledgeDomains.length).toBeGreaterThan(0);
      expect(model.totalTasks).toBe(0);
      expect(model.successRate).toBe(1.0);
      expect(model.intelligenceScore).toBeGreaterThan(0);
    });

    it("persists and reloads the model", async () => {
      const { loadSelfModel, saveSelfModel } = await import("./ontologicalModel.js");
      const model = loadSelfModel();
      model.totalTasks = 42;
      saveSelfModel(model);

      const reloaded = loadSelfModel();
      expect(reloaded.totalTasks).toBe(42);
      expect(reloaded.instanceId).toBe(model.instanceId);
    });

    it("generates a consistent instanceId across loads", async () => {
      const { loadSelfModel } = await import("./ontologicalModel.js");
      const m1 = loadSelfModel();
      const m2 = loadSelfModel();
      expect(m1.instanceId).toBe(m2.instanceId);
    });
  });

  describe("registerCapability", () => {
    it("adds a new capability to the model", async () => {
      const { registerCapability, loadSelfModel } = await import("./ontologicalModel.js");
      registerCapability({
        name: "image_analysis",
        description: "Analyze images using VLM",
        confidence: 0.7,
        tags: ["vision", "image", "vlm"],
      });

      const model = loadSelfModel();
      const cap = model.capabilities.find((c) => c.name === "image_analysis");
      expect(cap).toBeDefined();
      expect(cap!.confidence).toBe(0.7);
      expect(cap!.tags).toContain("vision");
      expect(cap!.successCount).toBe(0);
      expect(cap!.failureCount).toBe(0);
    });

    it("updates an existing capability on re-registration", async () => {
      const { registerCapability, loadSelfModel } = await import("./ontologicalModel.js");
      registerCapability({ name: "code_generation", description: "Updated desc", confidence: 0.95, tags: ["code"] });

      const model = loadSelfModel();
      const cap = model.capabilities.find((c) => c.name === "code_generation");
      expect(cap!.description).toBe("Updated desc");
      expect(cap!.confidence).toBe(0.95);
    });
  });

  describe("updateCapabilityOutcome", () => {
    it("increases confidence on success", async () => {
      const { loadSelfModel, updateCapabilityOutcome } = await import("./ontologicalModel.js");
      const before = loadSelfModel().capabilities.find((c) => c.name === "code_generation")!.confidence;
      updateCapabilityOutcome("code_generation", true);
      const after = loadSelfModel().capabilities.find((c) => c.name === "code_generation")!.confidence;
      expect(after).toBeGreaterThan(before);
    });

    it("decreases confidence on failure", async () => {
      const { loadSelfModel, updateCapabilityOutcome } = await import("./ontologicalModel.js");
      const before = loadSelfModel().capabilities.find((c) => c.name === "code_generation")!.confidence;
      updateCapabilityOutcome("code_generation", false);
      const after = loadSelfModel().capabilities.find((c) => c.name === "code_generation")!.confidence;
      expect(after).toBeLessThan(before);
    });

    it("increments successCount on success", async () => {
      const { loadSelfModel, updateCapabilityOutcome } = await import("./ontologicalModel.js");
      updateCapabilityOutcome("text_analysis", true);
      const cap = loadSelfModel().capabilities.find((c) => c.name === "text_analysis")!;
      expect(cap.successCount).toBe(1);
    });

    it("increments failureCount on failure", async () => {
      const { loadSelfModel, updateCapabilityOutcome } = await import("./ontologicalModel.js");
      updateCapabilityOutcome("text_analysis", false);
      const cap = loadSelfModel().capabilities.find((c) => c.name === "text_analysis")!;
      expect(cap.failureCount).toBe(1);
    });

    it("does nothing for unknown capability", async () => {
      const { updateCapabilityOutcome } = await import("./ontologicalModel.js");
      // Should not throw
      expect(() => updateCapabilityOutcome("nonexistent_cap", true)).not.toThrow();
    });
  });

  describe("extractTaskContext", () => {
    it("extracts code-related context from a code task", async () => {
      const { extractTaskContext } = await import("./ontologicalModel.js");
      const ctx = extractTaskContext("Write a TypeScript function to parse JSON");
      expect(ctx.requiresCodeExecution).toBe(true);
      expect(ctx.keywords).toContain("write");
      expect(ctx.complexity).toBeGreaterThan(0);
    });

    it("extracts data-related context from a search task", async () => {
      const { extractTaskContext } = await import("./ontologicalModel.js");
      const ctx = extractTaskContext("Search and retrieve the latest stock prices from the API");
      expect(ctx.requiresRealTimeData).toBe(true);
      expect(ctx.requiresExternalApi).toBe(true);
    });

    it("detects urgency from keywords", async () => {
      const { extractTaskContext } = await import("./ontologicalModel.js");
      const ctx = extractTaskContext("Immediately fix the production bug");
      expect(ctx.urgency).toBeGreaterThan(0.5);
    });

    it("detects high complexity from keywords", async () => {
      const { extractTaskContext } = await import("./ontologicalModel.js");
      const ctx = extractTaskContext("Build a comprehensive advanced code analysis system");
      expect(ctx.complexity).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe("routeTask", () => {
    it("returns a routing decision with a valid action", async () => {
      const { routeTask } = await import("./ontologicalModel.js");
      const decision = routeTask("Write a function to calculate fibonacci numbers");

      expect(["answer_directly", "write_tool", "train_lora", "delegate_swarm", "gather_data", "request_human"])
        .toContain(decision.selectedAction);
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.reasoning).toBeTruthy();
      expect(decision.alternativeActions.length).toBeGreaterThan(0);
      expect(decision.timestamp).toBeGreaterThan(0);
    });

    it("routes simple text tasks to answer_directly", async () => {
      const { routeTask } = await import("./ontologicalModel.js");
      const decision = routeTask("Summarize this text document");
      // text_analysis has high confidence, so answer_directly should score well
      expect(decision.selectedAction).toBe("answer_directly");
    });

    it("routes complex code tasks toward write_tool or answer_directly", async () => {
      const { routeTask } = await import("./ontologicalModel.js");
      const decision = routeTask("Build a comprehensive advanced code analysis framework");
      expect(["write_tool", "answer_directly", "delegate_swarm"]).toContain(decision.selectedAction);
    });

    it("persists routing decision to routing_log.jsonl", async () => {
      const { routeTask } = await import("./ontologicalModel.js");
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      routeTask("Test task for logging");
      expect(existsSync(join(tmpDir, "data", "routing_log.jsonl"))).toBe(true);
    });
  });

  describe("recordRoutingOutcome", () => {
    it("updates capability outcomes and domain coverage", async () => {
      const { routeTask, recordRoutingOutcome, loadSelfModel } = await import("./ontologicalModel.js");
      const decision = routeTask("Analyze this text document");
      const beforeCap = loadSelfModel().capabilities.find((c) => c.name === "text_analysis");
      const beforeCount = beforeCap?.successCount ?? 0;

      recordRoutingOutcome(decision, true, 1500);

      const afterCap = loadSelfModel().capabilities.find((c) => c.name === "text_analysis");
      // If text_analysis was matched, its successCount should have increased
      if (decision.matchedCapabilities.includes("text_analysis")) {
        expect(afterCap?.successCount).toBeGreaterThan(beforeCount);
      }
    });

    it("increments totalTasks in the self-model", async () => {
      const { routeTask, recordRoutingOutcome, loadSelfModel } = await import("./ontologicalModel.js");
      const before = loadSelfModel().totalTasks;
      const decision = routeTask("A task");
      recordRoutingOutcome(decision, true);
      expect(loadSelfModel().totalTasks).toBe(before + 1);
    });
  });

  describe("getSelfModelSummary", () => {
    it("returns a summary with all required fields", async () => {
      const { getSelfModelSummary } = await import("./ontologicalModel.js");
      const summary = getSelfModelSummary();

      expect(summary.instanceId).toMatch(/^andromeda-/);
      expect(summary.intelligenceScore).toBeGreaterThan(0);
      expect(summary.successRate).toBe(1.0);
      expect(summary.capabilityCount).toBeGreaterThan(0);
      expect(summary.domainCount).toBeGreaterThan(0);
      expect(Array.isArray(summary.topCapabilities)).toBe(true);
      expect(Array.isArray(summary.weakestDomains)).toBe(true);
      expect(Array.isArray(summary.recommendedLoraTargets)).toBe(true);
    });

    it("topCapabilities lists capabilities in descending confidence order", async () => {
      const { getSelfModelSummary, loadSelfModel, saveSelfModel } = await import("./ontologicalModel.js");
      // Artificially set confidences
      const model = loadSelfModel();
      model.capabilities[0].confidence = 0.99;
      model.capabilities[1].confidence = 0.1;
      saveSelfModel(model);

      const summary = getSelfModelSummary();
      // The first capability in topCapabilities should have higher confidence than the second
      expect(summary.topCapabilities[0]).toContain("99%");
    });
  });
});
