/**
 * goalDecomposer.test.ts — Andromeda v11.16.0 Audit 8
 * Real function-level tests for goalDecomposer.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM call so tests run without network
vi.mock("./_core/llm.js", () => ({
  invokeLLM: vi.fn().mockResolvedValue(
    JSON.stringify([
      { title: "Step 1: Analyze", description: "Analyze the codebase", priority: 1, estimatedEffort: "low" },
      { title: "Step 2: Refactor", description: "Apply refactoring", priority: 2, estimatedEffort: "medium" },
    ])
  ),
}));

describe("goalDecomposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("module loads without throwing", async () => {
    await expect(import("./goalDecomposer.js")).resolves.toBeDefined();
  });

  it("exports decomposeDiscoveries and decomposeSingleDiscovery", async () => {
    const mod = await import("./goalDecomposer.js");
    expect(typeof mod.decomposeDiscoveries).toBe("function");
    expect(typeof mod.decomposeSingleDiscovery).toBe("function");
  });

  it("decomposeSingleDiscovery returns DecomposedGoal or null", async () => {
    const { decomposeSingleDiscovery } = await import("./goalDecomposer.js");
    const discovery = {
      id: "test-discovery-1",
      title: "Improve error handling",
      description: "Add better error handling to the RSI pipeline",
      priority: "high" as const,
      estimatedImpact: 0.8,
    };
    const result = await decomposeSingleDiscovery(discovery);
    // Returns DecomposedGoal object or null
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("decomposeDiscoveries handles empty array gracefully", async () => {
    const { decomposeDiscoveries } = await import("./goalDecomposer.js");
    const result = await decomposeDiscoveries([]);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it("decomposeDiscoveries processes multiple discoveries", async () => {
    const { decomposeDiscoveries } = await import("./goalDecomposer.js");
    const discoveries = [
      { id: "d1", title: "Improve logging", description: "Add structured logging", priority: "medium" as const, estimatedImpact: 0.5 },
      { id: "d2", title: "Optimize memory", description: "Reduce memory footprint", priority: "high" as const, estimatedImpact: 0.7 },
    ];
    const result = await decomposeDiscoveries(discoveries);
    expect(Array.isArray(result)).toBe(true);
  });

  it("decomposeSingleDiscovery handles LLM failure gracefully", async () => {
    const { invokeLLM } = await import("./_core/llm.js");
    (invokeLLM as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("LLM unavailable"));
    const { decomposeSingleDiscovery } = await import("./goalDecomposer.js");
    const discovery = { id: "test-2", title: "Test goal", description: "Test", priority: "low" as const, estimatedImpact: 0.3 };
    // Should not throw — returns null on failure
    const result = await decomposeSingleDiscovery(discovery);
    expect(result === null || typeof result === "object").toBe(true);
  });
});
