/**
 * apiCompositionPlanner.ts — v54.0.0
 *
 * Plans compositions of multiple APIs to fulfill complex requirements,
 * generating execution graphs with data flow mappings.
 */

export interface CompositionNode {
  nodeId: string;
  apiId: string;
  endpoint: string;
  method: string;
  inputFrom?: string[];   // nodeIds whose output feeds this node
  outputTo?: string[];    // nodeIds this node feeds
}

export interface CompositionPlan {
  planId: string;
  name: string;
  nodes: CompositionNode[];
  entryNodes: string[];
  exitNodes: string[];
  estimatedLatencyMs: number;
  createdAt: number;
}

const plans = new Map<string, CompositionPlan>();
let planCounter = 0;

export function createCompositionPlan(name: string, nodes: CompositionNode[]): CompositionPlan {
  const nodeIds = new Set(nodes.map(n => n.nodeId));
  const entryNodes = nodes.filter(n => !n.inputFrom || n.inputFrom.length === 0).map(n => n.nodeId);
  const exitNodes = nodes.filter(n => !n.outputTo || n.outputTo.length === 0).map(n => n.nodeId);

  // Validate references
  for (const node of nodes) {
    for (const dep of node.inputFrom ?? []) {
      if (!nodeIds.has(dep)) throw new Error(`[CompositionPlanner] Node "${node.nodeId}" references unknown input "${dep}"`);
    }
  }

  const plan: CompositionPlan = {
    planId: `plan-${++planCounter}`,
    name,
    nodes,
    entryNodes,
    exitNodes,
    estimatedLatencyMs: nodes.length * 100, // simple estimate
    createdAt: Date.now(),
  };
  plans.set(plan.planId, plan);
  return plan;
}

export function getExecutionOrder(planId: string): string[] {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`[CompositionPlanner] Plan "${planId}" not found`);

  // Topological sort
  const order: string[] = [];
  const visited = new Set<string>();
  const nodeMap = new Map(plan.nodes.map(n => [n.nodeId, n]));

  function visit(nodeId: string): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId)!;
    for (const dep of node.inputFrom ?? []) visit(dep);
    order.push(nodeId);
  }

  for (const node of plan.nodes) visit(node.nodeId);
  return order;
}

export function _resetCompositionPlannerForTest(): void {
  plans.clear();
  planCounter = 0;
}
