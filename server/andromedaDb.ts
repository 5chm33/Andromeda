/**
 * andromedaDb.ts — Central SQLite Persistence Layer
 * Andromeda v9.14.0
 *
 * Replaces all JSON flat-file stores with a single SQLite database that
 * survives restarts. Uses better-sqlite3 (synchronous, zero-config, no server).
 *
 * Tables:
 *   kv_store           — Generic key-value store (replaces most .json files)
 *   vector_memory      — Embedding vectors for semantic search
 *   system_learnings   — RSI learnings and architectural decisions
 *   rsi_cycles         — RSI cycle history (proposals, applies, rollbacks)
 *   feedback           — RLHF thumbs up/down on AI responses
 *   eval_recordings    — Real request recordings for the eval harness
 *   benchmark_results  — Benchmark run history
 *   rsi_proposals      — Pending RSI proposals (for HIL review)
 *
 * All writes are synchronous (SQLite WAL mode) — no async needed.
 * The database file lives at: <cwd>/data/andromeda.db
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

// ─── Database Location ───────────────────────────────────────────────────────
const DATA_DIR = process.env.ANDROMEDA_WORKSPACE
  ? join(process.env.ANDROMEDA_WORKSPACE, "data")
  : join(process.cwd(), "data");

const DB_PATH = join(DATA_DIR, "andromeda.db");

let _db: Database.Database | null = null;

/** Get or create the singleton SQLite database instance */
export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);

  // WAL mode: concurrent reads + writes, much faster than default journal
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -64000"); // 64MB cache
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  return _db;
}

/** Initialize all tables (idempotent — safe to call multiple times) */
function initSchema(db: Database.Database): void {
  db.exec(`
    -- Generic key-value store: replaces benchmark_report.json, code_quality.json, etc.
    CREATE TABLE IF NOT EXISTS kv_store (
      key       TEXT PRIMARY KEY,
      value     TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );

    -- Embedding vectors for semantic memory search
    CREATE TABLE IF NOT EXISTS vector_memory (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      vector     TEXT NOT NULL,  -- JSON array of floats
      model      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_vector_memory_created ON vector_memory(created_at);

    -- System learnings from RSI cycles
    CREATE TABLE IF NOT EXISTS system_learnings (
      id              TEXT PRIMARY KEY,
      category        TEXT NOT NULL,
      title           TEXT NOT NULL,
      content         TEXT NOT NULL,
      context         TEXT NOT NULL DEFAULT '',
      confidence      REAL NOT NULL DEFAULT 0.5,
      applicable_to   TEXT NOT NULL DEFAULT '[]',  -- JSON array of module names
      created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      last_referenced INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      reference_count INTEGER NOT NULL DEFAULT 0,
      superseded_by   TEXT
    );

    -- RSI cycle history
    CREATE TABLE IF NOT EXISTS rsi_cycles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_num    INTEGER NOT NULL,
      started_at   INTEGER NOT NULL,
      finished_at  INTEGER,
      proposals    INTEGER NOT NULL DEFAULT 0,
      applied      INTEGER NOT NULL DEFAULT 0,
      rolled_back  INTEGER NOT NULL DEFAULT 0,
      score_before REAL,
      score_after  REAL,
      summary      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rsi_cycles_started ON rsi_cycles(started_at DESC);

    -- RLHF: thumbs up/down feedback on AI responses
    CREATE TABLE IF NOT EXISTS feedback (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      query       TEXT NOT NULL,
      response    TEXT NOT NULL,
      rating      INTEGER NOT NULL CHECK(rating IN (-1, 1)),  -- -1 = thumbs down, 1 = thumbs up
      comment     TEXT,
      module      TEXT,  -- which module handled this (for RSI targeting)
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_module ON feedback(module, rating);
    CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

    -- Real eval recordings: actual user requests for the eval harness
    CREATE TABLE IF NOT EXISTS eval_recordings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      query       TEXT NOT NULL,
      response    TEXT NOT NULL,
      tools_used  TEXT NOT NULL DEFAULT '[]',  -- JSON array
      latency_ms  INTEGER,
      model       TEXT,
      rating      INTEGER,  -- from feedback table if rated
      created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      replayed_at INTEGER,
      replay_score REAL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_recordings_created ON eval_recordings(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eval_recordings_rated ON eval_recordings(rating) WHERE rating IS NOT NULL;

    -- Benchmark run history
    CREATE TABLE IF NOT EXISTS benchmark_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      score       REAL NOT NULL,
      degradations INTEGER NOT NULL DEFAULT 0,
      details     TEXT NOT NULL DEFAULT '{}'  -- JSON
    );
    CREATE INDEX IF NOT EXISTS idx_benchmark_results_run ON benchmark_results(run_at DESC);

    -- RSI proposals (pending + historical)
    CREATE TABLE IF NOT EXISTS rsi_proposals (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      target_file  TEXT NOT NULL,
      confidence   REAL NOT NULL DEFAULT 0.5,
      status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'applied', 'rolled_back')),
      diff         TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      reviewed_at  INTEGER,
      reviewed_by  TEXT  -- 'human' | 'auto'
    );
    CREATE INDEX IF NOT EXISTS idx_rsi_proposals_status ON rsi_proposals(status, created_at DESC);
  `);
}

