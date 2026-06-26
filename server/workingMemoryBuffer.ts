/**
 * workingMemoryBuffer.ts — v58.0.0 "The Memory Palace"
 * Fixed-capacity working memory with LRU eviction and attention-weighted access.
 */

export interface WorkingMemoryItem { itemId: string; content: string; attentionWeight: number; insertedAt: number; lastAccessedAt: number; }

const DEFAULT_CAPACITY = 7;  // Miller's Law: 7 ± 2
let buffer: WorkingMemoryItem[] = [];
let capacity = DEFAULT_CAPACITY;
let itemCounter = 0;

export function setCapacity(cap: number): void { capacity = cap; }

export function pushToWorkingMemory(content: string, attentionWeight = 0.5): WorkingMemoryItem {
  const item: WorkingMemoryItem = { itemId: `wm-${++itemCounter}`, content, attentionWeight, insertedAt: Date.now(), lastAccessedAt: Date.now() };
  buffer.push(item);
  if (buffer.length > capacity) {
    // Evict item with lowest attention weight
    const minIdx = buffer.reduce((minI, x, i) => x.attentionWeight < buffer[minI].attentionWeight ? i : minI, 0);
    buffer.splice(minIdx, 1);
  }
  return item;
}

export function getWorkingMemory(): WorkingMemoryItem[] {
  return buffer.sort((a, b) => b.attentionWeight - a.attentionWeight);
}

export function focusAttention(itemId: string, boost: number): void {
  const item = buffer.find(i => i.itemId === itemId);
  if (item) { item.attentionWeight = Math.min(1, item.attentionWeight + boost); item.lastAccessedAt = Date.now(); }
}

export function clearWorkingMemory(): void { buffer = []; }
export function _resetWorkingMemoryBufferForTest(): void { buffer = []; itemCounter = 0; capacity = DEFAULT_CAPACITY; }
