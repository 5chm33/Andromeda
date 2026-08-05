/**
 * policyOptimizer.ts — v87.0.0 "Simulation & Game Theory"
 * Optimizes agent policies using tabular Q-learning and epsilon-greedy exploration.
 */
export interface QEntry {
  state: string;
  action: string;
  qValue: number;
  visitCount: number;
}

export interface PolicyConfig {
  policyId: string;
  name: string;
  learningRate: number;
  discount: number;
  epsilon: number;
  epsilonDecay: number;
  minEpsilon: number;
}

export interface OptimizationStep {
  state: string;
  action: string;
  reward: number;
  nextState: string;
  qBefore: number;
  qAfter: number;
  tdError: number;
}

const policies = new Map<string, PolicyConfig>();
const qTables = new Map<string, Map<string, Map<string, number>>>(); // policyId -> state -> action -> Q
const visitCounts = new Map<string, Map<string, Map<string, number>>>();
let policyCounter = 0;

export function createPolicy(name: string, learningRate = 0.1, discount = 0.99, epsilon = 1.0, epsilonDecay = 0.995, minEpsilon = 0.01): PolicyConfig {
  const policy: PolicyConfig = { policyId: `pol-${++policyCounter}`, name, learningRate, discount, epsilon, epsilonDecay, minEpsilon };
  policies.set(policy.policyId, policy);
  qTables.set(policy.policyId, new Map());
  visitCounts.set(policy.policyId, new Map());
  return policy;
}

function getQ(policyId: string, state: string, action: string): number {
  return qTables.get(policyId)?.get(state)?.get(action) ?? 0;
}

function setQ(policyId: string, state: string, action: string, value: number): void {
  const qt = qTables.get(policyId)!;
  if (!qt.has(state)) qt.set(state, new Map());
  qt.get(state)!.set(action, value);
}

export function selectAction(policyId: string, state: string, availableActions: string[]): string {
  const policy = policies.get(policyId);
  if (!policy || availableActions.length === 0) return availableActions[0] ?? "";

  if (Math.random() < policy.epsilon) {
    return availableActions[Math.floor(Math.random() * availableActions.length)];
  }

  let bestAction = availableActions[0];
  let bestQ = getQ(policyId, state, bestAction);
  for (const action of availableActions.slice(1)) {
    const q = getQ(policyId, state, action);
    if (q > bestQ) { bestQ = q; bestAction = action; }
  }
  return bestAction;
}

export function updatePolicy(policyId: string, state: string, action: string, reward: number, nextState: string, nextActions: string[]): OptimizationStep | null {
  const policy = policies.get(policyId);
  if (!policy) return null;

  const qBefore = getQ(policyId, state, action);
  const maxNextQ = nextActions.length > 0 ? Math.max(...nextActions.map(a => getQ(policyId, nextState, a))) : 0;
  const tdError = reward + policy.discount * maxNextQ - qBefore;
  const qAfter = qBefore + policy.learningRate * tdError;

  setQ(policyId, state, action, qAfter);
  policy.epsilon = Math.max(policy.minEpsilon, policy.epsilon * policy.epsilonDecay);

  return { state, action, reward, nextState, qBefore, qAfter, tdError };
}

export function getQTable(policyId: string): Record<string, Record<string, number>> {
  const qt = qTables.get(policyId);
  if (!qt) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [state, actions] of qt.entries()) {
    result[state] = Object.fromEntries(actions.entries());
  }
  return result;
}

export function getPolicy(policyId: string): PolicyConfig | undefined { return policies.get(policyId); }
export function _resetPolicyOptimizerForTest(): void { policies.clear(); qTables.clear(); visitCounts.clear(); policyCounter = 0; }
