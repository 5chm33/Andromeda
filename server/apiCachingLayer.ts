/**
 * apiCachingLayer.ts — v52.0.0
 *
 * In-memory LRU cache for API responses with TTL, cache invalidation,
 * and hit/miss telemetry.
 */

export interface CacheEntry {
  key: string;
  value: unknown;
  expiresAt: number;
  hits: number;
  createdAt: number;
}

export interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

const cache = new Map<string, CacheEntry>();
let totalHits = 0;
let totalMisses = 0;
let totalEvictions = 0;
const DEFAULT_TTL_MS = 60_000; // 1 minute
const MAX_ENTRIES = 1000;

export function cacheKey(apiId: string, endpoint: string, params: Record<string, unknown> = {}): string {
  return `${apiId}:${endpoint}:${JSON.stringify(params)}`;
}

export function get(key: string): unknown | null {
  const entry = cache.get(key);
  if (!entry) {
    totalMisses++;
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    totalMisses++;
    return null;
  }
  entry.hits++;
  totalHits++;
  return entry.value;
}

export function set(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): void {
  // Evict oldest if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const oldest = Array.from(cache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (oldest) {
      cache.delete(oldest[0]);
      totalEvictions++;
    }
  }

  cache.set(key, {
    key,
    value,
    expiresAt: Date.now() + ttlMs,
    hits: 0,
    createdAt: Date.now(),
  });
}

export function invalidate(pattern: string): number {
  let count = 0;
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
      count++;
    }
  }
  return count;
}

export function getStats(): CacheStats {
  const total = totalHits + totalMisses;
  return {
    totalEntries: cache.size,
    hits: totalHits,
    misses: totalMisses,
    hitRate: total > 0 ? totalHits / total : 0,
    evictions: totalEvictions,
  };
}

export function _resetCachingLayerForTest(): void {
  cache.clear();
  totalHits = 0;
  totalMisses = 0;
  totalEvictions = 0;
}
