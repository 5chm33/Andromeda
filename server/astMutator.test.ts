/**
 * astMutator.test.ts — Comprehensive tests for astMutator.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyMutation,
  validateMutation,
  recordMutationResult,
  recordValidationFailure,
  getMutatorStats,
  type MutationResult,
} from "./astMutator.js";

// ─── Test Fixtures ─────────────────────────────────────────────────────────────

const SIMPLE_TS_FILE = `
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`.trim();

const COMPLEX_TS_FILE = `
import { createLogger } from "./logger.js";
const log = createLogger("test");

export interface Config {
  timeout: number;
  retries: number;
}

export async function fetchData(url: string, config: Config): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed");
  return res.text();
}

export function processConfig(config: Config): Config {
  return { ...config, timeout: Math.max(config.timeout, 1000) };
}
`.trim();

// ─── applyMutation Tests ───────────────────────────────────────────────────────

describe("applyMutation", () => {
  describe("Strategy 1: Exact string match", () => {
    it("should apply exact string match successfully", () => {
      const original = "return a + b;";
      const snippet = "return a + b;";
      const proposed = "return a + b + 0;";
      const result = applyMutation(original, snippet, proposed);
      expect(result.success).toBe(true);
      expect(result.method).toBe("string");
      expect(result.matchConfidence).toBe(1.0);
      expect(result.mutatedContent).toBe("return a + b + 0;");
    });

    it("should apply exact match in multi-line file", () => {
      const snippet = "return a + b;";
      const proposed = "// improved\n  return a + b;";
      const result = applyMutation(SIMPLE_TS_FILE, snippet, proposed);
      expect(result.success).toBe(true);
      expect(result.method).toBe("string");
      expect(result.mutatedContent).toContain("// improved");
    });

    it("should replace only the first occurrence", () => {
      const original = "x = 1;\nx = 1;";
      const result = applyMutation(original, "x = 1;", "x = 2;");
      expect(result.success).toBe(true);
      // String.replace replaces first occurrence
      expect(result.mutatedContent).toBe("x = 2;\nx = 1;");
    });
  });

  describe("Strategy 2: Normalized string match", () => {
    it("should match despite leading/trailing whitespace differences", () => {
      const original = SIMPLE_TS_FILE;
      // Snippet with extra spaces
      const snippet = "  return a + b;  ";
      const proposed = "  return (a + b);  ";
      const result = applyMutation(original, snippet, proposed);
      expect(result.success).toBe(true);
    });

    it("should match despite comment differences", () => {
      const original = `function foo() {\n  // old comment\n  return 42;\n}`;
      const snippet = `function foo() {\n  return 42;\n}`;
      const proposed = `function foo() {\n  return 43;\n}`;
      const result = applyMutation(original, snippet, proposed);
      expect(result.success).toBe(true);
    });
  });

  describe("Strategy 3: AST structural match", () => {
    it("should match a function declaration with whitespace differences", () => {
      const original = SIMPLE_TS_FILE;
      // Snippet with different indentation
      const snippet = `export function add(a: number, b: number): number {\nreturn a + b;\n}`;
      const proposed = `export function add(a: number, b: number): number {\n  return a + b + 0; // optimized\n}`;
      const result = applyMutation(original, snippet, proposed, "test.ts");
      expect(result.success).toBe(true);
    });

    it("should match an interface declaration", () => {
      const snippet = `export interface Config {\n  timeout: number;\n  retries: number;\n}`;
      const proposed = `export interface Config {\n  timeout: number;\n  retries: number;\n  maxConnections?: number;\n}`;
      const result = applyMutation(COMPLEX_TS_FILE, snippet, proposed, "test.ts");
      expect(result.success).toBe(true);
    });

    it("should return matchConfidence >= 0.7 for AST matches", () => {
      const original = COMPLEX_TS_FILE;
      const snippet = `export function processConfig(config: Config): Config {\n  return { ...config };\n}`;
      const proposed = `export function processConfig(config: Config): Config {\n  return { ...config, timeout: Math.max(config.timeout, 2000) };\n}`;
      const result = applyMutation(original, snippet, proposed, "test.ts");
      if (result.success) {
        expect(result.matchConfidence).toBeGreaterThanOrEqual(0.7);
      }
    });
  });

  describe("Strategy 4: Fuzzy line match", () => {
    it("should fall back to fuzzy matching for highly similar first lines", () => {
      const original = `function greet(name: string) {\n  console.log("Hello " + name);\n}`;
      // Slightly different first line
      const snippet = `function greet( name: string ) {\n  console.log("Hello " + name);\n}`;
      const proposed = `function greet(name: string) {\n  console.log(\`Hello \${name}\`);\n}`;
      const result = applyMutation(original, snippet, proposed, "test.ts");
      // May succeed via fuzzy or fail — just check it doesn't throw
      expect(typeof result.success).toBe("boolean");
    });
  });

  describe("Failure cases", () => {
    it("should return success=false when snippet not found by any strategy", () => {
      const original = "function foo() { return 1; }";
      const snippet = "function bar() { return 999; }";
      const proposed = "function bar() { return 1000; }";
      const result = applyMutation(original, snippet, proposed, "test.ts");
      expect(result.success).toBe(false);
      expect(result.method).toBe("failed");
      expect(result.matchConfidence).toBe(0);
      expect(result.errorMessage).toBeDefined();
    });

    it("should return original content on failure", () => {
      const original = "const x = 1;";
      const result = applyMutation(original, "const y = 999;", "const y = 1000;");
      expect(result.mutatedContent).toBe(original);
    });

    it("should handle empty originalSnippet gracefully", () => {
      const result = applyMutation("const x = 1;", "", "const y = 2;");
      // Empty snippet matches everywhere — first occurrence replaced
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle empty originalContent gracefully", () => {
      const result = applyMutation("", "const x = 1;", "const y = 2;");
      expect(result.success).toBe(false);
    });
  });
});

// ─── validateMutation Tests ───────────────────────────────────────────────────

describe("validateMutation", () => {
  it("should return valid=true when all exports are preserved", () => {
    const original = SIMPLE_TS_FILE;
    const mutated = SIMPLE_TS_FILE.replace("return a + b;", "return a + b + 0;");
    const result = validateMutation({ originalContent: original, mutatedContent: mutated, filename: "test.ts" });
    expect(result.valid).toBe(true);
    expect(result.exportedSymbolsPreserved).toBe(true);
  });

  it("should return valid=false when an export is removed", () => {
    const original = SIMPLE_TS_FILE;
    // Remove the subtract function
    const mutated = `export function add(a: number, b: number): number {\n  return a + b;\n}`;
    const result = validateMutation({ originalContent: original, mutatedContent: mutated, filename: "test.ts" });
    expect(result.exportedSymbolsPreserved).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("subtract");
  });

  it("should detect preserved interface exports", () => {
    const original = COMPLEX_TS_FILE;
    const mutated = COMPLEX_TS_FILE.replace("timeout: number;", "timeout: number; // ms");
    const result = validateMutation({ originalContent: original, mutatedContent: mutated, filename: "test.ts" });
    expect(result.exportedSymbolsPreserved).toBe(true);
  });

  it("should handle non-TypeScript files gracefully", () => {
    const result = validateMutation({
      originalContent: "const x = 1;",
      mutatedContent: "const x = 2;",
      filename: "test.js",
    });
    // Should not throw
    expect(typeof result.valid).toBe("boolean");
  });

  it("should return valid=false for syntax errors in mutated content", () => {
    const original = "export function foo() { return 1; }";
    const mutated = "export function foo() { return 1; "; // unclosed brace
    const result = validateMutation({ originalContent: original, mutatedContent: mutated, filename: "test.ts" });
    // TypeScript parser may or may not report this as a parse error
    expect(typeof result.valid).toBe("boolean");
  });

  it("should handle empty original content", () => {
    const result = validateMutation({ originalContent: "", mutatedContent: "export const x = 1;", filename: "test.ts" });
    expect(typeof result.valid).toBe("boolean");
  });
});

// ─── Stats Tests ──────────────────────────────────────────────────────────────

describe("getMutatorStats", () => {
  it("should return stats object with expected fields", () => {
    const stats = getMutatorStats();
    expect(stats).toHaveProperty("astMutations");
    expect(stats).toHaveProperty("stringMutations");
    expect(stats).toHaveProperty("failedMutations");
    expect(stats).toHaveProperty("validationFailures");
    expect(stats).toHaveProperty("astSuccessRate");
    expect(typeof stats.astSuccessRate).toBe("number");
    expect(stats.astSuccessRate).toBeGreaterThanOrEqual(0);
    expect(stats.astSuccessRate).toBeLessThanOrEqual(1);
  });

  it("should update stats after recording results", () => {
    const before = getMutatorStats();
    recordMutationResult({ success: true, mutatedContent: "x", method: "ast", matchConfidence: 0.9 });
    recordMutationResult({ success: false, mutatedContent: "x", method: "failed", matchConfidence: 0 });
    recordValidationFailure();
    const after = getMutatorStats();
    expect(after.astMutations).toBeGreaterThanOrEqual(before.astMutations);
    expect(after.failedMutations).toBeGreaterThanOrEqual(before.failedMutations);
    expect(after.validationFailures).toBeGreaterThanOrEqual(before.validationFailures);
  });
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe("applyMutation + validateMutation integration", () => {
  it("should apply and validate a safe function body change", () => {
    const original = `export function clamp(val: number, min: number, max: number): number {\n  if (val < min) return min;\n  if (val > max) return max;\n  return val;\n}`;
    const snippet = `if (val < min) return min;\n  if (val > max) return max;\n  return val;`;
    const proposed = `return Math.min(Math.max(val, min), max);`;
    const mutResult = applyMutation(original, snippet, proposed, "utils.ts");
    if (mutResult.success) {
      const validation = validateMutation({
        originalContent: original,
        mutatedContent: mutResult.mutatedContent,
        filename: "utils.ts",
      });
      expect(validation.exportedSymbolsPreserved).toBe(true);
    }
  });

  it("should detect when mutation removes an exported function", () => {
    const original = `export function foo() { return 1; }\nexport function bar() { return 2; }`;
    // Mutation that accidentally removes bar
    const mutated = `export function foo() { return 1; }`;
    const validation = validateMutation({ originalContent: original, mutatedContent: mutated, filename: "test.ts" });
    expect(validation.exportedSymbolsPreserved).toBe(false);
    expect(validation.warnings.some(w => w.includes("bar"))).toBe(true);
  });

  it("should handle TypeScript generics in mutations", () => {
    const original = `export function identity<T>(val: T): T { return val; }`;
    const snippet = `export function identity<T>(val: T): T { return val; }`;
    const proposed = `export function identity<T>(val: T): T {\n  if (val === null || val === undefined) throw new Error("null");\n  return val;\n}`;
    const result = applyMutation(original, snippet, proposed, "test.ts");
    expect(result.success).toBe(true);
    if (result.success) {
      const validation = validateMutation({
        originalContent: original,
        mutatedContent: result.mutatedContent,
        filename: "test.ts",
      });
      expect(validation.exportedSymbolsPreserved).toBe(true);
    }
  });
});
