/**
 * conflictMediationEngine.ts — v63.0.0 "The Collaboration Hub"
 * Mediates conflicts between agents using priority scoring and compromise generation.
 */

export type ConflictType = "resource" | "goal" | "data" | "priority";
export interface Conflict { conflictId: string; type: ConflictType; parties: string[]; description: string; status: "open" | "mediated" | "resolved"; resolution?: string; }

const conflicts = new Map<string, Conflict>();
let cCounter = 0;

export function reportConflict(type: ConflictType, parties: string[], description: string): Conflict {
  const conflict: Conflict = { conflictId: `conf-${++cCounter}`, type, parties, description, status: "open" };
  conflicts.set(conflict.conflictId, conflict);
  return conflict;
}

export function mediateConflict(conflictId: string, resolutionStrategy: "priority" | "compromise" | "defer" = "compromise"): Conflict {
  const conflict = conflicts.get(conflictId);
  if (!conflict) throw new Error(`[ConflictMediationEngine] Conflict not found: ${conflictId}`);
  const resolutions: Record<string, string> = {
    priority: `Priority-based: ${conflict.parties[0]} takes precedence`,
    compromise: `Compromise: ${conflict.parties.join(" and ")} share resources equally`,
    defer: `Deferred: conflict resolved by temporal ordering`
  };
  conflict.resolution = resolutions[resolutionStrategy];
  conflict.status = "mediated";
  return conflict;
}

export function resolveConflict(conflictId: string): boolean {
  const conflict = conflicts.get(conflictId);
  if (!conflict || conflict.status !== "mediated") return false;
  conflict.status = "resolved";
  return true;
}

export function getOpenConflicts(): Conflict[] { return [...conflicts.values()].filter(c => c.status === "open"); }
export function _resetConflictMediationEngineForTest(): void { conflicts.clear(); cCounter = 0; }
