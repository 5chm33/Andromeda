/**
 * dependencyGraphAnalyzer.ts — v76.0.0 "Supply Chain & Dependency Management"
 * Builds and analyzes a directed dependency graph to detect cycles, depth, and critical paths.
 */
export interface DependencyEdge {
  from: string;
  to: string;
}

export interface GraphAnalysisResult {
  analysisId: string;
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  cycles: string[][];
  criticalNodes: string[];
  orphanNodes: string[];
  generatedAt: number;
}

const analysisHistory: GraphAnalysisResult[] = [];
let analysisCounter = 0;

function buildAdjacency(edges: DependencyEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, []);
    adj.get(edge.from)!.push(edge.to);
    if (!adj.has(edge.to)) adj.set(edge.to, []);
  }
  return adj;
}

function findCycles(adj: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) { dfs(neighbor); }
      else if (stack.has(neighbor)) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
      }
    }
    stack.delete(node);
    path.pop();
  }

  for (const node of adj.keys()) { if (!visited.has(node)) dfs(node); }
  return cycles;
}

function computeMaxDepth(adj: Map<string, string[]>, roots: string[]): number {
  let maxDepth = 0;
  function dfs(node: string, depth: number, seen: Set<string>): void {
    if (seen.has(node)) return;
    seen.add(node);
    maxDepth = Math.max(maxDepth, depth);
    for (const child of adj.get(node) ?? []) dfs(child, depth + 1, seen);
  }
  for (const root of roots) dfs(root, 0, new Set());
  return maxDepth;
}

export function analyzeDependencyGraph(edges: DependencyEdge[]): GraphAnalysisResult {
  const adj = buildAdjacency(edges);
  const allNodes = new Set<string>(adj.keys());
  const hasIncoming = new Set<string>(edges.map(e => e.to));
  const roots = [...allNodes].filter(n => !hasIncoming.has(n));
  const orphans = [...allNodes].filter(n => (adj.get(n)?.length ?? 0) === 0 && !hasIncoming.has(n));

  // Critical nodes: nodes with highest out-degree
  const sortedByDegree = [...allNodes].sort((a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0));
  const criticalNodes = sortedByDegree.slice(0, Math.min(3, sortedByDegree.length));

  const cycles = findCycles(adj);
  const maxDepth = computeMaxDepth(adj, roots.length > 0 ? roots : [...allNodes].slice(0, 1));

  const result: GraphAnalysisResult = {
    analysisId: `graph-analysis-${++analysisCounter}`,
    nodeCount: allNodes.size,
    edgeCount: edges.length,
    maxDepth,
    cycles,
    criticalNodes,
    orphanNodes: orphans,
    generatedAt: Date.now(),
  };

  analysisHistory.push(result);
  console.log(`[DependencyGraphAnalyzer] Graph: ${allNodes.size} nodes, ${edges.length} edges, depth ${maxDepth}, ${cycles.length} cycles`);
  return result;
}

export function getAnalysisHistory(): GraphAnalysisResult[] { return [...analysisHistory]; }
export function _resetDependencyGraphAnalyzerForTest(): void { analysisHistory.length = 0; analysisCounter = 0; }
