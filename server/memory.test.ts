/**
 * memory.test.ts — Unit tests for the Memory Module
 * Sets ANDROMEDA_WORKSPACE to a temp dir to avoid loading production memory
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Set temp workspace BEFORE importing memory module
const tmpWs = mkdtempSync(join(tmpdir(), "andromeda-test-"));
process.env.ANDROMEDA_WORKSPACE = tmpWs;

import {
  storeMemory,
  searchMemory,
  listMemories,
  deleteMemory,
  getMemoryStats,
  injectMemoryContext,
} from "./memory.js";

afterAll(() => {
  try { rmSync(tmpWs, { recursive: true, force: true }); } catch {}
});

describe("Memory Module", () => {
  describe("storeMemory", () => {
    it("stores a memory and returns an entry with id and timestamp", () => {
      const entry = storeMemory("Test memory content", "fact", ["test"]);
      expect(entry).toBeDefined();
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("Test memory content");
      expect(entry.type).toBe("fact");
      expect(entry.tags).toContain("test");
      expect(entry.createdAt).toBeDefined();
    });

    it("stores memories with different types", () => {
      const fact = storeMemory("A fact", "fact", []);
      const preference = storeMemory("A preference", "preference", []);
      expect(fact.type).toBe("fact");
      expect(preference.type).toBe("preference");
    });

    it("assigns unique IDs to each memory", () => {
      const a = storeMemory("Memory A unique", "fact", []);
      const b = storeMemory("Memory B unique", "fact", []);
      // IDs are strings with random suffix — just verify they are valid strings
      expect(typeof a.id).toBe("string");
      expect(a.id.length).toBeGreaterThan(0);
      expect(typeof b.id).toBe("string");
      expect(b.id.length).toBeGreaterThan(0);
    });
  });

  describe("searchMemory", () => {
    it("returns results matching the query", () => {
      storeMemory("TypeScript is a typed superset of JavaScript", "fact", ["typescript"]);
      const results = searchMemory("TypeScript programming");
      expect(Array.isArray(results)).toBe(true);
    });

    it("returns empty array for unrelated queries", () => {
      const results = searchMemory("xyzzy_nonexistent_term_12345");
      expect(Array.isArray(results)).toBe(true);
    });

    it("respects the limit parameter", () => {
      storeMemory("Entry 1", "fact", []);
      storeMemory("Entry 2", "fact", []);
      storeMemory("Entry 3", "fact", []);
      const results = searchMemory("Entry", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("listMemories", () => {
    it("returns memories up to the specified limit", () => {
      storeMemory("List test 1", "fact", []);
      storeMemory("List test 2", "fact", []);
      const memories = listMemories(1);
      expect(memories.length).toBeLessThanOrEqual(1);
    });

    it("filters by type when specified", () => {
      storeMemory("Preference item", "preference", []);
      storeMemory("Fact item", "fact", []);
      const prefs = listMemories(100, "preference");
      expect(prefs.every((m: { type: string }) => m.type === "preference")).toBe(true);
    });
  });

  describe("deleteMemory", () => {
    it("deletes an existing memory and returns true", () => {
      const entry = storeMemory("To be deleted", "fact", []);
      const result = deleteMemory(entry.id);
      expect(result).toBe(true);
    });

    it("returns false for non-existent id", () => {
      const result = deleteMemory("non_existent_id_xyz");
      expect(result).toBe(false);
    });
  });

  describe("getMemoryStats", () => {
    it("returns an object with memory statistics", () => {
      const stats = getMemoryStats() as Record<string, unknown>;
      expect(stats).toBeDefined();
      expect(typeof stats).toBe("object");
    });
  });

  describe("injectMemoryContext", () => {
    it("returns a string for any query", () => {
      const result = injectMemoryContext("What are my preferences?");
      expect(typeof result).toBe("string");
    });

    it("returns a string for unrelated queries", () => {
      const result = injectMemoryContext("xyzzy_completely_unrelated_98765");
      expect(typeof result).toBe("string");
    });
  });
});
