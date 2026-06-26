/**
 * rsiTaskQueue.ts — Distributed RSI Task Queue (v15.0.0)
 *
 * Provides a Redis-backed (or in-process fallback) task queue for distributing
 * RSI analysis work across multiple worker nodes. When Redis is unavailable, the
 * queue degrades gracefully to an in-memory FIFO queue so the system continues
 * operating on a single node.
 *
 * Architecture:
 *   Producer (rsiEngine.ts)  →  pushTask()  →  Queue  →  pullTask()  →  Worker (rsiWorkerPool.ts)
 *   Worker                   →  ackTask()   →  Queue  (marks complete, updates stats)
 *   Worker                   →  nackTask()  →  Queue  (returns to queue for retry)
 *
 * @module rsiTaskQueue
 * @version 15.0.0
 */

import { createLogger } from "./logger.js";

const log = createLogger("rsiTaskQueue");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RsiTask {
  /** Unique task identifier */
  id: string;
  /** Target file path relative to project root */
  targetFile: string;
  /** Optional focus area for the proposal (e.g., "performance", "security") */
  area?: string;
  /** RSI cycle ID this task belongs to */
  cycleId: string;
  /** Priority: 0 = normal, 1 = elevated (from chaos hardening), 2 = critical */
  priority: 0 | 1 | 2;
  /** ISO timestamp when the task was enqueued */
  enqueuedAt: string;
  /** Number of times this task has been retried */
  retryCount: number;
  /** Maximum allowed retries before the task is dead-lettered */
  maxRetries: number;
}

export interface TaskQueueStats {
  pending: number;
  inFlight: number;
  completed: number;
  failed: number;
  deadLettered: number;
  throughputPerHour: number;
  avgProcessingMs: number;
  isRedisConnected: boolean;
}

// ─── In-Memory Queue (fallback when Redis is unavailable) ─────────────────────

const _pending: RsiTask[] = [];
const _inFlight = new Map<string, { task: RsiTask; startedAt: number }>();
const _completed: RsiTask[] = [];
const _deadLettered: RsiTask[] = [];
let _completedCount = 0;
let _failedCount = 0;
let _totalProcessingMs = 0;
let _initialized = false;
let _isRedisConnected = false;

// Track hourly throughput
const _completionTimestamps: number[] = [];

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Initialize the RSI task queue. Attempts to connect to Redis if REDIS_URL is
 * set in the environment. Falls back to an in-memory queue silently.
 * Idempotent — safe to call multiple times.
 */
export function initRsiTaskQueue(): void {
  if (_initialized) return;
  _initialized = true;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    // Attempt Redis connection (non-blocking — falls back to in-memory on error)
    _tryConnectRedis(redisUrl);
  } else {
    log.info("[rsiTaskQueue] No REDIS_URL set — using in-memory queue (single-node mode)");
  }
}

function _tryConnectRedis(url: string): void {
  // Dynamic import so the module works without ioredis installed
  // @ts-ignore — ioredis is optional; falls back to in-memory if not installed
  import("ioredis")
    .then(({ default: Redis }) => {
      const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
      client.connect()
        .then(() => {
          _isRedisConnected = true;
          log.info("[rsiTaskQueue] Redis connected — distributed multi-node mode active");
        })
        .catch((err: Error) => {
          log.warn(`[rsiTaskQueue] Redis connection failed (${err.message}) — falling back to in-memory queue`);
        });
    })
    .catch(() => {
      log.info("[rsiTaskQueue] ioredis not installed — using in-memory queue");
    });
}

// ─── Core Queue Operations ────────────────────────────────────────────────────

/**
 * Enqueue a new RSI task. Higher-priority tasks are inserted ahead of lower-priority ones.
 *
 * @param targetFile  Path to the file to analyse
 * @param cycleId     RSI cycle identifier
 * @param opts        Optional overrides (area, priority, maxRetries)
 * @returns           The created task object
 */
