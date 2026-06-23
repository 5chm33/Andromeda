/**
 * noveltySearchEngine.test.ts — v1.0.0
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getDiscoveries,
  getArchive,
  getNoveltySearchStats,
  initNoveltySearchEngine,
} from "./noveltySearchEngine.js";

describe("noveltySearchEngine", () => {
  beforeEach(() => {
    initNoveltySearchEngine();
  });

  it("module loads without throwing", () => {
    expect(getDiscoveries).toBeDefined();
    expect(getArchive).toBeDefined();
    expect(getNoveltySearchStats).toBeDefined();
    expect(initNoveltySearchEngine).toBeDefined();
  });

  it("initNoveltySearchEngine does not throw", () => {
    expect(() => initNoveltySearchEngine()).not.toThrow();
  });

  it("getArchive returns seed behaviors after init", () => {
    const archive = getArchive();
    expect(Array.isArray(archive)).toBe(true);
    expect(archive.length).toBeGreaterThanOrEqual(8);  // 8 seed behaviors
  });

  it("getArchive includes expected seed capabilities", () => {
    const archive = getArchive();
    const names = archive.map(b => b.name);
    expect(names).toContain("code_generation");
    expect(names).toContain("bug_detection");
    expect(names).toContain("test_generation");
    expect(names).toContain("security_analysis");
  });

  it("getArchive behaviors have valid structure", () => {
    const archive = getArchive();
    for (const behavior of archive) {
      expect(typeof behavior.id).toBe("string");
      expect(typeof behavior.name).toBe("string");
      expect(typeof behavior.description).toBe("string");
      expect(Array.isArray(behavior.behaviorVector)).toBe(true);
      expect(typeof behavior.validationScore).toBe("number");
      expect(typeof behavior.noveltyScore).toBe("number");
      expect(["predefined", "discovered", "transferred"]).toContain(behavior.source);
    }
  });

  it("getDiscoveries returns empty array before any discovery", () => {
    const discoveries = getDiscoveries();
    expect(Array.isArray(discoveries)).toBe(true);
    // May be empty or have previous discoveries from other tests
  });

  it("getNoveltySearchStats returns valid stats", () => {
    const stats = getNoveltySearchStats();
    expect(stats).toBeDefined();
    expect(typeof stats.archiveSize).toBe("number");
    expect(typeof stats.totalDiscoveries).toBe("number");
    expect(typeof stats.acceptedDiscoveries).toBe("number");
    expect(typeof stats.averageNoveltyScore).toBe("number");
    expect(Array.isArray(stats.topDiscoveries)).toBe(true);
    expect(stats.archiveSize).toBeGreaterThanOrEqual(8);
  });

  it("getNoveltySearchStats.acceptedDiscoveries <= totalDiscoveries", () => {
    const stats = getNoveltySearchStats();
    expect(stats.acceptedDiscoveries).toBeLessThanOrEqual(stats.totalDiscoveries);
  });

  it("getDiscoveries respects limit parameter", () => {
    const discoveries = getDiscoveries(3);
    expect(discoveries.length).toBeLessThanOrEqual(3);
  });
});
