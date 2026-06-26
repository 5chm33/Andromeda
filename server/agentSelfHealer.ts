/**
 * agentSelfHealer.ts — v49.0.0
 *
 * Monitors sub-agent health and autonomously applies healing actions:
 * restart, rebalance, quarantine, or escalate based on health signals.
 */

export type HealingAction = "restart" | "rebalance" | "quarantine" | "escalate" | "none";

export interface HealthSignal {
  agentId: string;
  errorRate: number;      // 0.0–1.0
  memoryPressure: number; // 0.0–1.0
  latencySpike: boolean;
  consecutiveFailures: number;
  lastHeartbeatMs: number; // ms since last heartbeat
}

export interface HealingDecision {
  agentId: string;
  action: HealingAction;
  reason: string;
  timestamp: number;
}

export interface HealingRecord {
  agentId: string;
  decisions: HealingDecision[];
  quarantined: boolean;
  restartCount: number;
}

const records = new Map<string, HealingRecord>();
const healingHistory: HealingDecision[] = [];

export function registerAgent(agentId: string): void {
  if (!records.has(agentId)) {
    records.set(agentId, { agentId, decisions: [], quarantined: false, restartCount: 0 });
  }
}

export function evaluateHealth(signal: HealthSignal): HealingDecision {
  registerAgent(signal.agentId);
  const record = records.get(signal.agentId)!;

  let action: HealingAction = "none";
  let reason = "Agent healthy.";

  if (record.quarantined) {
    action = "none";
    reason = "Agent is quarantined — awaiting manual review.";
  } else if (signal.consecutiveFailures >= 10 || signal.errorRate >= 0.9) {
    action = "quarantine";
    reason = `Critical failure rate (${(signal.errorRate * 100).toFixed(0)}%) or ${signal.consecutiveFailures} consecutive failures.`;
    record.quarantined = true;
  } else if (signal.lastHeartbeatMs > 30000) {
    action = "restart";
    reason = `No heartbeat for ${(signal.lastHeartbeatMs / 1000).toFixed(0)}s.`;
    record.restartCount++;
  } else if (signal.consecutiveFailures >= 5 || signal.errorRate >= 0.5) {
    action = "restart";
    reason = `High failure rate (${(signal.errorRate * 100).toFixed(0)}%) with ${signal.consecutiveFailures} consecutive failures.`;
    record.restartCount++;
  } else if (signal.memoryPressure >= 0.85 || signal.latencySpike) {
    action = "rebalance";
    reason = `Resource pressure: memory=${(signal.memoryPressure * 100).toFixed(0)}%, latencySpike=${signal.latencySpike}.`;
  } else if (signal.errorRate >= 0.2) {
    action = "escalate";
    reason = `Elevated error rate (${(signal.errorRate * 100).toFixed(0)}%) — escalating for review.`;
  }

  const decision: HealingDecision = {
    agentId: signal.agentId,
    action,
    reason,
    timestamp: Date.now(),
  };

  record.decisions.push(decision);
  healingHistory.push(decision);

  if (action !== "none") {
    console.log(`[SelfHealer] ${action.toUpperCase()} agent ${signal.agentId}: ${reason}`);
  }

  return decision;
}

export function unquarantine(agentId: string): boolean {
  const record = records.get(agentId);
  if (!record) return false;
  record.quarantined = false;
  console.log(`[SelfHealer] Agent ${agentId} released from quarantine.`);
  return true;
}

export function getHealingRecord(agentId: string): HealingRecord | undefined {
  return records.get(agentId);
}

export function getHealingHistory(agentId?: string): HealingDecision[] {
  return agentId ? healingHistory.filter(d => d.agentId === agentId) : [...healingHistory];
}

export function _resetSelfHealerForTest(): void {
  records.clear();
  healingHistory.length = 0;
}
