/**
 * agentMemoryBroker.ts — v47.0.0
 *
 * Manages shared and private memory namespaces for sub-agents.
 * Supports read/write with access control, TTL-based expiry, and
 * cross-agent memory sharing with permission grants.
 */

export type MemoryScope = "private" | "shared" | "broadcast";

export interface MemoryEntry {
  key: string;
  value: unknown;
  ownerId: string;
  scope: MemoryScope;
  createdAt: number;
  expiresAt?: number;
  accessList: string[];   // agent IDs with read access (empty = owner only)
  version: number;
}

const store = new Map<string, MemoryEntry>();
let writeCounter = 0;

function makeKey(ownerId: string, key: string): string {
  return `${ownerId}::${key}`;
}

export function writeMemory(
  ownerId: string,
  key: string,
  value: unknown,
  scope: MemoryScope = "private",
  ttlMs?: number
): MemoryEntry {
  const storeKey = makeKey(ownerId, key);
  const existing = store.get(storeKey);

  const entry: MemoryEntry = {
    key,
    value,
    ownerId,
    scope,
    createdAt: existing?.createdAt ?? Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    accessList: existing?.accessList ?? [],
    version: (existing?.version ?? 0) + 1,
  };

  store.set(storeKey, entry);
  writeCounter++;
  return entry;
}

export function readMemory(requesterId: string, ownerId: string, key: string): unknown | null {
  const storeKey = makeKey(ownerId, key);
  const entry = store.get(storeKey);
  if (!entry) return null;

  // Check expiry
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    store.delete(storeKey);
    return null;
  }

  // Check access
  if (entry.scope === "private" && requesterId !== ownerId) return null;
  if (entry.scope === "shared" && requesterId !== ownerId && !entry.accessList.includes(requesterId)) return null;
  // "broadcast" is readable by all

  return entry.value;
}

export function grantAccess(ownerId: string, key: string, granteeId: string): boolean {
  const entry = store.get(makeKey(ownerId, key));
  if (!entry || entry.scope === "broadcast") return false;
  if (!entry.accessList.includes(granteeId)) {
    entry.accessList.push(granteeId);
  }
  return true;
}

export function deleteMemory(ownerId: string, key: string): boolean {
  return store.delete(makeKey(ownerId, key));
}

export function listKeys(ownerId: string): string[] {
  const prefix = `${ownerId}::`;
  return Array.from(store.keys())
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length));
}

export function purgeExpired(): number {
  const now = Date.now();
  let count = 0;
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      store.delete(key);
      count++;
    }
  }
  return count;
}

export function getMemoryStats(): { totalEntries: number; totalWrites: number } {
  return { totalEntries: store.size, totalWrites: writeCounter };
}

export function _resetMemoryBrokerForTest(): void {
  store.clear();
  writeCounter = 0;
}
