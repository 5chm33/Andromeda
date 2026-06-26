/**
 * rsiDb.ts — v6.30: Persistent RSI state storage
 *
 * Provides a unified storage API for RSI proposals, cycle history, episodic
 * memory snapshots, and eval history. Uses the existing Drizzle/MySQL connection
 * when DATABASE_URL is set; falls back to the existing JSON flat-file store
 * transparently so the system works with zero config out of the box.
 *
 * Tables added to drizzle/schema.ts (appended, not replacing existing tables):
 *   - rsi_proposals
 *   - rsi_cycles
 *   - rsi_eval_history
 *
 * The episodic memory table reuses the existing episodicMemory.ts JSON store
 * and adds a DB mirror for queryability.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "./logger.js";
import type { ImprovementProposal } from "./selfImprove.js";
import type { RSICycleResult } from "./rsiEngine.js";

const log = createLogger("rsiDb");

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getDataDir(): string {
  try {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const d = path.resolve(serverDir, "..", "data");
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  } catch {
    const d = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }
}

// ─── DB availability check ────────────────────────────────────────────────────

let _dbAvailable: boolean | null = null;

async function isDbAvailable(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    const { getDb } = await import("./db.js");
    const db = await getDb();
    _dbAvailable = db !== null;
  } catch {
    _dbAvailable = false;
  }
  return _dbAvailable;
}

// ─── RSI Proposals ────────────────────────────────────────────────────────────

/**
 * Persist a single proposal to the database (or JSON fallback).
 * Called by selfImprove.ts after generating each proposal.
 */
export async function dbSaveProposal(proposal: ImprovementProposal): Promise<void> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      // Use raw SQL via drizzle execute to avoid needing a schema import here
      await (db as any).execute(
        `INSERT INTO rsi_proposals
           (id, target_file, title, rationale, category, impact, confidence,
            diff, original_snippet, proposed_snippet, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           confidence = VALUES(confidence),
           updated_at = NOW()`,
        [
          proposal.id,
          proposal.targetFile,
          proposal.title,
          proposal.rationale,
          proposal.category,
          proposal.impact,
          proposal.confidence ?? 0,
          proposal.diff ?? "",
          proposal.originalSnippet ?? "",
          proposal.proposedSnippet ?? "",
          proposal.status,
        ]
      );
      log.info(`[rsiDb] Saved proposal ${proposal.id} to DB`);
      return;
    } catch (err) {
      log.warn(`[rsiDb] DB save failed, falling back to JSON: ${(err as Error).message}`);
    }
  }
  // JSON fallback — proposals are already persisted by selfImprove.ts's saveProposals()
  // so this is a no-op in fallback mode.
}

/**
 * Load all proposals from DB (or JSON fallback via selfImprove.ts).
 */
export async function dbLoadProposals(): Promise<ImprovementProposal[]> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      const rows = await (db as any).execute(
        `SELECT id, target_file, title, rationale, category, impact, confidence,
                diff, original_snippet, proposed_snippet, status,
                UNIX_TIMESTAMP(created_at)*1000 as created_at
         FROM rsi_proposals ORDER BY created_at DESC LIMIT 1000`
      );
      const rowsData = rows[0] as any[] | undefined;
      if (!rowsData) return [];
      return rowsData.map((r: any) => ({
        id: r.id,
        targetFile: r.target_file,
        title: r.title,
        rationale: r.rationale,
        category: r.category,
        impact: r.impact,
        confidence: r.confidence,
        diff: r.diff,
        originalSnippet: r.original_snippet,
        proposedSnippet: r.proposed_snippet,
        originalContent: "",
        proposedContent: "",
        createdAt: r.created_at,
        status: r.status,
      }));
    } catch (err) {
      log.warn(`[rsiDb] DB load failed, falling back to JSON: ${(err as Error).message}`);
    }
  }
  // JSON fallback
  try {
    const { listProposals } = await import("./selfImprove.js");
    return listProposals() as ImprovementProposal[];
  } catch {
    return [];
  }
}

// ─── RSI Cycles ───────────────────────────────────────────────────────────────

/**
 * Persist a completed RSI cycle result to the database.
 * Called by rsiEngine.ts after appendCycleHistory().
 */
