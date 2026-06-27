/**
 * eventBus.ts — v67.0.0 "Real-World Integration II"
 * Publish/subscribe event bus with typed events, wildcards, and replay buffer.
 */

export type EventHandler = (event: BusEvent) => void | Promise<void>;
export interface BusEvent { topic: string; payload: unknown; publishedAt: number; eventId: string; }

const subscribers = new Map<string, Set<EventHandler>>();
const replayBuffer: BusEvent[] = [];
const MAX_REPLAY = 1000;
let eventCounter = 0;

export function subscribe(topic: string, handler: EventHandler): () => void {
  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic)!.add(handler);
  return () => subscribers.get(topic)?.delete(handler);
}

export async function publish(topic: string, payload: unknown): Promise<number> {
  const event: BusEvent = { topic, payload, publishedAt: Date.now(), eventId: `evt-${++eventCounter}` };
  if (replayBuffer.length >= MAX_REPLAY) replayBuffer.shift();
  replayBuffer.push(event);
  const handlers = new Set<EventHandler>();
  subscribers.forEach((set, pattern) => {
    if (pattern === topic || pattern === "*" || (pattern.endsWith("*") && topic.startsWith(pattern.slice(0, -1)))) {
      set.forEach(h => handlers.add(h));
    }
  });
  await Promise.all([...handlers].map(h => h(event)));
  return handlers.size;
}

export function getReplayBuffer(topic?: string): BusEvent[] {
  return topic ? replayBuffer.filter(e => e.topic === topic) : [...replayBuffer];
}

export function _resetEventBusForTest(): void { subscribers.clear(); replayBuffer.length = 0; eventCounter = 0; }
