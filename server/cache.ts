/**
 * cache.ts — v5.8 Response caching layer with TTL and LRU eviction
 *
 * Provides:
 * - LRU cache for search results and AI responses
 * - TTL-based expiration (configurable per cache type)
 * - Cache hit/miss metrics
 * - Structured logging with levels, timestamps, and context
 */

// ─── Structured Logger ───────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
  durationMs?: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

let currentLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const logBuffer: LogEntry[] = [];
const MAX_LOG_BUFFER = 2000;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatLog(entry: LogEntry): string {
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
  const dur = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : "";
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.module}] ${entry.message}${dur}${ctx}`;
}

export function log(level: LogLevel, module: string, message: string, context?: Record<string, unknown>, durationMs?: number): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    context,
    durationMs,
  };

  // Console output
  const formatted = formatLog(entry);
  if (level === "error" || level === "fatal") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // Buffer for retrieval
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_BUFFER);
  }
}

/** Returns the current log level for the application.
 * @returns {string} The current log level (e.g. 'info', 'debug', 'warn', 'error')
 */
export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getRecentLogs(limit = 100, level?: LogLevel): LogEntry[] {
  let entries = logBuffer;
  if (level) {
    entries = entries.filter(e => LOG_LEVELS[e.level] >= LOG_LEVELS[level]);
  }
  return entries.slice(-limit);
}

// ─── LRU Cache ───────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  ttl: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

class LRUCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;
  private stats = { hits: 0, misses: 0, evictions: 0 };

  constructor(maxSize: number, defaultTTL: number) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.entries.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Update access metadata
    entry.accessedAt = Date.now();
    entry.accessCount++;
    this.stats.hits++;

    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    // Evict if at capacity
    if (this.entries.size >= this.maxSize && !this.entries.has(key)) {
      this.evictLRU();
    }

    this.entries.set(key, {
      key,
      value,
      createdAt: Date.now(),
      accessedAt: Date.now(),
      accessCount: 1,
      ttl: ttl ?? this.defaultTTL,
    });
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.entries.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? Math.round((this.stats.hits / total) * 100) : 0,
    };
  }

  private evictLRU(): void {
    // Remove the least recently accessed entry (first in Map = oldest)
    const firstKey = this.entries.keys().next().value;
    if (firstKey !== undefined) {
      this.entries.delete(firstKey);
      this.stats.evictions++;
    }
  }

  // Prune expired entries
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > entry.ttl) {
        this.entries.delete(key);
        pruned++;
      }
    }
    return pruned;
  }
}

// ─── Cache instances ─────────────────────────────────────────────────────────

// Search results cache: 200 entries, 10 minute TTL
const searchCache = new LRUCache<{ sources: unknown[]; answer: string }>(200, 10 * 60 * 1000);

// AI response cache: 100 entries, 30 minute TTL (for identical prompts)
const aiResponseCache = new LRUCache<string>(100, 30 * 60 * 1000);

// Web browse cache: 50 entries, 5 minute TTL
const browseCache = new LRUCache<string>(50, 5 * 60 * 1000);

// ─── Cache key generation ────────────────────────────────────────────────────

function hashKey(input: string): string {
  // Simple FNV-1a hash for cache keys
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function searchCacheKey(query: string, model: string): string {
  return `search:${hashKey(query + model)}`;
}

export function aiCacheKey(messages: Array<{ role: string; content: string }>): string {
  const content = messages.map(m => `${m.role}:${m.content}`).join("|");
  return `ai:${hashKey(content)}`;
}

export function browseCacheKey(url: string): string {
  return `browse:${hashKey(url)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getCachedSearch(key: string): { sources: unknown[]; answer: string } | undefined {
  const result = searchCache.get(key);
  if (result) {
    log("debug", "cache", `Search cache HIT: ${key}`);
  }
  return result;
}

export function setCachedSearch(key: string, value: { sources: unknown[]; answer: string }): void {
  searchCache.set(key, value);
  log("debug", "cache", `Search cache SET: ${key}`);
}

export function getCachedAI(key: string): string | undefined {
  return aiResponseCache.get(key);
}

export function setCachedAI(key: string, value: string): void {
  aiResponseCache.set(key, value);
}

export function getCachedBrowse(key: string): string | undefined {
  return browseCache.get(key);
}

export function setCachedBrowse(key: string, value: string): void {
  browseCache.set(key, value);
}

export function getAllCacheStats(): Record<string, CacheStats> {
  return {
    search: searchCache.getStats(),
    ai: aiResponseCache.getStats(),
    browse: browseCache.getStats(),
  };
}

export function clearAllCaches(): void {
  searchCache.clear();
  aiResponseCache.clear();
  browseCache.clear();
  log("info", "cache", "All caches cleared");
}

export function pruneExpired(): { search: number; ai: number; browse: number } {
  const result = {
    search: searchCache.prune(),
    ai: aiResponseCache.prune(),
    browse: browseCache.prune(),
  };
  log("info", "cache", `Pruned expired entries`, result);
  return result;
}

// Auto-prune every 5 minutes. .unref() prevents this timer from keeping the
// Node.js event loop alive in test environments (fixes vitest worker timeout).
setInterval(() => {
  pruneExpired();
}, 5 * 60 * 1000).unref();
