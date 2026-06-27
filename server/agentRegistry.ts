/**
 * agentRegistry.ts — v86.0.0 "Multi-Agent Coordination"
 * Central registry for agent discovery, capability advertisement, and health tracking.
 */
export type AgentStatus = "online" | "offline" | "busy" | "degraded" | "initializing";

export interface AgentCapability {
  name: string;
  version: string;
  maxConcurrency: number;
  avgLatencyMs: number;
}

export interface RegisteredAgent {
  agentId: string;
  name: string;
  endpoint: string;
  capabilities: AgentCapability[];
  status: AgentStatus;
  registeredAt: number;
  lastHeartbeatAt: number;
  metadata: Record<string, string>;
  load: number;
}

const registry = new Map<string, RegisteredAgent>();
let agentCounter = 0;

export function registerAgent(name: string, endpoint: string, capabilities: AgentCapability[], metadata: Record<string, string> = {}): RegisteredAgent {
  const agent: RegisteredAgent = {
    agentId: `agent-${++agentCounter}`,
    name, endpoint, capabilities,
    status: "initializing",
    registeredAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    metadata,
    load: 0,
  };
  registry.set(agent.agentId, agent);
  return agent;
}

export function updateHeartbeat(agentId: string, status: AgentStatus, load = 0): boolean {
  const agent = registry.get(agentId);
  if (!agent) return false;
  agent.lastHeartbeatAt = Date.now();
  agent.status = status;
  agent.load = load;
  return true;
}

export function findAgentsByCapability(capabilityName: string): RegisteredAgent[] {
  return [...registry.values()].filter(a =>
    a.status === "online" && a.capabilities.some(c => c.name === capabilityName)
  ).sort((a, b) => a.load - b.load);
}

export function deregisterAgent(agentId: string): boolean {
  return registry.delete(agentId);
}

export function getOnlineAgents(): RegisteredAgent[] { return [...registry.values()].filter(a => a.status === "online"); }
export function getAgent(agentId: string): RegisteredAgent | undefined { return registry.get(agentId); }
export function getRegistrySize(): number { return registry.size; }
export function _resetAgentRegistryForTest(): void { registry.clear(); agentCounter = 0; }
