/**
 * agentSpawnController.ts — v47.0.0
 *
 * Controls the spawning and termination of sub-agents with resource limits,
 * spawn quotas, and cooldown enforcement.
 */

export interface SpawnRequest {
  requestId: string;
  requesterId: string;
  agentType: string;
  capabilities: string[];
  computeUnits: number;
  maxLifetimeMs: number;
}

export interface SpawnedAgent {
  agentId: string;
  agentType: string;
  capabilities: string[];
  computeUnits: number;
  spawnedAt: number;
  expiresAt: number;
  status: "running" | "terminated" | "expired";
  requesterId: string;
}

export interface SpawnPolicy {
  maxActiveAgents: number;
  maxAgentsPerRequester: number;
  minSpawnIntervalMs: number;
  maxComputeUnitsTotal: number;
}

const DEFAULT_POLICY: SpawnPolicy = {
  maxActiveAgents: 50,
  maxAgentsPerRequester: 10,
  minSpawnIntervalMs: 1000,
  maxComputeUnitsTotal: 500,
};

let policy: SpawnPolicy = { ...DEFAULT_POLICY };
const agents = new Map<string, SpawnedAgent>();
const lastSpawnTime = new Map<string, number>();
let agentCounter = 0;

export function setSpawnPolicy(newPolicy: Partial<SpawnPolicy>): void {
  policy = { ...policy, ...newPolicy };
}

export function spawnAgent(request: SpawnRequest): SpawnedAgent | { error: string } {
  const now = Date.now();

  // Enforce cooldown
  const lastSpawn = lastSpawnTime.get(request.requesterId) ?? 0;
  if (now - lastSpawn < policy.minSpawnIntervalMs) {
    return { error: `Spawn cooldown active for ${request.requesterId}` };
  }

  // Check per-requester quota
  const requesterAgents = Array.from(agents.values()).filter(
    a => a.requesterId === request.requesterId && a.status === "running"
  );
  if (requesterAgents.length >= policy.maxAgentsPerRequester) {
    return { error: `Requester ${request.requesterId} has reached spawn quota` };
  }

  // Check global limits
  const activeAgents = Array.from(agents.values()).filter(a => a.status === "running");
  if (activeAgents.length >= policy.maxActiveAgents) {
    return { error: "Global agent limit reached" };
  }

  const totalCompute = activeAgents.reduce((s, a) => s + a.computeUnits, 0);
  if (totalCompute + request.computeUnits > policy.maxComputeUnitsTotal) {
    return { error: "Insufficient compute units available" };
  }

  const agent: SpawnedAgent = {
    agentId: `agent-${++agentCounter}-${now}`,
    agentType: request.agentType,
    capabilities: request.capabilities,
    computeUnits: request.computeUnits,
    spawnedAt: now,
    expiresAt: now + request.maxLifetimeMs,
    status: "running",
    requesterId: request.requesterId,
  };

  agents.set(agent.agentId, agent);
  lastSpawnTime.set(request.requesterId, now);
  console.log(`[SpawnController] Spawned ${agent.agentType} agent ${agent.agentId} for ${request.requesterId}.`);
  return agent;
}

export function terminateAgent(agentId: string): boolean {
  const agent = agents.get(agentId);
  if (!agent || agent.status !== "running") return false;
  agent.status = "terminated";
  console.log(`[SpawnController] Agent ${agentId} terminated.`);
  return true;
}

export function expireStaleAgents(): number {
  const now = Date.now();
  let count = 0;
  for (const agent of agents.values()) {
    if (agent.status === "running" && now > agent.expiresAt) {
      agent.status = "expired";
      count++;
    }
  }
  return count;
}

export function getActiveAgents(): SpawnedAgent[] {
  return Array.from(agents.values()).filter(a => a.status === "running");
}

export function getAgent(agentId: string): SpawnedAgent | undefined {
  return agents.get(agentId);
}

export function _resetSpawnControllerForTest(): void {
  agents.clear();
  lastSpawnTime.clear();
  agentCounter = 0;
  policy = { ...DEFAULT_POLICY };
}
