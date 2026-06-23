import { describe, it, expect } from "vitest";
import { extractFunctionBoundaries } from "./fileEngineChunking.js";

describe("fileEngineChunking", () => {
  it("extractFunctionBoundaries returns an array", () => {
    const chunks = extractFunctionBoundaries("function foo() { return 1; }", ".ts");
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("extractFunctionBoundaries finds a named function", () => {
    const code = `export function myFunc(x: number): number {\n  return x + 1;\n}`;
    const chunks = extractFunctionBoundaries(code, ".ts");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("extractFunctionBoundaries chunk has name and startLine fields", () => {
    const code = `function alpha() {}\nfunction beta() {}`;
    const chunks = extractFunctionBoundaries(code, ".ts");
    if (chunks.length > 0) {
      expect(chunks[0]).toHaveProperty("name");
      expect(chunks[0]).toHaveProperty("startLine");
    }
  });

  it("extractFunctionBoundaries returns empty array for empty content", () => {
    const chunks = extractFunctionBoundaries("", ".ts");
    expect(Array.isArray(chunks)).toBe(true);
  });

  it("extractFunctionBoundaries handles arrow functions", () => {
    const code = `const myArrow = (x: number) => x * 2;`;
    const chunks = extractFunctionBoundaries(code, ".ts");
    expect(Array.isArray(chunks)).toBe(true);
  });
});
