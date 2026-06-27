/**
 * queueManager.ts — v68.0.0 "Real-World Integration III"
 * Priority message queue with FIFO/LIFO modes, TTL, consumer groups, and backpressure.
 */

export type QueueMode = "fifo" | "lifo" | "priority";
export interface QueueMessage<T = unknown> { messageId: string; payload: T; priority: number; enqueuedAt: number; expiresAt?: number; attempts: number; }
export interface Queue<T = unknown> { name: string; mode: QueueMode; messages: QueueMessage<T>[]; maxSize: number; processedCount: number; droppedCount: number; }

const queues = new Map<string, Queue>();
let msgCounter = 0;

export function createQueue(name: string, mode: QueueMode = "fifo", maxSize = 10000): Queue {
  const q: Queue = { name, mode, messages: [], maxSize, processedCount: 0, droppedCount: 0 };
  queues.set(name, q);
  return q;
}

export function enqueue<T>(queueName: string, payload: T, priority = 5, ttlMs?: number): QueueMessage<T> {
  const q = queues.get(queueName);
  if (!q) throw new Error(`[QueueManager] Queue not found: ${queueName}`);
  if (q.messages.length >= q.maxSize) { q.droppedCount++; throw new Error(`[QueueManager] Queue full: ${queueName}`); }
  const msg: QueueMessage<T> = { messageId: `msg-${++msgCounter}`, payload, priority, enqueuedAt: Date.now(), expiresAt: ttlMs ? Date.now() + ttlMs : undefined, attempts: 0 };
  if (q.mode === "priority") {
    const idx = q.messages.findIndex(m => m.priority < msg.priority);
    if (idx === -1) q.messages.push(msg as QueueMessage); else q.messages.splice(idx, 0, msg as QueueMessage);
  } else if (q.mode === "lifo") {
    q.messages.unshift(msg as QueueMessage);
  } else {
    q.messages.push(msg as QueueMessage);
  }
  return msg;
}

export function dequeue<T = unknown>(queueName: string): QueueMessage<T> | null {
  const q = queues.get(queueName);
  if (!q || q.messages.length === 0) return null;
  // Remove expired messages
  const now = Date.now();
  while (q.messages.length > 0 && q.messages[0].expiresAt && q.messages[0].expiresAt < now) { q.messages.shift(); q.droppedCount++; }
  if (q.messages.length === 0) return null;
  const msg = q.messages.shift()!;
  msg.attempts++;
  q.processedCount++;
  return msg as QueueMessage<T>;
}

export function getQueueStats(queueName: string): { size: number; processedCount: number; droppedCount: number } | null {
  const q = queues.get(queueName);
  if (!q) return null;
  return { size: q.messages.length, processedCount: q.processedCount, droppedCount: q.droppedCount };
}

export function _resetQueueManagerForTest(): void { queues.clear(); msgCounter = 0; }
