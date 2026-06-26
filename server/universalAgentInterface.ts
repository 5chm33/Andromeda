/**
 * universalAgentInterface.ts — v55.0.0 "The Grand Unification"
 *
 * A universal interface layer that normalizes communication between
 * all Andromeda sub-systems, external agents, and API integrations.
 * Provides a single unified message bus with typed contracts.
 */

export type AgentMessageType =
  | "command" | "query" | "event" | "response"
  | "heartbeat" | "capability-announce" | "capability-request"
  | "error" | "shutdown";

export interface AgentMessage {
  messageId: string;
  type: AgentMessageType;
  fromAgent: string;
  toAgent: string | "broadcast";
  payload: unknown;
  correlationId?: string;
  timestamp: number;
  ttlMs?: number;
}

export interface AgentRegistration {
  agentId: string;
  name: string;
  capabilities: string[];
  version: string;
  registeredAt: number;
  lastSeenAt: number;
  status: "active" | "idle" | "overloaded" | "offline";
}

export interface MessageHandler {
  agentId: string;
  messageType: AgentMessageType | "*";
  handler: (msg: AgentMessage) => AgentMessage | null;
}

const agents = new Map<string, AgentRegistration>();
const handlers = new Map<string, MessageHandler[]>();
const messageLog: AgentMessage[] = [];
let msgCounter = 0;

export function registerAgent(reg: Omit<AgentRegistration, "registeredAt" | "lastSeenAt">): AgentRegistration {
  const full: AgentRegistration = { ...reg, registeredAt: Date.now(), lastSeenAt: Date.now() };
  agents.set(reg.agentId, full);
  return full;
}

export function registerHandler(handler: MessageHandler): void {
  if (!handlers.has(handler.agentId)) handlers.set(handler.agentId, []);
  handlers.get(handler.agentId)!.push(handler);
}

export function sendMessage(msg: Omit<AgentMessage, "messageId" | "timestamp">): AgentMessage {
  const full: AgentMessage = { messageId: `msg-${++msgCounter}`, timestamp: Date.now(), ...msg };
  messageLog.push(full);

  // Update sender last seen
  const sender = agents.get(msg.fromAgent);
  if (sender) sender.lastSeenAt = Date.now();

  // Dispatch to handlers
  const targets = msg.toAgent === "broadcast" ? Array.from(agents.keys()) : [msg.toAgent];
  for (const targetId of targets) {
    const agentHandlers = handlers.get(targetId) ?? [];
    for (const h of agentHandlers) {
      if (h.messageType === "*" || h.messageType === msg.type) {
        h.handler(full);
      }
    }
  }

  return full;
}

export function getAgentStatus(agentId: string): AgentRegistration | undefined {
  return agents.get(agentId);
}

export function listActiveAgents(): AgentRegistration[] {
  return Array.from(agents.values()).filter(a => a.status !== "offline");
}

export function getMessageLog(agentId?: string, limit = 50): AgentMessage[] {
  const filtered = agentId
    ? messageLog.filter(m => m.fromAgent === agentId || m.toAgent === agentId || m.toAgent === "broadcast")
    : messageLog;
  return filtered.slice(-limit);
}

export function updateAgentStatus(agentId: string, status: AgentRegistration["status"]): boolean {
  const agent = agents.get(agentId);
  if (!agent) return false;
  agent.status = status;
  agent.lastSeenAt = Date.now();
  return true;
}

export function _resetUniversalAgentInterfaceForTest(): void {
  agents.clear();
  handlers.clear();
  messageLog.length = 0;
  msgCounter = 0;
}
