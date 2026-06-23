import { describe, it, expect } from "vitest";
import {
  queryUnifiedKnowledge,
  consolidateKnowledge,
  getUnifiedKnowledgeStats,
} from "./unifiedKnowledge.js";

describe("unifiedKnowledge", () => {
  it("getUnifiedKnowledgeStats returns a stats object", () => {
    const stats = getUnifiedKnowledgeStats();
    expect(stats).toBeDefined();
    expect(typeof stats).toBe("object");
  });

  it("getUnifiedKnowledgeStats has available and sources fields", () => {
    const stats = getUnifiedKnowledgeStats();
    expect(stats).toHaveProperty("available");
    expect(stats).toHaveProperty("sources");
    expect(Array.isArray(stats.sources)).toBe(true);
  });

  it("queryUnifiedKnowledge returns a UnifiedQueryResult with entries array", async () => {
    const result = await queryUnifiedKnowledge({ query: "test", limit: 5 });
    expect(result).toBeDefined();
    expect(result).toHaveProperty("entries");
    expect(Array.isArray(result.entries)).toBe(true);
  }, 10000);

  it("queryUnifiedKnowledge result has totalFound and queryTimeMs fields", async () => {
    const result = await queryUnifiedKnowledge({ query: "improvement", limit: 3 });
    expect(result).toHaveProperty("totalFound");
    expect(result).toHaveProperty("queryTimeMs");
    expect(typeof result.totalFound).toBe("number");
  }, 10000);

  it("consolidateKnowledge returns a ConsolidationResult shape", async () => {
    const result = await consolidateKnowledge();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("merged");
    expect(result).toHaveProperty("removed");
    expect(result).toHaveProperty("sourcesProcessed");
    expect(Array.isArray(result.sourcesProcessed)).toBe(true);
  }, 15000);

  it("consolidateKnowledge merged and removed are non-negative numbers", async () => {
    const result = await consolidateKnowledge();
    expect(result.merged).toBeGreaterThanOrEqual(0);
    expect(result.removed).toBeGreaterThanOrEqual(0);
  }, 15000);
});
