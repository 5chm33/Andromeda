/**
 * Andromeda v5.28 — System Memory (Persistent Learnings)
 *
 * Unlike user-facing memory.ts, this stores system-level learnings:
 * - What modifications succeeded/failed and why
 * - Performance baselines and trends
 * - Architectural decisions and their rationale
 * - Error patterns and their resolutions
 * - Cross-session insights that persist beyond restarts
 *
 * This is the "long-term memory" that makes Andromeda smarter over time.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SystemLearning {
  id: string;
  category: "modification" | "performance" | "architecture" | "error" | "optimization" | "security";
  title: string;
  content: string;
  context: string;
  confidence: number; // 0-1, how confident we are this learning is correct
  applicableTo: string[]; // Module names this applies to
  createdAt: number;
  lastReferencedAt: number;
  referenceCount: number;
  supersededBy?: string; // If this learning was replaced by a newer one
}

export interface PerformanceBaseline {
  metric: string;
  module: string;
  baseline: number;
  current: number;
  trend: "improving" | "stable" | "degrading";
  measuredAt: number;
  sampleCount: number;
}

export interface ErrorPattern {
  id: string;
  pattern: string; // Regex or string pattern
  resolution: string;
  module: string;
  occurrences: number;
  lastSeen: number;
  autoResolvable: boolean;
}

interface SystemMemoryStore {
  learnings: SystemLearning[];
  baselines: PerformanceBaseline[];
  errorPatterns: ErrorPattern[];
  metadata: {
    totalLearnings: number;
    totalReferences: number;
    lastConsolidation: number;
    version: string;
  };
}

// ── State ───────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const STORE_PATH = join(DATA_DIR, "system_memory.json");
const MAX_LEARNINGS = 500;
const MAX_ERROR_PATTERNS = 200;

let store: SystemMemoryStore = {
  learnings: [],
  baselines: [],
  errorPatterns: [],
  metadata: {
    totalLearnings: 0,
    totalReferences: 0,
    lastConsolidation: 0,
    version: "5.28",
  },
};

// ── Persistence ─────────────────────────────────────────────────────────────

function load(): void {
  try {
    if (existsSync(STORE_PATH)) {
      store = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    }
  } catch { /* start fresh */ }
}

function save(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch { /* non-critical */ }
}

// ── Learning CRUD ───────────────────────────────────────────────────────────

/**
 * Record a new system learning.
 */
