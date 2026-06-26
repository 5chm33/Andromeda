/**
 * episodicMemoryStore.ts — v58.0.0 "The Memory Palace"
 * Stores and retrieves episodic memories (specific events with context and timestamp).
 */

export interface EpisodicMemory {
  memoryId: string;
  event: string;
  context: Record<string, string>;
  emotionalValence: number;  // -1 (negative) to +1 (positive)
  importance: number;        // 0–1
  timestamp: number;
  accessCount: number;
  lastAccessedAt: number;
}

const memories = new Map<string, EpisodicMemory>();
let memCounter = 0;

export function storeEpisode(event: string, context: Record<string, string>, emotionalValence: number, importance: number): EpisodicMemory {
  const mem: EpisodicMemory = {
    memoryId: `ep-${++memCounter}`,
    event, context,
    emotionalValence: Math.max(-1, Math.min(1, emotionalValence)),
    importance: Math.max(0, Math.min(1, importance)),
    timestamp: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
  };
  memories.set(mem.memoryId, mem);
  return mem;
}

export function recallEpisode(memoryId: string): EpisodicMemory | null {
  const mem = memories.get(memoryId);
  if (!mem) return null;
  mem.accessCount++;
  mem.lastAccessedAt = Date.now();
  return mem;
}

export function searchEpisodes(query: string, limit = 10): EpisodicMemory[] {
  return Array.from(memories.values())
    .filter(m => m.event.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

export function getMostImportantMemories(limit = 5): EpisodicMemory[] {
  return Array.from(memories.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

export function _resetEpisodicMemoryStoreForTest(): void { memories.clear(); memCounter = 0; }
