/**
 * Task Decomposer V44 — hierarchical task network (HTN) decomposition for embodied planning.
 * Complements the existing taskDecomposer.ts (query-level) with embodied action decomposition.
 */

export interface EmbodiedSubTask {
  id: string;
  name: string;
  description: string;
  estimatedDurationMs: number;
  dependencies: string[];
  status: "pending" | "ready" | "running" | "done" | "failed";
  result?: string;
}

export interface EmbodiedDecomposedTask {
  id: string;
  originalTask: string;
  subtasks: EmbodiedSubTask[];
  criticalPath: string[];
  estimatedTotalMs: number;
  parallelizable: boolean;
}

export interface EmbodiedDecomposerReport {
  totalDecompositions: number;
  avgSubtasksPerTask: number;
  parallelizableRate: number;
  avgEstimatedDurationMs: number;
}

class EmbodiedTaskDecomposerEngine {
  private decompositions: EmbodiedDecomposedTask[] = [];
  private counter = 0;

  decompose(
    taskDescription: string,
    subtaskDefs: Array<{ name: string; description: string; durationMs: number; deps: string[] }>
  ): EmbodiedDecomposedTask {
    const subtasks: EmbodiedSubTask[] = subtaskDefs.map(def => ({
      id: `esub-${++this.counter}`,
      name: def.name,
      description: def.description,
      estimatedDurationMs: def.durationMs,
      dependencies: def.deps,
      status: def.deps.length === 0 ? "ready" : "pending",
    }));

    // Compute critical path (longest dependency chain)
    const criticalPath: string[] = [];
    let maxDuration = 0;
    for (const sub of subtasks) {
      if (sub.dependencies.length === 0 && sub.estimatedDurationMs > maxDuration) {
        maxDuration = sub.estimatedDurationMs;
        criticalPath.length = 0;
        criticalPath.push(sub.name);
      }
    }

    const parallelizable = subtasks.some(s => s.dependencies.length === 0) && subtasks.length > 1;
    const totalMs = parallelizable
      ? Math.max(...subtasks.map(s => s.estimatedDurationMs))
      : subtasks.reduce((s, t) => s + t.estimatedDurationMs, 0);

    const decomposed: EmbodiedDecomposedTask = {
      id: `edecomp-${++this.counter}`,
      originalTask: taskDescription,
      subtasks, criticalPath,
      estimatedTotalMs: totalMs,
      parallelizable,
    };
    this.decompositions.push(decomposed);
    return decomposed;
  }

  getDecomposerReport(): EmbodiedDecomposerReport {
    return {
      totalDecompositions: this.decompositions.length,
      avgSubtasksPerTask: this.decompositions.length > 0
        ? this.decompositions.reduce((s, d) => s + d.subtasks.length, 0) / this.decompositions.length
        : 0,
      parallelizableRate: this.decompositions.length > 0
        ? this.decompositions.filter(d => d.parallelizable).length / this.decompositions.length
        : 0,
      avgEstimatedDurationMs: this.decompositions.length > 0
        ? this.decompositions.reduce((s, d) => s + d.estimatedTotalMs, 0) / this.decompositions.length
        : 0,
    };
  }
}

export const globalEmbodiedTaskDecomposer = new EmbodiedTaskDecomposerEngine();

export function decomposeEmbodiedTask(
  taskDescription: string,
  subtaskDefs: Array<{ name: string; description: string; durationMs: number; deps: string[] }>
): EmbodiedDecomposedTask {
  return globalEmbodiedTaskDecomposer.decompose(taskDescription, subtaskDefs);
}
export function getEmbodiedDecomposerReport(): EmbodiedDecomposerReport {
  return globalEmbodiedTaskDecomposer.getDecomposerReport();
}
export function initTaskDecomposerV44(): void {
  console.log("[TaskDecomposerV44] Embodied Task Decomposer initialized.");
}
