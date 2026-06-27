/**
 * agentStateSync.ts — v86.0.0 "Multi-Agent Coordination"
 * Synchronizes shared state across agents with conflict resolution and versioning.
 */
export type ConflictStrategy = "last_write_wins" | "highest_version_wins" | "merge";

export interface SharedStateEntry {
  key: string;
  value: unknown;
  version: number;
  lastModifiedBy: string;
  lastModifiedAt: number;
  checksum: string;
}

export interface SyncResult {
  key: string;
  accepted: boolean;
  conflictResolved: boolean;
  finalVersion: number;
  strategy: ConflictStrategy;
}

const stateStore = new Map<string, SharedStateEntry>();

function simpleChecksum(value: unknown): string {
  const str = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(16);
}

export function writeState(key: string, value: unknown, agentId: string, version: number, strategy: ConflictStrategy = "last_write_wins"): SyncResult {
  const existing = stateStore.get(key);
  let accepted = false;
  let conflictResolved = false;

  if (!existing) {
    stateStore.set(key, { key, value, version, lastModifiedBy: agentId, lastModifiedAt: Date.now(), checksum: simpleChecksum(value) });
    accepted = true;
  } else if (strategy === "last_write_wins") {
    stateStore.set(key, { key, value, version: Math.max(existing.version, version) + 1, lastModifiedBy: agentId, lastModifiedAt: Date.now(), checksum: simpleChecksum(value) });
    accepted = true;
    conflictResolved = existing.version >= version;
  } else if (strategy === "highest_version_wins") {
    if (version > existing.version) {
      stateStore.set(key, { key, value, version, lastModifiedBy: agentId, lastModifiedAt: Date.now(), checksum: simpleChecksum(value) });
      accepted = true;
    } else {
      conflictResolved = true;
    }
  } else if (strategy === "merge") {
    // Simple merge: if both are objects, merge properties
    if (typeof value === "object" && typeof existing.value === "object" && value !== null && existing.value !== null) {
      const merged = { ...(existing.value as Record<string, unknown>), ...(value as Record<string, unknown>) };
      stateStore.set(key, { key, value: merged, version: existing.version + 1, lastModifiedBy: agentId, lastModifiedAt: Date.now(), checksum: simpleChecksum(merged) });
      accepted = true;
      conflictResolved = true;
    } else {
      stateStore.set(key, { key, value, version: existing.version + 1, lastModifiedBy: agentId, lastModifiedAt: Date.now(), checksum: simpleChecksum(value) });
      accepted = true;
    }
  }

  return { key, accepted, conflictResolved, finalVersion: stateStore.get(key)?.version ?? version, strategy };
}

export function readState(key: string): SharedStateEntry | undefined { return stateStore.get(key); }
export function deleteState(key: string): boolean { return stateStore.delete(key); }
export function getAllKeys(): string[] { return [...stateStore.keys()]; }
export function getStateCount(): number { return stateStore.size; }
export function _resetAgentStateSyncForTest(): void { stateStore.clear(); }
