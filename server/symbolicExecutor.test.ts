/**
 * symbolicExecutor.test.ts — Comprehensive tests for symbolicExecutor.ts
 */
import { describe, it, expect } from "vitest";
import {
  analyzeSymbolicSafety,
  formatSymbolicViolations,
} from "./symbolicExecutor.js";

describe("analyzeSymbolicSafety — safe code", () => {
  it("returns safe=true for a simple function with no null risk", () => {
    const snippet = `
      function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/math.ts");
    expect(result.safe).toBe(true);
    expect(result.violations.filter(v => v.severity === "critical")).toHaveLength(0);
  });

  it("returns safe=true for a function that null-checks before access", () => {
    const snippet = `
      function getLength(s: string | null): number {
        if (s !== null) {
          return s.length;
        }
        return 0;
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/utils.ts");
    expect(result.safe).toBe(true);
  });

  it("returns safe=true for optional chaining usage", () => {
    const snippet = `
      function getName(user: { name?: string } | null): string {
        return user?.name ?? "anonymous";
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/user.ts");
    expect(result.safe).toBe(true);
  });

  it("returns safe=true for an empty function body", () => {
    const snippet = `function noop(): void {}`;
    const result = analyzeSymbolicSafety(snippet, "/server/noop.ts");
    expect(result.safe).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns safe=true for an arrow function with no parameters", () => {
    const snippet = `const getTimestamp = () => Date.now();`;
    const result = analyzeSymbolicSafety(snippet, "/server/time.ts");
    expect(result.safe).toBe(true);
  });

  it("handles a snippet with no functions gracefully", () => {
    const snippet = `const x = 1;\nconst y = 2;`;
    const result = analyzeSymbolicSafety(snippet, "/server/constants.ts");
    expect(result.safe).toBe(true);
    expect(result.pathsAnalyzed).toBe(0);
  });
});

describe("analyzeSymbolicSafety — potentially unsafe code", () => {
  it("detects potential null dereference on nullable parameter", () => {
    const snippet = `
      function process(data: string | null): number {
        return data.length;
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/process.ts");
    // Should have at least a warning about data potentially being null
    const nullWarnings = result.violations.filter(v => v.kind === "NULL_DEREF");
    expect(nullWarnings.length).toBeGreaterThan(0);
  });

  it("detects potential undefined call on optional function parameter", () => {
    const snippet = `
      function run(callback: (() => void) | undefined): void {
        callback();
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/runner.ts");
    const callWarnings = result.violations.filter(v => v.kind === "UNDEFINED_CALL");
    expect(callWarnings.length).toBeGreaterThan(0);
  });

  it("reports violation line numbers greater than 0", () => {
    const snippet = `
      function test(val: string | null): string {
        return val.toUpperCase();
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/test.ts");
    for (const v of result.violations) {
      expect(v.line).toBeGreaterThan(0);
    }
  });
});

describe("analyzeSymbolicSafety — metadata", () => {
  it("returns pathsAnalyzed >= 1 for a snippet with at least one function", () => {
    const snippet = `function foo(x: number): number { return x * 2; }`;
    const result = analyzeSymbolicSafety(snippet, "/server/foo.ts");
    expect(result.pathsAnalyzed).toBeGreaterThanOrEqual(1);
  });

  it("returns durationMs >= 0", () => {
    const snippet = `function bar(): void {}`;
    const result = analyzeSymbolicSafety(snippet, "/server/bar.ts");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles invalid TypeScript syntax without throwing", () => {
    const snippet = `function broken( { return; }`;
    expect(() => analyzeSymbolicSafety(snippet, "/server/broken.ts")).not.toThrow();
  });

  it("handles very large snippets without hanging (MAX_PATHS guard)", () => {
    // Generate a snippet with many nested if statements to trigger path explosion
    let snippet = "function complex(a: string | null, b: string | null, c: string | null): void {\n";
    for (let i = 0; i < 10; i++) {
      snippet += `  if (a) { if (b) { if (c) { const x${i} = a.length; } } }\n`;
    }
    snippet += "}";
    const start = Date.now();
    const result = analyzeSymbolicSafety(snippet, "/server/complex.ts");
    const elapsed = Date.now() - start;
    // Should complete in under 5 seconds
    expect(elapsed).toBeLessThan(5000);
    expect(result).toBeDefined();
  });
});

describe("formatSymbolicViolations", () => {
  it("returns empty string when no violations exist", () => {
    const result = analyzeSymbolicSafety("function safe(): void {}", "/server/safe.ts");
    expect(formatSymbolicViolations(result)).toBe("");
  });

  it("returns formatted string when violations exist", () => {
    const snippet = `
      function test(val: string | null): string {
        return val.toUpperCase();
      }
    `;
    const result = analyzeSymbolicSafety(snippet, "/server/test.ts");
    if (result.violations.length > 0) {
      const formatted = formatSymbolicViolations(result);
      expect(formatted).toContain("SYMBOLIC EXECUTION");
      expect(formatted).toContain("paths");
    }
  });

  it("limits output to 5 violations maximum", () => {
    // Create a result with many violations
    const manyViolations = {
      violations: Array.from({ length: 10 }, (_, i) => ({
        kind: "NULL_DEREF" as const,
        message: `Violation ${i}`,
        line: i + 1,
        severity: "warning" as const,
      })),
      pathsAnalyzed: 5,
      durationMs: 10,
      safe: false,
    };
    const formatted = formatSymbolicViolations(manyViolations);
    const lines = formatted.split("\n").filter(l => l.includes("[WARNING]") || l.includes("[CRITICAL]"));
    expect(lines.length).toBeLessThanOrEqual(5);
  });
});
