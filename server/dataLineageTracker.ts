/**
 * dataLineageTracker.ts — v69.0.0 "Data Pipeline"
 * Tracks data lineage across pipeline stages for auditability and debugging.
 */
export interface LineageNode { nodeId: string; name: string; type: "source" | "transform" | "sink"; inputFrom: string[]; outputTo: string[]; recordCount: number; createdAt: number; }
export interface LineageGraph { nodes: LineageNode[]; edges: Array<{ from: string; to: string }>; }

const nodes = new Map<string, LineageNode>();
let nodeCounter = 0;

export function addLineageNode(name: string, type: LineageNode["type"], inputFrom: string[] = [], recordCount = 0): LineageNode {
  const node: LineageNode = { nodeId: `ln-${++nodeCounter}`, name, type, inputFrom, outputTo: [], recordCount, createdAt: Date.now() };
  nodes.set(node.nodeId, node);
  inputFrom.forEach(parentId => { const parent = nodes.get(parentId); if (parent) parent.outputTo.push(node.nodeId); });
  return node;
}

export function getLineageGraph(): LineageGraph {
  const nodeList = [...nodes.values()];
  const edges: Array<{ from: string; to: string }> = [];
  nodeList.forEach(n => n.outputTo.forEach(to => edges.push({ from: n.nodeId, to })));
  return { nodes: nodeList, edges };
}

export function traceLineage(nodeId: string): string[] {
  const visited = new Set<string>();
  const trace: string[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) return;
    trace.unshift(node.name);
    node.inputFrom.forEach(visit);
  };
  visit(nodeId);
  return trace;
}

export function _resetDataLineageTrackerForTest(): void { nodes.clear(); nodeCounter = 0; }
