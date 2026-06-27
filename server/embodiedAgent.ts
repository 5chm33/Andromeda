/**
 * embodiedAgent.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * Top-level embodied agent that integrates perception, planning, and action.
 */
export type AgentMode = "idle" | "exploring" | "navigating" | "interacting" | "resting" | "error";

export interface EmbodiedAgentConfig {
  agentId: string;
  name: string;
  maxEnergy: number;
  sensorRange: number;
  movementSpeed: number;
  capabilities: string[];
}

export interface EmbodiedAgentStatus {
  agentId: string;
  name: string;
  mode: AgentMode;
  position: { x: number; y: number };
  energy: number;
  maxEnergy: number;
  goalPosition: { x: number; y: number } | null;
  distanceToGoal: number | null;
  stepsTaken: number;
  objectsInteracted: number;
  lastActionAt: number | null;
}

const agentStatuses = new Map<string, EmbodiedAgentStatus>();
const agentConfigs = new Map<string, EmbodiedAgentConfig>();

export function createEmbodiedAgent(config: EmbodiedAgentConfig): EmbodiedAgentStatus {
  agentConfigs.set(config.agentId, config);
  const status: EmbodiedAgentStatus = { agentId: config.agentId, name: config.name, mode: "idle", position: { x: 0, y: 0 }, energy: config.maxEnergy, maxEnergy: config.maxEnergy, goalPosition: null, distanceToGoal: null, stepsTaken: 0, objectsInteracted: 0, lastActionAt: null };
  agentStatuses.set(config.agentId, status);
  return status;
}

export function setGoal(agentId: string, goalPosition: { x: number; y: number }): boolean {
  const status = agentStatuses.get(agentId);
  if (!status) return false;
  status.goalPosition = goalPosition;
  const dx = goalPosition.x - status.position.x;
  const dy = goalPosition.y - status.position.y;
  status.distanceToGoal = Math.sqrt(dx * dx + dy * dy);
  status.mode = "navigating";
  return true;
}

export function stepTowardGoal(agentId: string): boolean {
  const status = agentStatuses.get(agentId);
  const config = agentConfigs.get(agentId);
  if (!status || !config || !status.goalPosition) return false;
  if (status.energy <= 0) { status.mode = "resting"; return false; }

  const dx = status.goalPosition.x - status.position.x;
  const dy = status.goalPosition.y - status.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.1) { status.mode = "idle"; status.goalPosition = null; status.distanceToGoal = 0; return true; }

  const step = Math.min(config.movementSpeed, dist);
  status.position.x += (dx / dist) * step;
  status.position.y += (dy / dist) * step;
  status.energy -= 1;
  status.stepsTaken++;
  status.lastActionAt = Date.now();
  status.distanceToGoal = Math.sqrt((status.goalPosition.x - status.position.x) ** 2 + (status.goalPosition.y - status.position.y) ** 2);
  return true;
}

export function interact(agentId: string, objectId: string): boolean {
  const status = agentStatuses.get(agentId);
  if (!status || status.energy <= 0) return false;
  status.objectsInteracted++;
  status.energy -= 2;
  status.mode = "interacting";
  status.lastActionAt = Date.now();
  return true;
}

export function rest(agentId: string): void {
  const status = agentStatuses.get(agentId);
  const config = agentConfigs.get(agentId);
  if (!status || !config) return;
  status.energy = Math.min(config.maxEnergy, status.energy + 10);
  status.mode = status.energy >= config.maxEnergy * 0.8 ? "idle" : "resting";
}

export function getStatus(agentId: string): EmbodiedAgentStatus | undefined { return agentStatuses.get(agentId); }
export function getAllAgents(): EmbodiedAgentStatus[] { return [...agentStatuses.values()]; }
export function _resetEmbodiedAgentForTest(): void { agentStatuses.clear(); agentConfigs.clear(); }