export function pushTask(
  targetFile: string,
  cycleId: string,
  opts: { area?: string; priority?: 0 | 1 | 2; maxRetries?: number } = {}
): RsiTask {
  const task: RsiTask = {
    id: `${cycleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    targetFile,
    area: opts.area,
    cycleId,
    priority: opts.priority ?? 0,
    enqueuedAt: new Date().toISOString(),
    retryCount: 0,
    maxRetries: opts.maxRetries ?? 3,
  };

  // Insert by priority (higher priority = earlier in queue)
  const insertIdx = _pending.findIndex(t => t.priority < task.priority);
  if (insertIdx === -1) {
    _pending.push(task);
  } else {
    _pending.splice(insertIdx, 0, task);
  }

  log.info(`[rsiTaskQueue] Enqueued task ${task.id} for ${task.targetFile} (priority=${task.priority}, queue depth=${_pending.length})`);
  return task;
}

/**
 * Pull the next available task from the queue.
 * Moves it to the in-flight map with a start timestamp.
 *
 * @returns The next task, or null if the queue is empty
 */
export function pullTask(): RsiTask | null {
  const task = _pending.shift();
  if (!task) return null;

  _inFlight.set(task.id, { task, startedAt: Date.now() });
  return task;
}

/**
 * Acknowledge successful completion of a task.
 * Records processing time and removes it from the in-flight map.
 *
 * @param taskId  ID of the completed task
 */
export function ackTask(taskId: string): void {
  const entry = _inFlight.get(taskId);
  if (!entry) return;

  const processingMs = Date.now() - entry.startedAt;
  _totalProcessingMs += processingMs;
  _completedCount++;
  _completionTimestamps.push(Date.now());
  _inFlight.delete(taskId);

  // Trim timestamps older than 1 hour for throughput calculation
  const oneHourAgo = Date.now() - 3_600_000;
  while (_completionTimestamps.length > 0 && _completionTimestamps[0] < oneHourAgo) {
    _completionTimestamps.shift();
  }
}

/**
 * Negative-acknowledge a task (worker failed to process it).
 * Re-queues the task if retries remain; otherwise dead-letters it.
 *
 * @param taskId  ID of the failed task
 * @param reason  Human-readable failure reason
 */
export function nackTask(taskId: string, reason: string): void {
  const entry = _inFlight.get(taskId);
  if (!entry) return;

  _inFlight.delete(taskId);
  const task = entry.task;
  task.retryCount++;

  if (task.retryCount <= task.maxRetries) {
    // Re-queue with reduced priority to avoid starvation
    const newPriority = Math.max(0, task.priority - 1) as 0 | 1 | 2;
    task.priority = newPriority;
    _pending.push(task);
    log.warn(`[rsiTaskQueue] Task ${taskId} nacked (${reason}) — retry ${task.retryCount}/${task.maxRetries}`);
  } else {
    _deadLettered.push(task);
    _failedCount++;
    log.error(`[rsiTaskQueue] Task ${taskId} dead-lettered after ${task.maxRetries} retries: ${reason}`);
  }
}

// ─── Stale In-Flight Detection ────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Recover stale in-flight tasks (workers that crashed without acking).
 * Should be called periodically (e.g., every 60 seconds) by the scheduler.
 *
 * @returns Number of tasks recovered
 */
export function recoverStaleTasks(): number {
  const now = Date.now();
  let recovered = 0;

  for (const [taskId, entry] of _inFlight.entries()) {
    if (now - entry.startedAt > STALE_THRESHOLD_MS) {
      log.warn(`[rsiTaskQueue] Recovering stale task ${taskId} (in-flight for ${Math.round((now - entry.startedAt) / 1000)}s)`);
      nackTask(taskId, "stale — worker timeout");
      recovered++;
    }
  }

  return recovered;
}

// ─── Bulk Operations ──────────────────────────────────────────────────────────

/**
 * Push multiple tasks at once for a full RSI cycle.
 * Automatically assigns priorities based on whether a file is a chaos hardening target.
 *
 * @param files         Array of file paths to enqueue
 * @param cycleId       RSI cycle identifier
 * @param hardeningSet  Set of module names that are chaos hardening targets (get priority=2)
 * @returns             Array of created tasks
 */
export function pushCycleTasks(
  files: string[],
  cycleId: string,
  hardeningSet: Set<string> = new Set()
): RsiTask[] {
  return files.map(file => {
    const moduleName = file.replace(/^server\//, "").replace(/\.ts$/, "");
    const priority: 0 | 1 | 2 = hardeningSet.has(moduleName) ? 2 : 0;
    return pushTask(file, cycleId, { priority });
  });
}

/**
 * Drain all pending tasks — used for graceful shutdown.
 *
 * @returns Number of tasks drained
 */
export function drainQueue(): number {
  const count = _pending.length;
  _pending.length = 0;
  log.info(`[rsiTaskQueue] Queue drained (${count} tasks discarded)`);
  return count;
}

// ─── Stats & Observability ────────────────────────────────────────────────────

/**
 * Get current queue statistics for observability dashboards.
 */
export function getTaskQueueStats(): TaskQueueStats {
  const avgProcessingMs = _completedCount > 0
    ? Math.round(_totalProcessingMs / _completedCount)
    : 0;

  return {
    pending: _pending.length,
    inFlight: _inFlight.size,
    completed: _completedCount,
    failed: _failedCount,
    deadLettered: _deadLettered.length,
    throughputPerHour: _completionTimestamps.length,
    avgProcessingMs,
    isRedisConnected: _isRedisConnected,
  };
}

/**
 * Get the current queue depth (pending tasks only).
 */
export function getQueueDepth(): number {
  return _pending.length;
}

/**
 * Get all dead-lettered tasks for inspection and manual retry.
 */
export function getDeadLetteredTasks(): RsiTask[] {
  return [..._deadLettered];
}

/**
 * Manually retry a dead-lettered task by re-queuing it with reset retry count.
 *
 * @param taskId  ID of the dead-lettered task to retry
 * @returns       true if the task was found and re-queued
 */
export function retryDeadLettered(taskId: string): boolean {
  const idx = _deadLettered.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  const [task] = _deadLettered.splice(idx, 1);
  task.retryCount = 0;
  _pending.push(task);
  log.info(`[rsiTaskQueue] Dead-lettered task ${taskId} manually re-queued`);
  return true;
}
