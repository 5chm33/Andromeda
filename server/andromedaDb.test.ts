/**
 * andromedaDb.test.ts
 *
 * Integration tests for andromedaDb.ts — the SQLite persistence layer.
 *
 * The global vitest.setup.ts mocks better-sqlite3 with an in-memory KV store.
 * Tests that rely on the mock's KV behavior (kvGet/kvSet/kvDelete) work fully.
 * Tests for other tables (vector, feedback, eval, rsi cycles, benchmarks) verify
 * that the functions exist, accept the correct signatures, and don't throw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ── Test isolation ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-db-test-"));
  process.env.ANDROMEDA_WORKSPACE = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  try {
    const mod = require("./andromedaDb.js");
    mod.closeDb?.();
  } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env.ANDROMEDA_WORKSPACE;
});

// ── KV Store ──────────────────────────────────────────────────────────────────

describe("KV Store", () => {
  it("sets and gets a string value", async () => {
    const { kvSet, kvGet } = await import("./andromedaDb.js");
    kvSet("test-key", "hello world");
    expect(kvGet("test-key", "default")).toBe("hello world");
  });

  it("returns default value for missing key", async () => {
    const { kvGet } = await import("./andromedaDb.js");
    expect(kvGet("nonexistent-key", 42)).toBe(42);
  });

  it("overwrites an existing value", async () => {
    const { kvSet, kvGet } = await import("./andromedaDb.js");
    kvSet("overwrite-key", "first");
    kvSet("overwrite-key", "second");
    expect(kvGet("overwrite-key", "default")).toBe("second");
  });

  it("stores and retrieves complex objects", async () => {
    const { kvSet, kvGet } = await import("./andromedaDb.js");
    const obj = { name: "Andromeda", version: 7, active: true, tags: ["rsi", "ai"] };
    kvSet("complex-obj", obj);
    const retrieved = kvGet<typeof obj>("complex-obj", { name: "", version: 0, active: false, tags: [] });
    expect(retrieved).toEqual(obj);
  });

  it("kvDelete does not throw for existing key", async () => {
    const { kvSet, kvDelete } = await import("./andromedaDb.js");
    kvSet("delete-me", "value");
    expect(() => kvDelete("delete-me")).not.toThrow();
  });

  it("kvDelete does not throw for nonexistent key", async () => {
    const { kvDelete } = await import("./andromedaDb.js");
    expect(() => kvDelete("ghost-key")).not.toThrow();
  });
});

// ── Vector Store ──────────────────────────────────────────────────────────────
// Note: The better-sqlite3 mock only implements kv_store tables.
// Vector store tests verify the API signatures and non-throwing behavior.

describe("Vector Store", () => {
  it("upsertVector accepts correct DbVectorEntry shape", async () => {
    const { upsertVector } = await import("./andromedaDb.js");
    expect(() => upsertVector({
      id: "vec-1",
      text: "test content",
      vector: [0.1, 0.2, 0.3],
      model: "text-embedding-ada-002",
      created_at: Date.now(),
    })).not.toThrow();
  });

  it("getAllVectors returns an array", async () => {
    const { getAllVectors } = await import("./andromedaDb.js");
    const vectors = getAllVectors();
    expect(Array.isArray(vectors)).toBe(true);
  });

  it("upsertVector handles multiple entries without throwing", async () => {
    const { upsertVector } = await import("./andromedaDb.js");
    for (let i = 0; i < 5; i++) {
      expect(() => upsertVector({
        id: `vec-${i}`,
        text: `content ${i}`,
        vector: [i * 0.1],
        model: "test-model",
        created_at: Date.now(),
      })).not.toThrow();
    }
  });

  it("pruneVectors accepts ttlMs and maxEntries without throwing", async () => {
    const { pruneVectors } = await import("./andromedaDb.js");
    expect(() => pruneVectors(50_000, 1000)).not.toThrow();
  });
});

// ── Feedback ──────────────────────────────────────────────────────────────────

describe("Feedback", () => {
  it("recordFeedback accepts correct FeedbackEntry shape", async () => {
    const { recordFeedback } = await import("./andromedaDb.js");
    expect(() => recordFeedback({
      sessionId: "sess-1",
      messageId: "msg-1",
      query: "What is 2+2?",
      response: "4",
      rating: 1,
      comment: "great",
      module: "rsiEngine",
    })).not.toThrow();
  });

  it("recordFeedback returns a number (row ID or -1 on mock)", async () => {
    const { recordFeedback } = await import("./andromedaDb.js");
    const id = recordFeedback({
      sessionId: "sess-2",
      messageId: "msg-2",
      query: "test",
      response: "answer",
      rating: -1,
      module: "badModule",
    });
    expect(typeof id).toBe("number");
  });

  it("getFeedbackSummary returns correct shape", async () => {
    const { getFeedbackSummary } = await import("./andromedaDb.js");
    const summary = getFeedbackSummary();
    expect(typeof summary.total).toBe("number");
    expect(typeof summary.positive).toBe("number");
    expect(typeof summary.negative).toBe("number");
    expect(typeof summary.ratio).toBe("number");
  });

  it("getLowRatedModules returns an array", async () => {
    const { getLowRatedModules } = await import("./andromedaDb.js");
    const result = getLowRatedModules(10);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── Eval Recordings ───────────────────────────────────────────────────────────

describe("Eval Recordings", () => {
  it("recordEval accepts correct EvalRecording shape", async () => {
    const { recordEval } = await import("./andromedaDb.js");
    expect(() => recordEval({
      sessionId: "sess-1",
      query: "What is 2+2?",
      response: "4",
      toolsUsed: ["calculator"],
      model: "deepseek-v3",
    })).not.toThrow();
  });

  it("recordEval returns a number", async () => {
    const { recordEval } = await import("./andromedaDb.js");
    const id = recordEval({
      sessionId: "sess-1",
      query: "test query",
      response: "test response",
      toolsUsed: [],
    });
    expect(typeof id).toBe("number");
  });

  it("getEvalsForReplay returns an array", async () => {
    const { getEvalsForReplay } = await import("./andromedaDb.js");
    const evals = getEvalsForReplay(10);
    expect(Array.isArray(evals)).toBe(true);
  });

  it("markEvalReplayed does not throw", async () => {
    const { markEvalReplayed } = await import("./andromedaDb.js");
    expect(() => markEvalReplayed(1, 0.95)).not.toThrow();
  });
});

// ── RSI Cycle Records ─────────────────────────────────────────────────────────

describe("RSI Cycle Records", () => {
  it("insertRsiCycle accepts correct RsiCycleRecord shape", async () => {
    const { insertRsiCycle } = await import("./andromedaDb.js");
    expect(() => insertRsiCycle({
      cycleNum: 1,
      startedAt: Date.now(),
      proposals: 3,
      applied: 2,
      rolledBack: 1,
      scoreBefore: 0.75,
    })).not.toThrow();
  });

  it("insertRsiCycle returns a number", async () => {
    const { insertRsiCycle } = await import("./andromedaDb.js");
    const id = insertRsiCycle({
      cycleNum: 1,
      startedAt: Date.now(),
      proposals: 1,
      applied: 1,
      rolledBack: 0,
    });
    expect(typeof id).toBe("number");
  });

  it("finishRsiCycle does not throw", async () => {
    const { insertRsiCycle, finishRsiCycle } = await import("./andromedaDb.js");
    const id = insertRsiCycle({
      cycleNum: 1,
      startedAt: Date.now(),
      proposals: 1,
      applied: 1,
      rolledBack: 0,
    });
    expect(() => finishRsiCycle(id, Date.now() + 1000, 0.85)).not.toThrow();
  });

  it("getRecentRsiCycles returns an array", async () => {
    const { getRecentRsiCycles } = await import("./andromedaDb.js");
    const cycles = getRecentRsiCycles(10);
    expect(Array.isArray(cycles)).toBe(true);
  });
});

// ── Benchmark Results ─────────────────────────────────────────────────────────

describe("Benchmark Results", () => {
  it("recordBenchmarkResult accepts correct parameters without throwing", async () => {
    const { recordBenchmarkResult } = await import("./andromedaDb.js");
    expect(() => recordBenchmarkResult(0.82, 0, { suite: "core", passed: 100 })).not.toThrow();
  });

  it("getBenchmarkTrend returns an array", async () => {
    const { getBenchmarkTrend } = await import("./andromedaDb.js");
    const trend = getBenchmarkTrend(10);
    expect(Array.isArray(trend)).toBe(true);
  });

  it("getBenchmarkTrend items have correct shape when non-empty", async () => {
    const { getBenchmarkTrend } = await import("./andromedaDb.js");
    const trend = getBenchmarkTrend(10);
    // If the mock returns items, verify their shape
    for (const item of trend) {
      expect(typeof item.score).toBe("number");
      expect(typeof item.runAt).toBe("number");
      expect(typeof item.degradations).toBe("number");
    }
  });
});

// ── getDb ─────────────────────────────────────────────────────────────────────

describe("getDb", () => {
  it("returns a database instance with prepare function", async () => {
    const { getDb } = await import("./andromedaDb.js");
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.prepare).toBe("function");
  });

  it("returns the same instance on repeated calls (singleton)", async () => {
    const { getDb } = await import("./andromedaDb.js");
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });
});

// ── closeDb ───────────────────────────────────────────────────────────────────

describe("closeDb", () => {
  it("does not throw when called", async () => {
    const { closeDb } = await import("./andromedaDb.js");
    expect(() => closeDb()).not.toThrow();
  });
});

// ── migrateFromJson ───────────────────────────────────────────────────────────

describe("migrateFromJson", () => {
  it("does not throw when called (no JSON files to migrate)", async () => {
    const { migrateFromJson } = await import("./andromedaDb.js");
    expect(() => migrateFromJson()).not.toThrow();
  });
});
