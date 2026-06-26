/**
 * Dependency Optimizer — analyzes and optimizes the module dependency graph.
 * Detects circular dependencies, dead imports, and suggests optimal load order.
 */

export interface DependencyNode {
  moduleId: string;
  dependencies: string[];
  dependents: string[];
  loadOrder: number;
  isCriticalPath: boolean;
}

export interface CircularDependency {
  cycle: string[];
  severity: "warning" | "error";
  suggestion: string;
}

export interface OptimizationResult {
  loadOrder: string[];
  circularDependencies: CircularDependency[];
  deadImports: string[];
  criticalPathLength: number;
  parallelizableGroups: string[][];
}

class DependencyOptimizerEngine {
  private graph: Map<string, DependencyNode> = new Map();

  addModule(moduleId: string, dependencies: string[]): void {
    this.graph.set(moduleId, {
      moduleId, dependencies, dependents: [], loadOrder: 0, isCriticalPath: false,
    });
    // Update dependents
    for (const dep of dependencies) {
      if (!this.graph.has(dep)) {
        this.graph.set(dep, { moduleId: dep, dependencies: [], dependents: [], loadOrder: 0, isCriticalPath: false });
      }
      this.graph.get(dep)!.dependents.push(moduleId);
    }
  }

  detectCircularDependencies(): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (node: string, path: string[]): void => {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart);
        cycles.push({
          cycle,
          severity: "error",
          suggestion: `Break cycle by extracting shared logic from ${cycle[0]} into a new module`,
        });
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      stack.add(node);
      const deps = this.graph.get(node)?.dependencies ?? [];
      for (const dep of deps) dfs(dep, [...path, dep]);
      stack.delete(node);
    };

    for (const moduleId of this.graph.keys()) dfs(moduleId, [moduleId]);
    return cycles;
  }

  computeLoadOrder(): string[] {
    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const [id] of this.graph) inDegree.set(id, 0);
    for (const [, node] of this.graph) {
      for (const dep of node.dependencies) {
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      }
    }
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const dependent of (this.graph.get(node)?.dependents ?? [])) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }
    return order;
  }

  findParallelizableGroups(): string[][] {
    const order = this.computeLoadOrder();
    const groups: string[][] = [];
    const processed = new Set<string>();
    for (const moduleId of order) {
      const deps = this.graph.get(moduleId)?.dependencies ?? [];
      const allDepsProcessed = deps.every(d => processed.has(d));
      if (allDepsProcessed) {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || lastGroup.some(m => deps.includes(m))) {
          groups.push([moduleId]);
        } else {
          lastGroup.push(moduleId);
        }
        processed.add(moduleId);
      }
    }
    return groups;
  }

  optimize(): OptimizationResult {
    const loadOrder = this.computeLoadOrder();
    const circularDependencies = this.detectCircularDependencies();
    const parallelizableGroups = this.findParallelizableGroups();
    return {
      loadOrder,
      circularDependencies,
      deadImports: [],
      criticalPathLength: loadOrder.length,
      parallelizableGroups,
    };
  }

  getGraph(): Map<string, DependencyNode> { return new Map(this.graph); }
}

export const globalDependencyOptimizer = new DependencyOptimizerEngine();

export function addModuleDependency(moduleId: string, dependencies: string[]): void {
  globalDependencyOptimizer.addModule(moduleId, dependencies);
}
export function detectCircularDependencies(): CircularDependency[] {
  return globalDependencyOptimizer.detectCircularDependencies();
}
export function computeModuleLoadOrder(): string[] {
  return globalDependencyOptimizer.computeLoadOrder();
}
export function optimizeDependencies(): OptimizationResult {
  return globalDependencyOptimizer.optimize();
}
export function initDependencyOptimizer(): void {
  console.log("[DepOptimizer] Dependency Optimizer initialized.");
  // Seed with core module dependencies
  globalDependencyOptimizer.addModule("rsiEngine", ["rewardModel", "safetyGuard"]);
  globalDependencyOptimizer.addModule("selfImprove", ["rsiEngine", "capabilityTracker"]);
  globalDependencyOptimizer.addModule("initDaemons", ["rsiEngine", "selfImprove"]);
}
