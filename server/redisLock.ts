/**
 * redisLock.ts — v6.30: Distributed lock manager
 *
 * Provides a `withLock(key, fn)` helper that:
 *   1. Acquires a Redis SET NX PX lock when REDIS_URL is configured
 *   2. Falls back to an in-process Map<string, Promise> when Redis is unavailable
 *
 * This replaces the scattered `let isRunning = false` boolean guards across:
 *   - autoGoalSuggester.ts
 *   - autonomyOrchestrator.ts
 *   - continuousImprover.ts
 *   - dependencyGraph.ts
 *   - selfHeal.ts
 *   - selfTestPipeline.ts
 *
 * Usage:
 *   import { withLock } from "./redisLock.js";
 *   await withLock("rsi-cycle", async () => { ... });
 *
 * The lock is automatically released when the callback completes or throws.
 * If the lock is already held, `withLock` returns immediately with `{ skipped: true }`.
 */

import { createLogger } from "./logger.js";

const log = createLogger("redisLock");

// ─── Types ────────────────────────────────────────────────────────────────────

export type LockResult<T> =
  | { skipped: false; result: T }
  | { skipped: true; result: null };

// ─── Redis client (lazy, optional) ───────────────────────────────────────────

type RedisClient = {
  set(key: string, value: string, options: { NX: boolean; PX: number }): Promise<string | null>;
  del(key: string): Promise<number>;
  quit(): Promise<void>;
};

let _redisClient: RedisClient | null | "unavailable" = null;

async function getRedisClient(): Promise<RedisClient | null> {
  if (_redisClient === "unavailable") return null;
  if (_redisClient !== null) return _redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    _redisClient = "unavailable";
    return null;
  }

  try {
    // Dynamic import so the module loads fine even without redis installed
    const { createClient } = await import("redis" as any);
    const client = createClient({ url: redisUrl });
    client.on("error", (err: Error) => {
      log.warn(`[redisLock] Redis error: ${err.message} — falling back to in-process locks`);
      _redisClient = "unavailable";
    });
    await client.connect();
    _redisClient = client as unknown as RedisClient;
    log.info("[redisLock] Redis connected — distributed locks active");
    return _redisClient;
  } catch (err) {
    log.warn(`[redisLock] Redis unavailable (${(err as Error).message}) — using in-process locks`);
    _redisClient = "unavailable";
    return null;
  }
}

// ─── In-process fallback ──────────────────────────────────────────────────────

// Maps lock key → currently-running promise. If a key is present, the lock is held.
const _inProcessLocks = new Map<string, Promise<void>>();

// ─── Core API ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes max lock duration
const LOCK_PREFIX = "andromeda:lock:";

/**
 * Acquire a named lock, run `fn`, then release the lock.
 *
 * @param key     Unique lock name (e.g. "rsi-cycle", "self-heal", "test-pipeline")
 * @param fn      Async function to run while the lock is held
 * @param ttlMs   Max lock duration in ms (default 5 min). Redis only.
 * @returns       `{ skipped: false, result }` if the lock was acquired and fn ran,
 *                `{ skipped: true, result: null }` if the lock was already held.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<LockResult<T>> {
  const redis = await getRedisClient();

  if (redis) {
    return withRedisLock(redis, key, fn, ttlMs);
  } else {
    return withInProcessLock(key, fn);
  }
}

async function withRedisLock<T>(
  redis: RedisClient,
  key: string,
  fn: () => Promise<T>,
  ttlMs: number
): Promise<LockResult<T>> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const acquired = await redis.set(lockKey, lockValue, { NX: true, PX: ttlMs });
  if (!acquired) {
    log.info(`[redisLock] Lock "${key}" already held (Redis) — skipping`);
    return { skipped: true, result: null };
  }

  try {
    const result = await fn();
    return { skipped: false, result };
  } finally {
    try {
      await redis.del(lockKey);
    } catch (err) {
      log.warn(`[redisLock] Failed to release Redis lock "${key}": ${(err as Error).message}`);
    }
  }
}

async function withInProcessLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<LockResult<T>> {
  if (_inProcessLocks.has(key)) {
    log.info(`[redisLock] Lock "${key}" already held (in-process) — skipping`);
    return { skipped: true, result: null };
  }

  let resolveGuard!: () => void;
  const guard = new Promise<void>(resolve => { resolveGuard = resolve; });
  _inProcessLocks.set(key, guard);

  try {
    const result = await fn();
    return { skipped: false, result };
  } finally {
    _inProcessLocks.delete(key);
    resolveGuard();
  }
}

// ─── Convenience wrappers for the 7 known lock sites ─────────────────────────

/** Lock for RSI cycle execution — prevents concurrent cycles */
export async function withRsiCycleLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("rsi-cycle", fn, 10 * 60 * 1000); // 10 min max
}

/** Lock for self-heal loop — prevents concurrent heal cycles */
export async function withSelfHealLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("self-heal", fn, 5 * 60 * 1000);
}

/** Lock for test pipeline — prevents concurrent test runs */
export async function withTestPipelineLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("test-pipeline", fn, 3 * 60 * 1000);
}

/** Lock for continuous improver — prevents concurrent improvement cycles */
export async function withContinuousImproverLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("continuous-improver", fn, 5 * 60 * 1000);
}

/** Lock for dependency graph build — prevents concurrent graph builds */
export async function withDependencyGraphLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("dependency-graph", fn, 2 * 60 * 1000);
}

/** Lock for auto-goal suggester — prevents concurrent goal generation */
export async function withAutoGoalLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("auto-goal", fn, 2 * 60 * 1000);
}

/** Lock for autonomy orchestrator — prevents concurrent orchestration cycles */
export async function withOrchestratorLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLock("orchestrator", fn, 5 * 60 * 1000);
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getLockStatus(): {
  backend: "redis" | "in-process";
  activeLocks: string[];
} {
  return {
    backend: _redisClient && _redisClient !== "unavailable" ? "redis" : "in-process",
    activeLocks: Array.from(_inProcessLocks.keys()),
  };
}
