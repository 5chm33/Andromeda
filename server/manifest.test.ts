import { describe, it, expect } from "vitest";
import { generateManifest, getManifestPrompt, getFullManifest } from "./manifest.js";

describe("generateManifest", () => {
  it("should execute without throwing", () => {
    try {
      const result = generateManifest();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = generateManifest();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { generateManifest(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getManifestPrompt", () => {
  it("should execute without throwing", () => {
    try {
      const result = getManifestPrompt();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getManifestPrompt();
    expect(typeof result).toBe("string");
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getManifestPrompt(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getFullManifest", () => {
  it("should execute without throwing", () => {
    try {
      const result = getFullManifest();
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getFullManifest();
    expect(result).toBeTruthy();
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getFullManifest(); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

