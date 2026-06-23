/**
 * memoryForgettingCurve.ts — Cross-Session Memory with Forgetting Curves
 * Andromeda v5.68
 *
 * Implements Ebbinghaus forgetting curve modeling for intelligent memory management:
 * - Track how often memories are accessed and predict when they'll be forgotten
 * - Spaced repetition for memory consolidation
 * - Memory importance decay with context
 * - Automatic memory summarization when related memories accumulate
 */

import * as fs from "fs";
import * as path from "path";
import { chatCompletion } from "./llmProvider.js";
import { storeMemory } from "./memory.js";

const MEMORY_CURVE_PATH = path.join(process.cwd(), "data", "memory_curves.json");
const CONSOLIDATION_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface MemoryCurveEntry {
  memoryId: string;
  content: string;
  tags: string[];
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  importanceScore: number; // 0-1, higher = more important
  retentionStrength: number; // 0-1, decays over time
  nextReviewAt: string; // When spaced repetition should re-expose this memory
  isConsolidated: boolean; // True if this was merged into a higher-level insight
}

let memoryCurves: Map<string, MemoryCurveEntry> = new Map();
let consolidationTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadCurves(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(MEMORY_CURVE_PATH)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_CURVE_PATH, "utf-8"));
      memoryCurves = new Map(Object.entries(data));
    }
  } catch {
    memoryCurves = new Map();
  }
  initialized = true;
}

