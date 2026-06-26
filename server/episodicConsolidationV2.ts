/**
 * episodicConsolidationV2.ts — v19.0.0
 *
 * Importance-weighted memory tier promotion.
 *
 * Replaces the old linear decay memory system. Memories are now evaluated
 * based on their downstream impact (how often they lead to accepted proposals).
 * High-impact memories are promoted to "core" tier and never decay.
 * Low-impact memories decay rapidly to save context window.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { MemoryEntry, MemoryType, storeMemory } from "./memory.js";

const log = createLogger("episodicConsolidationV2");

export type MemoryTier = "ephemeral" | "working" | "core";

export interface V2MemoryEntry extends MemoryEntry {
  timestamp: number;
  tier: MemoryTier;
  impactScore: number; // 0.0 to 1.0
  useCount: number;
  successCount: number;
}

const MEMORY_DB_PATH = path.join(process.cwd(), "workspace", "memories_v2.json");

// In-memory cache
let v2Memories: V2MemoryEntry[] = [];

/**
 * Initializes the V2 memory system, migrating old memories if necessary.
 */
export function initConsolidationV2(): void {
  if (fs.existsSync(MEMORY_DB_PATH)) {
    try {
      const data = fs.readFileSync(MEMORY_DB_PATH, "utf-8");
      v2Memories = JSON.parse(data);
      log.info(`Loaded ${v2Memories.length} V2 memories.`);
    } catch (e) {
      log.error(`Failed to load V2 memories: ${(e as Error).message}`);
      v2Memories = [];
    }
  } else {
    // Attempt migration from v1 memory.ts if it exists
    // For this implementation, we'll just start fresh or rely on the memory.ts wrapper
    v2Memories = [];
    log.info("Initialized empty V2 memory store.");
  }
}

/**
 * Persists the current state to disk.
 */
function persistMemories(): void {
  try {
    const dir = path.dirname(MEMORY_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_DB_PATH, JSON.stringify(v2Memories, null, 2));
  } catch (e) {
    log.error(`Failed to persist V2 memories: ${(e as Error).message}`);
  }
}

/**
 * Records the usage of a memory and its outcome.
 */
export function recordMemoryUsage(memoryId: string, successful: boolean): void {
  const mem = v2Memories.find(m => m.id === memoryId);
  if (!mem) return;

  mem.useCount++;
  if (successful) mem.successCount++;

  // Recalculate impact score (simple success rate, heavily penalized if useCount is low to avoid early promotion)
  // We use a Laplace smoothing approach: (success + 1) / (uses + 2)
  mem.impactScore = (mem.successCount + 1) / (mem.useCount + 2);

  // Evaluate for promotion/demotion
  evaluateTier(mem);
  persistMemories();
}

/**
 * Evaluates and updates the tier of a memory based on its impact score.
 */
function evaluateTier(mem: V2MemoryEntry): void {
  const oldTier = mem.tier;

  if (mem.impactScore > 0.7 && mem.useCount >= 3) {
    mem.tier = "core";
  } else if (mem.impactScore > 0.3) {
    mem.tier = "working";
  } else {
    mem.tier = "ephemeral";
  }

  if (oldTier !== mem.tier) {
    log.info(`Memory ${mem.id.substring(0, 8)} transitioned from ${oldTier} to ${mem.tier} (Score: ${mem.impactScore.toFixed(2)})`);
  }
}

/**
 * Runs the nightly consolidation pass.
 * Removes expired ephemeral/working memories, keeps core memories forever.
 */
export function runNightlyConsolidation(): { removed: number; promoted: number } {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  
  let removedCount = 0;
  let promotedCount = 0;

  v2Memories = v2Memories.filter(mem => {
    const ageDays = (now - mem.timestamp) / DAY_MS;

    if (mem.tier === "ephemeral" && ageDays > 7) {
      removedCount++;
      return false; // Delete
    }
    
    if (mem.tier === "working" && ageDays > 30) {
      // If it hasn't proven itself to be core in 30 days, it's out
      removedCount++;
      return false; // Delete
    }

    // Core memories never decay based on time.
    return true;
  });

  persistMemories();
  log.info(`Nightly consolidation complete. Removed: ${removedCount}. Active memories: ${v2Memories.length}`);
  
  return { removed: removedCount, promoted: promotedCount };
}

/**
 * Wrapper to store a new memory in the V2 system.
 */
export function storeMemoryV2(content: string, type: MemoryType, tags: string[] = []): V2MemoryEntry {
  const entry: V2MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content,
    type,
    tags,
    timestamp: Date.now(),
    tier: "ephemeral", // All memories start as ephemeral
    impactScore: 0.5,  // Neutral starting score
    useCount: 0,
        successCount: 0,
    vector: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now()
  };

  v2Memories.push(entry);
  persistMemories();
  return entry;
}

/**
 * Retrieves memories, prioritizing core and high-impact working memories.
 */
export function getRelevantMemoriesV2(query: string, limit: number = 5): V2MemoryEntry[] {
  // Simple keyword matching for relevance, weighted by tier and impact
  const queryWords = query.toLowerCase().split(/\s+/);
  
  const scored = v2Memories.map(mem => {
    let matchScore = 0;
    const contentLower = mem.content.toLowerCase();
    const tagsLower = mem.tags.map(t => t.toLowerCase());

    for (const word of queryWords) {
      if (word.length < 3) continue;
      if (contentLower.includes(word)) matchScore += 1;
      if (tagsLower.includes(word)) matchScore += 2;
    }

    // Tier multipliers
    let tierMultiplier = 1.0;
    if (mem.tier === "core") tierMultiplier = 2.0;
    if (mem.tier === "working") tierMultiplier = 1.5;

    const finalScore = matchScore * tierMultiplier * mem.impactScore;
    return { mem, score: finalScore };
  });

  // Filter out zero scores and sort
  const relevant = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.mem)
    .slice(0, limit);

  return relevant;
}
