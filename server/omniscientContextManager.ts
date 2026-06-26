/**
 * omniscientContextManager.ts — v55.0.0 "The Grand Unification"
 *
 * A global context store that maintains a unified world-model across
 * all Andromeda sub-systems: facts, beliefs, goals, and active tasks.
 */

export type ContextEntryType = "fact" | "belief" | "goal" | "task" | "constraint" | "observation";

export interface ContextEntry {
  entryId: string;
  type: ContextEntryType;
  key: string;
  value: unknown;
  confidence: number;   // 0.0–1.0
  source: string;
  createdAt: number;
  expiresAt?: number;
  tags: string[];
}

export interface ContextQuery {
  type?: ContextEntryType;
  keyPattern?: string;
  tags?: string[];
  minConfidence?: number;
  source?: string;
}

const context = new Map<string, ContextEntry>();
let entryCounter = 0;

export function setContext(
  type: ContextEntryType,
  key: string,
  value: unknown,
  source: string,
  confidence = 1.0,
  tags: string[] = [],
  ttlMs?: number
): ContextEntry {
  const entry: ContextEntry = {
    entryId: `ctx-${++entryCounter}`,
    type,
    key,
    value,
    confidence,
    source,
    createdAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    tags,
  };
  context.set(key, entry);
  return entry;
}

export function getContext(key: string): ContextEntry | null {
  const entry = context.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    context.delete(key);
    return null;
  }
  return entry;
}

export function queryContext(query: ContextQuery): ContextEntry[] {
  const results: ContextEntry[] = [];
  const now = Date.now();

  for (const entry of context.values()) {
    if (entry.expiresAt && now > entry.expiresAt) continue;
    if (query.type && entry.type !== query.type) continue;
    if (query.keyPattern && !entry.key.includes(query.keyPattern)) continue;
    if (query.minConfidence && entry.confidence < query.minConfidence) continue;
    if (query.source && entry.source !== query.source) continue;
    if (query.tags && !query.tags.every(t => entry.tags.includes(t))) continue;
    results.push(entry);
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function removeContext(key: string): boolean {
  return context.delete(key);
}

export function getContextSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, entry] of context.entries()) {
    if (!entry.expiresAt || Date.now() <= entry.expiresAt) {
      snapshot[key] = entry.value;
    }
  }
  return snapshot;
}

export function _resetOmniscientContextForTest(): void {
  context.clear();
  entryCounter = 0;
}
