import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(os.tmpdir(), `proof-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  vi.resetModules(); // Force fresh module load so DATA_DIR picks up the new ANDROMEDA_WORKSPACE
});

afterEach(() => {
  vi.resetModules();
  delete process.env.ANDROMEDA_WORKSPACE;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("proofAssistant", () => {
  describe("detectProverBackend", () => {
    it("returns a valid backend string", async () => {
      const { detectProverBackend } = await import("./proofAssistant.js");
      const backend = detectProverBackend();
      expect(["lean4", "coq", "heuristic"]).toContain(backend);
    });

    it("returns heuristic in CI environment (no Lean/Coq installed)", async () => {
      const { detectProverBackend } = await import("./proofAssistant.js");
      const backend = detectProverBackend();
      // In CI, neither Lean 4 nor Coq is installed
      expect(backend).toBe("heuristic");
    });
  });

  describe("analyzeCodeSafety", () => {
    it("returns no violations for safe code", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const safeCode = `
export function add(a: number, b: number): number {
  return a + b;
}

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`;
      const violations = analyzeCodeSafety(safeCode);
      expect(violations).toHaveLength(0);
    });

    it("detects while(true) without break as termination violation", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
function forever() {
  while (true) {
    console.log("running");
    // infinite loop, no exit
  }
}
`;
      const violations = analyzeCodeSafety(code);
      const termination = violations.filter((v) => v.property === "termination");
      expect(termination.length).toBeGreaterThan(0);
      expect(termination[0].severity).toBe("warning");
    });

    it("does NOT flag while(true) that has a break", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
function poll() {
  while (true) {
    const done = checkDone();
    if (done) break;
  }
}
`;
      const violations = analyzeCodeSafety(code);
      const termination = violations.filter((v) => v.property === "termination");
      expect(termination).toHaveLength(0);
    });

    it("detects eval() as privilege violation", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
const result = eval("2 + 2");
`;
      const violations = analyzeCodeSafety(code);
      const privilege = violations.filter((v) => v.property === "privilege_safety");
      expect(privilege.length).toBeGreaterThan(0);
      expect(privilege[0].severity).toBe("error");
    });

    it("detects sudo in execSync as critical privilege violation", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
import { execSync } from "child_process";
execSync("sudo apt-get install something");
`;
      const violations = analyzeCodeSafety(code);
      const critical = violations.filter((v) => v.severity === "critical");
      expect(critical.length).toBeGreaterThan(0);
    });

    it("detects file write outside workspace as file safety error", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
import { writeFileSync } from "fs";
writeFileSync("/etc/passwd", "malicious");
`;
      const violations = analyzeCodeSafety(code, {
        minSafetyScore: 0.7,
        proverTimeoutMs: 5000,
        blockOnFailure: false,
        allowedWorkspaceDir: "/home/user/project",
        allowedHosts: [],
      });
      const fileSafety = violations.filter((v) => v.property === "file_safety");
      expect(fileSafety.length).toBeGreaterThan(0);
      expect(fileSafety[0].severity).toBe("error");
    });

    it("does NOT flag file writes inside the workspace", async () => {
      const { analyzeCodeSafety } = await import("./proofAssistant.js");
      const code = `
import { writeFileSync } from "fs";
writeFileSync("/home/user/project/data/output.json", JSON.stringify(result));
`;
      const violations = analyzeCodeSafety(code, {
        minSafetyScore: 0.7,
        proverTimeoutMs: 5000,
        blockOnFailure: false,
        allowedWorkspaceDir: "/home/user/project",
        allowedHosts: [],
      });
      const fileSafety = violations.filter((v) => v.property === "file_safety");
      expect(fileSafety).toHaveLength(0);
    });
  });

  describe("computeSafetyScore", () => {
    it("returns 1.0 for no violations", async () => {
      const { computeSafetyScore } = await import("./proofAssistant.js");
      expect(computeSafetyScore([])).toBe(1.0);
    });

    it("returns a low score for critical violations", async () => {
      const { computeSafetyScore } = await import("./proofAssistant.js");
      const score = computeSafetyScore([
        { property: "privilege_safety", description: "sudo", line: 1, severity: "critical", autoFixable: false },
      ]);
      expect(score).toBeLessThan(0.3);
    });

    it("returns a medium score for error violations", async () => {
      const { computeSafetyScore } = await import("./proofAssistant.js");
      const score = computeSafetyScore([
        { property: "file_safety", description: "bad write", line: 1, severity: "error", autoFixable: false },
      ]);
      expect(score).toBeGreaterThanOrEqual(0.3);
      expect(score).toBeLessThan(0.7);
    });

    it("returns a high score for only warnings", async () => {
      const { computeSafetyScore } = await import("./proofAssistant.js");
      const score = computeSafetyScore([
        { property: "termination", description: "while(true)", line: 1, severity: "warning", autoFixable: false },
      ]);
      expect(score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("generateLean4Proof", () => {
    it("generates valid Lean 4 syntax", async () => {
      const { generateLean4Proof } = await import("./proofAssistant.js");
      const proof = generateLean4Proof("export function foo() {}", []);
      expect(proof).toContain("import Lean");
      expect(proof).toContain("namespace AndromedaSafety");
      expect(proof).toContain("end AndromedaSafety");
      expect(proof).toContain("theorem all_safe");
    });

    it("includes violation theorems for auto-fixable violations", async () => {
      const { generateLean4Proof } = await import("./proofAssistant.js");
      const proof = generateLean4Proof("code", [
        { property: "memory_safety", description: "unbounded push", line: 5, severity: "warning", autoFixable: true },
      ]);
      expect(proof).toContain("theorem safety_memory_safety_0");
    });
  });

  describe("generateCoqProof", () => {
    it("generates valid Coq syntax", async () => {
      const { generateCoqProof } = await import("./proofAssistant.js");
      const proof = generateCoqProof("export function foo() {}", []);
      expect(proof).toContain("Require Import");
      expect(proof).toContain("Module AndromedaSafety");
      expect(proof).toContain("End AndromedaSafety");
      expect(proof).toContain("Theorem all_safe");
    });
  });

  describe("verifyCodeSafety", () => {
    it("returns safe=true for clean code using heuristic backend", async () => {
      const { verifyCodeSafety } = await import("./proofAssistant.js");
      const result = await verifyCodeSafety(`
export function safeAdd(a: number, b: number): number {
  if (typeof a !== "number" || typeof b !== "number") throw new Error("invalid");
  return a + b;
}
`);
      expect(result.safe).toBe(true);
      expect(result.backend).toBe("heuristic");
      expect(result.score).toBe(1.0);
      expect(result.violations).toHaveLength(0);
      expect(result.codeHash).toHaveLength(64);
      expect(result.verificationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("returns safe=false for code with critical violations", async () => {
      const { verifyCodeSafety } = await import("./proofAssistant.js");
      const result = await verifyCodeSafety(`
import { execSync } from "child_process";
execSync("sudo rm -rf /");
`);
      expect(result.safe).toBe(false);
      expect(result.score).toBeLessThan(0.7);
      expect(result.violations.some((v) => v.severity === "critical")).toBe(true);
    });

    it("persists the result to proof_log.jsonl", async () => {
      const { verifyCodeSafety } = await import("./proofAssistant.js");
      const { existsSync } = await import("fs");
      const { join } = await import("path");

      await verifyCodeSafety("export const x = 1;");
      expect(existsSync(join(tmpDir, "data", "proof_log.jsonl"))).toBe(true);
    });
  });

  describe("loadProofLog / getProofStats", () => {
    it("returns empty log when no proofs have been run", async () => {
      const { loadProofLog } = await import("./proofAssistant.js");
      expect(loadProofLog()).toEqual([]);
    });

    it("returns correct stats after running verifications", async () => {
      const { verifyCodeSafety, getProofStats } = await import("./proofAssistant.js");

      await verifyCodeSafety("export const a = 1;"); // safe
      await verifyCodeSafety(`execSync("sudo rm -rf /")`); // unsafe

      const stats = getProofStats();
      expect(stats.total).toBe(2);
      expect(stats.safe).toBe(1);
      expect(stats.unsafe).toBe(1);
      expect(stats.averageScore).toBeGreaterThan(0);
      expect(stats.backendBreakdown.heuristic).toBe(2);
    });
  });
});
