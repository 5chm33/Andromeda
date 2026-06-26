/**
 * agentVersionControl.ts — v48.0.0
 *
 * Tracks versioned snapshots of agent state and capability sets,
 * enabling rollback, diff, and evolution tracking.
 */

export interface AgentSnapshot {
  snapshotId: string;
  agentId: string;
  version: number;
  capabilities: string[];
  configHash: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

const snapshots = new Map<string, AgentSnapshot[]>(); // agentId → snapshots
let snapshotCounter = 0;

export function createSnapshot(
  agentId: string,
  capabilities: string[],
  metadata: Record<string, unknown> = {}
): AgentSnapshot {
  const existing = snapshots.get(agentId) ?? [];
  const version = existing.length + 1;
  const configHash = Buffer.from(JSON.stringify({ capabilities, metadata })).toString("base64").slice(0, 16);

  const snapshot: AgentSnapshot = {
    snapshotId: `snap-${++snapshotCounter}-${Date.now()}`,
    agentId,
    version,
    capabilities: [...capabilities],
    configHash,
    metadata: { ...metadata },
    createdAt: Date.now(),
  };

  existing.push(snapshot);
  snapshots.set(agentId, existing);
  return snapshot;
}

export function rollback(agentId: string, targetVersion: number): AgentSnapshot | null {
  const history = snapshots.get(agentId);
  if (!history) return null;
  const target = history.find(s => s.version === targetVersion);
  if (!target) return null;
  // Create a new snapshot from the rolled-back state
  return createSnapshot(agentId, target.capabilities, { ...target.metadata, rolledBackFrom: history.length });
}

export function diffSnapshots(agentId: string, v1: number, v2: number): {
  added: string[];
  removed: string[];
  unchanged: string[];
} | null {
  const history = snapshots.get(agentId);
  if (!history) return null;
  const snap1 = history.find(s => s.version === v1);
  const snap2 = history.find(s => s.version === v2);
  if (!snap1 || !snap2) return null;

  const set1 = new Set(snap1.capabilities);
  const set2 = new Set(snap2.capabilities);

  return {
    added: snap2.capabilities.filter(c => !set1.has(c)),
    removed: snap1.capabilities.filter(c => !set2.has(c)),
    unchanged: snap1.capabilities.filter(c => set2.has(c)),
  };
}

export function getHistory(agentId: string): AgentSnapshot[] {
  return snapshots.get(agentId) ?? [];
}

export function getLatestSnapshot(agentId: string): AgentSnapshot | null {
  const history = snapshots.get(agentId);
  if (!history || history.length === 0) return null;
  return history[history.length - 1];
}

export function _resetVersionControlForTest(): void {
  snapshots.clear();
  snapshotCounter = 0;
}
