/**
 * agentTaskDelegator.ts — v86.0.0 "Multi-Agent Coordination"
 * Delegates tasks to the most suitable agents based on capability, load, and SLA.
 */
export type DelegationStrategy = "round_robin" | "least_loaded" | "capability_match" | "random";

export interface DelegationRequest {
  requestId: string;
  requiredCapability: string;
  payload: Record<string, unknown>;
  priority: "low" | "normal" | "high";
  timeoutMs: number;
  strategy: DelegationStrategy;
}

export interface DelegationResult {
  requestId: string;
  selectedAgentId: string | null;
  delegatedAt: number;
  reason: string;
  success: boolean;
}

export interface AgentPool {
  agentId: string;
  capabilities: string[];
  load: number;
  status: "available" | "busy" | "offline";
}

const agentPools: AgentPool[] = [];
const delegationLog: DelegationResult[] = [];
let requestCounter = 0;
let rrIndex = 0;

export function registerAgentInPool(agentId: string, capabilities: string[], load = 0): AgentPool {
  const existing = agentPools.find(a => a.agentId === agentId);
  if (existing) { existing.capabilities = capabilities; existing.load = load; return existing; }
  const pool: AgentPool = { agentId, capabilities, load, status: "available" };
  agentPools.push(pool);
  return pool;
}

export function updateAgentLoad(agentId: string, load: number): void {
  const agent = agentPools.find(a => a.agentId === agentId);
  if (agent) agent.load = load;
}

export function delegate(request: Omit<DelegationRequest, "requestId">): DelegationResult {
  const requestId = `req-${++requestCounter}`;
  const eligible = agentPools.filter(a => a.status === "available" && a.capabilities.includes(request.requiredCapability));

  if (eligible.length === 0) {
    const result: DelegationResult = { requestId, selectedAgentId: null, delegatedAt: Date.now(), reason: "No eligible agents found", success: false };
    delegationLog.push(result);
    return result;
  }

  let selected: AgentPool;
  if (request.strategy === "least_loaded") {
    selected = eligible.reduce((min, a) => a.load < min.load ? a : min);
  } else if (request.strategy === "round_robin") {
    selected = eligible[rrIndex % eligible.length];
    rrIndex++;
  } else if (request.strategy === "random") {
    selected = eligible[Math.floor(Math.random() * eligible.length)];
  } else {
    selected = eligible[0];
  }

  const result: DelegationResult = { requestId, selectedAgentId: selected.agentId, delegatedAt: Date.now(), reason: `Selected via ${request.strategy}`, success: true };
  delegationLog.push(result);
  return result;
}

export function getDelegationLog(): DelegationResult[] { return [...delegationLog]; }
export function getPoolSize(): number { return agentPools.length; }
export function _resetAgentTaskDelegatorForTest(): void { agentPools.length = 0; delegationLog.length = 0; requestCounter = 0; rrIndex = 0; }
