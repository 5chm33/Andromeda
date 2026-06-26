/**
 * agentSpecializationEngine.ts — v50.0.0
 *
 * Tracks agent skill development over time and recommends specialization
 * paths based on performance history and economy demand signals.
 */

export interface SkillProfile {
  agentId: string;
  skills: Map<string, SkillLevel>;
  specialization?: string;
  generalistScore: number;  // 0.0–1.0 (breadth)
  specialistScore: number;  // 0.0–1.0 (depth in top skill)
}

export interface SkillLevel {
  name: string;
  level: number;       // 0.0–1.0
  taskCount: number;
  successRate: number;
  lastUsed: number;
}

export interface SpecializationRecommendation {
  agentId: string;
  recommendedPath: string;
  confidence: number;
  reasoning: string;
}

const profiles = new Map<string, SkillProfile>();

export function registerAgent(agentId: string): SkillProfile {
  const profile: SkillProfile = {
    agentId,
    skills: new Map(),
    generalistScore: 0,
    specialistScore: 0,
  };
  profiles.set(agentId, profile);
  return profile;
}

export function recordSkillUsage(agentId: string, skill: string, success: boolean): void {
  let profile = profiles.get(agentId);
  if (!profile) profile = registerAgent(agentId);

  const existing = profile.skills.get(skill);
  if (existing) {
    existing.taskCount++;
    existing.successRate = (existing.successRate * (existing.taskCount - 1) + (success ? 1 : 0)) / existing.taskCount;
    existing.level = Math.min(1.0, existing.level + (success ? 0.02 : -0.01));
    existing.lastUsed = Date.now();
  } else {
    profile.skills.set(skill, {
      name: skill,
      level: success ? 0.1 : 0.0,
      taskCount: 1,
      successRate: success ? 1.0 : 0.0,
      lastUsed: Date.now(),
    });
  }

  // Recompute scores
  const allSkills = Array.from(profile.skills.values());
  profile.generalistScore = allSkills.length > 0 ? Math.min(1.0, allSkills.length / 10) : 0;
  const topSkill = allSkills.reduce((best, s) => s.level > best.level ? s : best, { level: 0 } as SkillLevel);
  profile.specialistScore = topSkill.level ?? 0;
}

export function recommendSpecialization(agentId: string, demandSignals: Map<string, number>): SpecializationRecommendation {
  const profile = profiles.get(agentId);
  if (!profile) {
    return { agentId, recommendedPath: "generalist", confidence: 0.5, reasoning: "No skill data yet." };
  }

  const allSkills = Array.from(profile.skills.values());
  if (allSkills.length === 0) {
    return { agentId, recommendedPath: "generalist", confidence: 0.5, reasoning: "No skills recorded." };
  }

  // Score each skill by level × demand
  let bestSkill = "";
  let bestScore = 0;
  for (const skill of allSkills) {
    const demand = demandSignals.get(skill.name) ?? 0.5;
    const score = skill.level * skill.successRate * demand;
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill.name;
    }
  }

  const confidence = Math.min(1.0, bestScore * 2);
  return {
    agentId,
    recommendedPath: bestSkill || "generalist",
    confidence,
    reasoning: `Top skill "${bestSkill}" with level ${(profile.skills.get(bestSkill)?.level ?? 0).toFixed(2)} and demand score ${(demandSignals.get(bestSkill) ?? 0.5).toFixed(2)}.`,
  };
}

export function getProfile(agentId: string): SkillProfile | undefined {
  return profiles.get(agentId);
}

export function _resetSpecializationEngineForTest(): void {
  profiles.clear();
}
