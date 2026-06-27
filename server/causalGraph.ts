/**
 * causalGraph.ts — v98.0.0 "Causal Inference & Counterfactual Reasoning"
 * Directed Acyclic Graph (DAG) representation of causal relationships.
 */
export interface CausalNode { nodeId: string; name: string; type: "cause" | "effect" | "confounder" | "mediator" | "collider"; observed: boolean; }
export interface CausalEdge { edgeId: string; sourceId: string; targetId: string; strength: number; mechanism: string; }
export interface CausalPath { pathId: string; nodes: string[]; edges: string[]; isBackdoor: boolean; totalStrength: number; }

const nodes = new Map<string, CausalNode>();
const edges = new Map<string, CausalEdge>();
let nodeCounter = 0; let edgeCounter = 0; let pathCounter = 0;

export function addNode(name: string, type: CausalNode["type"] = "cause", observed = true): CausalNode {
  const node: CausalNode = { nodeId: `cn-${++nodeCounter}`, name, type, observed };
  nodes.set(node.nodeId, node);
  return node;
}

export function addEdge(sourceId: string, targetId: string, strength = 1.0, mechanism = "direct"): CausalEdge | null {
  if (!nodes.has(sourceId) || !nodes.has(targetId)) return null;
  const edge: CausalEdge = { edgeId: `ce-${++edgeCounter}`, sourceId, targetId, strength, mechanism };
  edges.set(edge.edgeId, edge);
  return edge;
}

export function getParents(nodeId: string): CausalNode[] {
  return [...edges.values()].filter(e => e.targetId === nodeId).map(e => nodes.get(e.sourceId)!).filter(Boolean);
}

export function getChildren(nodeId: string): CausalNode[] {
  return [...edges.values()].filter(e => e.sourceId === nodeId).map(e => nodes.get(e.targetId)!).filter(Boolean);
}

export function findPaths(sourceId: string, targetId: string): CausalPath[] {
  const paths: CausalPath[] = [];
  const dfs = (current: string, path: string[], edgePath: string[], visited: Set<string>) => {
    if (current === targetId && path.length > 1) {
      const strength = edgePath.reduce((s, eid) => s * (edges.get(eid)?.strength ?? 0), 1);
      paths.push({ pathId: `cp-${++pathCounter}`, nodes: [...path], edges: [...edgePath], isBackdoor: false, totalStrength: strength });
      return;
    }
    for (const edge of edges.values()) {
      if (edge.sourceId === current && !visited.has(edge.targetId)) {
        visited.add(edge.targetId);
        dfs(edge.targetId, [...path, edge.targetId], [...edgePath, edge.edgeId], visited);
        visited.delete(edge.targetId);
      }
    }
  };
  dfs(sourceId, [sourceId], [], new Set([sourceId]));
  return paths;
}

export function getNode(nodeId: string): CausalNode | undefined { return nodes.get(nodeId); }
export function getAllNodes(): CausalNode[] { return [...nodes.values()]; }
export function getAllEdges(): CausalEdge[] { return [...edges.values()]; }
export function _resetCausalGraphForTest(): void { nodes.clear(); edges.clear(); nodeCounter = 0; edgeCounter = 0; pathCounter = 0; }
