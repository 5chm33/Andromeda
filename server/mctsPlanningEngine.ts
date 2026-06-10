/**
 * mctsPlanningEngine.ts — Monte Carlo Tree Search Planning Engine
 * Andromeda v11.0.0 — Phase 12: Gödel Ascension
 *
 * Implements AlphaGo-style MCTS for complex, multi-step code refactoring and
 * RSI proposal planning. Instead of greedily picking the first plausible plan,
 * the engine simulates hundreds of possible architectural paths in memory,
 * scores them via LLM rollouts, and selects the globally optimal strategy.
 *
 * Architecture:
 *   - MCTSNode: a state in the search tree (partial plan + evaluation score)
 *   - MCTSEngine: the core search loop (Selection → Expansion → Simulation → Backprop)
 *   - UCB1 formula: balances exploration vs exploitation
 *   - LLM rollout: uses the background LLM to evaluate a plan's quality
 *
 * Key operations:
 *   - search(root, iterations): run N iterations of MCTS from a root state
 *   - getBestPlan(): return the highest-scoring plan found
 *   - expandNode(): generate child states (alternative plan steps)
 *   - simulate(): LLM-based rollout to estimate plan quality
 *   - backpropagate(): update scores up the tree
 */

import { createLogger } from "./logger.js";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { compute as computeUtility, createStateSnapshot } from "./utilityFunction.js";

const log = createLogger("mctsPlanningEngine");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  action: "modify_file" | "create_file" | "delete_file" | "run_tests" | "refactor" | "add_dependency";
  target: string;
  description: string;
  estimatedRisk: number;   // 0.0–1.0
  estimatedGain: number;   // 0.0–1.0
}

export interface PlanState {
  goal: string;
  steps: PlanStep[];
  completedSteps: string[];
  context: Record<string, unknown>;
}

export interface MCTSNode {
  id: string;
  state: PlanState;
  parent: MCTSNode | null;
  children: MCTSNode[];
  visits: number;
  totalScore: number;
  /** Unexplored actions available from this state */
  untriedActions: PlanStep[];
  /** Whether this is a terminal state (plan complete) */
  isTerminal: boolean;
  depth: number;
}

export interface MCTSResult {
  bestPlan: PlanStep[];
  bestScore: number;
  iterations: number;
  exploredNodes: number;
  confidence: number;
  alternativePlans: Array<{ steps: PlanStep[]; score: number }>;
}

// ── UCB1 Scoring ──────────────────────────────────────────────────────────────

const UCB1_C = Math.SQRT2;  // Exploration constant

function ucb1Score(node: MCTSNode, parentVisits: number): number {
  if (node.visits === 0) return Infinity;
  const exploitation = node.totalScore / node.visits;
  const exploration = UCB1_C * Math.sqrt(Math.log(parentVisits) / node.visits);
  return exploitation + exploration;
}

// ── MCTS Engine ───────────────────────────────────────────────────────────────

export class MCTSEngine {
  private maxDepth: number;
  private explorationConstant: number;
  private useLLMRollout: boolean;
  private nodeCount = 0;

  constructor(options: {
    maxDepth?: number;
    explorationConstant?: number;
    useLLMRollout?: boolean;
  } = {}) {
    this.maxDepth = options.maxDepth ?? 8;
    this.explorationConstant = options.explorationConstant ?? UCB1_C;
    this.useLLMRollout = options.useLLMRollout ?? false;
  }

  // ── Core MCTS Loop ───────────────────────────────────────────────────────────

  async search(rootState: PlanState, iterations: number = 100): Promise<MCTSResult> {
    const root = this.createNode(rootState, null);
    log.info(`[mcts] Starting search: goal="${rootState.goal}", iterations=${iterations}`);

    for (let i = 0; i < iterations; i++) {
      // 1. Selection: traverse tree using UCB1 to find a promising node
      const selected = this.select(root);

      // 2. Expansion: add a new child node
      const expanded = this.expand(selected);

      // 3. Simulation: rollout to estimate value
      const score = await this.simulate(expanded);

      // 4. Backpropagation: update scores up the tree
      this.backpropagate(expanded, score);
    }

    return this.extractResult(root, iterations);
  }

  // ── Selection (UCB1 Tree Policy) ─────────────────────────────────────────────

  private select(node: MCTSNode): MCTSNode {
    let current = node;

    while (!current.isTerminal && current.untriedActions.length === 0 && current.children.length > 0) {
      // All actions tried — select best child by UCB1
      current = this.selectBestChild(current);
    }

    return current;
  }

  private selectBestChild(node: MCTSNode): MCTSNode {
    let bestChild = node.children[0];
    let bestScore = -Infinity;

    for (const child of node.children) {
      const score = ucb1Score(child, node.visits);
      if (score > bestScore) {
        bestScore = score;
        bestChild = child;
      }
    }

    return bestChild;
  }

