/**
 * deadLetterQueue.ts — v68.0.0 "Real-World Integration III"
 * Dead letter queue for failed messages with inspection, replay, and purge capabilities.
 */

export interface DeadLetter { id: string; originalQueue: string; payload: unknown; failureReason: string; failedAt: number; attempts: number; replayedAt?: number; }

const dlq: DeadLetter[] = [];
let dlCounter = 0;

export function sendToDeadLetter(originalQueue: string, payload: unknown, failureReason: string, attempts: number): DeadLetter {
  const dl: DeadLetter = { id: `dl-${++dlCounter}`, originalQueue, payload, failureReason, failedAt: Date.now(), attempts };
  dlq.push(dl);
  return dl;
}

export function inspectDeadLetters(originalQueue?: string): DeadLetter[] {
  return originalQueue ? dlq.filter(d => d.originalQueue === originalQueue) : [...dlq];
}

export async function replayDeadLetter(id: string, handler: (payload: unknown) => Promise<void>): Promise<boolean> {
  const dl = dlq.find(d => d.id === id);
  if (!dl) return false;
  try {
    await handler(dl.payload);
    dl.replayedAt = Date.now();
    return true;
  } catch { return false; }
}

export function purgeDeadLetters(originalQueue?: string): number {
  const before = dlq.length;
  if (originalQueue) { const toRemove = dlq.filter(d => d.originalQueue === originalQueue); toRemove.forEach(d => dlq.splice(dlq.indexOf(d), 1)); }
  else dlq.length = 0;
  return before - dlq.length;
}

export function getDeadLetterCount(): number { return dlq.length; }
export function _resetDeadLetterQueueForTest(): void { dlq.length = 0; dlCounter = 0; }
