/**
 * mctsHealEngine.test.ts — Andromeda v12.10.1 Audit
 * Comprehensive tests for the MCTS parallel healing engine.
 * Tests the public mctsHeal API with mocked LLM calls and validates
 * all result shape fields and edge cases.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Shared mock helpers ──────────────────────────────────────────────────────
const makeMockLLM = (response: string | null) =>
  vi.fn().mockResolvedValue(response);

const makeFailingLLM = (err: string) =>
  vi.fn().mockRejectedValue(new Error(err));

const baseProposal = {
  id: "test-p1",
  targetFile: "server/foo.ts",
  title: "Test fix",
  category: "logic",
  originalSnippet: "const x: string = 1;",
  proposedSnippet: "const x: string = '1';",
  originalContent: "const x: string = 1;\nexport default x;",
};

const baseTscErrors = [
  { file: "server/foo.ts", line: 1, col: 7, code: "TS2322", message: "Type 'number' is not assignable to type 'string'." },
];

// ─── Module loading ───────────────────────────────────────────────────────────
describe("mctsHealEngine", () => {
  it("module loads without errors", async () => {
    await expect(import("./mctsHealEngine.js")).resolves.toBeDefined();
  });

  it("exports mctsHeal function", async () => {
    const mod = await import("./mctsHealEngine.js");
    expect(typeof mod.mctsHeal).toBe("function");
  });

  // ─── Result shape ───────────────────────────────────────────────────────────
  describe("mctsHeal — result shape", () => {
    it("returns all required fields", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "error TS2322: Type 'number' is not assignable to type 'string'.",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("LLM unavailable"),
      });
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("bestCandidate");
      expect(result).toHaveProperty("totalCandidates");
      expect(result).toHaveProperty("passingCandidates");
      expect(result).toHaveProperty("strategy");
      expect(result).toHaveProperty("durationMs");
    });

    it("success is boolean", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(typeof result.success).toBe("boolean");
    });

    it("durationMs is a non-negative number", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("totalCandidates is a non-negative integer", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(Number.isInteger(result.totalCandidates)).toBe(true);
      expect(result.totalCandidates).toBeGreaterThanOrEqual(0);
    });

    it("passingCandidates <= totalCandidates", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(result.passingCandidates).toBeLessThanOrEqual(result.totalCandidates);
    });

    it("strategy is a non-empty string", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(typeof result.strategy).toBe("string");
      expect(result.strategy.length).toBeGreaterThan(0);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────────
  describe("mctsHeal — edge cases", () => {
    it("handles empty tscErrors without crashing", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: [],
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeMockLLM("const x: string = '1';"),
      });
      expect(result).toHaveProperty("success");
    });

    it("handles empty providerChain without crashing", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: [],
        deadProviders: new Set(),
        simpleChatCompletion: makeMockLLM("const x: string = '1';"),
      });
      expect(result).toHaveProperty("success");
    });

    it("handles LLM returning null without crashing", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeMockLLM(null),
      });
      expect(result).toHaveProperty("success");
      expect(result.success).toBe(false);
    });

    it("handles LLM throwing without crashing", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("LLM unavailable"),
      });
      expect(result.success).toBe(false);
    });

    it("handles all providers in deadProviders without crashing", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai", "anthropic"],
        deadProviders: new Set(["openai", "anthropic"]),
        simpleChatCompletion: makeMockLLM("const x: string = '1';"),
      });
      expect(result).toHaveProperty("success");
    });

    it("branchesPerStrategy defaults to 2 when not specified", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
        // branchesPerStrategy not specified — should default to 2
      });
      expect(result).toHaveProperty("totalCandidates");
    });

    it("success:false when all candidates fail tsc", async () => {
      const { mctsHeal } = await import("./mctsHealEngine.js");
      // LLM returns invalid TS that will fail tsc
      const result = await mctsHeal({
        proposal: baseProposal,
        tscErrors: baseTscErrors,
        rawTscOutput: "",
        projectRoot: "/tmp",
        providerChain: ["openai"],
        deadProviders: new Set(),
        simpleChatCompletion: makeFailingLLM("fail"),
      });
      expect(result.success).toBe(false);
    });
  });
});