export function recordSystemLearning(input: {
  category: SystemLearning["category"];
  title: string;
  content: string;
  context: string;
  confidence?: number;
  applicableTo?: string[];
}): SystemLearning {
  const learning: SystemLearning = {
    id: `sl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category: input.category,
    title: input.title,
    content: input.content,
    context: input.context,
    confidence: input.confidence ?? 0.7,
    applicableTo: input.applicableTo || [],
    createdAt: Date.now(),
    lastReferencedAt: Date.now(),
    referenceCount: 0,
  };

  // Check for duplicates
  const existing = store.learnings.find(l =>
    l.title === learning.title || l.content === learning.content
  );
  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastReferencedAt = Date.now();
    existing.referenceCount++;
    save();
    return existing;
  }

  store.learnings.push(learning);
  store.metadata.totalLearnings++;

  // Evict oldest low-confidence learnings if over limit
  if (store.learnings.length > MAX_LEARNINGS) {
    store.learnings.sort((a, b) => {
      const scoreA = a.confidence * 0.5 + (a.referenceCount / 10) * 0.3 + (a.lastReferencedAt / Date.now()) * 0.2;
      const scoreB = b.confidence * 0.5 + (b.referenceCount / 10) * 0.3 + (b.lastReferencedAt / Date.now()) * 0.2;
      return scoreB - scoreA;
    });
    store.learnings = store.learnings.slice(0, MAX_LEARNINGS);
  }

  save();
  return learning;
}

/**
 * Query learnings relevant to a given context.
 */
export function queryLearnings(query: {
  category?: SystemLearning["category"];
  module?: string;
  keyword?: string;
  minConfidence?: number;
  limit?: number;
}): SystemLearning[] {
  let results = store.learnings;

  if (query.category) {
    results = results.filter(l => l.category === query.category);
  }
  if (query.module) {
    const mod = query.module;
    results = results.filter(l => l.applicableTo.includes(mod));
  }
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(l =>
      l.title.toLowerCase().includes(kw) ||
      l.content.toLowerCase().includes(kw) ||
      l.context.toLowerCase().includes(kw)
    );
  }
  if (query.minConfidence) {
    const minConf = query.minConfidence;
    results = results.filter(l => l.confidence >= minConf);
  }

  // Mark as referenced
  for (const r of results) {
    r.lastReferencedAt = Date.now();
    r.referenceCount++;
    store.metadata.totalReferences++;
  }

  save();
  return results.slice(0, query.limit || 20);
}

// ── Performance Baselines ───────────────────────────────────────────────────

/**
 * Record or update a performance baseline.
 */
export function updateBaseline(metric: string, module: string, value: number): void {
  const existing = store.baselines.find(b => b.metric === metric && b.module === module);

  if (existing) {
    const __prevValue = existing.current;
    existing.current = value;
    existing.sampleCount++;
    existing.measuredAt = Date.now();

    // Determine trend
    const delta = value - existing.baseline;
    const threshold = existing.baseline * 0.1; // 10% change threshold
    if (delta > threshold) existing.trend = "improving";
    else if (delta < -threshold) existing.trend = "degrading";
    else existing.trend = "stable";
  } else {
    store.baselines.push({
      metric,
      module,
      baseline: value,
      current: value,
      trend: "stable",
      measuredAt: Date.now(),
      sampleCount: 1,
    });
  }

  save();
}

/**
 * Get all baselines, optionally filtered by module.
 */
export function getBaselines(module?: string): PerformanceBaseline[] {
  if (module) return store.baselines.filter(b => b.module === module);
  return [...store.baselines];
}

/**
 * Get degrading metrics that need attention.
 */
export function getDegradingMetrics(): PerformanceBaseline[] {
  return store.baselines.filter(b => b.trend === "degrading");
}

// ── Error Patterns ──────────────────────────────────────────────────────────

/**
 * Record an error pattern and its resolution.
 */
export function recordErrorPattern(input: {
  pattern: string;
  resolution: string;
  module: string;
  autoResolvable?: boolean;
}): ErrorPattern {
  const existing = store.errorPatterns.find(e =>
    e.pattern === input.pattern && e.module === input.module
  );

  if (existing) {
    existing.occurrences++;
    existing.lastSeen = Date.now();
    existing.resolution = input.resolution; // Update with latest resolution
    save();
    return existing;
  }

  const pattern: ErrorPattern = {
    id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pattern: input.pattern,
    resolution: input.resolution,
    module: input.module,
    occurrences: 1,
    lastSeen: Date.now(),
    autoResolvable: input.autoResolvable ?? false,
  };

  store.errorPatterns.push(pattern);

  // Evict old patterns
  if (store.errorPatterns.length > MAX_ERROR_PATTERNS) {
    store.errorPatterns.sort((a, b) => b.occurrences - a.occurrences);
    store.errorPatterns = store.errorPatterns.slice(0, MAX_ERROR_PATTERNS);
  }

  save();
  return pattern;
}

/**
 * Find a known resolution for an error.
 */
export function findResolution(errorMessage: string, module?: string): ErrorPattern | null {
  const candidates = store.errorPatterns.filter(ep => {
    const matches = errorMessage.includes(ep.pattern) ||
      new RegExp(ep.pattern, "i").test(errorMessage);
    if (module) return matches && ep.module === module;
    return matches;
  });

  if (candidates.length === 0) return null;
  // Return most frequently seen pattern
  candidates.sort((a, b) => b.occurrences - a.occurrences);
  return candidates[0];
}

// ── Consolidation ───────────────────────────────────────────────────────────

/**
 * Consolidate system memory — merge similar learnings, remove stale data.
 */
export function consolidateMemory(): { merged: number; removed: number } {
  let merged = 0;
  let removed = 0;

  // Remove superseded learnings
  const superseded = store.learnings.filter(l => l.supersededBy);
  removed += superseded.length;
  store.learnings = store.learnings.filter(l => !l.supersededBy);

  // Remove very old, low-confidence, never-referenced learnings
  const staleThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
  const stale = store.learnings.filter(l =>
    l.lastReferencedAt < staleThreshold &&
    l.confidence < 0.5 &&
    l.referenceCount === 0
  );
  removed += stale.length;
  store.learnings = store.learnings.filter(l => !stale.includes(l));

  // Remove old error patterns not seen in 60 days
  const patternThreshold = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const oldPatterns = store.errorPatterns.filter(e => e.lastSeen < patternThreshold);
  removed += oldPatterns.length;
  store.errorPatterns = store.errorPatterns.filter(e => !oldPatterns.includes(e));

  store.metadata.lastConsolidation = Date.now();
  save();

  return { merged, removed };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize system memory.
 */
export function initSystemMemory(): void {
  load();
  console.log(`[SystemMemory] Initialized — ${store.learnings.length} learnings, ${store.errorPatterns.length} error patterns`);

  // Run consolidation every 24 hours
  setInterval(() => {
    const result = consolidateMemory();
    if (result.removed > 0) {
      console.log(`[SystemMemory] Consolidated: ${result.removed} entries removed`);
    }
  }, 24 * 60 * 60 * 1000);
}

/**
 * Get stats for diagnostics.
 */
export function getSystemMemoryStats() {
  return {
    totalLearnings: store.learnings.length,
    totalErrorPatterns: store.errorPatterns.length,
    totalBaselines: store.baselines.length,
    degradingMetrics: store.baselines.filter(b => b.trend === "degrading").length,
    totalReferences: store.metadata.totalReferences,
    lastConsolidation: store.metadata.lastConsolidation,
    byCategory: store.learnings.reduce((acc, l) => {
      acc[l.category] = (acc[l.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}
