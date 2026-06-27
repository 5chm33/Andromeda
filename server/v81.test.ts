/**
 * v81.test.ts — Code Intelligence
 * Comprehensive tests for all 6 v81 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { parseFile } from "./codeParser";
import { highlight, highlightCode } from "./syntaxHighlighter";
import { analyzeFunctionComplexity, analyzeFileComplexity } from "./codeComplexityAnalyzer";
import { detectDeadCode, _resetDeadCodeDetectorForTest } from "./deadCodeDetector";
import { formatCode, getDefaultConfig } from "./codeFormatterEngine";
import { indexSymbol, searchSymbols, getSymbolsByFile, getIndexSize, _resetCodeSearchIndexerForTest } from "./codeSearchIndexer";

// ─── codeParser ──────────────────────────────────────────────────────────────
describe("codeParser", () => {
  it("parses a simple TypeScript file", () => {
    const code = `import { foo } from "bar";\nfunction greet(name: string) { return "hello"; }\nclass MyClass {}`;
    const parsed = parseFile("test.ts", code);
    expect(parsed.lineCount).toBe(3);
    expect(parsed.functions).toContain("greet");
    expect(parsed.classes).toContain("MyClass");
  });

  it("detects imports", () => {
    const code = `import { useState } from "react";\nimport { useEffect } from "react";`;
    const parsed = parseFile("app.ts", code);
    expect(parsed.imports.length).toBeGreaterThan(0);
  });

  it("counts tokens", () => {
    const code = `const x = 42;`;
    const parsed = parseFile("x.ts", code);
    expect(parsed.tokenCount).toBeGreaterThan(0);
  });

  it("handles empty file", () => {
    const parsed = parseFile("empty.ts", "");
    expect(parsed.tokenCount).toBe(0);
    expect(parsed.functions.length).toBe(0);
  });

  it("handles comments", () => {
    const code = `// This is a comment\nconst x = 1;`;
    const parsed = parseFile("commented.ts", code);
    const commentTokens = parsed.tokens.filter(t => t.type === "comment");
    expect(commentTokens.length).toBeGreaterThan(0);
  });

  it("identifies string tokens", () => {
    const code = `const msg = "hello world";`;
    const parsed = parseFile("str.ts", code);
    const stringTokens = parsed.tokens.filter(t => t.type === "string");
    expect(stringTokens.length).toBeGreaterThan(0);
  });
});

// ─── syntaxHighlighter ───────────────────────────────────────────────────────
describe("syntaxHighlighter", () => {
  it("produces HTML output with color spans", () => {
    const tokens = [{ type: "keyword", value: "const" }, { type: "identifier", value: "x" }];
    const result = highlight(tokens, "html");
    expect(result.output).toContain("<span");
    expect(result.output).toContain("color:");
    expect(result.tokenCount).toBe(2);
  });

  it("produces ANSI output", () => {
    const tokens = [{ type: "keyword", value: "function" }];
    const result = highlight(tokens, "ansi");
    expect(result.output).toContain("\x1b[");
  });

  it("produces plain output", () => {
    const tokens = [{ type: "keyword", value: "const" }, { type: "identifier", value: "y" }];
    const result = highlight(tokens, "plain");
    expect(result.output).toBe("consty");
  });

  it("highlights code string directly", () => {
    const result = highlightCode("const x = 42;", "html");
    expect(result.output).toContain("const");
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it("escapes HTML special characters", () => {
    const tokens = [{ type: "operator", value: "<" }];
    const result = highlight(tokens, "html");
    expect(result.output).toContain("&lt;");
  });

  it("handles empty token list", () => {
    const result = highlight([], "html");
    expect(result.output).toBe("");
    expect(result.tokenCount).toBe(0);
  });
});

// ─── codeComplexityAnalyzer ──────────────────────────────────────────────────
describe("codeComplexityAnalyzer", () => {
  it("rates simple function as low complexity", () => {
    const code = `function add(a, b) { return a + b; }`;
    const result = analyzeFunctionComplexity("add", code);
    expect(result.rating).toBe("low");
    expect(result.cyclomaticComplexity).toBe(1);
  });

  it("increases complexity for conditionals", () => {
    const code = `function check(x) { if (x > 0) { return "pos"; } else if (x < 0) { return "neg"; } return "zero"; }`;
    const result = analyzeFunctionComplexity("check", code);
    expect(result.cyclomaticComplexity).toBeGreaterThan(1);
  });

  it("analyzes file with multiple functions", () => {
    const report = analyzeFileComplexity("test.ts", [
      { name: "simple", code: "function simple() { return 1; }" },
      { name: "complex", code: "function complex(x) { if (x) { for (let i=0;i<x;i++) { if (i%2) {} } } }" },
    ]);
    expect(report.functions.length).toBe(2);
    expect(report.maxCyclomatic).toBeGreaterThan(1);
  });

  it("handles empty function list", () => {
    const report = analyzeFileComplexity("empty.ts", []);
    expect(report.functions.length).toBe(0);
    expect(report.averageCyclomatic).toBe(0);
  });

  it("counts lines correctly", () => {
    const code = `function foo() {\n  const x = 1;\n  return x;\n}`;
    const result = analyzeFunctionComplexity("foo", code);
    expect(result.lineCount).toBeGreaterThan(0);
  });

  it("rates highly complex function correctly", () => {
    const code = Array(25).fill("if (x) {}").join("\n");
    const result = analyzeFunctionComplexity("mega", code);
    expect(result.rating).toBe("very_high");
  });
});

// ─── deadCodeDetector ────────────────────────────────────────────────────────
describe("deadCodeDetector", () => {
  beforeEach(() => _resetDeadCodeDetectorForTest());

  it("detects unreachable code after return", () => {
    const code = `function foo() {\n  return 1;\n  const x = 2;\n}`;
    const report = detectDeadCode("foo.ts", code, [], []);
    expect(report.unreachableBlocks).toBeGreaterThan(0);
  });

  it("detects unused exports", () => {
    const report = detectDeadCode("foo.ts", "export function bar() {}", ["bar", "baz"], ["bar"]);
    expect(report.unusedExports).toContain("baz");
  });

  it("returns no issues for clean code", () => {
    const code = `function clean() { return 42; }`;
    const report = detectDeadCode("clean.ts", code, [], ["clean"]);
    expect(report.issues.length).toBe(0);
  });

  it("detects unused imports", () => {
    const code = `import { useState } from "react";\nconst x = 1;`;
    const report = detectDeadCode("app.ts", code, [], []);
    expect(report.unusedImports).toContain("useState");
  });

  it("generates issue IDs", () => {
    const report = detectDeadCode("foo.ts", "", ["unused1"], []);
    expect(report.issues[0].issueId).toMatch(/^dci-/);
  });

  it("resets cleanly", () => {
    _resetDeadCodeDetectorForTest();
    const report = detectDeadCode("foo.ts", "", ["x"], []);
    expect(report.issues[0].issueId).toBe("dci-1");
  });
});

// ─── codeFormatterEngine ─────────────────────────────────────────────────────
describe("codeFormatterEngine", () => {
  it("trims trailing whitespace", () => {
    const result = formatCode("const x = 1;   \nconst y = 2;  ");
    expect(result.formatted).not.toMatch(/\s+\n/);
  });

  it("adds trailing newline", () => {
    const result = formatCode("const x = 1;", { trailingNewline: true });
    expect(result.formatted.endsWith("\n")).toBe(true);
  });

  it("converts double quotes to single quotes", () => {
    const result = formatCode(`const s = "hello";`, { singleQuotes: true });
    expect(result.formatted).toContain("'hello'");
  });

  it("reports lines exceeding max length", () => {
    const longLine = "const x = " + "a".repeat(200) + ";";
    const result = formatCode(longLine, { maxLineLength: 80 });
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("returns change count > 0 when changes made", () => {
    const result = formatCode("const x = 1;   ", { trimTrailingWhitespace: true });
    expect(result.changeCount).toBeGreaterThan(0);
  });

  it("returns default config", () => {
    const cfg = getDefaultConfig();
    expect(cfg.indentSize).toBe(2);
    expect(cfg.maxLineLength).toBe(120);
  });
});

// ─── codeSearchIndexer ───────────────────────────────────────────────────────
describe("codeSearchIndexer", () => {
  beforeEach(() => _resetCodeSearchIndexerForTest());

  it("indexes a symbol and finds it by exact name", () => {
    indexSymbol({ name: "getUserById", kind: "function", fileName: "users.ts", line: 10, signature: "getUserById(id: string): User", docComment: "Fetches a user by ID" });
    const results = searchSymbols("getUserById");
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("exact");
    expect(results[0].score).toBe(100);
  });

  it("finds symbols by prefix", () => {
    indexSymbol({ name: "getUserById", kind: "function", fileName: "users.ts", line: 10, signature: "", docComment: "" });
    indexSymbol({ name: "getUserByEmail", kind: "function", fileName: "users.ts", line: 20, signature: "", docComment: "" });
    const results = searchSymbols("getUser");
    expect(results.length).toBe(2);
    expect(results[0].matchType).toBe("prefix");
  });

  it("filters by kind", () => {
    indexSymbol({ name: "UserService", kind: "class", fileName: "users.ts", line: 1, signature: "", docComment: "" });
    indexSymbol({ name: "userHelper", kind: "function", fileName: "users.ts", line: 50, signature: "", docComment: "" });
    const results = searchSymbols("user", { kind: "class" });
    expect(results.every(r => r.symbol.kind === "class")).toBe(true);
  });

  it("filters by file name", () => {
    indexSymbol({ name: "foo", kind: "function", fileName: "a.ts", line: 1, signature: "", docComment: "" });
    indexSymbol({ name: "foo", kind: "function", fileName: "b.ts", line: 1, signature: "", docComment: "" });
    const results = searchSymbols("foo", { fileName: "a.ts" });
    expect(results.length).toBe(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) indexSymbol({ name: `func${i}`, kind: "function", fileName: "f.ts", line: i, signature: "", docComment: "" });
    const results = searchSymbols("func", { limit: 3 });
    expect(results.length).toBe(3);
  });

  it("resets cleanly", () => {
    indexSymbol({ name: "x", kind: "variable", fileName: "x.ts", line: 1, signature: "", docComment: "" });
    _resetCodeSearchIndexerForTest();
    expect(getIndexSize()).toBe(0);
  });
});
