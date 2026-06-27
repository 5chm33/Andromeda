/**
 * agentMessageBus.ts — v86.0.0 "Multi-Agent Coordination"
 * Pub/sub message bus for inter-agent communication with routing and filtering.
 */
export type MessagePriority = "low" | "normal" | "high" | "urgent";
export type MessageType = "command" | "event" | "query" | "response" | "broadcast";

export interface AgentMessage {
  messageId: string;
  fromAgentId: string;
  toAgentId: string | "broadcast";
  type: MessageType;
  topic: string;
  payload: Record<string, unknown>;
  priority: MessagePriority;
  sentAt: number;
  expiresAt: number | null;
  correlationId: string | null;
}

export interface Subscription {
  subscriptionId: string;
  agentId: string;
  topic: string;
  filter?: (msg: AgentMessage) => boolean;
  receivedCount: number;
}

const messageLog: AgentMessage[] = [];
const subscriptions: Subscription[] = [];
let msgCounter = 0;
let subCounter = 0;

export function publish(fromAgentId: string, toAgentId: string | "broadcast", type: MessageType, topic: string, payload: Record<string, unknown>, priority: MessagePriority = "normal", ttlMs: number | null = null, correlationId: string | null = null): AgentMessage {
  const msg: AgentMessage = {
    messageId: `msg-${++msgCounter}`,
    fromAgentId, toAgentId, type, topic, payload, priority,
    sentAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : null,
    correlationId,
  };
  messageLog.push(msg);

  // Deliver to matching subscriptions
  for (const sub of subscriptions) {
    if (sub.topic !== topic && sub.topic !== "*") continue;
    if (toAgentId !== "broadcast" && sub.agentId !== toAgentId) continue;
    if (sub.filter && !sub.filter(msg)) continue;
    sub.receivedCount++;
  }

  return msg;
}

export function subscribe(agentId: string, topic: string, filter?: (msg: AgentMessage) => boolean): Subscription {
  const sub: Subscription = { subscriptionId: `sub-${++subCounter}`, agentId, topic, filter, receivedCount: 0 };
  subscriptions.push(sub);
  return sub;
}

export function unsubscribe(subscriptionId: string): boolean {
  const idx = subscriptions.findIndex(s => s.subscriptionId === subscriptionId);
  if (idx === -1) return false;
  subscriptions.splice(idx, 1);
  return true;
}

export function getMessagesForAgent(agentId: string, topic?: string): AgentMessage[] {
  return messageLog.filter(m => (m.toAgentId === agentId || m.toAgentId === "broadcast") && (!topic || m.topic === topic) && (m.expiresAt === null || m.expiresAt > Date.now()));
}

export function getMessageCount(): number { return messageLog.length; }
export function getSubscriptionCount(): number { return subscriptions.length; }
export function _resetAgentMessageBusForTest(): void { messageLog.length = 0; subscriptions.length = 0; msgCounter = 0; subCounter = 0; }
