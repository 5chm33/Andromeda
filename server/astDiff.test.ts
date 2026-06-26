/**
 * astDiff.test.ts — Andromeda v12.10.1 Audit
 * Comprehensive tests for AST-based structural diffing.
 * All functions are pure (no LLM calls) so tests run without mocking.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalize,
  astDiff,
  findAndApplySnippet,
  detectConflict,
  type AstDiffResult,
  type SnippetMatchResult,
} from "./astDiff.js";

// ─── Module loading ───────────────────────────────────────────────────────────
describe("astDiff — module", () => {
  it("loads without errors", async () => {
    await expect(import("./astDiff.js")).resolves.toBeDefined();
  });

  it("exports all required functions", async () => {
    const mod = await import("./astDiff.js");
    expect(typeof mod.canonicalize).toBe("function");
    expect(typeof mod.astDiff).toBe("function");
    expect(typeof mod.findAndApplySnippet).toBe("function");
    expect(typeof mod.detectConflict).toBe("function");
  });
});

// ─── canonicalize ─────────────────────────────────────────────────────────────
describe("astDiff — canonicalize", () => {
  it("returns a non-empty string for valid TypeScript", () => {
    const result = canonicalize("const x = 1;");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("strips single-line comments", () => {
    const withComment = canonicalize("const x = 1; // this is a comment");
    const withoutComment = canonicalize("const x = 1;");
    expect(withComment).toBe(withoutComment);
  });

  it("strips multi-line comments", () => {
    const withComment = canonicalize("/* header */\nconst x = 1;");
    const withoutComment = canonicalize("const x = 1;");
    expect(withComment).toBe(withoutComment);
  });

  it("normalizes whitespace differences", () => {
    const spaced = canonicalize("const   x   =   1;");
    const normal = canonicalize("const x = 1;");
    expect(spaced).toBe(normal);
  });

  it("normalizes indentation differences", () => {
    const indented = canonicalize("  function foo() {\n    return 1;\n  }");
    const noIndent = canonicalize("function foo() {\nreturn 1;\n}");
    expect(indented).toBe(noIndent);
  });

  it("two semantically identical blocks produce the same canonical form", () => {
    const a = canonicalize("function add(a: number, b: number): number { return a + b; }");
    const b = canonicalize("function add( a: number , b: number ) : number { return a+b ; }");
    expect(a).toBe(b);
  });

  it("two different functions produce different canonical forms", () => {
    const a = canonicalize("function foo() { return 1; }");
    const b = canonicalize("function bar() { return 2; }");
    expect(a).not.toBe(b);
  });

  it("handles empty string without throwing", () => {
    expect(() => canonicalize("")).not.toThrow();
  });

  it("handles syntax errors without throwing (falls back gracefully)", () => {
    expect(() => canonicalize("this is not valid typescript }{{{")).not.toThrow();
  });

  it("returns a string even for invalid input", () => {
    const result = canonicalize("}{}{invalid");
    expect(typeof result).toBe("string");
  });
});

// ─── astDiff ──────────────────────────────────────────────────────────────────
describe("astDiff — astDiff", () => {
  it("returns AstDiffResult with all required fields", () => {
    const result = astDiff("const x = 1;", "const x = 2;");
    expect(result).toHaveProperty("structurallyIdentical");
    expect(result).toHaveProperty("hasSemanticChanges");
    expect(result).toHaveProperty("canonicalBefore");
    expect(result).toHaveProperty("canonicalAfter");
    expect(result).toHaveProperty("diffSummary");
  });

  it("structurallyIdentical is true for identical snippets", () => {
    const result = astDiff("const x = 1;", "const x = 1;");
    expect(result.structurallyIdentical).toBe(true);
    expect(result.hasSemanticChanges).toBe(false);
  });

  it("structurallyIdentical is false for different snippets", () => {
    const result = astDiff("const x = 1;", "const y = 2;");
    expect(result.structurallyIdentical).toBe(false);
    expect(result.hasSemanticChanges).toBe(true);
  });

  it("structurallyIdentical is true when only comments differ", () => {
    const result = astDiff(
      "// old comment\nconst x = 1;",
      "// new comment\nconst x = 1;"
    );
    expect(result.structurallyIdentical).toBe(true);
  });

  it("structurallyIdentical is true when only whitespace differs", () => {
    const result = astDiff("const x = 1;", "const  x  =  1;");
    expect(result.structurallyIdentical).toBe(true);
  });

  it("hasSemanticChanges is true when a function is added", () => {
    const result = astDiff(
      "const x = 1;",
      "const x = 1;\nfunction foo() { return 1; }"
    );
    expect(result.hasSemanticChanges).toBe(true);
  });

  it("hasSemanticChanges is true when a function is removed", () => {
    const result = astDiff(
      "const x = 1;\nfunction foo() { return 1; }",
      "const x = 1;"
    );
    expect(result.hasSemanticChanges).toBe(true);
  });

  it("diffSummary is a non-empty string", () => {
    const result = astDiff("const x = 1;", "const x = 2;");
    expect(typeof result.diffSummary).toBe("string");
    expect(result.diffSummary.length).toBeGreaterThan(0);
  });

  it("diffSummary is 'identical' for identical snippets", () => {
    const result = astDiff("const x = 1;", "const x = 1;");
    expect(result.diffSummary).toBe("identical");
  });

  it("canonicalBefore and canonicalAfter are strings", () => {
    const result = astDiff("const x = 1;", "const x = 2;");
    expect(typeof result.canonicalBefore).toBe("string");
    expect(typeof result.canonicalAfter).toBe("string");
  });

  it("handles empty strings without throwing", () => {
    expect(() => astDiff("", "")).not.toThrow();
    expect(() => astDiff("const x = 1;", "")).not.toThrow();
    expect(() => astDiff("", "const x = 1;")).not.toThrow();
  });

  it("handles syntax errors without throwing", () => {
    expect(() => astDiff("}{invalid", "const x = 1;")).not.toThrow();
  });

  it("structurallyIdentical and hasSemanticChanges are boolean", () => {
    const result = astDiff("const x = 1;", "const x = 2;");
    expect(typeof result.structurallyIdentical).toBe("boolean");
    expect(typeof result.hasSemanticChanges).toBe("boolean");
  });
});

