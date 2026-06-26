/**
 * probabilisticTypeInference.test.ts — Comprehensive tests for probabilisticTypeInference.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearTypeProfiles,
  observeRuntimeType,
  getTypeProfile,
  getHighRiskProfilesForFile,
  formatTypeProfileContext,
  getTypeProfileStats,
  pruneStaleProfiles,
  getRuntimeTypeString,
  checkSnippetForNullRiskAccess,
} from "./probabilisticTypeInference.js";

// Reset module state before each test
beforeEach(() => {
  clearTypeProfiles();
});

describe("getRuntimeTypeString", () => {
  it("returns 'null' for null", () => {
    expect(getRuntimeTypeString(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(getRuntimeTypeString(undefined)).toBe("undefined");
  });

  it("returns 'string' for string values", () => {
    expect(getRuntimeTypeString("hello")).toBe("string");
  });

  it("returns 'number' for number values", () => {
    expect(getRuntimeTypeString(42)).toBe("number");
  });

  it("returns 'boolean' for boolean values", () => {
    expect(getRuntimeTypeString(true)).toBe("boolean");
    expect(getRuntimeTypeString(false)).toBe("boolean");
  });

  it("returns 'never[]' for empty arrays", () => {
    expect(getRuntimeTypeString([])).toBe("never[]");
  });

  it("returns typed array for non-empty arrays", () => {
    const result = getRuntimeTypeString([1, 2, 3]);
    expect(result).toContain("[]");
  });

  it("returns '{}' for empty objects", () => {
    expect(getRuntimeTypeString({})).toBe("{}");
  });

  it("returns object shape for non-empty objects", () => {
    const result = getRuntimeTypeString({ name: "Alice", age: 30 });
    expect(result).toContain("{");
    expect(result).toContain("name");
  });

  it("returns 'function' for functions", () => {
    expect(getRuntimeTypeString(() => {})).toBe("function");
  });
});

describe("observeRuntimeType and getTypeProfile", () => {
  it("creates a new profile on first observation", () => {
    observeRuntimeType("server/foo.ts.myVar", "hello");
    const profile = getTypeProfile("server/foo.ts.myVar");
    expect(profile).toBeDefined();
    expect(profile!.totalObservations).toBe(1);
  });

  it("increments observation count on repeated calls", () => {
    observeRuntimeType("server/foo.ts.counter", 1);
    observeRuntimeType("server/foo.ts.counter", 2);
    observeRuntimeType("server/foo.ts.counter", 3);
    const profile = getTypeProfile("server/foo.ts.counter");
    expect(profile!.totalObservations).toBe(3);
  });

  it("tracks multiple types for the same path", () => {
    observeRuntimeType("server/bar.ts.mixed", "hello");
    observeRuntimeType("server/bar.ts.mixed", null);
    observeRuntimeType("server/bar.ts.mixed", 42);
    const profile = getTypeProfile("server/bar.ts.mixed");
    // Should have at least 2 different types observed
    expect(Object.keys(profile!.observations).length).toBeGreaterThanOrEqual(2);
  });

  it("computes nullProbability correctly", () => {
    // 2 nulls out of 10 observations = 20%
    for (let i = 0; i < 8; i++) observeRuntimeType("server/baz.ts.prob", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("server/baz.ts.prob", null);
    const profile = getTypeProfile("server/baz.ts.prob");
    expect(profile!.nullProbability).toBeCloseTo(0.2, 2);
  });

  it("marks isHighNullRisk when null probability >= 15%", () => {
    for (let i = 0; i < 8; i++) observeRuntimeType("server/risk.ts.highRisk", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("server/risk.ts.highRisk", null);
    const profile = getTypeProfile("server/risk.ts.highRisk");
    expect(profile!.isHighNullRisk).toBe(true);
  });

  it("does NOT mark isHighNullRisk when null probability < 15%", () => {
    for (let i = 0; i < 99; i++) observeRuntimeType("server/safe.ts.lowRisk", "string");
    observeRuntimeType("server/safe.ts.lowRisk", null);
    const profile = getTypeProfile("server/safe.ts.lowRisk");
    expect(profile!.isHighNullRisk).toBe(false);
  });

  it("updates dominantType to the most common type", () => {
    for (let i = 0; i < 5; i++) observeRuntimeType("server/dom.ts.dominant", "string");
    observeRuntimeType("server/dom.ts.dominant", null);
    const profile = getTypeProfile("server/dom.ts.dominant");
    expect(profile!.dominantType).toBe("string");
  });
});

describe("getHighRiskProfilesForFile", () => {
  it("returns profiles matching the file basename", () => {
    // The path matching uses the last segment of the filePath (basename without extension)
    // and checks if the profile.path includes it
    for (let i = 0; i < 8; i++) observeRuntimeType("riskFile.userId", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("riskFile.userId", null);
    // getHighRiskProfilesForFile checks: p.path.includes(basename of filePath)
    // basename of "/server/riskFile.ts" is "riskFile.ts"
    // "riskFile.userId" includes "riskFile" but not "riskFile.ts"
    // The matching is: normalized.split("/").pop() = "riskFile.ts"
    // So we need the profile path to include "riskFile.ts"
    clearTypeProfiles();
    for (let i = 0; i < 8; i++) observeRuntimeType("riskFile.ts.userId", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("riskFile.ts.userId", null);
    const profiles = getHighRiskProfilesForFile("/server/riskFile.ts");
    expect(profiles.length).toBeGreaterThan(0);
  });

  it("returns empty array when no high-risk profiles match the file", () => {
    const profiles = getHighRiskProfilesForFile("/server/nonExistentFile.ts");
    expect(profiles).toHaveLength(0);
  });

  it("does not return low-risk profiles", () => {
    // 1 null out of 100 = 1% — below the 15% threshold
    for (let i = 0; i < 99; i++) observeRuntimeType("lowRisk.ts.prop", "string");
    observeRuntimeType("lowRisk.ts.prop", null);
    const profiles = getHighRiskProfilesForFile("/server/lowRisk.ts");
    expect(profiles).toHaveLength(0);
  });
});

describe("formatTypeProfileContext", () => {
  it("returns empty string when no high-risk profiles exist", () => {
    const result = formatTypeProfileContext("/server/emptyFile.ts");
    expect(result).toBe("");
  });

  it("returns formatted context when high-risk profiles exist", () => {
    for (let i = 0; i < 8; i++) observeRuntimeType("contextFile.ts.prop", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("contextFile.ts.prop", null);
    const result = formatTypeProfileContext("/server/contextFile.ts");
    expect(result).toContain("RUNTIME TYPE OBSERVATIONS");
    expect(result).toContain("contextFile.ts.prop");
    expect(result).toContain("null");
  });

  it("respects maxProfiles limit", () => {
    // Create 10 high-risk profiles for the same file
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 8; j++) observeRuntimeType(`limitFile.ts.prop${i}`, "string");
      for (let j = 0; j < 2; j++) observeRuntimeType(`limitFile.ts.prop${i}`, null);
    }
    const result = formatTypeProfileContext("/server/limitFile.ts", 3);
    // Should not list more than 3 profiles
    const lines = result.split("\n").filter(l => l.trim().startsWith("limitFile.ts.prop"));
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("checkSnippetForNullRiskAccess", () => {
  it("returns empty array when no high-risk profiles exist for the file", () => {
    const warnings = checkSnippetForNullRiskAccess("const x = foo.bar;", "/server/noProfiles.ts");
    expect(warnings).toHaveLength(0);
  });

  it("flags unsafe property access on high-risk paths", () => {
    for (let i = 0; i < 8; i++) observeRuntimeType("riskAccess.ts.userId", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("riskAccess.ts.userId", null);
    // Direct property access without null guard should be flagged
    const snippet = "const name = req.userId.toUpperCase();";
    const warnings = checkSnippetForNullRiskAccess(snippet, "/server/riskAccess.ts");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].path).toContain("userId");
  });

  it("does NOT flag optional chaining access", () => {
    for (let i = 0; i < 8; i++) observeRuntimeType("safeAccess.ts.userId", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("safeAccess.ts.userId", null);
    const snippet = "const name = req?.userId?.toUpperCase();";
    const warnings = checkSnippetForNullRiskAccess(snippet, "/server/safeAccess.ts");
    expect(warnings.filter(w => w.path.includes("userId"))).toHaveLength(0);
  });
});

describe("getTypeProfileStats", () => {
  it("returns zero stats when no observations have been made", () => {
    const stats = getTypeProfileStats();
    expect(stats.totalProfiles).toBe(0);
    expect(stats.highRiskProfiles).toBe(0);
    expect(stats.totalObservations).toBe(0);
  });

  it("increments highRiskProfiles count correctly", () => {
    for (let i = 0; i < 8; i++) observeRuntimeType("statsFile.prop", "string");
    for (let i = 0; i < 2; i++) observeRuntimeType("statsFile.prop", null);
    const stats = getTypeProfileStats();
    expect(stats.totalProfiles).toBe(1);
    expect(stats.highRiskProfiles).toBe(1);
    expect(stats.totalObservations).toBe(10);
  });

  it("counts multiple profiles correctly", () => {
    observeRuntimeType("file.propA", "string");
    observeRuntimeType("file.propB", 42);
    const stats = getTypeProfileStats();
    expect(stats.totalProfiles).toBe(2);
    expect(stats.totalObservations).toBe(2);
  });
});

describe("pruneStaleProfiles", () => {
  it("returns 0 when no profiles are stale", () => {
    observeRuntimeType("fresh.prop", "string");
    const pruned = pruneStaleProfiles(30);
    expect(pruned).toBe(0);
  });

  it("prunes profiles older than maxAgeDays", () => {
    observeRuntimeType("stale.prop", "string");
    // Manually backdate the observation
    const profile = getTypeProfile("stale.prop");
    if (profile && profile.observations["string"]) {
      const pastDate = Date.now() - 31 * 24 * 60 * 60 * 1000;
      profile.observations["string"].lastSeen = pastDate;
    }
    const pruned = pruneStaleProfiles(30);
    expect(pruned).toBe(1);
    expect(getTypeProfile("stale.prop")).toBeUndefined();
  });

  it("does not prune profiles that are within the age limit", () => {
    observeRuntimeType("recent.prop", "string");
    const pruned = pruneStaleProfiles(30);
    expect(pruned).toBe(0);
    expect(getTypeProfile("recent.prop")).toBeDefined();
  });
});
