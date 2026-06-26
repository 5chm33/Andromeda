/**
 * rewardDistributor.ts — v46.0.0
 *
 * Distributes compute credit rewards to sub-agents based on task outcomes,
 * quality scores, and cooperative bonuses.
 */

export interface RewardRecord {
  agentId: string;
  taskId: string;
  baseReward: number;
  qualityBonus: number;
  cooperationBonus: number;
  totalReward: number;
  timestamp: number;
}

export interface AgentBalance {
  agentId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  rewardHistory: RewardRecord[];
}

const balances = new Map<string, AgentBalance>();

export function initializeAgent(agentId: string, initialBalance = 100): AgentBalance {
  const balance: AgentBalance = {
    agentId,
    balance: initialBalance,
    totalEarned: 0,
    totalSpent: 0,
    rewardHistory: [],
  };
  balances.set(agentId, balance);
  return balance;
}

export function distributeReward(
  agentId: string,
  taskId: string,
  baseReward: number,
  qualityScore: number,   // 0.0–1.0
  cooperationScore = 0.5  // 0.0–1.0
): RewardRecord | null {
  let balance = balances.get(agentId);
  if (!balance) {
    balance = initializeAgent(agentId);
  }

  const qualityBonus = baseReward * (qualityScore - 0.5) * 0.4;
  const cooperationBonus = baseReward * cooperationScore * 0.1;
  const totalReward = Math.max(0, baseReward + qualityBonus + cooperationBonus);

  const record: RewardRecord = {
    agentId,
    taskId,
    baseReward,
    qualityBonus: Math.round(qualityBonus * 100) / 100,
    cooperationBonus: Math.round(cooperationBonus * 100) / 100,
    totalReward: Math.round(totalReward * 100) / 100,
    timestamp: Date.now(),
  };

  balance.balance += record.totalReward;
  balance.totalEarned += record.totalReward;
  balance.rewardHistory.push(record);

  console.log(`[RewardDistributor] Agent ${agentId} earned ${record.totalReward.toFixed(2)} credits for task ${taskId}.`);
  return record;
}

export function deductCost(agentId: string, amount: number): boolean {
  const balance = balances.get(agentId);
  if (!balance || balance.balance < amount) return false;
  balance.balance -= amount;
  balance.totalSpent += amount;
  return true;
}

export function getBalance(agentId: string): AgentBalance | undefined {
  return balances.get(agentId);
}

export function getLeaderboard(): Array<{ agentId: string; totalEarned: number; balance: number }> {
  return Array.from(balances.values())
    .map(b => ({ agentId: b.agentId, totalEarned: b.totalEarned, balance: b.balance }))
    .sort((a, b) => b.totalEarned - a.totalEarned);
}

export function _resetRewardDistributorForTest(): void {
  balances.clear();
}