function saveCurves(): void {
  ensureDataDir();
  try {
    const obj: Record<string, MemoryCurveEntry> = {};
    for (const [k, v] of memoryCurves.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(MEMORY_CURVE_PATH, JSON.stringify(obj, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

/**
 * Calculate retention strength using Ebbinghaus forgetting curve.
 * R = e^(-t/S) where t = time since last review, S = stability (access count based)
 */
function calculateRetention(entry: MemoryCurveEntry): number {
  const now = Date.now();
  const lastAccess = new Date(entry.lastAccessedAt).getTime();
  const hoursSinceAccess = (now - lastAccess) / (1000 * 60 * 60);

  // Stability increases with access count (spaced repetition effect)
  const stability = Math.max(1, entry.accessCount * 24); // hours
  const retention = Math.exp(-hoursSinceAccess / stability);

  return Math.max(0, Math.min(1, retention));
}

/**
 * Calculate next review time using spaced repetition intervals.
 * Intervals: 1h, 6h, 1d, 3d, 7d, 14d, 30d
 */
function calculateNextReview(accessCount: number): Date {
  const intervals = [1, 6, 24, 72, 168, 336, 720]; // hours
  const intervalHours = intervals[Math.min(accessCount, intervals.length - 1)];
  const next = new Date();
  next.setTime(next.getTime() + intervalHours * 60 * 60 * 1000);
  return next;
}

/**
 * Register a new memory with the forgetting curve system.
 */
export function registerMemory(
  memoryId: string,
  content: string,
  tags: string[],
  importanceScore = 0.5
): void {
  if (!initialized) loadCurves();

  const now = new Date().toISOString();
  const entry: MemoryCurveEntry = {
    memoryId,
    content: content.substring(0, 500),
    tags,
    createdAt: now,
    lastAccessedAt: now,
    accessCount: 1,
    importanceScore,
    retentionStrength: 1.0,
    nextReviewAt: calculateNextReview(1).toISOString(),
    isConsolidated: false,
  };

  memoryCurves.set(memoryId, entry);
  saveCurves();
}

/**
 * Record a memory access (strengthens retention).
 */
export function recordMemoryAccess(memoryId: string): void {
  if (!initialized) loadCurves();

  const entry = memoryCurves.get(memoryId);
  if (!entry) return;

  entry.accessCount++;
  entry.lastAccessedAt = new Date().toISOString();
  entry.retentionStrength = calculateRetention(entry);
  entry.nextReviewAt = calculateNextReview(entry.accessCount).toISOString();
  saveCurves();
}

/**
 * Get memories that are due for spaced repetition review.
 */
export function getMemoriesDueForReview(): MemoryCurveEntry[] {
  if (!initialized) loadCurves();

  const now = Date.now();
  return Array.from(memoryCurves.values())
    .filter((e) => !e.isConsolidated && new Date(e.nextReviewAt).getTime() <= now)
    .sort((a, b) => a.retentionStrength - b.retentionStrength) // Weakest first
    .slice(0, 10);
}

/**
 * Get memories at risk of being forgotten (low retention, high importance).
 */
export function getAtRiskMemories(): MemoryCurveEntry[] {
  if (!initialized) loadCurves();

  return Array.from(memoryCurves.values())
    .filter((e) => !e.isConsolidated)
    .map((e) => ({ ...e, retentionStrength: calculateRetention(e) }))
    .filter((e) => e.retentionStrength < 0.3 && e.importanceScore > 0.6)
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 5);
}

/**
 * Consolidate related memories into higher-level insights.
 * Called periodically to keep memory clean.
 */
async function consolidateRelatedMemories(): Promise<void> {
  if (!initialized) loadCurves();

  // Find clusters of related memories (same tags)
  const tagGroups: Map<string, MemoryCurveEntry[]> = new Map();
  for (const entry of memoryCurves.values()) {
    if (entry.isConsolidated) continue;
    for (const tag of entry.tags) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push(entry);
    }
  }

  // Find groups with 5+ memories that could be consolidated
  for (const [tag, entries] of tagGroups.entries()) {
    if (entries.length < 5) continue;

    const oldEntries = entries
      .filter((e) => {
        const age = Date.now() - new Date(e.createdAt).getTime();
        return age > 24 * 60 * 60 * 1000; // Older than 24 hours
      })
      .slice(0, 10);

    if (oldEntries.length < 5) continue;

    console.log(`[MemoryForgetting] Consolidating ${oldEntries.length} memories with tag: ${tag}`);

    const contentList = oldEntries.map((e) => e.content).join("\n---\n");

    try {
      const response = await chatCompletion([
        {
          role: "user",
          content: `You are Andromeda consolidating your own memories. These ${oldEntries.length} memories all relate to "${tag}". Summarize them into a single higher-level insight that captures the key learnings:\n\n${contentList}\n\nProvide a concise 2-3 sentence summary that preserves the most important information.`,
        },
      ], { maxTokens: 300, temperature: 0.2 });

      const summary = response.content || "";
      if (!summary) continue;

      // Store the consolidated memory
      storeMemory(
        `[Consolidated from ${oldEntries.length} memories] ${summary}`,
        "fact",
        [tag, "consolidated", "insight"]
      );

      // Mark old entries as consolidated
      for (const entry of oldEntries) {
        entry.isConsolidated = true;
      }

      saveCurves();
      console.log(`[MemoryForgetting] Consolidated ${oldEntries.length} memories into insight for tag: ${tag}`);
    } catch {
      // Non-fatal
    }
  }
}

/**
 * Get forgetting curve statistics for the diagnostic endpoint.
 */
export function getForgettingCurveStats(): {
  totalTracked: number;
  atRisk: number;
  dueForReview: number;
  consolidated: number;
  avgRetention: number;
} {
  if (!initialized) loadCurves();

  const all = Array.from(memoryCurves.values());
  const active = all.filter((e) => !e.isConsolidated);
  const atRisk = getAtRiskMemories().length;
  const dueForReview = getMemoriesDueForReview().length;
  const consolidated = all.filter((e) => e.isConsolidated).length;
  const avgRetention = active.length > 0
    ? active.reduce((sum, e) => sum + calculateRetention(e), 0) / active.length
    : 1;

  return { totalTracked: all.length, atRisk, dueForReview, consolidated, avgRetention };
}

/**
 * Start the memory forgetting curve daemon.
 */
export function startMemoryForgettingCurveDaemon(): void {
  loadCurves();
  console.log("[MemoryForgetting] Daemon started (consolidation interval: 2 hours)");

  consolidationTimer = setInterval(() => {
    consolidateRelatedMemories().catch(() => {});
  }, CONSOLIDATION_INTERVAL_MS);

  // Run first consolidation after 10 minutes
  setTimeout(() => {
    consolidateRelatedMemories().catch(() => {});
  }, 10 * 60 * 1000);
}

/**
 * Stop the memory forgetting curve daemon.
 */
export function stopMemoryForgettingCurveDaemon(): void {
  if (consolidationTimer) {
    clearInterval(consolidationTimer);
    consolidationTimer = null;
  }
}
