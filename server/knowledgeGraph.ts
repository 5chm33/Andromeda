/**
 * knowledgeGraph.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Core knowledge graph with nodes, edges, and traversal capabilities.
 */
export type NodeType = "entity" | "concept" | "event" | "attribute" | "relation";
export type EdgeType = "is_a" | "has_property" | "related_to" | "part_of" | "caused_by" | "instance_of" | "custom";

export interface KGNode {
  nodeId: string;
  label: string;
  type: NodeType;
  properties: Record<string, unknown>;
  createdAt: number;
}

export interface KGEdge {
  edgeId: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
  properties: Record<string, unknown>;
}

export interface TraversalResult {
  startNodeId: string;
  visited: string[];
  paths: string[][];
  depth: number;
}

const nodes = new Map<string, KGNode>();
const edges: KGEdge[] = [];
let nodeCounter = 0;
let edgeCounter = 0;

export function addNode(label: string, type: NodeType, properties: Record<string, unknown> = {}): KGNode {
  const node: KGNode = { nodeId: `kgn-${++nodeCounter}`, label, type, properties, createdAt: Date.now() };
  nodes.set(node.nodeId, node);
  return node;
}

export function addEdge(sourceId: string, targetId: string, type: EdgeType, weight = 1, properties: Record<string, unknown> = {}): KGEdge | null {
  if (!nodes.has(sourceId) || !nodes.has(targetId)) return null;
  const edge: KGEdge = { edgeId: `kge-${++edgeCounter}`, sourceId, targetId, type, weight, properties };
  edges.push(edge);
  return edge;
}

export function getNeighbors(nodeId: string, direction: "outgoing" | "incoming" | "both" = "both"): KGNode[] {
  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if ((direction === "outgoing" || direction === "both") && edge.sourceId === nodeId) neighborIds.add(edge.targetId);
    if ((direction === "incoming" || direction === "both") && edge.targetId === nodeId) neighborIds.add(edge.sourceId);
  }
  return [...neighborIds].map(id => nodes.get(id)!).filter(Boolean);
}

export function bfsTraversal(startNodeId: string, maxDepth = 3): TraversalResult {
  const visited: string[] = [];
  const paths: string[][] = [];
  const queue: Array<{ nodeId: string; path: string[]; depth: number }> = [{ nodeId: startNodeId, path: [startNodeId], depth: 0 }];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const { nodeId, path, depth } = queue.shift()!;
    if (seen.has(nodeId) || depth > maxDepth) continue;
    seen.add(nodeId);
    visited.push(nodeId);
    paths.push(path);
    if (depth < maxDepth) {
      for (const neighbor of getNeighbors(nodeId, "outgoing")) {
        if (!seen.has(neighbor.nodeId)) queue.push({ nodeId: neighbor.nodeId, path: [...path, neighbor.nodeId], depth: depth + 1 });
      }
    }
  }
  return { startNodeId, visited, paths, depth: maxDepth };
}

export function findPath(fromId: string, toId: string): string[] | null {
  const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: fromId, path: [fromId] }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    if (nodeId === toId) return path;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    for (const neighbor of getNeighbors(nodeId, "outgoing")) {
      if (!seen.has(neighbor.nodeId)) queue.push({ nodeId: neighbor.nodeId, path: [...path, neighbor.nodeId] });
    }
  }
  return null;
}

export function getNode(nodeId: string): KGNode | undefined { return nodes.get(nodeId); }
export function getNodeCount(): number { return nodes.size; }
export function getEdgeCount(): number { return edges.length; }
export function getEdgesByType(type: EdgeType): KGEdge[] { return edges.filter(e => e.type === type); }
export function _resetKnowledgeGraphForTest(): void { nodes.clear(); edges.length = 0; nodeCounter = 0; edgeCounter = 0; }
