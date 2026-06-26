/**
 * agentCommunicationBus.ts — v47.0.0
 *
 * Pub/sub message bus for inter-agent communication with topic routing,
 * message queuing, and delivery guarantees.
 */

export type MessagePriority = "low" | "normal" | "high" | "critical";

export interface BusMessage {
  messageId: string;
  topic: string;
  senderId: string;
  payload: unknown;
  priority: MessagePriority;
  timestamp: number;
  ttlMs?: number;
}

export type MessageHandler = (message: BusMessage) => void;

const subscriptions = new Map<string, Set<{ subscriberId: string; handler: MessageHandler }>>();
const messageQueue = new Map<string, BusMessage[]>();
let messageCounter = 0;

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  critical: 4, high: 3, normal: 2, low: 1,
};

export function subscribe(topic: string, subscriberId: string, handler: MessageHandler): void {
  if (!subscriptions.has(topic)) subscriptions.set(topic, new Set());
  subscriptions.get(topic)!.add({ subscriberId, handler });
}

export function unsubscribe(topic: string, subscriberId: string): boolean {
  const subs = subscriptions.get(topic);
  if (!subs) return false;
  for (const sub of subs) {
    if (sub.subscriberId === subscriberId) {
      subs.delete(sub);
      return true;
    }
  }
  return false;
}

export function publish(
  topic: string,
  senderId: string,
  payload: unknown,
  priority: MessagePriority = "normal",
  ttlMs?: number
): BusMessage {
  const message: BusMessage = {
    messageId: `msg-${++messageCounter}-${Date.now()}`,
    topic,
    senderId,
    payload,
    priority,
    timestamp: Date.now(),
    ttlMs,
  };

  const subs = subscriptions.get(topic);
  if (subs && subs.size > 0) {
    // Deliver immediately to subscribers
    for (const sub of subs) {
      try {
        sub.handler(message);
      } catch (_e) {
        // Subscriber errors don't block the bus
      }
    }
  } else {
    // Queue for later delivery
    if (!messageQueue.has(topic)) messageQueue.set(topic, []);
    const queue = messageQueue.get(topic)!;
    queue.push(message);
    // Sort by priority descending
    queue.sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]);
  }

  return message;
}

export function drainQueue(topic: string, handler: MessageHandler): number {
  const queue = messageQueue.get(topic);
  if (!queue || queue.length === 0) return 0;

  const now = Date.now();
  let delivered = 0;
  const remaining: BusMessage[] = [];

  for (const msg of queue) {
    if (msg.ttlMs && now - msg.timestamp > msg.ttlMs) continue; // expired
    handler(msg);
    delivered++;
  }

  messageQueue.set(topic, remaining);
  return delivered;
}

export function getQueueDepth(topic: string): number {
  return messageQueue.get(topic)?.length ?? 0;
}

export function getSubscriberCount(topic: string): number {
  return subscriptions.get(topic)?.size ?? 0;
}

export function _resetBusForTest(): void {
  subscriptions.clear();
  messageQueue.clear();
  messageCounter = 0;
}