// ─── findAndApplySnippet ──────────────────────────────────────────────────────
describe("astDiff — findAndApplySnippet", () => {
  const fileContent = `import { foo } from './foo';

function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

function add(a: number, b: number): number {
  return a + b;
}

export { greet, add };
`;

  it("finds and applies an exact snippet match", () => {
    const original = "function add(a: number, b: number): number {\n  return a + b;\n}";
    const proposed = "function add(a: number, b: number): number {\n  return a + b + 0;\n}";
    const result = findAndApplySnippet(fileContent, original, proposed);
    expect(result.found).toBe(true);
    expect(result.proposedContent).toContain("return a + b + 0;");
    expect(result.proposedContent).toContain("function greet");
  });

  it("returns found:false when snippet is not in file", () => {
    const result = findAndApplySnippet(
      fileContent,
      "function notInFile() { return 42; }",
      "function notInFile() { return 99; }"
    );
    expect(result.found).toBe(false);
  });

  it("result.proposedContent contains proposed snippet when found", () => {
    const original = "function greet(name: string): string {\n  return `Hello, ${name}!`;\n}";
    const proposed = "function greet(name: string): string {\n  return `Hi, ${name}!`;\n}";
    const result = findAndApplySnippet(fileContent, original, proposed);
    if (result.found) {
      expect(result.proposedContent).toContain("Hi,");
    }
  });

  it("result.proposedContent preserves surrounding code when found", () => {
    const original = "function add(a: number, b: number): number {\n  return a + b;\n}";
    const proposed = "function add(a: number, b: number): number {\n  return a + b + 0;\n}";
    const result = findAndApplySnippet(fileContent, original, proposed);
    if (result.found) {
      expect(result.proposedContent).toContain("import { foo }");
      expect(result.proposedContent).toContain("export { greet, add }");
    }
  });

  it("handles empty file content without throwing", () => {
    expect(() => findAndApplySnippet("", "const x = 1;", "const x = 2;")).not.toThrow();
  });

  it("handles empty snippet without throwing", () => {
    expect(() => findAndApplySnippet(fileContent, "", "const x = 2;")).not.toThrow();
  });

  it("normalizedMatch is boolean", () => {
    const result = findAndApplySnippet(
      fileContent,
      "function add(a: number, b: number): number {\n  return a + b;\n}",
      "function add(a: number, b: number): number {\n  return a + b + 0;\n}"
    );
    expect(typeof result.normalizedMatch).toBe("boolean");
  });

  it("found is boolean", () => {
    const result = findAndApplySnippet(fileContent, "const x = 1;", "const x = 2;");
    expect(typeof result.found).toBe("boolean");
  });
});

// ─── detectConflict ───────────────────────────────────────────────────────────
describe("astDiff — detectConflict", () => {
  const originalFile = "function foo() { return 1; }\nfunction bar() { return 2; }";
  const snippet = "function foo() { return 1; }";

  it("returns conflicted:false when snippet is still present (no conflict)", () => {
    const result = detectConflict(originalFile, originalFile, snippet);
    expect(result).toHaveProperty("conflicted");
    expect(result).toHaveProperty("reason");
    expect(result.conflicted).toBe(false);
  });

  it("returns conflicted:true when snippet is no longer present", () => {
    const changedFile = "function foo() { return 99; }\nfunction bar() { return 2; }";
    const result = detectConflict(originalFile, changedFile, snippet);
    expect(result.conflicted).toBe(true);
  });

  it("returns conflicted:false for cosmetic whitespace changes", () => {
    const cosmeticFile = "function foo()  {  return 1;  }\nfunction bar() { return 2; }";
    const result = detectConflict(originalFile, cosmeticFile, snippet);
    expect(result.conflicted).toBe(false);
  });

  it("returns conflicted:false for comment-only changes", () => {
    const commentFile = "// new comment\nfunction foo() { return 1; }\nfunction bar() { return 2; }";
    const result = detectConflict(originalFile, commentFile, snippet);
    expect(result.conflicted).toBe(false);
  });

  it("reason is a non-empty string", () => {
    const result = detectConflict(originalFile, originalFile, snippet);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("conflicted is boolean", () => {
    const result = detectConflict(originalFile, originalFile, snippet);
    expect(typeof result.conflicted).toBe("boolean");
  });

  it("handles empty snippet without throwing", () => {
    expect(() => detectConflict(originalFile, originalFile, "")).not.toThrow();
  });

  it("handles empty file without throwing", () => {
    expect(() => detectConflict("", "", snippet)).not.toThrow();
  });

  it("handles all empty strings without throwing", () => {
    expect(() => detectConflict("", "", "")).not.toThrow();
  });
});
