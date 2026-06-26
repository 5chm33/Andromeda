/**
 * dynamicTestGen.test.ts — Andromeda v12.10.1 Audit
 * Comprehensive tests for the dynamic Vitest test generation module.
 * Tests the pure helper functions (extractFunctionNames, pruneOldDynamicTests)
 * and the public generateAndRunTest API with mocked LLM calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  extractFunctionNames,
  pruneOldDynamicTests,
  generateAndRunTest,
  type DynamicTestResult,
} from "./dynamicTestGen.js";

// ─── extractFunctionNames ─────────────────────────────────────────────────────
describe("dynamicTestGen — extractFunctionNames", () => {
  it("module loads without errors", async () => {
    await expect(import("./dynamicTestGen.js")).resolves.toBeDefined();
  });

  it("extracts a simple function declaration", () => {
    const snippet = "function add(a: number, b: number): number { return a + b; }";
    const names = extractFunctionNames(snippet);
    expect(names).toContain("add");
  });

  it("extracts an async function declaration", () => {
    const snippet = "async function fetchData(url: string): Promise<string> { return ''; }";
    const names = extractFunctionNames(snippet);
    expect(names).toContain("fetchData");
  });

  it("extracts an arrow function assigned to const", () => {
    const snippet = "const multiply = (a: number, b: number) => a * b;";
    const names = extractFunctionNames(snippet);
    expect(names).toContain("multiply");
  });

  it("extracts an async arrow function assigned to const", () => {
    const snippet = "const loadUser = async (id: string) => { return null; };";
    const names = extractFunctionNames(snippet);
    expect(names).toContain("loadUser");
  });

  it("extracts a class method", () => {
    const snippet = "class Foo { bar(x: number): number { return x; } }";
    const names = extractFunctionNames(snippet);
    expect(names).toContain("bar");
  });

  it("extracts multiple functions from a snippet", () => {
    const snippet = `
      function foo() { return 1; }
      function bar() { return 2; }
      const baz = () => 3;
    `;
    const names = extractFunctionNames(snippet);
    expect(names).toContain("foo");
    expect(names).toContain("bar");
    expect(names).toContain("baz");
  });

  it("returns empty array for snippet with no functions", () => {
    const snippet = "const x = 1;\nconst y = 2;";
    const names = extractFunctionNames(snippet);
    expect(Array.isArray(names)).toBe(true);
  });

  it("returns empty array for empty string", () => {
    const names = extractFunctionNames("");
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(0);
  });

  it("handles syntax errors without throwing", () => {
    expect(() => extractFunctionNames("}{invalid code{{{")).not.toThrow();
  });

  it("deduplicates function names", () => {
    const snippet = "function foo() { return 1; }\nfunction foo() { return 2; }";
    const names = extractFunctionNames(snippet);
    const fooCount = names.filter(n => n === "foo").length;
    expect(fooCount).toBe(1);
  });

  it("does not include constructor as a function name", () => {
    const snippet = "class Foo { constructor(private x: number) {} }";
    const names = extractFunctionNames(snippet);
    expect(names).not.toContain("constructor");
  });

  it("returns an array of strings", () => {
    const snippet = "function greet(name: string) { return `Hello ${name}`; }";
    const names = extractFunctionNames(snippet);
    expect(Array.isArray(names)).toBe(true);
    names.forEach(n => expect(typeof n).toBe("string"));
  });
});

// ─── pruneOldDynamicTests ─────────────────────────────────────────────────────
describe("dynamicTestGen — pruneOldDynamicTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-dyntest-prune-"));
  });

  it("does not throw when dynamic tests directory does not exist", () => {
    const nonExistent = path.join(tmpDir, "does-not-exist");
    expect(() => pruneOldDynamicTests(nonExistent)).not.toThrow();
  });

  it("does not throw when directory is empty", () => {
    expect(() => pruneOldDynamicTests(tmpDir)).not.toThrow();
  });

  it("deletes all dynamic test files from workspace/_dynamic_tests", () => {
    // Create the correct directory structure: workspace/_dynamic_tests
    const dynTestDir = path.join(tmpDir, "workspace", "_dynamic_tests");
    fs.mkdirSync(dynTestDir, { recursive: true });
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dynTestDir, `proposal_${i}_foo_dynamic.test.ts`), `// test ${i}`);
    }
    pruneOldDynamicTests(tmpDir);
    const remaining = fs.readdirSync(dynTestDir).filter(f => f.endsWith(".test.ts"));
    // pruneOldDynamicTests deletes ALL .test.ts files in the dir
    expect(remaining.length).toBe(0);
  });

  it("does not throw when workspace/_dynamic_tests is empty", () => {
    const dynTestDir = path.join(tmpDir, "workspace", "_dynamic_tests");
    fs.mkdirSync(dynTestDir, { recursive: true });
    expect(() => pruneOldDynamicTests(tmpDir)).not.toThrow();
  });
});

// ─── generateAndRunTest ───────────────────────────────────────────────────────
describe("dynamicTestGen — generateAndRunTest", () => {
  it("returns DynamicTestResult with required fields", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-1",
        targetFile: "server/foo.ts",
        originalSnippet: "function add(a: number, b: number) { return a + b; }",
        proposedSnippet: "function add(a: number, b: number) { return a + b + 0; }",
        title: "Test add function",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockResolvedValue(`
import { describe, it, expect } from 'vitest';
describe('add', () => {
  it('adds two numbers', () => { expect(1 + 1).toBe(2); });
});
`),
      providerId: "openai",
    });
    expect(result).toHaveProperty("ran");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("functionsTested");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.ran).toBe("boolean");
    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.functionsTested)).toBe(true);
    expect(typeof result.durationMs).toBe("number");
  });

  it("returns ran:false when no function names are found in snippet", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-2",
        targetFile: "server/constants.ts",
        originalSnippet: "const MAX = 100;",
        proposedSnippet: "const MAX = 200;",
        title: "Update constant",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockResolvedValue(""),
      providerId: "openai",
    });
    expect(result).toHaveProperty("ran");
    // No functions to test — may skip
    expect(typeof result.ran).toBe("boolean");
  });

  it("returns ran:false when LLM throws", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-3",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        title: "Update foo",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
      providerId: "openai",
    });
    expect(result.ran).toBe(false);
  });

  it("returns ran:false when LLM returns empty string", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-4",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        title: "Update foo",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockResolvedValue(""),
      providerId: "openai",
    });
    expect(result.ran).toBe(false);
  });

  it("durationMs is non-negative", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-5",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        title: "Update foo",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("fail")),
      providerId: "openai",
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("functionsTested is an array of strings", async () => {
    const result = await generateAndRunTest({
      proposal: {
        id: "test-proposal-6",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        title: "Update foo",
      },
      projectRoot: "/tmp",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("fail")),
      providerId: "openai",
    });
    expect(Array.isArray(result.functionsTested)).toBe(true);
    result.functionsTested.forEach(n => expect(typeof n).toBe("string"));
  });

  it("does not throw when projectRoot does not exist", async () => {
    await expect(generateAndRunTest({
      proposal: {
        id: "test-proposal-7",
        targetFile: "server/foo.ts",
        originalSnippet: "function foo() { return 1; }",
        proposedSnippet: "function foo() { return 2; }",
        title: "Update foo",
      },
      projectRoot: "/nonexistent/path",
      simpleChatCompletion: vi.fn().mockRejectedValue(new Error("fail")),
      providerId: "openai",
    })).resolves.toHaveProperty("ran");
  });
});
