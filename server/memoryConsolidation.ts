/**
 * memoryConsolidation.ts — Memory Lifecycle Management
 *
 * Prevents unbounded memory growth by scoring, compressing, and evicting
 * memories based on importance, recency, and access frequency.
 *
 * Architecture:
 *   1. Importance Scoring — each memory gets a composite score
 *   2. Decay — scores decay over time (recency bias)
 *   3. Consolidation — similar/related memories are merged into summaries
 *   4. Eviction — lowest-scoring memories are removed when limits are hit
 *
 * Integrations:
 *   - memory.ts: Reads and manages the memory store
 *   - vectorMemory.ts: Uses semantic similarity for consolidation grouping
 *   - selfMonitor.ts: Reports memory_usage metrics
 */

import { randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportanceFactors = {
  recency: number;          // 0-1, higher = more recent
  accessFrequency: number;  // 0-1, higher = accessed more often
  uniqueness: number;       // 0-1, higher = more unique content
  userExplicit: number;     // 0-1, 1 if user explicitly saved this
  errorRelated: number;     // 0-1, 1 if related to error correction
  crossReferenced: number;  // 0-1, higher = referenced by other memories
};

export type ScoredMemory = {
  id: string;
  text: string;
  type: string;
  score: number;
  factors: ImportanceFactors;
  accessCount: number;
  lastAccessed: number;
  createdAt: number;
  consolidated: boolean;    // Whether this is a consolidated summary
  sourceIds?: string[];     // IDs of memories that were merged into this
};

export type ConsolidationGroup = {
  id: string;
  memberIds: string[];
  similarity: number;       // Average pairwise similarity
  summary?: string;         // Generated summary of the group
  createdAt: number;
};

export type ConsolidationConfig = {
  enabled: boolean;
  maxMemories: number;              // Hard limit on total memories (default: 1000)
  softLimit: number;                // Start consolidation at this count (default: 750)
  evictionBatchSize: number;        // How many to evict per cycle (default: 50)
  consolidationThreshold: number;   // Similarity threshold for grouping (0-1, default: 0.7)
  decayHalfLifeMs: number;         // Time for score to halve (default: 7 days)
  minScoreToKeep: number;          // Absolute minimum score (default: 0.1)
  autoRunIntervalMs: number;       // How often to auto-run (default: 1 hour)
  weights: {
    recency: number;        // Default: 0.25
    accessFrequency: number; // Default: 0.20
    uniqueness: number;      // Default: 0.15
    userExplicit: number;    // Default: 0.25
    errorRelated: number;    // Default: 0.10
    crossReferenced: number; // Default: 0.05
  };
};

export type ConsolidationResult = {
  memoriesScored: number;
  memoriesEvicted: number;
  groupsConsolidated: number;
  memoriesMerged: number;
  newScore: { min: number; max: number; avg: number };
  duration: number;
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const scoredMemories = new Map<string, ScoredMemory>();
const consolidationGroups: ConsolidationGroup[] = [];
const accessLog = new Map<string, number[]>(); // id → timestamps of accesses
let consolidationInterval: ReturnType<typeof setInterval> | null = null;
let lastRunResult: ConsolidationResult | null = null;

const defaultConfig: ConsolidationConfig = {
  enabled: true,
  maxMemories: 1000,
  softLimit: 750,
  evictionBatchSize: 50,
  consolidationThreshold: 0.6,  // v5.25: Lowered from 0.7 for more aggressive compression
  decayHalfLifeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  minScoreToKeep: 0.1,
  autoRunIntervalMs: 60 * 60 * 1000, // 1 hour
  weights: {
    recency: 0.25,
    accessFrequency: 0.20,
    uniqueness: 0.15,
    userExplicit: 0.25,
    errorRelated: 0.10,
    crossReferenced: 0.05,
  },
};

let config: ConsolidationConfig = { ...defaultConfig, weights: { ...defaultConfig.weights } };

// ─── Importance Scoring ───────────────────────────────────────────────────────

function calculateRecency(createdAt: number): number {
  const ageMs = Date.now() - createdAt;
  // Exponential decay with configurable half-life
  return Math.pow(0.5, ageMs / config.decayHalfLifeMs);
}

function calculateAccessFrequency(id: string): number {
  const accesses = accessLog.get(id) ?? [];
  if (accesses.length === 0) return 0;

  // Recent accesses count more
  const now = Date.now();
  const recentWindow = 24 * 60 * 60 * 1000; // 24 hours
  const recentAccesses = accesses.filter(t => now - t < recentWindow).length;
  const totalAccesses = accesses.length;

  // Normalize: 10+ accesses = max score
  return Math.min(1, (recentAccesses * 2 + totalAccesses) / 15);
}

function calculateUniqueness(text: string, allTexts: string[]): number {
  // Simple word overlap uniqueness — lower overlap with others = more unique
  const words = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words.size === 0) return 0.5;

  let maxOverlap = 0;
  for (const other of allTexts) {
    if (other === text) continue;
    const otherWords = new Set(other.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of Array.from(words)) {
      if (otherWords.has(w)) overlap++;
    }
    const overlapRatio = overlap / Math.max(words.size, 1);
    if (overlapRatio > maxOverlap) maxOverlap = overlapRatio;
  }

  return 1 - maxOverlap; // Higher = more unique
}

function scoreMemory(memory: ScoredMemory, allTexts: string[]): number {
  const factors: ImportanceFactors = {
    recency: calculateRecency(memory.createdAt),
    accessFrequency: calculateAccessFrequency(memory.id),
    uniqueness: calculateUniqueness(memory.text, allTexts),
    userExplicit: memory.type === "preference" || memory.type === "feedback" ? 1 : 0,
    errorRelated: memory.type === "error" ? 1 : 0,
    crossReferenced: memory.sourceIds ? 0.8 : 0, // Consolidated memories get a boost
  };

  memory.factors = factors;

  const w = config.weights;
  const score =
    factors.recency * w.recency +
    factors.accessFrequency * w.accessFrequency +
    factors.uniqueness * w.uniqueness +
    factors.userExplicit * w.userExplicit +
    factors.errorRelated * w.errorRelated +
    factors.crossReferenced * w.crossReferenced;

  memory.score = Math.max(0, Math.min(1, score));
  return memory.score;
}

// ─── Memory Registration ─────────────────────────────────────────────────────

/**
 * Register a memory for tracking. Call this whenever a memory is stored.
 */
export function trackMemory(id: string, text: string, type: string, createdAt?: number): void {
  if (scoredMemories.has(id)) return;
  scoredMemories.set(id, {
    id,
    text,
    type,
    score: 0.5, // Initial neutral score
    factors: { recency: 1, accessFrequency: 0, uniqueness: 0.5, userExplicit: 0, errorRelated: 0, crossReferenced: 0 },
    accessCount: 0,
    lastAccessed: Date.now(),
    createdAt: createdAt ?? Date.now(),
    consolidated: false,
  });
}

/**
 * Record an access to a memory (e.g., when it appears in search results).
 */
export function recordAccess(id: string): void {
  const mem = scoredMemories.get(id);
  if (mem) {
    mem.accessCount++;
    mem.lastAccessed = Date.now();
  }
  const accesses = accessLog.get(id) ?? [];
  accesses.push(Date.now());
  if (accesses.length > 100) accesses.splice(0, accesses.length - 100);
  accessLog.set(id, accesses);
}

// ─── Consolidation (Merge Similar Memories) ───────────────────────────────────

function textSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of Array.from(wordsA)) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...Array.from(wordsA), ...Array.from(wordsB)]).size;
  return intersection / union; // Jaccard similarity
}

