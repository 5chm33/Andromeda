/**
 * aiChangelog.test.ts — SOTA tests for aiChangelog.ts
 *
 * Strategy: getChangelogPath() uses process.cwd() to resolve CHANGELOG_AI.md.
 * We use process.chdir() to a temp directory per test so all fs operations
 * run against real files in an isolated location. No fs mocking needed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { appendChangelogEntry, getRecentChanges } from "./aiChangelog";

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-changelog-test-"));
  // Copy package.json so getCurrentVersion() works
  fs.copyFileSync(
    path.join(originalCwd, "package.json"),
    path.join(tmpDir, "package.json")
  );
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("aiChangelog", () => {
  describe("appendChangelogEntry", () => {
    it("creates CHANGELOG_AI.md with a header on first call", () => {
      appendChangelogEntry(
        "prop-001",
        "server/selfImprove.ts",
        "Improve retry logic",
        "Adds exponential backoff to reduce API hammering.",
        "reliability",
        "medium",
        0.87,
        "const delay = 1000;",
        "const delay = Math.pow(2, attempt) * 500;"
      );

      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      expect(fs.existsSync(changelogPath)).toBe(true);
      const content = fs.readFileSync(changelogPath, "utf-8");
      expect(content).toContain("CHANGELOG_AI.md — Andromeda Self-Improvement Log");
      expect(content).toContain("Improve retry logic");
      expect(content).toContain("selfImprove.ts");
      expect(content).toContain("reliability");
      expect(content).toContain("87%");
    });

    it("prepends new entries (newest first) on subsequent calls", () => {
      appendChangelogEntry("p1", "a.ts", "First change", "rationale A", "perf", "low", 0.9, "old", "new");
      appendChangelogEntry("p2", "b.ts", "Second change", "rationale B", "security", "high", 0.95, "old2", "new2");

      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      const content = fs.readFileSync(changelogPath, "utf-8");
      const firstIdx = content.indexOf("First change");
      const secondIdx = content.indexOf("Second change");
      // Second entry should appear BEFORE first (newest first)
      expect(secondIdx).toBeLessThan(firstIdx);
    });

    it("records multiFile changes with secondary files listed", () => {
      appendChangelogEntry(
        "p-multi",
        "server/core.ts",
        "Multi-file refactor",
        "Splits large module into smaller ones.",
        "architecture",
        "high",
        0.78,
        "old code",
        "new code",
        ["server/helpers.ts", "server/utils.ts"]
      );

      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      const content = fs.readFileSync(changelogPath, "utf-8");
      expect(content).toContain("Also modified");
      expect(content).toContain("helpers.ts");
      expect(content).toContain("utils.ts");
    });

    it("handles missing rationale gracefully", () => {
      expect(() => {
        appendChangelogEntry("p-no-rationale", "x.ts", "Title", "", "general", "low", 0.5, "a", "b");
      }).not.toThrow();

      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      const content = fs.readFileSync(changelogPath, "utf-8");
      expect(content).toContain("No rationale provided");
    });

    it("includes a diff block with removed and added lines", () => {
      appendChangelogEntry("p-diff", "y.ts", "Diff test", "reason", "general", "medium", 0.8, "line one\nline two", "line three\nline four");
      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      const content = fs.readFileSync(changelogPath, "utf-8");
      expect(content).toContain("```diff");
      expect(content).toContain("- line one");
      expect(content).toContain("+ line three");
    });

    it("appends to end when header separator is missing", () => {
      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      // Write a file without the expected header separator
      fs.writeFileSync(changelogPath, "# Custom Header\n\n");
      appendChangelogEntry("p-fallback", "z.ts", "Fallback append", "reason", "general", "low", 0.6, "a", "b");
      const content = fs.readFileSync(changelogPath, "utf-8");
      expect(content).toContain("Fallback append");
    });
  });

  describe("getRecentChanges", () => {
    it("returns 'No changes logged yet.' when no changelog exists", () => {
      const result = getRecentChanges();
      expect(result).toBe("No changes logged yet.");
    });

    it("returns a formatted summary of recent entries", () => {
      appendChangelogEntry("p1", "a.ts", "Alpha change", "reason", "perf", "low", 0.9, "old", "new");
      appendChangelogEntry("p2", "b.ts", "Beta change", "reason", "security", "high", 0.95, "old", "new");
      appendChangelogEntry("p3", "c.ts", "Gamma change", "reason", "general", "medium", 0.7, "old", "new");

      const result = getRecentChanges(2);
      // Should return at most 2 entries
      const lines = result.split("\n").filter(l => l.startsWith("- "));
      expect(lines.length).toBeLessThanOrEqual(2);
      // Most recent entries should appear
      expect(result).toContain("Gamma change");
    });

    it("handles a changelog with no ## entries gracefully", () => {
      const changelogPath = path.join(tmpDir, "CHANGELOG_AI.md");
      fs.writeFileSync(changelogPath, "corrupted content with no ## headers");
      const result = getRecentChanges();
      expect(result).toBe("No changes logged yet.");
    });
  });
});
