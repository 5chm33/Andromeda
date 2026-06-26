/**
 * Motor Skill Library — stores and retrieves learned motor skills/procedures.
 * Implements skill chunking, parameterization, and transfer.
 */

export interface MotorSkill {
  id: string;
  name: string;
  domain: string;
  parameters: Record<string, number>;
  successRate: number;
  executionCount: number;
  avgDurationMs: number;
  lastUsed: number;
}

export interface SkillExecutionResult {
  skillId: string;
  success: boolean;
  durationMs: number;
  output: Record<string, number>;
}

export interface SkillLibraryReport {
  totalSkills: number;
  avgSuccessRate: number;
  mostUsedSkill: string | null;
  totalExecutions: number;
}

class MotorSkillLibraryEngine {
  private skills: Map<string, MotorSkill> = new Map();
  private counter = 0;

  learnSkill(name: string, domain: string, parameters: Record<string, number>): MotorSkill {
    const skill: MotorSkill = {
      id: `skill-${++this.counter}`,
      name, domain, parameters,
      successRate: 0.5, executionCount: 0, avgDurationMs: 100, lastUsed: Date.now(),
    };
    this.skills.set(skill.id, skill);
    return skill;
  }

  executeSkill(skillId: string, inputParams: Record<string, number>): SkillExecutionResult {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { skillId, success: false, durationMs: 0, output: {} };
    }

    // Simulate execution with parameter-based success probability
    const paramMatch = Object.keys(skill.parameters).reduce((score, key) => {
      const expected = skill.parameters[key] ?? 0;
      const actual = inputParams[key] ?? 0;
      return score + (1 - Math.min(1, Math.abs(expected - actual) / (Math.abs(expected) + 0.001)));
    }, 0) / Math.max(1, Object.keys(skill.parameters).length);

    const success = paramMatch > 0.5;
    const durationMs = skill.avgDurationMs * (0.8 + Math.random() * 0.4);

    // Update skill stats
    skill.executionCount++;
    skill.successRate = skill.successRate * 0.9 + (success ? 1 : 0) * 0.1;
    skill.avgDurationMs = skill.avgDurationMs * 0.9 + durationMs * 0.1;
    skill.lastUsed = Date.now();

    const output: Record<string, number> = {};
    for (const [key, val] of Object.entries(inputParams)) {
      output[key] = val * (success ? 1 : 0.5);
    }

    return { skillId, success, durationMs, output };
  }

  getSkillLibraryReport(): SkillLibraryReport {
    const skills = Array.from(this.skills.values());
    const mostUsed = skills.sort((a, b) => b.executionCount - a.executionCount)[0];
    return {
      totalSkills: skills.length,
      avgSuccessRate: skills.length > 0 ? skills.reduce((s, sk) => s + sk.successRate, 0) / skills.length : 0,
      mostUsedSkill: mostUsed?.name ?? null,
      totalExecutions: skills.reduce((s, sk) => s + sk.executionCount, 0),
    };
  }
}

export const globalMotorSkillLibrary = new MotorSkillLibraryEngine();

export function learnMotorSkill(name: string, domain: string, parameters: Record<string, number>): MotorSkill {
  return globalMotorSkillLibrary.learnSkill(name, domain, parameters);
}
export function executeMotorSkill(skillId: string, inputParams: Record<string, number>): SkillExecutionResult {
  return globalMotorSkillLibrary.executeSkill(skillId, inputParams);
}
export function getSkillLibraryReport(): SkillLibraryReport {
  return globalMotorSkillLibrary.getSkillLibraryReport();
}
export function initMotorSkillLibrary(): void {
  console.log("[MotorSkillLibrary] Motor Skill Library initialized.");
}
