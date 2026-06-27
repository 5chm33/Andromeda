/**
 * proceduralMemory.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Procedural memory storing skills, habits, and action sequences as compiled routines.
 */
export type SkillStatus = "novice" | "intermediate" | "proficient" | "expert" | "automatic";

export interface ActionStep {
  stepId: string;
  action: string;
  parameters: Record<string, unknown>;
  expectedOutcome: string;
  order: number;
}

export interface Skill {
  skillId: string;
  name: string;
  domain: string;
  steps: ActionStep[];
  executionCount: number;
  successCount: number;
  avgExecutionTimeMs: number;
  status: SkillStatus;
  lastExecutedAt: number | null;
}

const skills = new Map<string, Skill>();
let skillCounter = 0;
let stepCounter = 0;

function computeStatus(executionCount: number, successRate: number): SkillStatus {
  if (executionCount < 5) return "novice";
  if (executionCount < 20 && successRate > 0.5) return "intermediate";
  if (executionCount < 50 && successRate > 0.7) return "proficient";
  if (executionCount < 100 && successRate > 0.85) return "expert";
  if (executionCount >= 100 && successRate > 0.95) return "automatic";
  return "intermediate";
}

export function defineSkill(name: string, domain: string, steps: Array<{ action: string; parameters: Record<string, unknown>; expectedOutcome: string }>): Skill {
  const actionSteps: ActionStep[] = steps.map((s, i) => ({ stepId: `step-${++stepCounter}`, ...s, order: i }));
  const skill: Skill = { skillId: `sk-${++skillCounter}`, name, domain, steps: actionSteps, executionCount: 0, successCount: 0, avgExecutionTimeMs: 0, status: "novice", lastExecutedAt: null };
  skills.set(skill.skillId, skill);
  return skill;
}

export function executeSkill(skillId: string, success: boolean, executionTimeMs: number): Skill | null {
  const skill = skills.get(skillId);
  if (!skill) return null;
  skill.executionCount++;
  if (success) skill.successCount++;
  skill.avgExecutionTimeMs = (skill.avgExecutionTimeMs * (skill.executionCount - 1) + executionTimeMs) / skill.executionCount;
  skill.lastExecutedAt = Date.now();
  skill.status = computeStatus(skill.executionCount, skill.executionCount > 0 ? skill.successCount / skill.executionCount : 0);
  return skill;
}

export function getSkillsByDomain(domain: string): Skill[] { return [...skills.values()].filter(s => s.domain === domain); }
export function getSkillsByStatus(status: SkillStatus): Skill[] { return [...skills.values()].filter(s => s.status === status); }
export function getSkill(skillId: string): Skill | undefined { return skills.get(skillId); }
export function getSuccessRate(skillId: string): number { const s = skills.get(skillId); return s && s.executionCount > 0 ? s.successCount / s.executionCount : 0; }
export function _resetProceduralMemoryForTest(): void { skills.clear(); skillCounter = 0; stepCounter = 0; }
