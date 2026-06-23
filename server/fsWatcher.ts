/**
 * fsWatcher.ts — v1.0.0
 *
 * Native OS filesystem event monitoring for Andromeda.
 * Uses chokidar (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows)
 * for real-time file change awareness.
 *
 * Capabilities:
 *   - Watch arbitrary directories for file changes
 *   - Emit typed events: created, modified, deleted, renamed
 *   - Feed changes into RSI targeting (modified source files → RSI analyzes them)
 *   - Store change history in SQLite for trend analysis
 *   - REST API for watch management
 */

import chokidar, { type FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs";
import { getDb } from "./andromedaDb.js";
import { emitRsiEvent } from "./rsiEventBus.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileEventType = "created" | "modified" | "deleted" | "renamed";

export interface FileChangeEvent {
  id: string;
  watchId: string;
  type: FileEventType;
  filePath: string;
  relativePath: string;
  extension: string;
  timestamp: number;
  sizeBytes?: number;
}

export interface WatchConfig {
  id: string;
  directory: string;
  patterns: string[];       // glob patterns to include, e.g. ["**/*.ts", "**/*.tsx"]
  ignorePatterns: string[]; // glob patterns to ignore
  recursive: boolean;
  notifyRsi: boolean;       // whether to feed changes to RSI targeting
  active: boolean;
  createdAt: number;
}

// ─── Internal state ───────────────────────────────────────────────────────────

const _watchers = new Map<string, FSWatcher>();
const _configs = new Map<string, WatchConfig>();
const _eventEmitter = new EventEmitter();
const _recentEvents: FileChangeEvent[] = [];
const MAX_RECENT = 500;

// ─── SQLite persistence ───────────────────────────────────────────────────────

function ensureTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS fs_watch_events (
      id TEXT PRIMARY KEY,
      watch_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      extension TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      size_bytes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_fs_watch_events_ts ON fs_watch_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_fs_watch_events_watch ON fs_watch_events(watch_id);
  `);
}

function persistEvent(evt: FileChangeEvent): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO fs_watch_events
        (id, watch_id, event_type, file_path, relative_path, extension, timestamp, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(evt.id, evt.watchId, evt.type, evt.filePath, evt.relativePath, evt.extension, evt.timestamp, evt.sizeBytes ?? null);
  } catch {
    // Non-fatal — SQLite may not be initialized yet
  }
}

// ─── Event handling ───────────────────────────────────────────────────────────

function makeEventId(): string {
  return `fse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function handleFileEvent(
  watchId: string,
  config: WatchConfig,
  type: FileEventType,
  filePath: string
): void {
  const relativePath = path.relative(config.directory, filePath);
  const extension = path.extname(filePath).toLowerCase();
  let sizeBytes: number | undefined;

  if (type !== "deleted") {
    try { sizeBytes = fs.statSync(filePath).size; } catch { /* ignore */ }
  }

  const evt: FileChangeEvent = {
    id: makeEventId(),
    watchId,
    type,
    filePath,
    relativePath,
    extension,
    timestamp: Date.now(),
    sizeBytes,
  };

  // Keep in-memory ring buffer
  _recentEvents.push(evt);
  if (_recentEvents.length > MAX_RECENT) _recentEvents.shift();

  // Persist to SQLite
  persistEvent(evt);

  // Emit to subscribers
  _eventEmitter.emit("change", evt);
  _eventEmitter.emit(`change:${watchId}`, evt);

  // Feed TypeScript/JavaScript changes to RSI event bus
  // Uses "heartbeat" as the carrier type (file:changed is added to RsiEventType in rsiEventBus.ts)
  if (config.notifyRsi && [".ts", ".tsx", ".js", ".jsx"].includes(extension)) {
    emitRsiEvent("heartbeat", {
      eventKind: "file:changed",
      filePath,
      relativePath,
      changeType: type,
      watchId,
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initializes the filesystem watcher module (creates SQLite table).
 */
export function initFsWatcher(): void {
  ensureTable();
}

/**
 * Starts watching a directory for file changes.
 *
 * @param config - Watch configuration
 * @returns The watch ID
 */
export function startWatch(config: Omit<WatchConfig, "createdAt" | "active">): string {
  const watchId = config.id;

  if (_watchers.has(watchId)) {
    stopWatch(watchId);
  }

  const fullConfig: WatchConfig = { ...config, active: true, createdAt: Date.now() };
  _configs.set(watchId, fullConfig);

  const ignored: (string | RegExp)[] = [
    /(^|[/\\])\../, // dotfiles
    /node_modules/,
    /\.git/,
    /dist\//,
    /coverage\//,
    ...config.ignorePatterns.map((p) => new RegExp(p)),
  ];

  const watcher = chokidar.watch(config.directory, {
    ignored,
    persistent: true,
    ignoreInitial: true,
    depth: config.recursive ? undefined : 0,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });

  watcher
    .on("add", (p) => handleFileEvent(watchId, fullConfig, "created", p))
    .on("change", (p) => handleFileEvent(watchId, fullConfig, "modified", p))
    .on("unlink", (p) => handleFileEvent(watchId, fullConfig, "deleted", p))
    .on("error", (err) => console.error(`[fsWatcher:${watchId}] Error:`, err));

  _watchers.set(watchId, watcher);
  console.log(`[fsWatcher] Started watching: ${config.directory} (id: ${watchId})`);
  return watchId;
}

/**
 * Stops a running watch.
 */
export async function stopWatch(watchId: string): Promise<void> {
  const watcher = _watchers.get(watchId);
  if (watcher) {
    await watcher.close();
    _watchers.delete(watchId);
  }
  const config = _configs.get(watchId);
  if (config) {
    _configs.set(watchId, { ...config, active: false });
  }
}

/**
 * Returns all active watch configurations.
 */
export function listWatches(): WatchConfig[] {
  return Array.from(_configs.values());
}

/**
 * Returns recent file change events (up to limit).
 */
export function getRecentEvents(watchId?: string, limit = 50): FileChangeEvent[] {
  const events = watchId
    ? _recentEvents.filter((e) => e.watchId === watchId)
    : _recentEvents;
  return events.slice(-limit).reverse();
}

/**
 * Returns file change statistics for a watch over a time window.
 */
export function getWatchStats(watchId: string, windowMs = 3_600_000): {
  total: number;
  created: number;
  modified: number;
  deleted: number;
  topExtensions: Array<{ ext: string; count: number }>;
} {
  const cutoff = Date.now() - windowMs;
  const events = _recentEvents.filter(
    (e) => e.watchId === watchId && e.timestamp >= cutoff
  );

  const extCounts: Record<string, number> = {};
  let created = 0, modified = 0, deleted = 0;

  for (const e of events) {
    if (e.type === "created") created++;
    else if (e.type === "modified") modified++;
    else if (e.type === "deleted") deleted++;
    extCounts[e.extension] = (extCounts[e.extension] ?? 0) + 1;
  }

  const topExtensions = Object.entries(extCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ext, count]) => ({ ext, count }));

  return { total: events.length, created, modified, deleted, topExtensions };
}

/**
 * Subscribe to file change events.
 *
 * @param handler - Called with each FileChangeEvent
 * @returns Unsubscribe function
 */
export function onFileChange(
  handler: (evt: FileChangeEvent) => void,
  watchId?: string
): () => void {
  const event = watchId ? `change:${watchId}` : "change";
  _eventEmitter.on(event, handler);
  return () => _eventEmitter.off(event, handler);
}

/**
 * Stops all active watchers (called on server shutdown).
 */
export async function stopAllWatches(): Promise<void> {
  for (const [id] of _watchers) {
    await stopWatch(id);
  }
  console.log("[fsWatcher] All watchers stopped.");
}
