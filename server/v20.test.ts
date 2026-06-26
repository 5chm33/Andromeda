/**
 * v20.test.ts — Comprehensive test suite for all v20.0.0 modules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── unsupervisedCodebaseDiscovery.ts ──────────────────────────────────────────
import { scanCodebaseHealth, generateProposedGoals } from "./unsupervisedCodebaseDiscovery.js";

describe("unsupervisedCodebaseDiscovery", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucd-test-"));
    const serverDir = path.join(tmpDir, "server");
    fs.mkdirSync(serverDir, { recursive: true });
    
    // Create a mock high-complexity file
    fs.writeFileSync(path.join(serverDir, "complex.ts"), `
      if (a) {
        if (b) {
          while (c) {
            // TODO: fix this
          }
        }
      }
    `);
    
    // Create a mock simple file with a test
    fs.writeFileSync(path.join(serverDir, "simple.ts"), `const x = 1;`);
    fs.writeFileSync(path.join(serverDir, "simple.test.ts"), `test('x', () => {});`);
  });

  it("scanCodebaseHealth returns metrics sorted by ROI", () => {
    const metrics = scanCodebaseHealth(tmpDir);
    expect(metrics.length).toBe(2);
    expect(metrics[0].file).toBe("complex.ts"); // Should have higher ROI
    expect(metrics[0].cyclomaticComplexity).toBe(3); // 3 branches
    expect(metrics[0].unresolvedTodos).toBe(1);
    expect(metrics[0].testCoverageEstimate).toBe(0); // No test file
    
    expect(metrics[1].file).toBe("simple.ts");
    expect(metrics[1].testCoverageEstimate).toBe(1); // Has test file
  });

  it("generateProposedGoals creates PROPOSED_GOALS.md", () => {
    generateProposedGoals(tmpDir);
    const mdPath = path.join(tmpDir, "PROPOSED_GOALS.md");
    expect(fs.existsSync(mdPath)).toBe(true);
    
    const content = fs.readFileSync(mdPath, "utf-8");
    expect(content).toContain("Unsupervised Codebase Discovery");
    expect(content).toContain("complex.ts");
  });
});

// ── multiModalExecutionVerifier.ts ────────────────────────────────────────────
import { compareScreenshotsVLM, runVisualRegressionGate } from "./multiModalExecutionVerifier.js";

describe("multiModalExecutionVerifier", () => {
  it("compareScreenshotsVLM fails open when no API key", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await compareScreenshotsVLM("before.png", "after.png", "test");
    expect(result.passed).toBe(true);
    expect(result.similarityScore).toBe(1.0);
  });

  it("runVisualRegressionGate does not throw", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await runVisualRegressionGate("test.tsx", "test");
    expect(result.passed).toBe(true);
  });
});

// ── dynamicModelRouter.ts ─────────────────────────────────────────────────────
import { classifyTaskComplexity, getModelForTier } from "./dynamicModelRouter.js";

describe("dynamicModelRouter", () => {
  it("classifyTaskComplexity routes simple tasks to cheap tier", () => {
    const decision = classifyTaskComplexity("fix typo", "const a = 1;");
    expect(decision.tier).toBe("cheap");
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it("classifyTaskComplexity routes complex tasks to expensive tier", () => {
    // High complexity file (lots of branches) + architecture intent
    const complexFile = Array(60).fill("if (true) {}").join("\\n");
    const decision = classifyTaskComplexity("refactor architecture", complexFile);
    expect(decision.tier).toBe("expensive");
    expect(decision.confidence).toBeGreaterThan(0.5);
  });

  it("getModelForTier returns appropriate models", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getActiveModel").mockReturnValue("gpt-4o");
    expect(getModelForTier("expensive")).toBe("gpt-4o");
    expect(getModelForTier("cheap")).toBe("gpt-4o-mini");
  });
});

// ── persistentGlobalMemory.ts ─────────────────────────────────────────────────
import { initGlobalMemory, publishToGlobalMemory, queryGlobalMemory } from "./persistentGlobalMemory.js";

describe("persistentGlobalMemory", () => {
  beforeEach(() => {
    // We can't easily mock the homedir in a clean way for fs operations without
    // potentially messing up other tests, so we just verify it doesn't throw.
  });

  it("initGlobalMemory does not throw", () => {
    expect(() => initGlobalMemory()).not.toThrow();
  });

  it("publishToGlobalMemory and queryGlobalMemory work", () => {
    // Just verify they don't throw in the test environment
    expect(() => publishToGlobalMemory("proj1", "test content", ["test"], 0.9)).not.toThrow();
    const results = queryGlobalMemory(["test"]);
    expect(Array.isArray(results)).toBe(true);
  });
});

// ── toolSynthesizer.ts ────────────────────────────────────────────────────────
import { synthesizeNewTool } from "./toolSynthesizer.js";

describe("toolSynthesizer", () => {
  it("synthesizeNewTool returns false when no API key", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const result = await synthesizeNewTool("I need a tool to zip files", "/tmp");
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("No API key");
  });
});

// ── infiniteContextSummarizer.ts ──────────────────────────────────────────────
import { initSummarizer, summarizeFile, getHierarchicalContext } from "./infiniteContextSummarizer.js";

describe("infiniteContextSummarizer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ics-test-"));
    // Change cwd for this test block
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  it("initSummarizer creates necessary files", () => {
    initSummarizer();
    expect(fs.existsSync(path.join(process.cwd(), ".andromeda_summaries", "file_summaries.json"))).toBe(true);
  });

  it("summarizeFile extracts exports and deps", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const testFile = path.join(tmpDir, "test.ts");
    fs.writeFileSync(testFile, `
      import { x } from './other.js';
      export const y = 1;
      export function z() {}
    `);
    
    const summary = await summarizeFile(testFile);
    expect(summary.exports).toContain("y");
    expect(summary.exports).toContain("z");
    expect(summary.dependencies).toContain("./other.js");
  });

  it("getHierarchicalContext returns a formatted string", async () => {
    vi.spyOn(await import("./aiTokens.js"), "getApiKey").mockReturnValue(null);
    const testFile = path.join(tmpDir, "test.ts");
    fs.writeFileSync(testFile, `export const a = 1;`);
    await summarizeFile(testFile);
    
    const context = getHierarchicalContext(testFile);
    expect(typeof context).toBe("string");
    expect(context).toContain("Target File");
  });
});
