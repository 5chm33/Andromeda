/**
 * multiAgentCoordinator.ts — v63.0.0 "The Collaboration Hub"
 * Coordinates multiple agents with task assignment, progress tracking, and result aggregation.
 */

export type AgentStatus = "idle" | "busy" | "completed" | "failed";
export interface AgentRegistration { agentId: string; name: string; capabilities: string[]; status: AgentStatus; currentTask?: string; }
export interface CoordinationTask { taskId: string; description: string; requiredCapabilities: string[]; assignedAgents: string[]; status: "pending" | "in_progress" | "completed" | "failed"; results: Record<string, unknown>; }

const agents = new Map<string, AgentRegistration>();
const tasks = new Map<string, CoordinationTask>();
let aCounter = 0, tCounter = 0;

export function registerAgent(name: string, capabilities: string[]): AgentRegistration {
  const agent: AgentRegistration = { agentId: `agent-${++aCounter}`, name, capabilities, status: "idle" };
  agents.set(agent.agentId, agent);
  return agent;
}

export function createCoordinationTask(description: string, requiredCapabilities: string[]): CoordinationTask {
  const task: CoordinationTask = { taskId: `task-${++tCounter}`, description, requiredCapabilities, assignedAgents: [], status: "pending", results: {} };
  tasks.set(task.taskId, task);
  return task;
}

export function assignTask(taskId: string): string[] {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`[MultiAgentCoordinator] Task not found: ${taskId}`);
  const eligible = [...agents.values()].filter(a => a.status === "idle" && task.requiredCapabilities.every(c => a.capabilities.includes(c)));
  if (eligible.length === 0) throw new Error(`[MultiAgentCoordinator] No eligible agents for task: ${taskId}`);
  const assigned = eligible.slice(0, Math.min(3, eligible.length));
  assigned.forEach(a => { a.status = "busy"; a.currentTask = taskId; task.assignedAgents.push(a.agentId); });
  task.status = "in_progress";
  return assigned.map(a => a.agentId);
}

export function submitResult(taskId: string, agentId: string, result: unknown): void {
  const task = tasks.get(taskId);
  const agent = agents.get(agentId);
  if (!task || !agent) return;
  task.results[agentId] = result;
  agent.status = "completed";
  if (Object.keys(task.results).length >= task.assignedAgents.length) task.status = "completed";
}

export function getCoordinationSummary(): { totalAgents: number; idleAgents: number; activeTasks: number; completedTasks: number } {
  const allAgents = [...agents.values()];
  const allTasks = [...tasks.values()];
  return { totalAgents: allAgents.length, idleAgents: allAgents.filter(a => a.status === "idle").length, activeTasks: allTasks.filter(t => t.status === "in_progress").length, completedTasks: allTasks.filter(t => t.status === "completed").length };
}

export function _resetMultiAgentCoordinatorForTest(): void { agents.clear(); tasks.clear(); aCounter = 0; tCounter = 0; }
