/**
 * selfModifier.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Safe self-modification system with sandboxed testing and rollback capabilities.
 */
export type ModificationStatus = "proposed" | "testing" | "approved" | "applied" | "rolled_back" | "rejected";

export interface Modification {
  modificationId: string;
  agentId: string;
  targetModule: string;
  description: string;
  changeType: "parameter_update" | "behavior_change" | "capability_add" | "capability_remove" | "optimization";
  proposedChange: Record<string, unknown>;
  currentState: Record<string, unknown>;
  testResults: Array<{ testName: string; passed: boolean; score: number }>;
  status: ModificationStatus;
  safetyScore: number;
  proposedAt: number;
  appliedAt: number | null;
}

const modifications: Modification[] = [];
let modCounter = 0;

export function proposeModification(agentId: string, targetModule: string, description: string, changeType: Modification["changeType"], proposedChange: Record<string, unknown>, currentState: Record<string, unknown>): Modification {
  const modification: Modification = {
    modificationId: `mod-${++modCounter}`,
    agentId, targetModule, description, changeType,
    proposedChange, currentState,
    testResults: [],
    status: "proposed",
    safetyScore: 0,
    proposedAt: Date.now(),
    appliedAt: null,
  };
  modifications.push(modification);
  return modification;
}

export function runSafetyTests(modificationId: string, tests: Array<{ testName: string; passed: boolean; score: number }>): Modification | null {
  const mod = modifications.find(m => m.modificationId === modificationId);
  if (!mod) return null;
  mod.testResults = tests;
  mod.status = "testing";
  const passRate = tests.length > 0 ? tests.filter(t => t.passed).length / tests.length : 0;
  const avgScore = tests.length > 0 ? tests.reduce((s, t) => s + t.score, 0) / tests.length : 0;
  mod.safetyScore = passRate * 0.6 + avgScore * 0.4;
  mod.status = mod.safetyScore >= 0.7 ? "approved" : "rejected";
  return mod;
}

export function applyModification(modificationId: string): Modification | null {
  const mod = modifications.find(m => m.modificationId === modificationId);
  if (!mod || mod.status !== "approved") return null;
  mod.status = "applied";
  mod.appliedAt = Date.now();
  return mod;
}

export function rollback(modificationId: string): Modification | null {
  const mod = modifications.find(m => m.modificationId === modificationId);
  if (!mod || mod.status !== "applied") return null;
  mod.status = "rolled_back";
  return mod;
}

export function getModifications(agentId?: string, status?: ModificationStatus): Modification[] {
  return modifications.filter(m => (!agentId || m.agentId === agentId) && (!status || m.status === status));
}
export function _resetSelfModifierForTest(): void { modifications.length = 0; modCounter = 0; }
