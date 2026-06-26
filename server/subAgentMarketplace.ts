/**
 * subAgentMarketplace.ts — v46.0.0
 *
 * A decentralized marketplace where sub-agents list their capabilities,
 * accept task bids, and earn reputation-weighted rewards.
 */

export interface AgentListing {
  agentId: string;
  capabilities: string[];
  pricePerTask: number;   // compute credits
  reputation: number;     // 0.0–1.0
  available: boolean;
  totalTasksCompleted: number;
}

export interface MarketplaceTask {
  taskId: string;
  requiredCapabilities: string[];
  maxBudget: number;
  priority: number;       // 1–10
  deadline: number;       // ms timestamp
  postedAt: number;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  agreedPrice: number;
  assignedAt: number;
}

const listings = new Map<string, AgentListing>();
const tasks = new Map<string, MarketplaceTask>();
const assignments = new Map<string, TaskAssignment>();

export function registerAgent(listing: AgentListing): void {
  listings.set(listing.agentId, { ...listing });
  console.log(`[Marketplace] Agent ${listing.agentId} registered with ${listing.capabilities.length} capabilities.`);
}

export function deregisterAgent(agentId: string): boolean {
  return listings.delete(agentId);
}

export function postTask(task: MarketplaceTask): void {
  tasks.set(task.taskId, { ...task, postedAt: task.postedAt || Date.now() });
  console.log(`[Marketplace] Task ${task.taskId} posted (budget: ${task.maxBudget} credits).`);
}

export function matchTask(taskId: string): TaskAssignment | null {
  const task = tasks.get(taskId);
  if (!task) return null;

  // Find eligible agents: must have all required capabilities, be available, and within budget
  const eligible = Array.from(listings.values()).filter(agent =>
    agent.available &&
    agent.pricePerTask <= task.maxBudget &&
    task.requiredCapabilities.every(cap => agent.capabilities.includes(cap))
  );

  if (eligible.length === 0) return null;

  // Select by highest reputation, then lowest price
  eligible.sort((a, b) => {
    const repDiff = b.reputation - a.reputation;
    if (Math.abs(repDiff) > 0.05) return repDiff;
    return a.pricePerTask - b.pricePerTask;
  });

  const winner = eligible[0];
  const assignment: TaskAssignment = {
    taskId,
    agentId: winner.agentId,
    agreedPrice: winner.pricePerTask,
    assignedAt: Date.now(),
  };

  assignments.set(taskId, assignment);
  // Mark agent as busy
  const listing = listings.get(winner.agentId);
  if (listing) listing.available = false;

  return assignment;
}

export function completeTask(taskId: string, success: boolean): void {
  const assignment = assignments.get(taskId);
  if (!assignment) return;

  const listing = listings.get(assignment.agentId);
  if (listing) {
    listing.available = true;
    listing.totalTasksCompleted++;
    // Update reputation: success nudges up, failure nudges down
    const delta = success ? 0.01 : -0.03;
    listing.reputation = Math.max(0, Math.min(1, listing.reputation + delta));
  }

  assignments.delete(taskId);
  tasks.delete(taskId);
}

export function getMarketplaceStats(): {
  totalAgents: number;
  availableAgents: number;
  pendingTasks: number;
  activeAssignments: number;
} {
  return {
    totalAgents: listings.size,
    availableAgents: Array.from(listings.values()).filter(a => a.available).length,
    pendingTasks: tasks.size,
    activeAssignments: assignments.size,
  };
}

export function getAgentListing(agentId: string): AgentListing | undefined {
  return listings.get(agentId);
}

export function _resetMarketplaceForTest(): void {
  listings.clear();
  tasks.clear();
  assignments.clear();
}
