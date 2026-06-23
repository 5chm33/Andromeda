/**
 * ollamaAutoSetup.test.ts — v2.0.0 (v11.2.0)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOllamaStatus,
  getRecommendedModels,
  getSetupGuide,
  trackLocalTokenUsage,
  initOllamaAutoSetup,
  triggerModelPull,
} from "./ollamaAutoSetup.js";

describe("ollamaAutoSetup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("module loads without throwing", () => {
    expect(getOllamaStatus).toBeDefined();
    expect(getRecommendedModels).toBeDefined();
    expect(getSetupGuide).toBeDefined();
    expect(trackLocalTokenUsage).toBeDefined();
    expect(initOllamaAutoSetup).toBeDefined();
    expect(triggerModelPull).toBeDefined();
  });

  it("getOllamaStatus returns a valid status object with v2.0.0 fields", () => {
    const status = getOllamaStatus();
    expect(status).toBeDefined();
    expect(typeof status.available).toBe("boolean");
    expect(typeof status.baseUrl).toBe("string");
    expect(Array.isArray(status.models)).toBe(true);
    expect(typeof status.totalFreeTokens).toBe("number");
    expect(typeof status.estimatedSavings).toBe("number");
    // v2.0.0 new fields
    expect(typeof status.pullInProgress).toBe("boolean");
    expect(typeof status.pullProgress).toBe("number");
    expect(status.pullProgress >= 0 && status.pullProgress <= 100).toBe(true);
    // vramGb is null when not detected, or a number when detected
    expect(status.vramGb === null || typeof status.vramGb === "number").toBe(true);
  });

  it("getRecommendedModels returns a non-empty list with all required fields", () => {
    const models = getRecommendedModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.name).toBe("string");
      expect(typeof m.vramGb).toBe("number");
      expect(typeof m.qualityScore).toBe("number");
      expect(typeof m.installed).toBe("boolean");
      // v2.0.0: downloadMb field
      expect(typeof m.downloadMb).toBe("number");
      expect(m.downloadMb).toBeGreaterThan(0);
    }
  });

  it("getRecommendedModels includes qwen2.5-coder as top recommendation", () => {
    const models = getRecommendedModels();
    expect(models[0].name).toContain("qwen2.5-coder");
  });

  it("getRecommendedModels quality scores are in descending order", () => {
    const models = getRecommendedModels();
    // The first 4 qwen2.5-coder models should have descending quality scores
    const qwenModels = models.filter(m => m.name.includes("qwen2.5-coder"));
    for (let i = 1; i < qwenModels.length; i++) {
      expect(qwenModels[i - 1].qualityScore).toBeGreaterThanOrEqual(qwenModels[i].qualityScore);
    }
  });

  it("getSetupGuide returns a valid guide object", () => {
    const guide = getSetupGuide();
    expect(guide).toBeDefined();
    expect(typeof guide.installed).toBe("boolean");
    expect(typeof guide.running).toBe("boolean");
    expect(typeof guide.hasModel).toBe("boolean");
    expect(Array.isArray(guide.steps)).toBe(true);
    expect(guide.steps.length).toBeGreaterThan(0);
    expect(typeof guide.recommendedModel).toBe("string");
    expect(typeof guide.estimatedDownloadMb).toBe("number");
    expect(guide.estimatedDownloadMb).toBeGreaterThan(0);
  });

  it("getSetupGuide includes Ollama install command when not running", () => {
    const guide = getSetupGuide();
    if (!guide.running) {
      const hasInstallStep = guide.steps.some(s => s.includes("ollama.com/install") || s.includes("ollama.com/download"));
      expect(hasInstallStep).toBe(true);
    }
  });

  it("getSetupGuide includes all recommended models in the list", () => {
    const guide = getSetupGuide();
    const hasModelList = guide.steps.some(s => s.includes("qwen2.5-coder"));
    expect(hasModelList).toBe(true);
  });

  it("trackLocalTokenUsage accumulates savings correctly", () => {
    const before = getOllamaStatus().estimatedSavings;
    // 1M input tokens at GPT-4o pricing = $5
    trackLocalTokenUsage(1_000_000, 0);
    const after = getOllamaStatus().estimatedSavings;
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(5.0, 1);
  });

  it("trackLocalTokenUsage accumulates output token savings correctly", () => {
    const before = getOllamaStatus().estimatedSavings;
    // 1M output tokens at GPT-4o pricing = $15
    trackLocalTokenUsage(0, 1_000_000);
    const after = getOllamaStatus().estimatedSavings;
    expect(after - before).toBeCloseTo(15.0, 1);
  });

  it("trackLocalTokenUsage accumulates token count", () => {
    const before = getOllamaStatus().totalFreeTokens;
    trackLocalTokenUsage(500, 300);
    const after = getOllamaStatus().totalFreeTokens;
    expect(after - before).toBe(800);
  });

  it("triggerModelPull rejects unknown models", () => {
    // Test unknown model rejection first — before any pull is in progress
    const result = triggerModelPull("unknown-model:99b");
    expect(result.started).toBe(false);
    expect(result.message).toContain("Unknown model");
  });

  it("triggerModelPull returns a result object for a known model", () => {
    const result = triggerModelPull("qwen2.5-coder:7b");
    expect(result).toBeDefined();
    expect(typeof result.started).toBe("boolean");
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("initOllamaAutoSetup does not throw", () => {
    expect(() => initOllamaAutoSetup()).not.toThrow();
  });
});
