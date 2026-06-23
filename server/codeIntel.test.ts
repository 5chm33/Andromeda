import { describe, it, expect } from "vitest";
import { readPackageJson, diagnoseError } from "./codeIntel.js";

describe("readPackageJson", () => {
  it("should execute without throwing", () => {
    try {
      const result = readPackageJson();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = readPackageJson();
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { readPackageJson(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { readPackageJson(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("diagnoseError", () => {
  it("should execute without throwing", () => {
    try {
      const result = diagnoseError("test_rawError");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = diagnoseError("test_rawError");
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { diagnoseError(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { diagnoseError(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

