/**
 * Andromeda v6.12 — Workspace Module Tests
 *
 * Tests for workspace file operations:
 *  - Path resolution and safety
 *  - File CRUD operations
 *  - Dangerous pattern detection
 */
import { describe, it, expect } from "vitest";
import {
  getServerDir,
  getWorkspaceDir,
  isFullFsEnabled,
  resolveFilePath,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  deleteWorkspaceFile,
} from "./workspace.js";

describe("workspace — Path Resolution", () => {
  it("getServerDir returns a non-empty string", () => {
    const dir = getServerDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("getWorkspaceDir returns a non-empty string", () => {
    const dir = getWorkspaceDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
  });

  it("getWorkspaceDir returns consistent results (caching)", () => {
    const dir1 = getWorkspaceDir();
    const dir2 = getWorkspaceDir();
    expect(dir1).toBe(dir2);
  });

  it("isFullFsEnabled returns a boolean", () => {
    const result = isFullFsEnabled();
    expect(typeof result).toBe("boolean");
  });
});

describe("workspace — File Path Safety", () => {
  it("resolveFilePath allows normal filenames", () => {
    const result = resolveFilePath("test.txt");
    expect(result).toHaveProperty("absPath");
    expect(result).toHaveProperty("allowed");
    expect(result.allowed).toBe(true);
  });

  it("resolveFilePath blocks path traversal", () => {
    const result = resolveFilePath("../../etc/passwd");
    expect(result.allowed).toBe(false);
  });

  it("resolveFilePath handles nested paths", () => {
    const result = resolveFilePath("subdir/file.ts");
    expect(result.allowed).toBe(true);
    expect(result.absPath).toContain("subdir");
  });
});

describe("workspace — File CRUD", () => {
  const testFile = `_test_${Date.now()}.txt`;
  const testContent = "Hello from workspace test";

  it("writeWorkspaceFile creates a file", async () => {
    await writeWorkspaceFile(testFile, testContent);
    // If no error thrown, write succeeded
    expect(true).toBe(true);
  });

  it("readWorkspaceFile reads back written content", async () => {
    await writeWorkspaceFile(testFile, testContent);
    const content = await readWorkspaceFile(testFile);
    expect(content).toBe(testContent);
  });

  it("listWorkspaceFiles includes the test file", async () => {
    await writeWorkspaceFile(testFile, testContent);
    const files = await listWorkspaceFiles();
    expect(Array.isArray(files)).toBe(true);
    const found = files.find(f => f.name === testFile);
    expect(found).toBeDefined();
    expect(found!.size).toBeGreaterThan(0);
  });

  it("deleteWorkspaceFile removes the file", async () => {
    await writeWorkspaceFile(testFile, testContent);
    await deleteWorkspaceFile(testFile);
    const files = await listWorkspaceFiles();
    const found = files.find(f => f.name === testFile);
    expect(found).toBeUndefined();
  });

  it("readWorkspaceFile throws for non-existent file", async () => {
    await expect(readWorkspaceFile("nonexistent_xyz_123.txt")).rejects.toThrow();
  });
});
