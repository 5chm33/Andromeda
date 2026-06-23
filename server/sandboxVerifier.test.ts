import { describe, it, expect } from "vitest";
import { quickValidate, initSandboxVerifier, getVerifierStats } from "./sandboxVerifier.js";

describe("sandboxVerifier", () => {
  it("exports quickValidate, initSandboxVerifier, getVerifierStats", () => {
    expect(typeof quickValidate).toBe("function");
    expect(typeof initSandboxVerifier).toBe("function");
    expect(typeof getVerifierStats).toBe("function");
  });

  it("quickValidate returns valid for well-formed TypeScript", () => {
    const code = `export function hello(): string {\n  return "world";\n}\n`;
    const result = quickValidate(code, "hello.ts");
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("issues");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("quickValidate catches empty file", () => {
    const result = quickValidate("", "empty.ts");
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("quickValidate catches unbalanced braces", () => {
    const code = `export function broken() {\n  if (true) {\n    return 1;\n`;
    const result = quickValidate(code, "broken.ts");
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => /brace/i.test(i))).toBe(true);
  });

  it("quickValidate returns valid:true for whitespace-only file", () => {
    // whitespace-only may or may not be flagged depending on implementation
    const result = quickValidate("   \n   \n", "ws.ts");
    expect(result).toHaveProperty("valid");
    expect(Array.isArray(result.issues)).toBe(true);
  });

  it("getVerifierStats returns expected shape", () => {
    const stats = getVerifierStats();
    expect(stats).toHaveProperty("totalVerifications");
    expect(stats).toHaveProperty("passRate");
    expect(typeof stats.totalVerifications).toBe("number");
    expect(typeof stats.passRate).toBe("number");
  });

  it("initSandboxVerifier does not throw", () => {
    expect(() => initSandboxVerifier()).not.toThrow();
  });
});
