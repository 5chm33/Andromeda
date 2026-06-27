/**
 * monteCarloPlanner.ts — v87.0.0 "Simulation & Game Theory"
 * Monte Carlo Tree Search (MCTS) planner for sequential decision making.
 */
export interface MCTSNode {
  nodeId: string;
  stateId: string;
  action: string | null;
  parentId: string | null;
  childIds: string[];
  visitCount: number;
  totalValue: number;
  untriedActions: string[];
}

export interface MCTSResult {
  bestAction: string;
  confidence: number;
  simulations: number;
  rootVisits: number;
  actionValues: Record<string, number>;
}

const trees = new Map<string, Map<string, MCTSNode>>();
let nodeCounter = 0;

const UCB_C = 1.41;

function ucbScore(node: MCTSNode, parentVisits: number): number {
  if (node.visitCount === 0) return Infinity;
  return (node.totalValue / node.visitCount) + UCB_C * Math.sqrt(Math.log(parentVisits) / node.visitCount);
}

export function createMCTSTree(treeId: string, rootStateId: string, availableActions: string[]): MCTSNode {
  const root: MCTSNode = {
    nodeId: `node-${++nodeCounter}`,
    stateId: rootStateId,
    action: null,
    parentId: null,
    childIds: [],
    visitCount: 0,
    totalValue: 0,
    untriedActions: [...availableActions],
  };
  trees.set(treeId, new Map([[root.nodeId, root]]));
  return root;
}

export function expandNode(treeId: string, nodeId: string, newStateId: string, action: string, childActions: string[]): MCTSNode | null {
  const tree = trees.get(treeId);
  if (!tree) return null;
  const parent = tree.get(nodeId);
  if (!parent) return null;

  const child: MCTSNode = {
    nodeId: `node-${++nodeCounter}`,
    stateId: newStateId,
    action,
    parentId: nodeId,
    childIds: [],
    visitCount: 0,
    totalValue: 0,
    untriedActions: [...childActions],
  };
  tree.set(child.nodeId, child);
  parent.childIds.push(child.nodeId);
  parent.untriedActions = parent.untriedActions.filter(a => a !== action);
  return child;
}

export function backpropagate(treeId: string, nodeId: string, value: number): void {
  const tree = trees.get(treeId);
  if (!tree) return;
  let current = tree.get(nodeId);
  while (current) {
    current.visitCount++;
    current.totalValue += value;
    current = current.parentId ? tree.get(current.parentId) : undefined;
  }
}

export function selectBestAction(treeId: string, rootNodeId: string): MCTSResult | null {
  const tree = trees.get(treeId);
  if (!tree) return null;
  const root = tree.get(rootNodeId);
  if (!root || root.childIds.length === 0) return null;

  const actionValues: Record<string, number> = {};
  let bestAction = "";
  let bestValue = -Infinity;

  for (const childId of root.childIds) {
    const child = tree.get(childId)!;
    const avgValue = child.visitCount > 0 ? child.totalValue / child.visitCount : 0;
    if (child.action) {
      actionValues[child.action] = avgValue;
      if (avgValue > bestValue) { bestValue = avgValue; bestAction = child.action; }
    }
  }

  const confidence = root.visitCount > 0 ? Math.min(1, root.visitCount / 100) : 0;
  return { bestAction, confidence, simulations: root.visitCount, rootVisits: root.visitCount, actionValues };
}

export function getNode(treeId: string, nodeId: string): MCTSNode | undefined { return trees.get(treeId)?.get(nodeId); }
export function getTreeSize(treeId: string): number { return trees.get(treeId)?.size ?? 0; }
export function _resetMonteCarloForTest(): void { trees.clear(); nodeCounter = 0; }
