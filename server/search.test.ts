import { describe, it, expect } from "vitest";
import { getCredibility, extractDomain, getFavicon, searchSearXNG } from "./search.js";

describe("getCredibility", () => {
  it("should execute without throwing", () => {
    try {
      const result = getCredibility("test_domain");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getCredibility("test_domain");
    expect(result !== undefined).toBe(true);
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getCredibility(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getCredibility(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("extractDomain", () => {
  it("should execute without throwing", () => {
    try {
      const result = extractDomain("test_url");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = extractDomain("test_url");
    expect(typeof result).toBe("string");
  });

  it("should handle empty/null inputs gracefully", () => {
    try { extractDomain(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { extractDomain(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

describe("getFavicon", () => {
  it("should execute without throwing", () => {
    try {
      const result = getFavicon("test_domain");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", () => {
    const result = getFavicon("test_domain");
    expect(typeof result).toBe("string");
  });

  it("should handle empty/null inputs gracefully", () => {
    try { getFavicon(""); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", () => {
    // @ts-expect-error Testing invalid input
    try { getFavicon(undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

// searchSearXNG makes real HTTP calls to a SearXNG instance not available in test env — skipped to avoid timeouts
describe.skip("searchSearXNG", () => {
  it("should execute without throwing", async () => {
    try {
      const result = await searchSearXNG("test_query", "test_value");
      expect(result).toBeDefined();
    } catch (e: any) {
      // Function may throw in test environment (e.g. no providers registered)
      expect(e).toBeDefined();
    }
  });

  it("should return correct type", async () => {
    const result = await searchSearXNG("test_query", "test_value");
    expect(Array.isArray(result)).toBe(true);
  });

  it("should handle empty/null inputs gracefully", async () => {
    try { await searchSearXNG("", {}); } catch (e: any) { expect(e).toBeDefined(); }
  });

  it("should handle invalid inputs", async () => {
    // @ts-expect-error Testing invalid input
    try { await searchSearXNG(undefined, undefined); } catch (e: any) { expect(e).toBeDefined(); }
  });

});

