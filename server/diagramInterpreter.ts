/**
 * diagramInterpreter.ts — v72.0.0 "Multi-Modal Fusion"
 * Diagram interpretation: flowcharts, UML, architecture diagrams, and graph structures.
 */
export type DiagramType = "flowchart" | "uml" | "architecture" | "graph" | "sequence" | "unknown";
export interface DiagramNode { nodeId: string; label: string; type: string; }
export interface DiagramEdge { from: string; to: string; label?: string; }
export interface DiagramInterpretation { diagramId: string; diagramType: DiagramType; nodes: DiagramNode[]; edges: DiagramEdge[]; description: string; complexity: "simple" | "moderate" | "complex"; }

const interpretations: DiagramInterpretation[] = [];
let diagCounter = 0;

export function interpretDiagram(diagramType: DiagramType, nodes: DiagramNode[], edges: DiagramEdge[]): DiagramInterpretation {
  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const complexity: DiagramInterpretation["complexity"] = nodeCount <= 5 ? "simple" : nodeCount <= 15 ? "moderate" : "complex";
  const description = `${diagramType} diagram with ${nodeCount} nodes and ${edgeCount} connections (${complexity} complexity)`;
  const interp: DiagramInterpretation = { diagramId: `diag-${++diagCounter}`, diagramType, nodes, edges, description, complexity };
  interpretations.push(interp);
  return interp;
}

export function findCriticalPath(interp: DiagramInterpretation): string[] {
  // Simple longest path via BFS
  const adj = new Map<string, string[]>();
  interp.nodes.forEach(n => adj.set(n.nodeId, []));
  interp.edges.forEach(e => adj.get(e.from)?.push(e.to));
  const roots = interp.nodes.filter(n => !interp.edges.some(e => e.to === n.nodeId));
  if (roots.length === 0) return [];
  let longest: string[] = [];
  const dfs = (nodeId: string, path: string[]) => {
    const newPath = [...path, nodeId];
    if (newPath.length > longest.length) longest = newPath;
    (adj.get(nodeId) ?? []).forEach(next => dfs(next, newPath));
  };
  roots.forEach(r => dfs(r.nodeId, []));
  return longest.map(id => interp.nodes.find(n => n.nodeId === id)?.label ?? id);
}

export function _resetDiagramInterpreterForTest(): void { interpretations.length = 0; diagCounter = 0; }
