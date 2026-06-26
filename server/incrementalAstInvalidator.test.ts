/**
 * incrementalAstInvalidator.test.ts — Comprehensive tests for incrementalAstInvalidator.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  clearHashCache,
  computeFileHash,
  hasFileChanged,
  markFileParsed,
  findDirectImporters,
  getGraphAge,
  getInvalidatorStats,
  primeHashCache,
} from "./incrementalAstInvalidator.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-inv-test-"));
  // Reset in-memory state for test isolation
  clearHashCache();
});

describe("computeFileHash", () => {
  it("returns a non-empty hex string for an existing file", () => {
    const filePath = path.join(tmpDir, "test.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    const hash = computeFileHash(filePath);
    expect(hash).toMatch(/^[a-f0-9]{8,}$/);
  });

  it("returns null for a non-existent file", () => {
    const hash = computeFileHash(path.join(tmpDir, "nonexistent.ts"));
    expect(hash).toBeNull();
  });

  it("returns different hashes for different content", () => {
    const filePath1 = path.join(tmpDir, "a.ts");
    const filePath2 = path.join(tmpDir, "b.ts");
    fs.writeFileSync(filePath1, "const x = 1;");
    fs.writeFileSync(filePath2, "const y = 2;");
    expect(computeFileHash(filePath1)).not.toBe(computeFileHash(filePath2));
  });

  it("returns the same hash for identical content in different files", () => {
    const content = "export const foo = 'bar';";
    const filePath1 = path.join(tmpDir, "c.ts");
    const filePath2 = path.join(tmpDir, "d.ts");
    fs.writeFileSync(filePath1, content);
    fs.writeFileSync(filePath2, content);
    expect(computeFileHash(filePath1)).toBe(computeFileHash(filePath2));
  });
});

describe("hasFileChanged", () => {
  it("returns true for a file that has never been registered", () => {
    const filePath = path.join(tmpDir, "unknown.ts");
    fs.writeFileSync(filePath, "const a = 1;");
    expect(hasFileChanged(filePath)).toBe(true);
  });

  it("returns false for a file that has not changed since last markFileParsed", () => {
    const filePath = path.join(tmpDir, "clean.ts");
    fs.writeFileSync(filePath, "const a = 1;");
    markFileParsed(filePath);
    expect(hasFileChanged(filePath)).toBe(false);
  });

  it("returns true for a file that has changed since last markFileParsed", () => {
    const filePath = path.join(tmpDir, "dirty.ts");
    fs.writeFileSync(filePath, "const a = 1;");
    markFileParsed(filePath);
    fs.writeFileSync(filePath, "const a = 2;");
    expect(hasFileChanged(filePath)).toBe(true);
  });

  it("returns false for a non-existent file", () => {
    expect(hasFileChanged(path.join(tmpDir, "ghost.ts"))).toBe(false);
  });
});

describe("markFileParsed", () => {
  it("marks a file as parsed so hasFileChanged returns false", () => {
    const filePath = path.join(tmpDir, "marked.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    markFileParsed(filePath);
    expect(hasFileChanged(filePath)).toBe(false);
  });

  it("handles non-existent files gracefully", () => {
    expect(() => markFileParsed(path.join(tmpDir, "nonexistent.ts"))).not.toThrow();
  });

  it("updates the hash when content changes and file is re-marked", () => {
    const filePath = path.join(tmpDir, "update.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    markFileParsed(filePath);
    fs.writeFileSync(filePath, "const x = 2;");
    markFileParsed(filePath);
    expect(hasFileChanged(filePath)).toBe(false);
  });
});

describe("findDirectImporters", () => {
  it("finds files that import from the target", () => {
    const targetFile = path.join(tmpDir, "utils.ts");
    const importerFile = path.join(tmpDir, "main.ts");
    fs.writeFileSync(targetFile, "export const x = 1;");
    fs.writeFileSync(importerFile, "import { x } from './utils.js';\nconsole.log(x);");
    const importers = findDirectImporters(targetFile, tmpDir);
    expect(importers.some(f => f.includes("main.ts"))).toBe(true);
  });

  it("does not include the target file itself in importers", () => {
    const targetFile = path.join(tmpDir, "self.ts");
    fs.writeFileSync(targetFile, "export const x = 1;");
    const importers = findDirectImporters(targetFile, tmpDir);
    expect(importers.includes(targetFile)).toBe(false);
  });

  it("returns empty array when no files import from the target", () => {
    const targetFile = path.join(tmpDir, "isolated.ts");
    fs.writeFileSync(targetFile, "export const x = 1;");
    const importers = findDirectImporters(targetFile, tmpDir);
    expect(importers).toHaveLength(0);
  });

  it("handles non-existent server directory gracefully", () => {
    const targetFile = path.join(tmpDir, "target.ts");
    fs.writeFileSync(targetFile, "export const x = 1;");
    expect(() => findDirectImporters(targetFile, "/nonexistent/dir")).not.toThrow();
  });
});

describe("getGraphAge", () => {
  it("returns 0 when the graph has never been fully rebuilt", () => {
    expect(getGraphAge()).toBe(0);
  });

  it("returns a non-negative number after primeHashCache is called", () => {
    primeHashCache(tmpDir);
    const age = getGraphAge();
    expect(age).toBeGreaterThanOrEqual(0);
  });
});

describe("getInvalidatorStats", () => {
  it("returns zero cachedFiles on fresh init", () => {
    const stats = getInvalidatorStats();
    expect(stats.cachedFiles).toBe(0);
    expect(stats.lastFullRebuild).toBe(0);
  });

  it("increments cachedFiles after marking files as parsed", () => {
    const filePath = path.join(tmpDir, "tracked.ts");
    fs.writeFileSync(filePath, "const x = 1;");
    markFileParsed(filePath);
    const stats = getInvalidatorStats();
    expect(stats.cachedFiles).toBe(1);
  });
});

describe("primeHashCache", () => {
  it("primes the cache for all .ts files in the directory", () => {
    fs.writeFileSync(path.join(tmpDir, "file1.ts"), "const a = 1;");
    fs.writeFileSync(path.join(tmpDir, "file2.ts"), "const b = 2;");
    primeHashCache(tmpDir);
    const stats = getInvalidatorStats();
    expect(stats.cachedFiles).toBeGreaterThanOrEqual(2);
    expect(stats.lastFullRebuild).toBeGreaterThan(0);
  });

  it("does not include test files in the cache", () => {
    // Create a fresh isolated dir with only one non-test and one test file
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "prime-test-"));
    clearHashCache(); // Reset state
    fs.writeFileSync(path.join(freshDir, "module.ts"), "const a = 1;");
    fs.writeFileSync(path.join(freshDir, "module.test.ts"), "it('test', () => {});");
    primeHashCache(freshDir);
    const stats = getInvalidatorStats();
    // Only module.ts should be cached, not module.test.ts
    expect(stats.cachedFiles).toBe(1);
  });

  it("handles non-existent directory gracefully", () => {
    expect(() => primeHashCache("/nonexistent/dir")).not.toThrow();
  });
});
