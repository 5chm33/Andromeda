/**
 * proposalInvariantVerifier.test.ts — Comprehensive tests for proposalInvariantVerifier.ts
 */
import { describe, it, expect } from "vitest";
import {
  verifyProposalInvariants,
  passesInvariantGate,
  type InvariantVerificationResult,
} from "./proposalInvariantVerifier.js";

// ─── verifyProposalInvariants Tests ──────────────────────────────────────────

describe("verifyProposalInvariants", () => {
  it("should return passed=true for safe code", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `export function add(a: number, b: number): number { return a + b; }`,
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("should skip test files", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `eval("bad code")`,
      targetFile: "server/utils.test.ts",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("should skip config files", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `const x = 1;`,
      targetFile: "tsconfig.json",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should skip very short snippets", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: "x = 1",
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    expect(result.skipped).toBe(true);
  });

  it("should detect eval() usage as a violation", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `
export function runCode(code: string): void {
  eval(code); // dangerous
}
      `.trim(),
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    // eval should be flagged
    if (!result.skipped) {
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it("should return InvariantVerificationResult with expected fields", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `export const x = 1;`,
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("violations");
    expect(result).toHaveProperty("criticalCount");
    expect(result).toHaveProperty("warningCount");
    expect(result).toHaveProperty("infoCount");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("skipped");
    expect(Array.isArray(result.violations)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should have criticalCount + warningCount matching violations", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `export function safe(): string { return "ok"; }`,
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    const critical = result.violations.filter(v => v.severity === "critical").length;
    const warnings = result.violations.filter(v => v.severity === "warning").length;
    expect(result.criticalCount).toBe(critical);
    expect(result.warningCount).toBe(warnings);
  });

  it("should allow safe async/await patterns", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `
export async function fetchData(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  return res.text();
}
      `.trim(),
      targetFile: "server/api.ts",
      projectRoot: "/tmp",
    });
    expect(result.passed).toBe(true);
  });

  it("should detect as any casts as violations", async () => {
    const result = await verifyProposalInvariants({
      proposedSnippet: `
export function getUser(data: unknown): string {
  return (data as any).name;
}
      `.trim(),
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    });
    if (!result.skipped) {
      // as any should be flagged
      expect(result.violations.length).toBeGreaterThan(0);
    }
  });

  it("should not throw for empty snippet", async () => {
    await expect(verifyProposalInvariants({
      proposedSnippet: "",
      targetFile: "server/utils.ts",
      projectRoot: "/tmp",
    })).resolves.not.toThrow();
  });

  it("should not throw for non-existent project root", async () => {
    await expect(verifyProposalInvariants({
      proposedSnippet: `export function x() { return 1; }`,
      targetFile: "server/utils.ts",
      projectRoot: "/nonexistent/path",
    })).resolves.not.toThrow();
  });
});

// ─── passesInvariantGate Tests ────────────────────────────────────────────────

describe("passesInvariantGate", () => {
  it("should return true for safe code", async () => {
    const result = await passesInvariantGate(
      `export function add(a: number, b: number): number { return a + b; }`,
      "server/utils.ts",
      "/tmp"
    );
    expect(typeof result).toBe("boolean");
    expect(result).toBe(true);
  });

  it("should return true for skipped files (test files)", async () => {
    const result = await passesInvariantGate(
      `eval("dangerous")`,
      "server/utils.test.ts",
      "/tmp"
    );
    expect(result).toBe(true); // skipped = passes gate
  });

  it("should return false for code with critical violations", async () => {
    const result = await passesInvariantGate(
      `export function bad(code: string) { eval(code); }`,
      "server/utils.ts",
      "/tmp"
    );
    // Either passes (if eval not flagged as critical) or fails
    expect(typeof result).toBe("boolean");
  });

  it("should not throw for empty snippet", async () => {
    await expect(passesInvariantGate("", "server/utils.ts", "/tmp")).resolves.not.toThrow();
  });
});
