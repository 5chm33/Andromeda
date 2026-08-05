/**
 * pheromoneTrailManager.ts — v99.0.0 "Collective Intelligence & Swarm Cognition"
 * Manages pheromone trails for ant-colony-optimization-style path finding.
 */
export interface PheromoneEdge {
  edgeId: string;
  fromNode: string;
  toNode: string;
  pheromoneLevel: number;
  heuristicValue: number;
  traversalCount: number;
}

export interface AntPath {
  pathId: string;
  antId: string;
  nodes: string[];
  totalCost: number;
  pheromoneDeposit: number;
  foundAt: number;
}

const edges = new Map<string, PheromoneEdge>();
const paths: AntPath[] = [];
let edgeCounter = 0;
let pathCounter = 0;

const EVAPORATION_RATE = 0.1;
const MIN_PHEROMONE = 0.01;
const INITIAL_PHEROMONE = 1.0;

export function addEdge(fromNode: string, toNode: string, heuristicValue = 1.0): PheromoneEdge {
  const edgeId = `pe-${++edgeCounter}`;
  const edge: PheromoneEdge = { edgeId, fromNode, toNode, pheromoneLevel: INITIAL_PHEROMONE, heuristicValue, traversalCount: 0 };
  edges.set(edgeId, edge);
  return edge;
}

export function getEdge(fromNode: string, toNode: string): PheromoneEdge | null {
  return [...edges.values()].find(e => e.fromNode === fromNode && e.toNode === toNode) ?? null;
}

export function depositPheromone(fromNode: string, toNode: string, amount: number): void {
  const edge = getEdge(fromNode, toNode);
  if (edge) { edge.pheromoneLevel += amount; edge.traversalCount++; }
}

export function evaporatePheromones(): void {
  for (const edge of edges.values()) {
    edge.pheromoneLevel = Math.max(MIN_PHEROMONE, edge.pheromoneLevel * (1 - EVAPORATION_RATE));
  }
}

export function getNeighbors(fromNode: string): Array<{ toNode: string; probability: number; edge: PheromoneEdge }> {
  const outEdges = [...edges.values()].filter(e => e.fromNode === fromNode);
  const total = outEdges.reduce((s, e) => s + e.pheromoneLevel * e.heuristicValue, 0);
  return outEdges.map(e => ({ toNode: e.toNode, probability: total > 0 ? (e.pheromoneLevel * e.heuristicValue) / total : 0, edge: e }));
}

export function recordPath(antId: string, nodes: string[], totalCost: number): AntPath {
  const deposit = nodes.length > 0 ? 1 / totalCost : 0;
  const path: AntPath = { pathId: `ap-${++pathCounter}`, antId, nodes, totalCost, pheromoneDeposit: deposit, foundAt: Date.now() };
  paths.push(path);
  return path;
}

export function getBestPath(): AntPath | null {
  if (paths.length === 0) return null;
  return paths.reduce((best, p) => p.totalCost < best.totalCost ? p : best, paths[0]);
}

export function getAllEdges(): PheromoneEdge[] { return [...edges.values()]; }
export function _resetPheromoneTrailManagerForTest(): void { edges.clear(); paths.length = 0; edgeCounter = 0; pathCounter = 0; }