function findConsolidationGroups(): ConsolidationGroup[] {
  const memories = Array.from(scoredMemories.values()).filter(m => !m.consolidated);
  const groups: ConsolidationGroup[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    if (assigned.has(memories[i].id)) continue;

    const group: string[] = [memories[i].id];
    let totalSim = 0;
    let simCount = 0;

    for (let j = i + 1; j < memories.length; j++) {
      if (assigned.has(memories[j].id)) continue;

      const sim = textSimilarity(memories[i].text, memories[j].text);
      if (sim >= config.consolidationThreshold) {
        group.push(memories[j].id);
        totalSim += sim;
        simCount++;
      }
    }

    if (group.length >= 2) {
      for (const id of group) assigned.add(id);
      groups.push({
        id: randomUUID(),
        memberIds: group,
        similarity: simCount > 0 ? totalSim / simCount : 0,
        createdAt: Date.now(),
      });
    }
  }

  return groups;
}

function mergeGroup(group: ConsolidationGroup): ScoredMemory | null {
  const members = group.memberIds
    .map(id => scoredMemories.get(id))
    .filter((m): m is ScoredMemory => !!m);

  if (members.length < 2) return null;

  // Create a consolidated summary by combining unique sentences
  const allSentences: string[] = [];
  for (const m of members) {
    const sentences = m.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    for (const s of sentences) {
      // Only add if not too similar to existing sentences
      const isDuplicate = allSentences.some(existing => textSimilarity(existing, s) > 0.8);
      if (!isDuplicate) allSentences.push(s);
    }
  }

  const mergedText = allSentences.join(". ") + ".";
  const bestType = members.reduce((best, m) => {
    if (m.type === "preference" || m.type === "feedback") return m.type;
    return best;
  }, members[0].type);

  // Keep the highest score and earliest creation date
  const bestScore = Math.max(...members.map(m => m.score));
  const earliestCreated = Math.min(...members.map(m => m.createdAt));

  const consolidated: ScoredMemory = {
    id: randomUUID(),
    text: mergedText.slice(0, 2000), // Cap at 2000 chars
    type: bestType,
    score: bestScore,
    factors: { recency: 1, accessFrequency: 0.5, uniqueness: 0.8, userExplicit: 0, errorRelated: 0, crossReferenced: 0.8 },
    accessCount: members.reduce((sum, m) => sum + m.accessCount, 0),
    lastAccessed: Date.now(),
    createdAt: earliestCreated,
    consolidated: true,
    sourceIds: group.memberIds,
  };

  // Remove old members, add consolidated
  for (const id of group.memberIds) {
    scoredMemories.delete(id);
    accessLog.delete(id);
  }
  scoredMemories.set(consolidated.id, consolidated);

  return consolidated;
}

