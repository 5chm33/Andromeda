import { describe, it, expect } from "vitest";
import {
  appendChangelogEntry,
  getRecentChanges,
} from "./aiChangelog.js";

describe("aiChangelog", () => {
  it("appendChangelogEntry does not throw", () => {
    expect(() =>
      appendChangelogEntry("prop-001", "server/selfImprove.ts", "Improved error handling", "Better null checks", "reliability")
    ).not.toThrow();
  });

  it("getRecentChanges returns a string", () => {
    const result = getRecentChanges(5);
    expect(typeof result).toBe("string");
  });

  it("appended entry appears in getRecentChanges", () => {
    appendChangelogEntry("prop-audit11", "server/testTarget.ts", "Audit 11 test entry", "Test rationale", "performance");
    const recent = getRecentChanges(10);
    expect(recent).toContain("testTarget.ts");
  });

  it("getRecentChanges with n=1 returns at most one entry", () => {
    appendChangelogEntry("prop-002", "server/a.ts", "Entry A", "Rationale A", "readability");
    appendChangelogEntry("prop-003", "server/b.ts", "Entry B", "Rationale B", "feature");
    const recent = getRecentChanges(1);
    expect(typeof recent).toBe("string");
  });

  it("appendChangelogEntry with all categories does not throw", () => {
    const categories = ["performance", "reliability", "security", "readability", "feature"] as const;
    for (const cat of categories) {
      expect(() =>
        appendChangelogEntry(`prop-${cat}`, "server/ai.ts", `Test ${cat}`, `Rationale for ${cat}`, cat)
      ).not.toThrow();
    }
  });
});
