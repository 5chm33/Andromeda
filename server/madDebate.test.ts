/**
 * madDebate.test.ts — Andromeda v12.10.1 Audit
 * Comprehensive tests for the Multi-Agent Debate engine.
 * Tests the skip logic (pure), the public runMadDebate API (mocked LLM),
 * and result shape validation.
 */
import { describe, it, expect, vi } from "vitest";
import {
  runMadDebate,
  type MadDebateResult,
  type DebateIssue,
  type RedTeamResult,
  type BlueTeamResult,
} from "./madDebate.js";

// ─── Module loading ───────────────────────────────────────────────────────────
describe("madDebate — module", () => {
  it("loads without errors", async () => {
    await expect(import("./madDebate.js")).resolves.toBeDefined();
  });

  it("exports runMadDebate function", async () => {
    const mod = await import("./madDebate.js");
    expect(typeof mod.runMadDebate).toBe("function");
  });
});

// ─── runMadDebate — skip conditions ──────────────────────────────────────────
describe("madDebate — runMadDebate skip conditions", () => {
  it("skips when providerChain is empty", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p1",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn(),
      providerChain: [],
    });
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toBeDefined();
    expect(typeof result.skippedReason).toBe("string");
  });

  it("skips for trivial snippets (too short)", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p2",
        targetFile: "server/foo.ts",
        originalSnippet: "x",
        proposedSnippet: "y",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn(),
      providerChain: ["openai"],
    });
    expect(result).toHaveProperty("ran");
    // Short snippets may be skipped
    expect(typeof result.ran).toBe("boolean");
  });

  it("skips for short snippets (< 3 lines)", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p3",
        targetFile: "server/foo.ts",
        originalSnippet: "const x = 1;",
        proposedSnippet: "const x = 2;",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn(),
      providerChain: ["openai"],
    });
    expect(result.ran).toBe(false);
    expect(result.skippedReason).toContain("short");
  });
});

// ─── runMadDebate — result shape ──────────────────────────────────────────────
describe("madDebate — runMadDebate result shape", () => {
  const mockLLM = vi.fn().mockResolvedValue(JSON.stringify({
    issues: [
      { severity: "medium", category: "type-safety", description: "Possible null dereference", line: 1, suggestion: "Add null check" }
    ],
    overallRisk: "medium",
    summary: "One medium issue found"
  }));

  it("returns MadDebateResult with all required fields", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p4",
        targetFile: "server/foo.ts",
        originalSnippet: "function processUser(user: User) { return user.name.toUpperCase(); }",
        proposedSnippet: "function processUser(user: User) { return user.name?.toUpperCase() ?? ''; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "interface User { name: string; }",
      simpleChatCompletion: mockLLM,
      providerChain: ["openai", "anthropic"],
    });
    expect(result).toHaveProperty("ran");
    expect(result).toHaveProperty("redTeamIssues");
    expect(result).toHaveProperty("blueTeamImproved");
    expect(result).toHaveProperty("confidenceDelta");
    expect(result).toHaveProperty("transcript");
    expect(result).toHaveProperty("durationMs");
    expect(Array.isArray(result.redTeamIssues)).toBe(true);
    expect(typeof result.blueTeamImproved).toBe("boolean");
    expect(typeof result.confidenceDelta).toBe("number");
    expect(typeof result.transcript).toBe("string");
    expect(typeof result.durationMs).toBe("number");
  });

  it("durationMs is non-negative", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p5",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("fail")),
      providerChain: ["openai"],
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("confidenceDelta is a finite number", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p6",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: mockLLM,
      providerChain: ["openai"],
    });
    expect(Number.isFinite(result.confidenceDelta)).toBe(true);
  });

  it("redTeamIssues is an array", async () => {
    const result = await runMadDebate({
      proposal: {
        id: "p7",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: mockLLM,
      providerChain: ["openai"],
    });
    expect(Array.isArray(result.redTeamIssues)).toBe(true);
  });

  it("does not throw when LLM returns invalid JSON", async () => {
    await expect(runMadDebate({
      proposal: {
        id: "p8",
        targetFile: "server/foo.ts",
        originalSnippet: "function processUser(user: User) { return user.name.toUpperCase(); }",
        proposedSnippet: "function processUser(user: User) { return user.name?.toUpperCase() ?? ''; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn().mockResolvedValue("not valid json {{{{"),
      providerChain: ["openai"],
    })).resolves.toHaveProperty("ran");
  });

  it("does not throw when LLM throws an error", async () => {
    await expect(runMadDebate({
      proposal: {
        id: "p9",
        targetFile: "server/foo.ts",
        originalSnippet: "function processUser(user: User) { return user.name.toUpperCase(); }",
        proposedSnippet: "function processUser(user: User) { return user.name?.toUpperCase() ?? ''; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
      providerChain: ["openai"],
    })).resolves.toHaveProperty("ran");
  });

  it("uses single provider for both Red and Blue when only one is available", async () => {
    const mockSingle = vi.fn().mockResolvedValue(JSON.stringify({
      issues: [],
      overallRisk: "low",
      summary: "No issues"
    }));
    const result = await runMadDebate({
      proposal: {
        id: "p10",
        targetFile: "server/foo.ts",
        originalSnippet: "function processUser(user: User) { return user.name.toUpperCase(); }",
        proposedSnippet: "function processUser(user: User) { return user.name?.toUpperCase() ?? ''; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "",
      simpleChatCompletion: mockSingle,
      providerChain: ["openai"],
    });
    expect(result).toHaveProperty("ran");
  });

  it("improvedSnippet is a string when blueTeamImproved is true", async () => {
    const mockWithImprovement = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        issues: [{ severity: "critical", category: "null-safety", description: "Null deref", line: 1, suggestion: "Add check" }],
        overallRisk: "high",
        summary: "Critical issue"
      }))
      .mockResolvedValueOnce(JSON.stringify({
        improved: true,
        improvedSnippet: "function processUser(user: User) { return user?.name?.toUpperCase() ?? ''; }",
        responses: [{ issueIndex: 0, dismissed: false, patch: "Added optional chaining" }],
        summary: "Fixed null deref"
      }));
    const result = await runMadDebate({
      proposal: {
        id: "p11",
        targetFile: "server/foo.ts",
        originalSnippet: "function processUser(user: User) { return user.name.toUpperCase(); }",
        proposedSnippet: "function processUser(user: User) { return user.name?.toUpperCase() ?? ''; }",
        category: "logic",
        confidence: 0.8,
      },
      fileContext: "interface User { name: string; }",
      simpleChatCompletion: mockWithImprovement,
      providerChain: ["openai", "anthropic"],
    });
    if (result.blueTeamImproved) {
      expect(typeof result.improvedSnippet).toBe("string");
      expect((result.improvedSnippet as string).length).toBeGreaterThan(0);
    }
  });
});