// ─── Eviction ─────────────────────────────────────────────────────────────────

function evictLowestScoring(count: number): string[] {
  const sorted = Array.from(scoredMemories.values())
    .filter(m => !m.consolidated) // Don't evict consolidated summaries first
    .sort((a, b) => a.score - b.score);

  const toEvict = sorted.slice(0, count);
  const evictedIds: string[] = [];

  for (const mem of toEvict) {
    if (mem.score < config.minScoreToKeep || scoredMemories.size > config.maxMemories) {
      scoredMemories.delete(mem.id);
      accessLog.delete(mem.id);
      evictedIds.push(mem.id);
    }
  }

  return evictedIds;
}

// ─── Main Consolidation Cycle ─────────────────────────────────────────────────

/**
 * Run a full consolidation cycle: score → consolidate → evict.
 */
export function runConsolidation(): ConsolidationResult {
  const startTime = Date.now();
  const allTexts = Array.from(scoredMemories.values()).map(m => m.text);

  // 1. Score all memories
  let memoriesScored = 0;
  for (const mem of Array.from(scoredMemories.values())) {
    scoreMemory(mem, allTexts);
    memoriesScored++;
  }

  // 2. Consolidate similar memories (only if above soft limit)
  let groupsConsolidated = 0;
  let memoriesMerged = 0;
  if (scoredMemories.size > config.softLimit) {
    const groups = findConsolidationGroups();
    for (const group of groups) {
      const merged = mergeGroup(group);
      if (merged) {
        groupsConsolidated++;
        memoriesMerged += group.memberIds.length;
        consolidationGroups.push(group);
      }
    }
  }

  // 3. Evict lowest-scoring if still over limit
  let memoriesEvicted = 0;
  if (scoredMemories.size > config.maxMemories) {
    const excess = scoredMemories.size - config.maxMemories + config.evictionBatchSize;
    const evicted = evictLowestScoring(excess);
    memoriesEvicted = evicted.length;
  }

  // 4. Also evict anything below minimum score
  const belowMin = Array.from(scoredMemories.values()).filter(m => m.score < config.minScoreToKeep);
  for (const mem of belowMin) {
    scoredMemories.delete(mem.id);
    accessLog.delete(mem.id);
    memoriesEvicted++;
  }

  // 5. Clean up orphaned accessLog entries (v6.12 memory leak fix)
  for (const id of Array.from(accessLog.keys())) {
    if (!scoredMemories.has(id)) accessLog.delete(id);
  }

  // Calculate score stats
  const scores = Array.from(scoredMemories.values()).map(m => m.score);
  const result: ConsolidationResult = {
    memoriesScored,
    memoriesEvicted,
    groupsConsolidated,
    memoriesMerged,
    newScore: {
      min: scores.length > 0 ? Math.min(...scores) : 0,
      max: scores.length > 0 ? Math.max(...scores) : 0,
      avg: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    },
    duration: Date.now() - startTime,
  };

  lastRunResult = result;
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getConsolidationConfig(): ConsolidationConfig {
  return { ...config, weights: { ...config.weights } };
}

export function setConsolidationConfig(updates: Partial<ConsolidationConfig>): ConsolidationConfig {
  if (updates.weights) {
    config.weights = { ...config.weights, ...updates.weights };
  }
  const { weights, ...rest } = updates;
  config = { ...config, ...rest, weights: config.weights };

  // Restart interval if changed
  if (updates.autoRunIntervalMs !== undefined || updates.enabled !== undefined) {
    stopConsolidation();
    if (config.enabled) startConsolidation();
  }

  return getConsolidationConfig();
}

export function getConsolidationStats(): {
  trackedMemories: number;
  consolidatedMemories: number;
  totalGroups: number;
  lastResult: ConsolidationResult | null;
  scoreDistribution: { low: number; medium: number; high: number };
} {
  const all = Array.from(scoredMemories.values());
  const consolidated = all.filter(m => m.consolidated);

  return {
    trackedMemories: all.length,
    consolidatedMemories: consolidated.length,
    totalGroups: consolidationGroups.length,
    lastResult: lastRunResult,
    scoreDistribution: {
      low: all.filter(m => m.score < 0.33).length,
      medium: all.filter(m => m.score >= 0.33 && m.score < 0.66).length,
      high: all.filter(m => m.score >= 0.66).length,
    },
  };
}

export function getScoredMemories(sortBy: "score" | "recency" | "access" = "score", limit: number = 50): ScoredMemory[] {
  const all = Array.from(scoredMemories.values());
  switch (sortBy) {
    case "score": all.sort((a, b) => b.score - a.score); break;
    case "recency": all.sort((a, b) => b.createdAt - a.createdAt); break;
    case "access": all.sort((a, b) => b.accessCount - a.accessCount); break;
  }
  return all.slice(0, limit);
}

export function getMemoryScore(id: string): ScoredMemory | undefined {
  return scoredMemories.get(id);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startConsolidation(): void {
  if (consolidationInterval) return;
  consolidationInterval = setInterval(() => {
    if (config.enabled) runConsolidation();
  }, config.autoRunIntervalMs);
}

export function stopConsolidation(): void {
  if (consolidationInterval) {
    clearInterval(consolidationInterval);
    consolidationInterval = null;
  }
}

export function isConsolidationRunning(): boolean {
  return consolidationInterval !== null;
}

// ═══════════════════════════════════════════════════════════════════════════
// v5.7 Enhancement: Cross-Session Memory Deduplication
// ═══════════════════════════════════════════════════════════════════════════

export type DedupResult = {
  totalChecked: number;
  duplicatesFound: number;
  merged: number;
  removed: number;
  keptBest: number;
  duration: number;
};

export type DedupConfig = {
  enabled: boolean;
  similarityThreshold: number;   // 0-1, default 0.85 for near-duplicates
  preferNewer: boolean;          // When merging, prefer newer or higher-scored?
  maxComparisons: number;        // Cap to avoid O(n²) blowup
  runOnConsolidation: boolean;   // Auto-run during consolidation cycle
};

let dedupConfig: DedupConfig = {
  enabled: true,
  similarityThreshold: 0.85,
  preferNewer: false,
  maxComparisons: 50_000,
  runOnConsolidation: true,
};

const dedupHistory: DedupResult[] = [];

/**
 * Find near-duplicate memory pairs using Jaccard + substring overlap.
 */
function findDuplicatePairs(): { idA: string; idB: string; similarity: number }[] {
  const memories = Array.from(scoredMemories.values());
  const pairs: { idA: string; idB: string; similarity: number }[] = [];
  let comparisons = 0;

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      if (comparisons >= dedupConfig.maxComparisons) break;
      comparisons++;

      // Quick length check — very different lengths are unlikely duplicates
      const lenRatio = Math.min(memories[i].text.length, memories[j].text.length) /
                       Math.max(memories[i].text.length, memories[j].text.length);
      if (lenRatio < 0.5) continue;

      // Compute similarity (reuse existing textSimilarity + substring check)
      const jaccardSim = textSimilarity(memories[i].text, memories[j].text);
      
      // Also check if one is a substring of the other
      const shorter = memories[i].text.length < memories[j].text.length ? memories[i].text : memories[j].text;
      const longer = memories[i].text.length >= memories[j].text.length ? memories[i].text : memories[j].text;
      const substringBonus = longer.toLowerCase().includes(shorter.toLowerCase().substring(0, 50)) ? 0.15 : 0;

      const combinedSim = Math.min(1, jaccardSim + substringBonus);

      if (combinedSim >= dedupConfig.similarityThreshold) {
        pairs.push({ idA: memories[i].id, idB: memories[j].id, similarity: combinedSim });
      }
    }
    if (comparisons >= dedupConfig.maxComparisons) break;
  }

  // Sort by similarity descending (merge most similar first)
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Run cross-session deduplication.
 * For each duplicate pair, keeps the higher-scored (or newer) memory
 * and merges unique information from the other.
 */
export function runDeduplication(): DedupResult {
  const start = Date.now();
  if (!dedupConfig.enabled) {
    return { totalChecked: 0, duplicatesFound: 0, merged: 0, removed: 0, keptBest: 0, duration: 0 };
  }

  const pairs = findDuplicatePairs();
  const alreadyProcessed = new Set<string>();
  let merged = 0;
  let removed = 0;
  let keptBest = 0;

  for (const pair of pairs) {
    if (alreadyProcessed.has(pair.idA) || alreadyProcessed.has(pair.idB)) continue;

    const memA = scoredMemories.get(pair.idA);
    const memB = scoredMemories.get(pair.idB);
    if (!memA || !memB) continue;

    // Decide which to keep
    let keeper: typeof memA;
    let loser: typeof memA;

    if (dedupConfig.preferNewer) {
      keeper = memA.createdAt > memB.createdAt ? memA : memB;
      loser = memA.createdAt > memB.createdAt ? memB : memA;
    } else {
      keeper = memA.score >= memB.score ? memA : memB;
      loser = memA.score >= memB.score ? memB : memA;
    }

    // Extract unique sentences from loser that aren't in keeper
    const loserSentences = loser.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    const keeperLower = keeper.text.toLowerCase();
    const uniqueSentences = loserSentences.filter(s => {
      const sim = textSimilarity(s, keeper.text);
      return sim < 0.6 && !keeperLower.includes(s.toLowerCase().substring(0, 30));
    });

    // Merge unique info into keeper
    if (uniqueSentences.length > 0) {
      const addition = uniqueSentences.join(". ");
      keeper.text = (keeper.text + ". " + addition).substring(0, 2000);
      merged++;
    } else {
      keptBest++;
    }

    // Merge access stats
    keeper.accessCount += loser.accessCount;
    keeper.score = Math.max(keeper.score, loser.score);

    // Remove the loser
    scoredMemories.delete(loser.id);
    accessLog.delete(loser.id);
    removed++;

    alreadyProcessed.add(pair.idA);
    alreadyProcessed.add(pair.idB);
  }

  const result: DedupResult = {
    totalChecked: scoredMemories.size,
    duplicatesFound: pairs.length,
    merged,
    removed,
    keptBest,
    duration: Date.now() - start,
  };

  dedupHistory.push(result);
  if (dedupHistory.length > 50) dedupHistory.splice(0, dedupHistory.length - 50);

  return result;
}

export function getDedupConfig(): DedupConfig {
  return { ...dedupConfig };
}

export function setDedupConfig(updates: Partial<DedupConfig>): DedupConfig {
  dedupConfig = { ...dedupConfig, ...updates };
  return { ...dedupConfig };
}

export function getDedupHistory(limit: number = 20): DedupResult[] {
  return dedupHistory.slice(-limit);
}

export function getDedupStats(): {
  totalRuns: number;
  totalDuplicatesFound: number;
  totalRemoved: number;
  totalMerged: number;
  avgDuplicatesPerRun: number;
} {
  const totalDups = dedupHistory.reduce((sum, r) => sum + r.duplicatesFound, 0);
  return {
    totalRuns: dedupHistory.length,
    totalDuplicatesFound: totalDups,
    totalRemoved: dedupHistory.reduce((sum, r) => sum + r.removed, 0),
    totalMerged: dedupHistory.reduce((sum, r) => sum + r.merged, 0),
    avgDuplicatesPerRun: dedupHistory.length > 0 ? Math.round(totalDups / dedupHistory.length) : 0,
  };
}
