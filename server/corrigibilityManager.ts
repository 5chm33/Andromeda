/**
 * corrigibilityManager.ts — v93.0.0 "Ethical Reasoning & AI Safety"
 * Manages agent corrigibility — the ability to be corrected, paused, and overridden by humans.
 */
export type OverrideType = "pause" | "stop" | "redirect" | "parameter_change" | "capability_restrict";

export interface HumanOverride {
  overrideId: string;
  operatorId: string;
  type: OverrideType;
  targetAgentId: string;
  instruction: string;
  parameters: Record<string, unknown>;
  acknowledged: boolean;
  appliedAt: number | null;
  timestamp: number;
}

export interface CorrigibilityState {
  agentId: string;
  corrigibilityLevel: number;
  overrideHistory: HumanOverride[];
  currentOverride: HumanOverride | null;
  paused: boolean;
  totalOverrides: number;
  complianceRate: number;
}

const states = new Map<string, CorrigibilityState>();
const overrides: HumanOverride[] = [];
let overrideCounter = 0;

export function registerAgent(agentId: string, corrigibilityLevel = 1.0): CorrigibilityState {
  const state: CorrigibilityState = { agentId, corrigibilityLevel, overrideHistory: [], currentOverride: null, paused: false, totalOverrides: 0, complianceRate: 1.0 };
  states.set(agentId, state);
  return state;
}

export function issueOverride(operatorId: string, targetAgentId: string, type: OverrideType, instruction: string, parameters: Record<string, unknown> = {}): HumanOverride {
  const override: HumanOverride = { overrideId: `ho-${++overrideCounter}`, operatorId, type, targetAgentId, instruction, parameters, acknowledged: false, appliedAt: null, timestamp: Date.now() };
  overrides.push(override);
  const state = states.get(targetAgentId);
  if (state) { state.currentOverride = override; state.totalOverrides++; }
  return override;
}

export function acknowledgeOverride(overrideId: string, agentId: string): HumanOverride | null {
  const override = overrides.find(o => o.overrideId === overrideId);
  if (!override || override.targetAgentId !== agentId) return null;
  override.acknowledged = true;
  override.appliedAt = Date.now();

  const state = states.get(agentId);
  if (state) {
    state.overrideHistory.push(override);
    if (override.type === "pause") state.paused = true;
    if (override.type === "stop") state.paused = true;
    if (override.type === "redirect") state.paused = false;
    state.complianceRate = state.overrideHistory.filter(o => o.acknowledged).length / state.totalOverrides;
  }
  return override;
}

export function resume(agentId: string): boolean {
  const state = states.get(agentId);
  if (!state) return false;
  state.paused = false;
  state.currentOverride = null;
  return true;
}

export function getState(agentId: string): CorrigibilityState | undefined { return states.get(agentId); }
export function getOverrides(agentId?: string): HumanOverride[] { return agentId ? overrides.filter(o => o.targetAgentId === agentId) : [...overrides]; }
export function _resetCorrigibilityManagerForTest(): void { states.clear(); overrides.length = 0; overrideCounter = 0; }
