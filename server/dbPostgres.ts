/**
 * dbPostgres.ts — v6.37
 *
 * Postgres adapter for Andromeda. When POSTGRES_URL is set, this module
 * provides a Drizzle ORM instance backed by postgres.js (neon-compatible).
 *
 * Falls back gracefully to null when POSTGRES_URL is not configured,
 * allowing the existing MySQL path in db.ts to remain unchanged.
 *
 * Usage:
 *   import { getPgDb, isPgAvailable } from "./dbPostgres.js";
 *   const db = await getPgDb();
 *   if (db) { await db.execute(sql`SELECT 1`); }
 *
 * Supported connection strings:
 *   postgres://user:pass@host:5432/dbname
 *   postgresql://user:pass@host:5432/dbname
 *   postgres://user:pass@host/dbname?sslmode=require  (Neon, Supabase, etc.)
 */

import { createLogger } from "./logger.js";

const log = createLogger("dbPostgres");

// ── Types ──────────────────────────────────────────────────────────────────────

type PgDb = Awaited<ReturnType<typeof createPgDb>>;

// ── Connection state ───────────────────────────────────────────────────────────

let _pgDbPromise: Promise<PgDb | null> | null = null;
let _pgAvailable: boolean | null = null;

// ── Internal factory ───────────────────────────────────────────────────────────

async function createPgDb() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const url = process.env.POSTGRES_URL!;
  const client = postgres(url, {
    max: 10, // Maximum connections in the pool
    idle_timeout: 30, // Seconds before closing an idle connection
    connect_timeout: 10, // Seconds before a connection attempt times out
    ssl: url.includes("sslmode=require") || url.includes("neon.tech") || url.includes("supabase.co")
      ? { rejectUnauthorized: false }
      : undefined,
    onnotice: () => {}, // suppress NOTICE messages
  });
  const db = drizzle(client);
  // Verify connection
  await client`SELECT 1`;
  return db;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get the Postgres Drizzle instance, or null if POSTGRES_URL is not configured.
 * Lazy-initialised on first call; subsequent calls return the cached promise.
 */
export async function getPgDb(): Promise<PgDb | null> {
  if (!process.env.POSTGRES_URL) {
    _pgAvailable = false;
    return null;
  }
  if (!_pgDbPromise) {
    _pgDbPromise = createPgDb().then(db => {
      _pgAvailable = true;
      log.info("[dbPostgres] Connected to Postgres successfully");
      return db;
    }).catch(err => {
      _pgAvailable = false;
      log.warn(`[dbPostgres] Connection failed: ${(err as Error).message} — falling back to JSON store`);
      _pgDbPromise = null; // allow retry on next call
      return null;
    });
  }
  return _pgDbPromise;
}

/**
 * Returns true if Postgres is configured and connected.
 * Cached after first check.
 */
export async function isPgAvailable(): Promise<boolean> {
  if (_pgAvailable !== null) return _pgAvailable;
  const db = await getPgDb();
  return db !== null;
}

/**
 * Run a raw SQL query against Postgres.
 * Returns null if Postgres is unavailable.
 */
export async function pgExecute(query: string, params: unknown[] = []): Promise<unknown[] | null> {
  const db = await getPgDb();
  if (!db) return null;
  try {
    const postgres = (await import("postgres")).default;
    const url = process.env.POSTGRES_URL!;
    const client = postgres(url, { max: 1 });
    const result = await client.unsafe(query, params as any[]);
    await client.end();
    return result as unknown[];
  } catch (err) {
    log.warn(`[dbPostgres] pgExecute failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Run Postgres migrations from the drizzle/migrations directory.
 * Creates the rsi_proposals, rsi_cycles, and rsi_eval_history tables
 * if they don't exist.
 */
export async function runPgMigrations(): Promise<void> {
  const db = await getPgDb();
  if (!db) {
    log.info("[dbPostgres] Skipping Postgres migrations — POSTGRES_URL not set");
    return;
  }
  try {
    const postgres = (await import("postgres")).default;
    const url = process.env.POSTGRES_URL!;
    const client = postgres(url, { max: 1 });

    // Create RSI tables (idempotent)
    await client`
      CREATE TABLE IF NOT EXISTS rsi_proposals (
        id TEXT PRIMARY KEY,
        target_file TEXT NOT NULL,
        title TEXT,
        category TEXT,
        impact TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        confidence REAL,
        proposed_content TEXT,
        proposed_snippet TEXT,
        diff TEXT,
        rationale TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS rsi_cycles (
        run_id TEXT PRIMARY KEY,
        started_at BIGINT NOT NULL,
        completed_at BIGINT,
        proposals_generated INTEGER DEFAULT 0,
        proposals_applied INTEGER DEFAULT 0,
        eval_score_before REAL,
        eval_score_after REAL,
        status TEXT NOT NULL DEFAULT 'running',
        error TEXT
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS rsi_eval_history (
        run_id TEXT PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        percentage REAL NOT NULL,
        passed INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        by_category JSONB,
        triggered_by TEXT DEFAULT 'manual'
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS rsi_discoveries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        failed_task_ids JSONB,
        avg_score REAL,
        goal_id TEXT,
        discovered_at BIGINT NOT NULL
      )
    `;

    await client`
      CREATE TABLE IF NOT EXISTS learned_constraints (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL UNIQUE,
        reason TEXT,
        rejection_count INTEGER NOT NULL DEFAULT 1,
        first_seen_at BIGINT NOT NULL,
        last_seen_at BIGINT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT false
      )
    `;

    await client.end();
    log.info("[dbPostgres] Postgres migrations complete — all RSI tables ready");
  } catch (err) {
    log.warn(`[dbPostgres] Migration failed (non-fatal): ${(err as Error).message}`);
  }
}

/**
 * Get Postgres connection status for the health endpoint.
 */
export async function getPgStatus(): Promise<{
  available: boolean;
  url: string | null;
  tables: string[];
  error?: string;
}> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return { available: false, url: null, tables: [] };
  }
  try {
    const postgres = (await import("postgres")).default;
    const client = postgres(url, { max: 1, connect_timeout: 5 });
    const rows = await client`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    await client.end();
    return {
      available: true,
      url: url.replace(/:[^:@]+@/, ":***@"), // redact password
      tables: rows.map((r: any) => r.tablename),
    };
  } catch (err) {
    return {
      available: false,
      url: url.replace(/:[^:@]+@/, ":***@"),
      tables: [],
      error: (err as Error).message,
    };
  }
}
