/**
 * workingMemory.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Short-term working memory with capacity limits, decay, and rehearsal mechanisms.
 */
export interface MemoryChunk {
  chunkId: string;
  content: unknown;
  label: string;
  activationLevel: number;
  createdAt: number;
  lastAccessedAt: number;
  rehearsalCount: number;
  decayRate: number;
}

export interface WorkingMemoryStore {
  storeId: string;
  agentId: string;
  capacity: number;
  chunks: MemoryChunk[];
  totalRehearsals: number;
  evictionCount: number;
}

const stores = new Map<string, WorkingMemoryStore>();
let storeCounter = 0;
let chunkCounter = 0;

export function createWorkingMemory(agentId: string, capacity = 7): WorkingMemoryStore {
  const store: WorkingMemoryStore = { storeId: `wm-${++storeCounter}`, agentId, capacity, chunks: [], totalRehearsals: 0, evictionCount: 0 };
  stores.set(store.storeId, store);
  return store;
}

export function store(storeId: string, content: unknown, label: string, decayRate = 0.1): MemoryChunk | null {
  const mem = stores.get(storeId);
  if (!mem) return null;

  // Evict lowest activation if at capacity
  if (mem.chunks.length >= mem.capacity) {
    mem.chunks.sort((a, b) => a.activationLevel - b.activationLevel);
    mem.chunks.shift();
    mem.evictionCount++;
  }

  const chunk: MemoryChunk = { chunkId: `chunk-${++chunkCounter}`, content, label, activationLevel: 1.0, createdAt: Date.now(), lastAccessedAt: Date.now(), rehearsalCount: 0, decayRate };
  mem.chunks.push(chunk);
  return chunk;
}

export function retrieve(storeId: string, label: string): MemoryChunk | null {
  const mem = stores.get(storeId);
  if (!mem) return null;
  const chunk = mem.chunks.find(c => c.label === label);
  if (chunk) { chunk.lastAccessedAt = Date.now(); chunk.activationLevel = Math.min(1.0, chunk.activationLevel + 0.1); }
  return chunk ?? null;
}

export function rehearse(storeId: string, chunkId: string): boolean {
  const mem = stores.get(storeId);
  if (!mem) return false;
  const chunk = mem.chunks.find(c => c.chunkId === chunkId);
  if (!chunk) return false;
  chunk.rehearsalCount++;
  chunk.activationLevel = Math.min(1.0, chunk.activationLevel + 0.2);
  chunk.lastAccessedAt = Date.now();
  mem.totalRehearsals++;
  return true;
}

export function decay(storeId: string): void {
  const mem = stores.get(storeId);
  if (!mem) return;
  const now = Date.now();
  for (const chunk of mem.chunks) {
    const elapsed = (now - chunk.lastAccessedAt) / 1000;
    chunk.activationLevel = Math.max(0, chunk.activationLevel - chunk.decayRate * elapsed);
  }
  mem.chunks = mem.chunks.filter(c => c.activationLevel > 0.01);
}

export function getStore(storeId: string): WorkingMemoryStore | undefined { return stores.get(storeId); }
export function getActiveChunks(storeId: string, threshold = 0.3): MemoryChunk[] { return stores.get(storeId)?.chunks.filter(c => c.activationLevel >= threshold) ?? []; }
export function _resetWorkingMemoryForTest(): void { stores.clear(); storeCounter = 0; chunkCounter = 0; }