export async function dbSaveCycle(result: RSICycleResult): Promise<void> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      await (db as any).execute(
        `INSERT IGNORE INTO rsi_cycles
           (cycle_id, started_at, completed_at, duration_ms,
            proposals_generated, proposals_applied, proposals_rejected,
            score_before, score_after, score_delta,
            applied_files, errors, benchmark_before, benchmark_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.cycleId,
          result.startedAt,
          result.completedAt,
          result.durationMs,
          result.proposalsGenerated,
          result.proposalsApplied,
          result.proposalsRejected,
          result.capabilityScoreBefore,
          result.capabilityScoreAfter,
          result.scoreImprovement,
          JSON.stringify(result.appliedFiles),
          JSON.stringify(result.errors),
          result.benchmarkBefore ? JSON.stringify(result.benchmarkBefore) : null,
          result.benchmarkAfter ? JSON.stringify(result.benchmarkAfter) : null,
        ]
      );
      log.info(`[rsiDb] Saved cycle ${result.cycleId} to DB`);
      return;
    } catch (err) {
      log.warn(`[rsiDb] DB cycle save failed: ${(err as Error).message}`);
    }
  }
  // JSON fallback — already handled by appendCycleHistory() in rsiEngine.ts
}

/**
 * Load recent RSI cycles from DB (or JSON fallback).
 */
export async function dbLoadCycles(limit = 50): Promise<RSICycleResult[]> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      const rows = await (db as any).execute(
        `SELECT cycle_id, started_at, completed_at, duration_ms,
                proposals_generated, proposals_applied, proposals_rejected,
                score_before, score_after, score_delta,
                applied_files, errors, benchmark_before, benchmark_after
         FROM rsi_cycles ORDER BY completed_at DESC LIMIT ?`,
        [limit]
      );
      return (rows[0] as any[]).map((r: any) => ({
        cycleId: r.cycle_id,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        phase: "idle" as const,
        proposalsGenerated: r.proposals_generated,
        proposalsApplied: r.proposals_applied,
        proposalsRejected: r.proposals_rejected,
        capabilityScoreBefore: r.score_before,
        capabilityScoreAfter: r.score_after,
        scoreImprovement: r.score_delta,
        appliedFiles: (() => { try { return JSON.parse(r.applied_files || "[]"); } catch { return []; } })(),
        errors: (() => { try { return JSON.parse(r.errors || "[]"); } catch { return []; } })(),
        memoryStoredCount: 0,
        benchmarkBefore: r.benchmark_before ? (() => { try { return JSON.parse(r.benchmark_before); } catch { return undefined; } })() : undefined,
        benchmarkAfter: r.benchmark_after ? (() => { try { return JSON.parse(r.benchmark_after); } catch { return undefined; } })() : undefined,
      }));
    } catch (err) {
      log.warn(`[rsiDb] DB cycle load failed: ${(err as Error).message}`);
    }
  }
  // JSON fallback — read from workspace/rsi-history.jsonl
  try {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    const histPath = path.resolve(serverDir, "..", "workspace", "rsi-history.jsonl");
    if (!fs.existsSync(histPath)) return [];
    const lines = fs.readFileSync(histPath, "utf8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map(l => JSON.parse(l)) as RSICycleResult[];
  } catch {
    return [];
  }
}

// ─── RSI Eval History ─────────────────────────────────────────────────────────

export type EvalHistoryEntry = {
  runId: string;
  ranAt: string;
  taskCount: number;
  passed: number;
  failed: number;
  percentage: number;
  triggeredByCycleId?: string;
};

/**
 * Persist an eval run result to the database.
 */
export async function dbSaveEvalRun(entry: EvalHistoryEntry): Promise<void> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      await (db as any).execute(
        `INSERT IGNORE INTO rsi_eval_history
           (run_id, ran_at, task_count, passed, failed, percentage, triggered_by_cycle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.runId,
          entry.ranAt,
          entry.taskCount,
          entry.passed,
          entry.failed,
          entry.percentage,
          entry.triggeredByCycleId ?? null,
        ]
      );
      return;
    } catch (err) {
      log.warn(`[rsiDb] DB eval save failed: ${(err as Error).message}`);
    }
  }
  // JSON fallback
  const p = path.join(getDataDir(), "eval_history.json");
  let history: EvalHistoryEntry[] = [];
  try { history = JSON.parse(fs.readFileSync(p, "utf8")); } catch { history = []; }
  history.push(entry);
  if (history.length > 500) history = history.slice(-500);
  fs.writeFileSync(p, JSON.stringify(history, null, 2), "utf8");
}

