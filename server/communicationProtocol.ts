/**
 * communicationProtocol.ts — v94.0.0 "Emergent Communication & Language Grounding"
 * Defines and enforces emergent communication protocols between agents.
 */
export type MessageType = "inform" | "query" | "propose" | "accept" | "reject" | "confirm" | "notify";

export interface ProtocolMessage {
  messageId: string;
  senderId: string;
  receiverId: string;
  type: MessageType;
  content: unknown;
  conversationId: string;
  replyToId: string | null;
  timestamp: number;
  acknowledged: boolean;
}

export interface ConversationThread {
  conversationId: string;
  participants: string[];
  messages: ProtocolMessage[];
  status: "active" | "completed" | "timeout";
  startedAt: number;
  lastActivityAt: number;
}

const threads = new Map<string, ConversationThread>();
const messages: ProtocolMessage[] = [];
let threadCounter = 0;
let messageCounter = 0;

export function startConversation(participants: string[]): ConversationThread {
  const thread: ConversationThread = { conversationId: `conv-${++threadCounter}`, participants, messages: [], status: "active", startedAt: Date.now(), lastActivityAt: Date.now() };
  threads.set(thread.conversationId, thread);
  return thread;
}

export function sendMessage(conversationId: string, senderId: string, receiverId: string, type: MessageType, content: unknown, replyToId: string | null = null): ProtocolMessage | null {
  const thread = threads.get(conversationId);
  if (!thread || thread.status !== "active") return null;
  if (!thread.participants.includes(senderId) || !thread.participants.includes(receiverId)) return null;

  const message: ProtocolMessage = { messageId: `msg-${++messageCounter}`, senderId, receiverId, type, content, conversationId, replyToId, timestamp: Date.now(), acknowledged: false };
  messages.push(message);
  thread.messages.push(message);
  thread.lastActivityAt = Date.now();
  return message;
}

export function acknowledgeMessage(messageId: string): boolean {
  const msg = messages.find(m => m.messageId === messageId);
  if (!msg) return false;
  msg.acknowledged = true;
  return true;
}

export function closeConversation(conversationId: string): boolean {
  const thread = threads.get(conversationId);
  if (!thread) return false;
  thread.status = "completed";
  return true;
}

export function getThread(conversationId: string): ConversationThread | undefined { return threads.get(conversationId); }
export function getMessages(conversationId: string, type?: MessageType): ProtocolMessage[] {
  const thread = threads.get(conversationId);
  if (!thread) return [];
  return type ? thread.messages.filter(m => m.type === type) : [...thread.messages];
}
export function _resetCommunicationProtocolForTest(): void { threads.clear(); messages.length = 0; threadCounter = 0; messageCounter = 0; }