// ─── KV Store Helpers ────────────────────────────────────────────────────────

/** Read a JSON value from the key-value store */
export function kvGet<T>(key: string, defaultValue: T): T {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM kv_store WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return defaultValue;
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

/** Write a JSON value to the key-value store */
export function kvSet(key: string, value: unknown): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO kv_store (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), Date.now());
  } catch (err) {
    console.warn("[andromedaDb] kvSet failed for key", key, err);
  }
}

/** Delete a key from the key-value store */
export function kvDelete(key: string): void {
  try {
    const db = getDb();
    db.prepare("DELETE FROM kv_store WHERE key = ?").run(key);
  } catch (err) {
    console.warn("[andromedaDb] kvDelete failed for key", key, err);
  }
}

// ─── Vector Memory ───────────────────────────────────────────────────────────

export interface DbVectorEntry {
  id: string;
  text: string;
  vector: number[];
  model: string;
  created_at: number;
}

/** Insert or update a vector memory entry */
export function upsertVector(entry: DbVectorEntry): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO vector_memory (id, text, vector, model, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        vector = excluded.vector,
        model = excluded.model,
        created_at = excluded.created_at
    `).run(entry.id, entry.text, JSON.stringify(entry.vector), entry.model, entry.created_at);
  } catch (err) {
    console.warn("[andromedaDb] upsertVector failed:", err);
  }
}

/** Get all vector memory entries */
export function getAllVectors(): DbVectorEntry[] {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT id, text, vector, model, created_at FROM vector_memory ORDER BY created_at DESC").all() as Array<{id: string; text: string; vector: string; model: string; created_at: number}>;
    return rows.map(r => ({ ...r, vector: JSON.parse(r.vector) as number[] }));
  } catch {
    return [];
  }
}

/** Delete vector entries older than ttlMs */
export function pruneVectors(ttlMs: number, maxEntries: number): void {
  try {
    const db = getDb();
    const cutoff = Date.now() - ttlMs;
    db.prepare("DELETE FROM vector_memory WHERE created_at < ?").run(cutoff);
    // Keep only the most recent maxEntries
    db.prepare(`
      DELETE FROM vector_memory WHERE id NOT IN (
        SELECT id FROM vector_memory ORDER BY created_at DESC LIMIT ?
      )
    `).run(maxEntries);
  } catch (err) {
    console.warn("[andromedaDb] pruneVectors failed:", err);
  }
}

// ─── RLHF Feedback ───────────────────────────────────────────────────────────

export interface FeedbackEntry {
  sessionId: string;
  messageId: string;
  query: string;
  response: string;
  rating: 1 | -1;
  comment?: string;
  module?: string;
}

/** Record a thumbs up/down rating */
export function recordFeedback(entry: FeedbackEntry): number {
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO feedback (session_id, message_id, query, response, rating, comment, module)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.sessionId, entry.messageId, entry.query, entry.response, entry.rating, entry.comment ?? null, entry.module ?? null);
    return result.lastInsertRowid as number;
  } catch (err) {
    console.warn("[andromedaDb] recordFeedback failed:", err);
    return -1;
  }
}

/** Get modules with the most negative feedback (for RSI targeting) */
export function getLowRatedModules(limit = 10): Array<{ module: string; negativeCount: number; positiveCount: number; ratio: number }> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        module,
        SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative_count,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive_count,
        CAST(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) AS REAL) /
          MAX(1, COUNT(*)) as ratio
      FROM feedback
      WHERE module IS NOT NULL
      GROUP BY module
      HAVING negative_count > 0
      ORDER BY ratio DESC, negative_count DESC
      LIMIT ?
    `).all(limit) as Array<{ module: string; negative_count: number; positive_count: number; ratio: number }>;
    return rows.map(r => ({
      module: r.module,
      negativeCount: r.negative_count,
      positiveCount: r.positive_count,
      ratio: r.ratio,
    }));
  } catch {
    return [];
  }
}

/** Get recent feedback summary */
export function getFeedbackSummary(): { total: number; positive: number; negative: number; ratio: number } {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END) as negative
      FROM feedback
    `).get() as { total: number; positive: number; negative: number };
    const ratio = row.total > 0 ? row.positive / row.total : 0;
    return { ...row, ratio };
  } catch {
    return { total: 0, positive: 0, negative: 0, ratio: 0 };
  }
}

// ─── Eval Recordings ─────────────────────────────────────────────────────────

export interface EvalRecording {
  sessionId: string;
  query: string;
  response: string;
  toolsUsed: string[];
  latencyMs?: number;
  model?: string;
}

/** Record a real user interaction for later eval replay */
export function recordEval(entry: EvalRecording): number {
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO eval_recordings (session_id, query, response, tools_used, latency_ms, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entry.sessionId, entry.query, entry.response, JSON.stringify(entry.toolsUsed), entry.latencyMs ?? null, entry.model ?? null);
    return result.lastInsertRowid as number;
  } catch (err) {
    console.warn("[andromedaDb] recordEval failed:", err);
    return -1;
  }
}

/** Get eval recordings for replay (unrated ones first, then oldest) */
export function getEvalsForReplay(limit = 20): Array<{ id: number; query: string; response: string; toolsUsed: string[]; model: string | null }> {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, query, response, tools_used, model
      FROM eval_recordings
      WHERE replayed_at IS NULL
      ORDER BY rating ASC NULLS LAST, created_at ASC
      LIMIT ?
    `).all(limit) as Array<{ id: number; query: string; response: string; tools_used: string; model: string | null }>;
    return rows.map(r => ({ ...r, toolsUsed: JSON.parse(r.tools_used) as string[] }));
  } catch {
    return [];
  }
}

