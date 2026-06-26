/**
 * apiDependencyMapper.ts — v53.0.0
 *
 * Maps dependencies between APIs and modules, detecting circular
 * dependencies and generating dependency graphs.
 */

export interface ApiDependency {
  fromApiId: string;
  toApiId: string;
  dependencyType: "data" | "auth" | "orchestration" | "fallback";
  description?: string;
}

export interface DependencyGraph {
  nodes: string[];
  edges: ApiDependency[];
  circularPaths: string[][];
}

const dependencies: ApiDependency[] = [];

export function registerDependency(dep: ApiDependency): void {
  dependencies.push(dep);
}

export function getDependencyGraph(): DependencyGraph {
  const nodes = Array.from(new Set(dependencies.flatMap(d => [d.fromApiId, d.toApiId])));
  const circularPaths = detectCircularDependencies();
  return { nodes, edges: [...dependencies], circularPaths };
}

export function getDependentsOf(apiId: string): string[] {
  return dependencies.filter(d => d.toApiId === apiId).map(d => d.fromApiId);
}

export function getDependenciesOf(apiId: string): string[] {
  return dependencies.filter(d => d.fromApiId === apiId).map(d => d.toApiId);
}

function detectCircularDependencies(): string[][] {
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!graph.has(dep.fromApiId)) graph.set(dep.fromApiId, []);
    graph.get(dep.fromApiId)!.push(dep.toApiId);
  }

  const circular: string[][] = [];
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (path.includes(node)) {
      const cycle = path.slice(path.indexOf(node));
      circular.push([...cycle, node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    path.push(node);
    for (const neighbor of graph.get(node) ?? []) {
      dfs(neighbor);
    }
    path.pop();
  }

  for (const node of graph.keys()) dfs(node);
  return circular;
}

export function _resetDependencyMapperForTest(): void {
  dependencies.length = 0;
}