  // ── Expansion ────────────────────────────────────────────────────────────────

  private expand(node: MCTSNode): MCTSNode {
    if (node.isTerminal || node.untriedActions.length === 0) {
      return node;
    }

    // Pick a random untried action
    const actionIdx = Math.floor(Math.random() * node.untriedActions.length);
    const action = node.untriedActions.splice(actionIdx, 1)[0];

    // Create new state by applying the action
    const newState: PlanState = {
      goal: node.state.goal,
      steps: [...node.state.steps, action],
      completedSteps: [...node.state.completedSteps, action.id],
      context: { ...node.state.context },
    };

    const child = this.createNode(newState, node);
    node.children.push(child);

    return child;
  }

  // ── Simulation (Rollout) ─────────────────────────────────────────────────────

  private async simulate(node: MCTSNode): Promise<number> {
    if (node.isTerminal) {
      return this.evaluateTerminalState(node.state);
    }

    if (this.useLLMRollout) {
      return this.llmRollout(node.state);
    }

    return this.heuristicRollout(node.state);
  }

  /**
   * Fast heuristic rollout: score based on risk/gain ratio and plan coherence.
   * v9.0: Primary reward signal is the unified utility function U(state).
   * Falls back to gain/risk heuristic if utility function is unavailable.
   */
  private heuristicRollout(state: PlanState): number {
    if (state.steps.length === 0) return 0.5;

    // v9.0: Use unified utility function as primary reward signal
    try {
      const snapshot = createStateSnapshot({
        // Map plan steps to utility-relevant state overrides
        testPassRate: state.steps.some(s => s.action === "run_tests") ? 0.95 : 0.80,
        safetyScore: 1.0 - (state.steps.reduce((sum, s) => sum + s.estimatedRisk, 0) / state.steps.length),
        newCapabilities: Math.round(Math.min(5, state.steps.length)),
      });
      const utilityScore = computeUtility(snapshot);
      // Normalize utility total to 0-1 range (max possible is ~1.0 weighted sum)
      const normalizedUtility = Math.min(1.0, Math.max(0.0, utilityScore.total));

      // Blend utility (70%) with gain/risk heuristic (30%) for robustness
      const totalGain = state.steps.reduce((sum, s) => sum + s.estimatedGain, 0);
      const totalRisk = state.steps.reduce((sum, s) => sum + s.estimatedRisk, 0);
      const avgGain = totalGain / state.steps.length;
      const avgRisk = totalRisk / state.steps.length;
      const heuristicScore = avgGain * (1 - avgRisk * 0.5);
      const hasTests = state.steps.some(s => s.action === "run_tests");
      const testBonus = hasTests ? 0.1 : 0;
      const lengthPenalty = Math.max(0, (state.steps.length - 5) * 0.02);
      const blendedHeuristic = Math.min(1.0, Math.max(0.0, heuristicScore + testBonus - lengthPenalty));

      return 0.7 * normalizedUtility + 0.3 * blendedHeuristic;
    } catch {
      // Fallback to pure gain/risk heuristic if utility function fails
      const totalGain = state.steps.reduce((sum, s) => sum + s.estimatedGain, 0);
      const totalRisk = state.steps.reduce((sum, s) => sum + s.estimatedRisk, 0);
      const avgGain = totalGain / state.steps.length;
      const avgRisk = totalRisk / state.steps.length;
      const score = avgGain * (1 - avgRisk * 0.5);
      const hasTests = state.steps.some(s => s.action === "run_tests");
      const testBonus = hasTests ? 0.1 : 0;
      const lengthPenalty = Math.max(0, (state.steps.length - 5) * 0.02);
      return Math.min(1.0, Math.max(0.0, score + testBonus - lengthPenalty));
    }
  }

  /**
   * LLM-based rollout: ask the model to evaluate the plan quality.
   * Used when useLLMRollout=true for high-stakes planning.
   */
  private async llmRollout(state: PlanState): Promise<number> {
    try {
      const planDescription = state.steps
        .map((s, i) => `${i + 1}. [${s.action}] ${s.target}: ${s.description}`)
        .join("\n");

      const prompt = `You are evaluating an AI self-improvement plan. Rate the following plan on a scale of 0.0 to 1.0 based on:
- Likelihood of achieving the goal: "${state.goal}"
- Safety (low risk of regressions)
- Efficiency (minimal steps)
- Correctness (logical step ordering)

Plan:
${planDescription}

Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`;

      const response = await backgroundSimpleCompletion([{ role: "user", content: prompt }]);
      const score = parseFloat(response.trim());
      return isNaN(score) ? 0.5 : Math.min(1.0, Math.max(0.0, score));
    } catch {
      return this.heuristicRollout(state);
    }
  }

  private evaluateTerminalState(state: PlanState): number {
    return this.heuristicRollout(state);
  }

