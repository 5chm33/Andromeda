/**
 * persistentGlobalMemory.ts — v20.0.0
 * 
 * Persistent Global Memory Graph (PGMG).
 * Elevates the local memory system to a cross-project knowledge graph,
 * allowing Andromeda to apply lessons learned from one project to another.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface GlobalMemoryEntry {
  id: string;
  projectId: string;
  content: string;
  tags: string[];
  successRate: number;
  timestamp: number;
}

const GLOBAL_MEMORY_DIR = path.join(os.homedir(), ".andromeda_global_memory");
const GLOBAL_MEMORY_FILE = path.join(GLOBAL_MEMORY_DIR, "pgmg.json");

/**
 * Initializes the global memory directory.
 */
export function initGlobalMemory(): void {
  if (!fs.existsSync(GLOBAL_MEMORY_DIR)) {
    fs.mkdirSync(GLOBAL_MEMORY_DIR, { recursive: true });
  }
  if (!fs.existsSync(GLOBAL_MEMORY_FILE)) {
    fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify([]));
  }
}

/**
 * Reads all global memories.
 */
function readGlobalMemories(): GlobalMemoryEntry[] {
  try {
    const data = fs.readFileSync(GLOBAL_MEMORY_FILE, "utf-8");
    return JSON.parse(data) as GlobalMemoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Writes to the global memory store.
 */
function writeGlobalMemories(memories: GlobalMemoryEntry[]): void {
  fs.writeFileSync(GLOBAL_MEMORY_FILE, JSON.stringify(memories, null, 2));
}

/**
 * Publishes a highly successful local memory to the global graph.
 */
export function publishToGlobalMemory(
  projectId: string,
  content: string,
  tags: string[],
  successRate: number
): void {
  initGlobalMemory();
  const memories = readGlobalMemories();
  
  // Prevent exact duplicates
  if (memories.some(m => m.content === content)) return;

  memories.push({
    id: `gmem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    projectId,
    content,
    tags,
    successRate,
    timestamp: Date.now()
  });

  writeGlobalMemories(memories);
}

/**
 * Queries the global memory graph for cross-project insights.
 */
export function queryGlobalMemory(queryTags: string[], limit: number = 3): GlobalMemoryEntry[] {
  initGlobalMemory();
  const memories = readGlobalMemories();
  
  // Simple tag intersection scoring
  const scored = memories.map(mem => {
    const matchCount = mem.tags.filter(t => queryTags.includes(t)).length;
    return { mem, score: matchCount * mem.successRate };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.mem);
}
