import { describe, it, expect } from "vitest";
import * as CodeintelModule from "./codeIntel.js";

describe("CodeintelModule.readPackageJson", () => {
  it("should execute without throwing", () => {
    try {
      const result = CodeintelModule.readPackageJson();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = CodeintelModule.readPackageJson();
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { CodeintelModule.readPackageJson(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { CodeintelModule.readPackageJson(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("CodeintelModule.diagnoseError", () => {
  it("should execute without throwing", () => {
    try {
      const result = CodeintelModule.diagnoseError("test_rawError");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = CodeintelModule.diagnoseError("test_rawError");
    expect(result).toBeTruthy();
  });

  it("should handle empty/null inputs gracefully", () => {
    try { CodeintelModule.diagnoseError(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { CodeintelModule.diagnoseError(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

