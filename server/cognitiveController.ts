/**
 * cognitiveController.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Central executive that coordinates memory systems, attention, and decision-making.
 */
export type CognitiveState = "idle" | "perceiving" | "reasoning" | "planning" | "executing" | "reflecting";

export interface CognitiveLoad {
  workingMemoryLoad: number;
  attentionLoad: number;
  processingLoad: number;
  totalLoad: number;
  overloaded: boolean;
}

export interface CognitiveCycle {
  cycleId: string;
  agentId: string;
  state: CognitiveState;
  inputsProcessed: number;
  decisionsReached: number;
  actionsExecuted: number;
  cognitiveLoad: CognitiveLoad;
  cycleTimeMs: number;
  startedAt: number;
  completedAt: number | null;
}

export interface CognitiveArchitecture {
  architectureId: string;
  agentId: string;
  currentState: CognitiveState;
  cycles: CognitiveCycle[];
  totalCycles: number;
  avgCycleTimeMs: number;
  avgCognitiveLoad: number;
  workingMemoryId: string | null;
  attentionControllerId: string | null;
}

const architectures = new Map<string, CognitiveArchitecture>();
let archCounter = 0;
let cycleCounter = 0;

export function createCognitiveArchitecture(agentId: string, workingMemoryId?: string, attentionControllerId?: string): CognitiveArchitecture {
  const arch: CognitiveArchitecture = {
    architectureId: `ca-${++archCounter}`,
    agentId, currentState: "idle",
    cycles: [], totalCycles: 0, avgCycleTimeMs: 0, avgCognitiveLoad: 0,
    workingMemoryId: workingMemoryId ?? null,
    attentionControllerId: attentionControllerId ?? null,
  };
  architectures.set(arch.architectureId, arch);
  return arch;
}

export function startCycle(architectureId: string): CognitiveCycle | null {
  const arch = architectures.get(architectureId);
  if (!arch) return null;
  arch.currentState = "perceiving";
  const cycle: CognitiveCycle = {
    cycleId: `cyc-${++cycleCounter}`,
    agentId: arch.agentId,
    state: "perceiving",
    inputsProcessed: 0, decisionsReached: 0, actionsExecuted: 0,
    cognitiveLoad: { workingMemoryLoad: 0, attentionLoad: 0, processingLoad: 0, totalLoad: 0, overloaded: false },
    cycleTimeMs: 0,
    startedAt: Date.now(), completedAt: null,
  };
  arch.cycles.push(cycle);
  return cycle;
}

export function updateCycleState(architectureId: string, cycleId: string, state: CognitiveState, inputsProcessed: number, decisionsReached: number, actionsExecuted: number, loads: { wm: number; att: number; proc: number }): void {
  const arch = architectures.get(architectureId);
  if (!arch) return;
  const cycle = arch.cycles.find(c => c.cycleId === cycleId);
  if (!cycle) return;
  cycle.state = state;
  arch.currentState = state;
  cycle.inputsProcessed = inputsProcessed;
  cycle.decisionsReached = decisionsReached;
  cycle.actionsExecuted = actionsExecuted;
  const totalLoad = (loads.wm + loads.att + loads.proc) / 3;
  cycle.cognitiveLoad = { workingMemoryLoad: loads.wm, attentionLoad: loads.att, processingLoad: loads.proc, totalLoad, overloaded: totalLoad > 0.85 };
}

export function completeCycle(architectureId: string, cycleId: string): CognitiveCycle | null {
  const arch = architectures.get(architectureId);
  if (!arch) return null;
  const cycle = arch.cycles.find(c => c.cycleId === cycleId);
  if (!cycle) return null;
  cycle.completedAt = Date.now();
  cycle.cycleTimeMs = cycle.completedAt - cycle.startedAt;
  cycle.state = "reflecting";
  arch.currentState = "idle";
  arch.totalCycles++;
  arch.avgCycleTimeMs = arch.cycles.reduce((s, c) => s + c.cycleTimeMs, 0) / arch.cycles.length;
  arch.avgCognitiveLoad = arch.cycles.reduce((s, c) => s + c.cognitiveLoad.totalLoad, 0) / arch.cycles.length;
  return cycle;
}

export function getArchitecture(architectureId: string): CognitiveArchitecture | undefined { return architectures.get(architectureId); }
export function _resetCognitiveControllerForTest(): void { architectures.clear(); archCounter = 0; cycleCounter = 0; }
