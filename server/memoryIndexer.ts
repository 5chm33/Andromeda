/**
 * memoryIndexer.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Indexes and cross-references memories across working, semantic, and episodic stores.
 */
export interface MemoryIndex {
  indexId: string;
  agentId: string;
  entries: Map<string, MemoryIndexEntry>;
  totalEntries: number;
  lastRebuildAt: number;
}

export interface MemoryIndexEntry {
  entryId: string;
  label: string;
  tags: string[];
  memoryType: "working" | "semantic" | "episodic" | "procedural";
  storeId: string;
  itemId: string;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface MemorySearchResult {
  entry: MemoryIndexEntry;
  score: number;
  matchType: "exact" | "partial" | "tag";
}

const indices = new Map<string, MemoryIndex>();
let indexCounter = 0;
let entryCounter = 0;

export function createMemoryIndex(agentId: string): MemoryIndex {
  const index: MemoryIndex = { indexId: `mi-${++indexCounter}`, agentId, entries: new Map(), totalEntries: 0, lastRebuildAt: Date.now() };
  indices.set(index.indexId, index);
  return index;
}

export function indexMemory(indexId: string, label: string, tags: string[], memoryType: MemoryIndexEntry["memoryType"], storeId: string, itemId: string, importance = 0.5): MemoryIndexEntry | null {
  const index = indices.get(indexId);
  if (!index) return null;
  const entry: MemoryIndexEntry = { entryId: `me-${++entryCounter}`, label, tags, memoryType, storeId, itemId, importance, accessCount: 0, createdAt: Date.now(), lastAccessedAt: Date.now() };
  index.entries.set(entry.entryId, entry);
  index.totalEntries++;
  return entry;
}

export function searchMemory(indexId: string, query: string, tags?: string[], limit = 10): MemorySearchResult[] {
  const index = indices.get(indexId);
  if (!index) return [];

  const results: MemorySearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const entry of index.entries.values()) {
    let score = 0;
    let matchType: MemorySearchResult["matchType"] = "partial";

    if (entry.label.toLowerCase() === queryLower) { score = 1.0; matchType = "exact"; }
    else if (entry.label.toLowerCase().includes(queryLower)) { score = 0.7; matchType = "partial"; }

    if (tags && tags.some(t => entry.tags.includes(t))) { score = Math.max(score, 0.5); matchType = score < 0.5 ? "tag" : matchType; }

    if (score > 0) {
      score = score * 0.6 + entry.importance * 0.4;
      entry.accessCount++;
      entry.lastAccessedAt = Date.now();
      results.push({ entry, score, matchType });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function getImportantMemories(indexId: string, threshold = 0.7, limit = 20): MemoryIndexEntry[] {
  const index = indices.get(indexId);
  if (!index) return [];
  return [...index.entries.values()].filter(e => e.importance >= threshold).sort((a, b) => b.importance - a.importance).slice(0, limit);
}

export function getIndex(indexId: string): MemoryIndex | undefined { return indices.get(indexId); }
export function _resetMemoryIndexerForTest(): void { indices.clear(); indexCounter = 0; entryCounter = 0; }