/** Mark an eval as replayed with a quality score */
export function markEvalReplayed(id: number, score: number): void {
  try {
    const db = getDb();
    db.prepare("UPDATE eval_recordings SET replayed_at = ?, replay_score = ? WHERE id = ?").run(Date.now(), score, id);
  } catch (err) {
    console.warn("[andromedaDb] markEvalReplayed failed:", err);
  }
}

// ─── RSI Cycle History ───────────────────────────────────────────────────────

export interface RsiCycleRecord {
  cycleNum: number;
  startedAt: number;
  proposals: number;
  applied: number;
  rolledBack: number;
  scoreBefore?: number;
  scoreAfter?: number;
  summary?: string;
}

/** Insert a new RSI cycle record, returns the row ID */
export function insertRsiCycle(record: RsiCycleRecord): number {
  try {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO rsi_cycles (cycle_num, started_at, proposals, applied, rolled_back, score_before, score_after, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.cycleNum, record.startedAt, record.proposals, record.applied, record.rolledBack, record.scoreBefore ?? null, record.scoreAfter ?? null, record.summary ?? null);
    return result.lastInsertRowid as number;
  } catch (err) {
    console.warn("[andromedaDb] insertRsiCycle failed:", err);
    return -1;
  }
}

/** Finish a cycle by updating its end time */
export function finishRsiCycle(id: number, finishedAt: number, scoreAfter?: number): void {
  try {
    const db = getDb();
    db.prepare("UPDATE rsi_cycles SET finished_at = ?, score_after = ? WHERE id = ?").run(finishedAt, scoreAfter ?? null, id);
  } catch (err) {
    console.warn("[andromedaDb] finishRsiCycle failed:", err);
  }
}

/** Get the last N RSI cycles */
export function getRecentRsiCycles(limit = 20): RsiCycleRecord[] {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM rsi_cycles ORDER BY started_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      cycleNum: r.cycle_num as number,
      startedAt: r.started_at as number,
      proposals: r.proposals as number,
      applied: r.applied as number,
      rolledBack: r.rolled_back as number,
      scoreBefore: r.score_before as number | undefined,
      scoreAfter: r.score_after as number | undefined,
      summary: r.summary as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ─── Benchmark Results ───────────────────────────────────────────────────────

/** Record a benchmark run result */
export function recordBenchmarkResult(score: number, degradations: number, details: Record<string, unknown>): void {
  try {
    const db = getDb();
    db.prepare("INSERT INTO benchmark_results (score, degradations, details) VALUES (?, ?, ?)").run(score, degradations, JSON.stringify(details));
  } catch (err) {
    console.warn("[andromedaDb] recordBenchmarkResult failed:", err);
  }
}

/** Get benchmark score trend (last N runs) */
export function getBenchmarkTrend(limit = 30): Array<{ runAt: number; score: number; degradations: number }> {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT run_at, score, degradations FROM benchmark_results ORDER BY run_at DESC LIMIT ?").all(limit) as Array<{ run_at: number; score: number; degradations: number }>;
    return rows.map(r => ({ runAt: r.run_at, score: r.score, degradations: r.degradations }));
  } catch {
    return [];
  }
}

// ─── Migrate from JSON flat files ────────────────────────────────────────────

/**
 * One-time migration: reads existing JSON files from the data/ directory
 * and imports them into the SQLite kv_store. Safe to call multiple times.
 */
export function migrateFromJson(): void {
  const db = getDb();
  const alreadyMigrated = db.prepare("SELECT value FROM kv_store WHERE key = '_migration_done'").get();
  if (alreadyMigrated) return;

  const jsonFiles = [
    "benchmark_baselines.json",
    "benchmark_report.json",
    "code_quality.json",
    "codebase_health.json",
    "dependency_audit.json",
    "doc_report.json",
    "quality_history.json",
    "skill_graph.json",
    "test_coverage.json",
    "self_model.json",
    "system_memory.json",
  ];

  let migrated = 0;
  for (const file of jsonFiles) {
    const filePath = join(DATA_DIR, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      const key = file.replace(".json", "");
      kvSet(key, JSON.parse(content));
      migrated++;
    } catch {
      // Skip malformed files
    }
  }

  kvSet("_migration_done", { at: Date.now(), files: migrated });
  if (migrated > 0) {
    console.log(`[andromedaDb] Migrated ${migrated} JSON files to SQLite`);
  }
}

/** Close the database connection (for graceful shutdown) */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
