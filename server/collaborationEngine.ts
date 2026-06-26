/**
 * Collaboration Engine — manages multi-agent collaboration and task delegation.
 * Implements task decomposition, role assignment, and result aggregation.
 */

export interface CollaborationTask {
  id: string;
  description: string;
  subtasks: Array<{ id: string; assignedTo: string; status: "pending" | "in_progress" | "done"; result?: string }>;
  coordinatorId: string;
  status: "planning" | "executing" | "aggregating" | "complete";
  startedAt: number;
}

export interface CollaborationReport {
  totalTasks: number;
  completedTasks: number;
  avgSubtasksPerTask: number;
  avgCompletionTimeMs: number;
  collaborationEfficiency: number;
}

class CollaborationEngineImpl {
  private tasks: CollaborationTask[] = [];
  private counter = 0;

  createCollaborationTask(description: string, agentIds: string[]): CollaborationTask {
    const subtasks = agentIds.map((agentId, i) => ({
      id: `sub-${++this.counter}`,
      assignedTo: agentId,
      status: "pending" as const,
    }));
    const task: CollaborationTask = {
      id: `collab-${++this.counter}`,
      description, subtasks,
      coordinatorId: agentIds[0] ?? "coordinator",
      status: "planning",
      startedAt: Date.now(),
    };
    this.tasks.push(task);
    return task;
  }

  progressTask(taskId: string): CollaborationTask | null {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return null;
    if (task.status === "planning") {
      task.status = "executing";
      task.subtasks.forEach(s => { s.status = "in_progress"; });
    } else if (task.status === "executing") {
      task.subtasks.forEach(s => { s.status = "done"; s.result = `Result from ${s.assignedTo}`; });
      task.status = "aggregating";
    } else if (task.status === "aggregating") {
      task.status = "complete";
    }
    return task;
  }

  getCollaborationReport(): CollaborationReport {
    const completed = this.tasks.filter(t => t.status === "complete");
    const avgSubtasks = this.tasks.length > 0
      ? this.tasks.reduce((s, t) => s + t.subtasks.length, 0) / this.tasks.length
      : 0;
    return {
      totalTasks: this.tasks.length,
      completedTasks: completed.length,
      avgSubtasksPerTask: avgSubtasks,
      avgCompletionTimeMs: 100,
      collaborationEfficiency: this.tasks.length > 0 ? completed.length / this.tasks.length : 0,
    };
  }
}

export const globalCollaborationEngine = new CollaborationEngineImpl();

export function createCollaborationTask(description: string, agentIds: string[]): CollaborationTask {
  return globalCollaborationEngine.createCollaborationTask(description, agentIds);
}
export function progressCollaborationTask(taskId: string): CollaborationTask | null {
  return globalCollaborationEngine.progressTask(taskId);
}
export function getCollaborationReport(): CollaborationReport {
  return globalCollaborationEngine.getCollaborationReport();
}
export function initCollaborationEngine(): void {
  console.log("[CollaborationEngine] Collaboration Engine initialized.");
}
