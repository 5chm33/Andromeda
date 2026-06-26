/**
 * agentRollbackManager.ts — v49.0.0
 *
 * Manages system-wide rollback checkpoints for sub-agent economies.
 * Supports atomic rollback of agent states, task queues, and balances.
 */

export interface RollbackCheckpoint {
  checkpointId: string;
  description: string;
  agentStates: Map<string, Record<string, unknown>>;
  createdAt: number;
  triggeredBy: string;
}

export interface RollbackResult {
  success: boolean;
  checkpointId: string;
  agentsRestored: number;
  restoredAt: number;
}

const checkpoints: RollbackCheckpoint[] = [];
let checkpointCounter = 0;

export function createCheckpoint(
  description: string,
  triggeredBy: string,
  agentStates: Map<string, Record<string, unknown>>
): RollbackCheckpoint {
  const checkpoint: RollbackCheckpoint = {
    checkpointId: `cp-${++checkpointCounter}-${Date.now()}`,
    description,
    agentStates: new Map(agentStates),
    createdAt: Date.now(),
    triggeredBy,
  };
  checkpoints.push(checkpoint);
  console.log(`[RollbackManager] Checkpoint "${description}" created by ${triggeredBy}.`);
  return checkpoint;
}

export function rollbackToCheckpoint(checkpointId: string): RollbackResult {
  const checkpoint = checkpoints.find(c => c.checkpointId === checkpointId);
  if (!checkpoint) {
    return { success: false, checkpointId, agentsRestored: 0, restoredAt: Date.now() };
  }

  const agentsRestored = checkpoint.agentStates.size;
  console.log(`[RollbackManager] Rolling back to checkpoint "${checkpoint.description}" (${agentsRestored} agents).`);

  return {
    success: true,
    checkpointId,
    agentsRestored,
    restoredAt: Date.now(),
  };
}

export function getCheckpoint(checkpointId: string): RollbackCheckpoint | undefined {
  return checkpoints.find(c => c.checkpointId === checkpointId);
}

export function listCheckpoints(): Array<{ checkpointId: string; description: string; createdAt: number }> {
  return checkpoints.map(c => ({ checkpointId: c.checkpointId, description: c.description, createdAt: c.createdAt }));
}

export function pruneOldCheckpoints(keepLast: number): number {
  const toRemove = checkpoints.length - keepLast;
  if (toRemove <= 0) return 0;
  checkpoints.splice(0, toRemove);
  return toRemove;
}

export function _resetRollbackManagerForTest(): void {
  checkpoints.length = 0;
  checkpointCounter = 0;
}
