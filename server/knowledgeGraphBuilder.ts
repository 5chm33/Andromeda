/**
 * Knowledge Graph Builder — semantic graph of all concepts, modules, and relationships.
 * Enables semantic search, gap identification, and PageRank-based importance scoring.
 */

export interface KGNode {
  id: string;
  label: string;
  type: "module" | "concept" | "capability" | "improvement";
  weight: number;
  pageRank: number;
  metadata: Record<string, unknown>;
}

export interface KGEdge {
  from: string;
  to: string;
  relation: "imports" | "improves" | "depends_on" | "related_to" | "conflicts_with";
  weight: number;
}

export interface KGPath {
  nodes: string[];
  totalWeight: number;
  length: number;
}

export interface KGStats {
  nodeCount: number;
  edgeCount: number;
  avgPageRank: number;
  topNodes: string[];
  knowledgeGaps: string[];
  density: number;
}

class KnowledgeGraphBuilderEngine {
  private nodes: Map<string, KGNode> = new Map();
  private edges: KGEdge[] = [];
  private pageRankComputed = false;

  addNode(id: string, label: string, type: KGNode["type"], metadata: Record<string, unknown> = {}): KGNode {
    const node: KGNode = { id, label, type, weight: 1.0, pageRank: 1.0, metadata };
    this.nodes.set(id, node);
    this.pageRankComputed = false;
    return node;
  }

  addEdge(from: string, to: string, relation: KGEdge["relation"], weight = 1.0): KGEdge {
    // Ensure nodes exist
    if (!this.nodes.has(from)) this.addNode(from, from, "concept");
    if (!this.nodes.has(to)) this.addNode(to, to, "concept");
    const edge: KGEdge = { from, to, relation, weight };
    this.edges.push(edge);
    this.pageRankComputed = false;
    return edge;
  }

  findShortestPath(fromId: string, toId: string): KGPath | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    // BFS
    const queue: Array<{ node: string; path: string[]; weight: number }> = [{ node: fromId, path: [fromId], weight: 0 }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.node === toId) {
        return { nodes: current.path, totalWeight: current.weight, length: current.path.length - 1 };
      }
      if (visited.has(current.node)) continue;
      visited.add(current.node);
      const outEdges = this.edges.filter(e => e.from === current.node);
      for (const edge of outEdges) {
        if (!visited.has(edge.to)) {
          queue.push({ node: edge.to, path: [...current.path, edge.to], weight: current.weight + edge.weight });
        }
      }
    }
    return null;
  }

  computePageRank(dampingFactor = 0.85, iterations = 20): Map<string, number> {
    const n = this.nodes.size;
    if (n === 0) return new Map();

    const ranks = new Map<string, number>();
    this.nodes.forEach((_, id) => ranks.set(id, 1.0 / n));

    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map<string, number>();
      this.nodes.forEach((_, id) => {
        const inEdges = this.edges.filter(e => e.to === id);
        let sum = 0;
        for (const edge of inEdges) {
          const outDegree = this.edges.filter(e => e.from === edge.from).length;
          sum += (ranks.get(edge.from) ?? 0) / Math.max(outDegree, 1);
        }
        newRanks.set(id, (1 - dampingFactor) / n + dampingFactor * sum);
      });
      newRanks.forEach((rank, id) => ranks.set(id, rank));
    }

    // Update node pageRank
    ranks.forEach((rank, id) => {
      const node = this.nodes.get(id);
      if (node) node.pageRank = rank;
    });
    this.pageRankComputed = true;
    return ranks;
  }

  identifyKnowledgeGaps(): string[] {
    // Gaps: nodes with no outgoing edges (dead ends) or very low PageRank
    if (!this.pageRankComputed) this.computePageRank();
    const gaps: string[] = [];
    for (const [id, node] of this.nodes) {
      const outDegree = this.edges.filter(e => e.from === id).length;
      const inDegree = this.edges.filter(e => e.to === id).length;
      if (outDegree === 0 && inDegree === 0) {
        gaps.push(`Isolated node: ${node.label}`);
      } else if (node.pageRank < 0.001 && node.type === "capability") {
        gaps.push(`Under-connected capability: ${node.label}`);
      }
    }
    return gaps.slice(0, 10);
  }

  getGraphStats(): KGStats {
    if (!this.pageRankComputed) this.computePageRank();
    const nodes = Array.from(this.nodes.values());
    const avgPageRank = nodes.length > 0 ? nodes.reduce((s, n) => s + n.pageRank, 0) / nodes.length : 0;
    const topNodes = nodes.sort((a, b) => b.pageRank - a.pageRank).slice(0, 5).map(n => n.label);
    const density = nodes.length > 1 ? this.edges.length / (nodes.length * (nodes.length - 1)) : 0;
    return {
      nodeCount: nodes.length,
      edgeCount: this.edges.length,
      avgPageRank,
      topNodes,
      knowledgeGaps: this.identifyKnowledgeGaps(),
      density,
    };
  }

  getNodes(): KGNode[] { return Array.from(this.nodes.values()); }
  getEdges(): KGEdge[] { return [...this.edges]; }
}

export const globalKnowledgeGraph = new KnowledgeGraphBuilderEngine();

export function addKGNode(id: string, label: string, type: KGNode["type"], metadata?: Record<string, unknown>): KGNode {
  return globalKnowledgeGraph.addNode(id, label, type, metadata);
}
export function addKGEdge(from: string, to: string, relation: KGEdge["relation"], weight?: number): KGEdge {
  return globalKnowledgeGraph.addEdge(from, to, relation, weight);
}
export function findShortestPath(fromId: string, toId: string): KGPath | null {
  return globalKnowledgeGraph.findShortestPath(fromId, toId);
}
export function computePageRank(dampingFactor?: number, iterations?: number): Map<string, number> {
  return globalKnowledgeGraph.computePageRank(dampingFactor, iterations);
}
export function identifyKnowledgeGaps(): string[] {
  return globalKnowledgeGraph.identifyKnowledgeGaps();
}
export function getKGStats(): KGStats {
  return globalKnowledgeGraph.getGraphStats();
}
export function initKnowledgeGraphBuilder(): void {
  console.log("[KG] Knowledge Graph Builder initialized.");
  const coreModules = ["rsiEngine", "selfImprove", "rewardModel", "safetyGuard", "capabilityTracker"];
  coreModules.forEach(m => globalKnowledgeGraph.addNode(m, m, "module"));
  globalKnowledgeGraph.addEdge("rsiEngine", "selfImprove", "improves");
  globalKnowledgeGraph.addEdge("selfImprove", "capabilityTracker", "improves");
  globalKnowledgeGraph.addEdge("rewardModel", "rsiEngine", "depends_on");
  globalKnowledgeGraph.addEdge("safetyGuard", "rsiEngine", "depends_on");
  globalKnowledgeGraph.computePageRank();
}