  // ── Backpropagation ──────────────────────────────────────────────────────────

  private backpropagate(node: MCTSNode, score: number): void {
    let current: MCTSNode | null = node;
    while (current !== null) {
      current.visits++;
      current.totalScore += score;
      current = current.parent;
    }
  }

  // ── Result Extraction ────────────────────────────────────────────────────────

  private extractResult(root: MCTSNode, iterations: number): MCTSResult {
    // Find the best path through the tree
    const bestPath = this.getBestPath(root);
    const bestScore = root.visits > 0 ? root.totalScore / root.visits : 0;

    // Collect alternative plans from top children
    const alternatives = root.children
      .filter(c => c.visits > 0)
      .sort((a, b) => (b.totalScore / b.visits) - (a.totalScore / a.visits))
      .slice(1, 4)
      .map(c => ({
        steps: c.state.steps,
        score: c.totalScore / c.visits,
      }));

    const confidence = Math.min(1.0, iterations / 50);  // More iterations = more confidence

    log.info(`[mcts] Search complete: bestScore=${bestScore.toFixed(3)}, nodes=${this.nodeCount}, confidence=${confidence.toFixed(2)}`);

    return {
      bestPlan: bestPath,
      bestScore,
      iterations,
      exploredNodes: this.nodeCount,
      confidence,
      alternativePlans: alternatives,
    };
  }

  private getBestPath(node: MCTSNode): PlanStep[] {
    let current = node;
    while (current.children.length > 0) {
      // Follow the most visited child (robust child selection)
      current = current.children.reduce((best, child) =>
        child.visits > best.visits ? child : best
      );
    }
    return current.state.steps;
  }

  // ── Node Creation ────────────────────────────────────────────────────────────

  private createNode(state: PlanState, parent: MCTSNode | null): MCTSNode {
    this.nodeCount++;
    const depth = parent ? parent.depth + 1 : 0;

    // Generate candidate actions for this state
    const untriedActions = this.generateActions(state);

    return {
      id: `node_${this.nodeCount}`,
      state,
      parent,
      children: [],
      visits: 0,
      totalScore: 0,
      untriedActions,
      isTerminal: depth >= this.maxDepth || untriedActions.length === 0,
      depth,
    };
  }

  /**
   * Generate candidate next steps for a given plan state.
   * In a real deployment, this would query the LLM for suggestions.
   * Here we use a structured set of canonical RSI actions.
   */
  private generateActions(state: PlanState): PlanStep[] {
    const completedIds = new Set(state.completedSteps);
    const stepCount = state.steps.length;

    // Don't generate more steps if plan is already long
    if (stepCount >= this.maxDepth) return [];

    const candidates: PlanStep[] = [
      {
        id: `analyze_${stepCount}`,
        action: "refactor",
        target: "codebase",
        description: "Analyze current codebase for improvement opportunities",
        estimatedRisk: 0.1,
        estimatedGain: 0.3,
      },
      {
        id: `test_${stepCount}`,
        action: "run_tests",
        target: "full_suite",
        description: "Run full test suite to establish baseline",
        estimatedRisk: 0.05,
        estimatedGain: 0.2,
      },
      {
        id: `modify_${stepCount}`,
        action: "modify_file",
        target: state.goal,
        description: `Implement improvement for: ${state.goal}`,
        estimatedRisk: 0.4,
        estimatedGain: 0.7,
      },
      {
        id: `validate_${stepCount}`,
        action: "run_tests",
        target: "targeted",
        description: "Run targeted tests to validate changes",
        estimatedRisk: 0.05,
        estimatedGain: 0.4,
      },
    ];

    return candidates.filter(c => !completedIds.has(c.id));
  }

  reset(): void {
    this.nodeCount = 0;
  }
}

// ── Convenience API ───────────────────────────────────────────────────────────

/**
 * Plan an RSI improvement using MCTS.
 * Returns the optimal sequence of steps to achieve the goal.
 */
export async function planWithMCTS(
  goal: string,
  context: Record<string, unknown> = {},
  iterations = 200,
  useLLM = false
): Promise<MCTSResult> {
  const engine = new MCTSEngine({ useLLMRollout: useLLM, maxDepth: 8 });

  const rootState: PlanState = {
    goal,
    steps: [],
    completedSteps: [],
    context,
  };

  return engine.search(rootState, iterations);
}

/**
 * Compare two plans using MCTS scoring.
 * Returns true if planA is better than planB.
 */
export function comparePlans(planA: PlanStep[], planB: PlanStep[]): boolean {
  const scoreA = planA.reduce((s, step) => s + step.estimatedGain * (1 - step.estimatedRisk * 0.5), 0);
  const scoreB = planB.reduce((s, step) => s + step.estimatedGain * (1 - step.estimatedRisk * 0.5), 0);
  return scoreA > scoreB;
}