/**
 * Load eval history from DB or JSON fallback.
 */
export async function dbLoadEvalHistory(limit = 100): Promise<EvalHistoryEntry[]> {
  if (await isDbAvailable()) {
    try {
      const { getDb } = await import("./db.js");
      const db = await getDb();
      if (!db) throw new Error("no db");
      const rows = await (db as any).execute(
        `SELECT run_id, ran_at, task_count, passed, failed, percentage, triggered_by_cycle_id
         FROM rsi_eval_history ORDER BY ran_at DESC LIMIT ?`,
        [limit]
      );
      return (rows[0] as any[]).map((r: any) => ({
        runId: r.run_id,
        ranAt: r.ran_at,
        taskCount: r.task_count,
        passed: r.passed,
        failed: r.failed,
        percentage: r.percentage,
        triggeredByCycleId: r.triggered_by_cycle_id ?? undefined,
      }));
    } catch (err) {
      log.warn(`[rsiDb] DB eval load failed: ${(err as Error).message}`);
    }
  }
  const p = path.join(getDataDir(), "eval_history.json");
  try {
    const history: EvalHistoryEntry[] = JSON.parse(fs.readFileSync(p, "utf8"));
    return history.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ─── DB Migration (create tables if they don't exist) ─────────────────────────

/**
 * Idempotent: creates the three RSI tables if they don't already exist.
 * Called once on server startup from initModules.ts.
 */
export async function runRsiDbMigration(): Promise<void> {
  if (!(await isDbAvailable())) {
    log.info("[rsiDb] No DB connection — using JSON flat-file store");
    return;
  }
  try {
    const { getDb } = await import("./db.js");
    const db = await getDb();
    if (!db) return;

    await (db as any).execute(`
      CREATE TABLE IF NOT EXISTS rsi_proposals (
        id              VARCHAR(64)   PRIMARY KEY,
        target_file     VARCHAR(512)  NOT NULL,
        title           VARCHAR(512)  NOT NULL,
        rationale       TEXT,
        category        VARCHAR(64),
        impact          VARCHAR(16),
        confidence      FLOAT         DEFAULT 0,
        diff            LONGTEXT,
        original_snippet TEXT,
        proposed_snippet TEXT,
        status          VARCHAR(32)   DEFAULT 'pending',
        created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_target_file (target_file(255)),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await (db as any).execute(`
      CREATE TABLE IF NOT EXISTS rsi_cycles (
        cycle_id            VARCHAR(64)   PRIMARY KEY,
        started_at          VARCHAR(32)   NOT NULL,
        completed_at        VARCHAR(32)   NOT NULL,
        duration_ms         INT           DEFAULT 0,
        proposals_generated INT           DEFAULT 0,
        proposals_applied   INT           DEFAULT 0,
        proposals_rejected  INT           DEFAULT 0,
        score_before        FLOAT         DEFAULT 0,
        score_after         FLOAT         DEFAULT 0,
        score_delta         FLOAT         DEFAULT 0,
        applied_files       JSON,
        errors              JSON,
        benchmark_before    JSON,
        benchmark_after     JSON,
        INDEX idx_completed_at (completed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await (db as any).execute(`
      CREATE TABLE IF NOT EXISTS rsi_eval_history (
        run_id                  VARCHAR(64)   PRIMARY KEY,
        ran_at                  VARCHAR(32)   NOT NULL,
        task_count              INT           DEFAULT 0,
        passed                  INT           DEFAULT 0,
        failed                  INT           DEFAULT 0,
        percentage              FLOAT         DEFAULT 0,
        triggered_by_cycle_id   VARCHAR(64),
        INDEX idx_ran_at (ran_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    log.info("[rsiDb] RSI tables created/verified in DB");
  } catch (err) {
    log.warn(`[rsiDb] Migration failed (non-fatal): ${(err as Error).message}`);
  }
}

/** v8.9: Return DB connectivity status for the /api/rsi/db/status endpoint */
export function getRsiDbStatus(): { available: boolean; url: string | null; tables: string[] } {
  const url = process.env.DATABASE_URL ?? process.env.TIDB_URL ?? null;
  return {
    available: !!url,
    url: url ? url.replace(/:[^:@]*@/, ":***@") : null,
    tables: ["rsi_proposals", "rsi_cycles", "rsi_eval_history"],
  };
}
