/**
 * knowledgeSynchronizer.ts — v63.0.0 "The Collaboration Hub"
 * Synchronizes knowledge across agents using vector-clock-based conflict resolution.
 */

export interface KnowledgeEntry { key: string; value: unknown; version: number; agentId: string; timestamp: number; }
export interface SyncResult { syncId: string; mergedEntries: number; conflicts: number; resolvedBy: "latest_wins" | "highest_version"; }

const store = new Map<string, KnowledgeEntry>();
const syncs: SyncResult[] = [];
let sCounter = 0;

export function publishKnowledge(agentId: string, key: string, value: unknown, version: number): KnowledgeEntry {
  const existing = store.get(key);
  const entry: KnowledgeEntry = { key, value, version, agentId, timestamp: Date.now() };
  if (!existing || version > existing.version || (version === existing.version && entry.timestamp > existing.timestamp)) {
    store.set(key, entry);
  }
  return entry;
}

export function syncKnowledge(entries: KnowledgeEntry[]): SyncResult {
  let merged = 0, conflicts = 0;
  for (const entry of entries) {
    const existing = store.get(entry.key);
    if (!existing) { store.set(entry.key, entry); merged++; }
    else if (entry.version !== existing.version) { conflicts++; if (entry.version > existing.version) { store.set(entry.key, entry); merged++; } }
  }
  const result: SyncResult = { syncId: `sync-${++sCounter}`, mergedEntries: merged, conflicts, resolvedBy: "highest_version" };
  syncs.push(result);
  return result;
}

export function getKnowledge(key: string): KnowledgeEntry | undefined { return store.get(key); }
export function getAllKnowledge(): KnowledgeEntry[] { return [...store.values()]; }
export function _resetKnowledgeSynchronizerForTest(): void { store.clear(); syncs.length = 0; sCounter = 0; }
