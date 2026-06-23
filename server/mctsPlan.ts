/**
 * mctsPlan.ts — Monte Carlo Tree Search Planner (v11.0.0)
 * Replaces linear planning with MCTS so Andromeda simulates multiple solution
 * paths before committing to one. Each node is a partial plan; rollouts
 * estimate expected reward; UCB1 balances exploration vs exploitation.
 */

export interface MctsNode {
  id: string;
  parentId: string | null;
  action: string;
  depth: number;
  visits: number;
  totalReward: number;
  children: MctsNode[];
  isTerminal: boolean;
}

export interface MctsResult {
  bestPath: string[];
  bestReward: number;
  iterations: number;
  tree: MctsNode;
}

export interface MctsOptions {
  maxIterations?: number;
  maxDepth?: number;
  explorationConstant?: number; // UCB1 C parameter
  rolloutDepth?: number;
}

const DEFAULT_OPTIONS: Required<MctsOptions> = {
  maxIterations: 200,
  maxDepth: 6,
  explorationConstant: 1.414, // sqrt(2) — standard UCB1
  rolloutDepth: 3,
};

let nodeCounter = 0;

function makeNode(action: string, parentId: string | null, depth: number): MctsNode {
  return {
    id: `node_${++nodeCounter}`,
    parentId,
    action,
    depth,
    visits: 0,
    totalReward: 0,
    children: [],
    isTerminal: false,
  };
}

/**
 * UCB1 score — balances exploitation (high avg reward) vs exploration (low visits).
 */
function ucb1(node: MctsNode, parentVisits: number, C: number): number {
  if (node.visits === 0) return Infinity;
  const exploitation = node.totalReward / node.visits;
  const exploration = C * Math.sqrt(Math.log(parentVisits) / node.visits);
  return exploitation + exploration;
}

/**
 * Expand a node by generating candidate child actions.
 * In production this would call the LLM; here we use heuristic expansion.
 */
function expand(node: MctsNode, actions: string[], maxDepth: number): MctsNode[] {
  if (node.depth >= maxDepth || node.isTerminal) return [];
  const children = actions.map(a => makeNode(a, node.id, node.depth + 1));
  node.children.push(...children);
  return children;
}

/**
 * Rollout: simulate a random path from this node and return estimated reward.
 * Reward heuristic: longer paths with diverse actions score higher.
 */
function rollout(node: MctsNode, actions: string[], rolloutDepth: number): number {
  let reward = 0;
  let current = node;
  const visited = new Set<string>([node.action]);

  for (let i = 0; i < rolloutDepth; i++) {
    const candidates = actions.filter(a => !visited.has(a));
    if (candidates.length === 0) break;
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    visited.add(next);
    // Reward diversity and depth
    reward += 1.0 / (current.depth + 1);
    current = makeNode(next, current.id, current.depth + 1);
  }
  return reward;
}

/**
 * Backpropagate reward up the tree.
 */
function backpropagate(node: MctsNode, reward: number, nodeMap: Map<string, MctsNode>): void {
  let current: MctsNode | undefined = node;
  while (current) {
    current.visits++;
    current.totalReward += reward;
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
  }
}

/**
 * Select the best child using UCB1.
 */
function selectBestChild(node: MctsNode, C: number): MctsNode | null {
  if (node.children.length === 0) return null;
  return node.children.reduce((best, child) =>
    ucb1(child, node.visits, C) > ucb1(best, node.visits, C) ? child : best
  );
}

/**
 * Extract the best path from root to the highest-reward leaf.
 */
function extractBestPath(root: MctsNode): string[] {
  const path: string[] = [];
  let current: MctsNode = root;
  while (current.children.length > 0) {
    const best = current.children.reduce((a, b) =>
      (b.visits > 0 ? b.totalReward / b.visits : 0) >
      (a.visits > 0 ? a.totalReward / a.visits : 0) ? b : a
    );
    if (best.visits === 0) break;
    path.push(best.action);
    current = best;
  }
  return path;
}

/**
 * Run MCTS to find the best plan for a given goal.
 * @param goal - The high-level goal description
 * @param candidateActions - Available actions to choose from
 * @param options - MCTS hyperparameters
 */
export function mctsPlan(
  goal: string,
  candidateActions: string[],
  options: MctsOptions = {}
): MctsResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  nodeCounter = 0;

  const root = makeNode(`GOAL: ${goal}`, null, 0);
  const nodeMap = new Map<string, MctsNode>([[root.id, root]]);

  // Initial expansion
  expand(root, candidateActions, opts.maxDepth);
  root.children.forEach(c => nodeMap.set(c.id, c));

  for (let i = 0; i < opts.maxIterations; i++) {
    // Selection: traverse tree using UCB1
    let current = root;
    while (current.children.length > 0 && current.children.every(c => c.visits > 0)) {
      const best = selectBestChild(current, opts.explorationConstant);
      if (!best) break;
      current = best;
    }

    // Expansion: expand unvisited node
    if (current.children.length === 0 && current.depth < opts.maxDepth && !current.isTerminal) {
      const newChildren = expand(current, candidateActions, opts.maxDepth);
      newChildren.forEach(c => nodeMap.set(c.id, c));
      if (newChildren.length > 0) {
        current = newChildren[0];
      }
    }

    // Rollout
    const reward = rollout(current, candidateActions, opts.rolloutDepth);

    // Backpropagation
    backpropagate(current, reward, nodeMap);
  }

  const bestPath = extractBestPath(root);
  const bestLeaf = root.children.reduce((a, b) =>
    (b.visits > 0 ? b.totalReward / b.visits : 0) >
    (a.visits > 0 ? a.totalReward / a.visits : 0) ? b : a,
    root.children[0] ?? root
  );

  return {
    bestPath,
    bestReward: bestLeaf.visits > 0 ? bestLeaf.totalReward / bestLeaf.visits : 0,
    iterations: opts.maxIterations,
    tree: root,
  };
}

/**
 * Convenience wrapper: plan from a natural-language goal string.
 * Returns ordered action list.
 */
export function planFromGoal(goal: string, availableTools: string[]): string[] {
  const result = mctsPlan(goal, availableTools);
  return result.bestPath;
}
