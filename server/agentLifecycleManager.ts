/**
 * agentLifecycleManager.ts — v47.0.0
 *
 * Manages the full lifecycle of sub-agents: initialization, health monitoring,
 * graceful shutdown, and post-mortem analysis.
 */

export type LifecycleState =
  | "initializing"
  | "ready"
  | "busy"
  | "draining"
  | "terminated"
  | "crashed";

export interface LifecycleRecord {
  agentId: string;
  state: LifecycleState;
  stateHistory: Array<{ state: LifecycleState; timestamp: number }>;
  healthScore: number;   // 0.0–1.0
  tasksCompleted: number;
  tasksFailed: number;
  uptimeMs: number;
  lastHeartbeat: number;
  crashReason?: string;
}

const records = new Map<string, LifecycleRecord>();

export function registerLifecycle(agentId: string): LifecycleRecord {
  const now = Date.now();
  const record: LifecycleRecord = {
    agentId,
    state: "initializing",
    stateHistory: [{ state: "initializing", timestamp: now }],
    healthScore: 1.0,
    tasksCompleted: 0,
    tasksFailed: 0,
    uptimeMs: 0,
    lastHeartbeat: now,
  };
  records.set(agentId, record);
  return record;
}

export function transitionState(agentId: string, newState: LifecycleState, reason?: string): boolean {
  const record = records.get(agentId);
  if (!record) return false;

  const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    initializing: ["ready", "crashed"],
    ready: ["busy", "draining", "crashed"],
    busy: ["ready", "draining", "crashed"],
    draining: ["terminated"],
    terminated: [],
    crashed: [],
  };

  if (!VALID_TRANSITIONS[record.state].includes(newState)) return false;

  record.state = newState;
  record.stateHistory.push({ state: newState, timestamp: Date.now() });
  if (newState === "crashed") record.crashReason = reason;
  return true;
}

export function heartbeat(agentId: string): void {
  const record = records.get(agentId);
  if (!record) return;
  const now = Date.now();
  record.uptimeMs = now - (record.stateHistory[0]?.timestamp ?? now);
  record.lastHeartbeat = now;
}

export function recordTaskOutcome(agentId: string, success: boolean): void {
  const record = records.get(agentId);
  if (!record) return;
  if (success) {
    record.tasksCompleted++;
    record.healthScore = Math.min(1.0, record.healthScore + 0.02);
  } else {
    record.tasksFailed++;
    record.healthScore = Math.max(0, record.healthScore - 0.1);
  }
}

export function getStaleAgents(heartbeatTimeoutMs = 30000): LifecycleRecord[] {
  const now = Date.now();
  return Array.from(records.values()).filter(
    r => r.state === "ready" || r.state === "busy"
      ? now - r.lastHeartbeat > heartbeatTimeoutMs
      : false
  );
}

export function getLifecycleRecord(agentId: string): LifecycleRecord | undefined {
  return records.get(agentId);
}

export function getHealthSummary(): { healthy: number; degraded: number; crashed: number } {
  const all = Array.from(records.values());
  return {
    healthy: all.filter(r => r.healthScore >= 0.7 && r.state !== "crashed" && r.state !== "terminated").length,
    degraded: all.filter(r => r.healthScore < 0.7 && r.state !== "crashed" && r.state !== "terminated").length,
    crashed: all.filter(r => r.state === "crashed").length,
  };
}

export function _resetLifecycleManagerForTest(): void {
  records.clear();
}
