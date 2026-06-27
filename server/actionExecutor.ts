/**
 * actionExecutor.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * Executes physical and virtual actions for embodied agents with feedback.
 */
export type ActionType = "move" | "rotate" | "grasp" | "release" | "push" | "pull" | "communicate" | "observe" | "wait";
export type ActionStatus = "pending" | "executing" | "completed" | "failed" | "cancelled";

export interface Action {
  actionId: string;
  agentId: string;
  type: ActionType;
  parameters: Record<string, unknown>;
  status: ActionStatus;
  startedAt: number | null;
  completedAt: number | null;
  result: unknown;
  energyCost: number;
  queuedAt: number;
}

export interface AgentState {
  agentId: string;
  position: { x: number; y: number };
  heading: number;
  energy: number;
  actionQueue: Action[];
  completedActions: number;
  failedActions: number;
}

const agents = new Map<string, AgentState>();
const actions: Action[] = [];
let actionCounter = 0;

const energyCosts: Record<ActionType, number> = { move: 2, rotate: 0.5, grasp: 1, release: 0.5, push: 3, pull: 3, communicate: 0.1, observe: 0.2, wait: 0 };

export function registerAgent(agentId: string, initialPosition = { x: 0, y: 0 }, initialEnergy = 100): AgentState {
  const state: AgentState = { agentId, position: initialPosition, heading: 0, energy: initialEnergy, actionQueue: [], completedActions: 0, failedActions: 0 };
  agents.set(agentId, state);
  return state;
}

export function queueAction(agentId: string, type: ActionType, parameters: Record<string, unknown> = {}): Action | null {
  const agent = agents.get(agentId);
  if (!agent) return null;
  const action: Action = { actionId: `act-${++actionCounter}`, agentId, type, parameters, status: "pending", startedAt: null, completedAt: null, result: null, energyCost: energyCosts[type], queuedAt: Date.now() };
  actions.push(action);
  agent.actionQueue.push(action);
  return action;
}

export function executeNextAction(agentId: string): Action | null {
  const agent = agents.get(agentId);
  if (!agent || agent.actionQueue.length === 0) return null;
  const action = agent.actionQueue.shift()!;
  if (agent.energy < action.energyCost) { action.status = "failed"; agent.failedActions++; return action; }

  action.status = "executing";
  action.startedAt = Date.now();
  agent.energy -= action.energyCost;

  // Simulate action effects
  if (action.type === "move") {
    const dx = (action.parameters["dx"] as number) ?? 0;
    const dy = (action.parameters["dy"] as number) ?? 0;
    agent.position.x += dx; agent.position.y += dy;
    action.result = { newPosition: { ...agent.position } };
  } else if (action.type === "rotate") {
    const degrees = (action.parameters["degrees"] as number) ?? 0;
    agent.heading = (agent.heading + degrees) % 360;
    action.result = { newHeading: agent.heading };
  } else {
    action.result = { executed: true };
  }

  action.status = "completed";
  action.completedAt = Date.now();
  agent.completedActions++;
  return action;
}

export function getAgentState(agentId: string): AgentState | undefined { return agents.get(agentId); }
export function getActions(agentId: string, status?: ActionStatus): Action[] { return actions.filter(a => a.agentId === agentId && (!status || a.status === status)); }
export function _resetActionExecutorForTest(): void { agents.clear(); actions.length = 0; actionCounter = 0; }
