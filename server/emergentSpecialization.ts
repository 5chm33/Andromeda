import fs from "fs";
import path from "path";

const SPECIALIZATION_DB = path.join(process.cwd(), "data", "specializations.json");

export type SpecializationRole = "generalist" | "security_expert" | "performance_optimizer" | "api_designer";

export interface SpecializationProfile {
  role: SpecializationRole;
  competenceScore: number;
  successfulProposals: number;
  totalProposals: number;
}

function loadSpecializations(): Record<SpecializationRole, SpecializationProfile> {
  if (fs.existsSync(SPECIALIZATION_DB)) {
    try {
      return JSON.parse(fs.readFileSync(SPECIALIZATION_DB, "utf-8"));
    } catch {
      return initDefaultSpecializations();
    }
  }
  return initDefaultSpecializations();
}

function saveSpecializations(profiles: Record<SpecializationRole, SpecializationProfile>) {
  const dir = path.dirname(SPECIALIZATION_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SPECIALIZATION_DB, JSON.stringify(profiles, null, 2));
}

function initDefaultSpecializations(): Record<SpecializationRole, SpecializationProfile> {
  return {
    generalist: { role: "generalist", competenceScore: 0.5, successfulProposals: 0, totalProposals: 0 },
    security_expert: { role: "security_expert", competenceScore: 0.1, successfulProposals: 0, totalProposals: 0 },
    performance_optimizer: { role: "performance_optimizer", competenceScore: 0.1, successfulProposals: 0, totalProposals: 0 },
    api_designer: { role: "api_designer", competenceScore: 0.1, successfulProposals: 0, totalProposals: 0 }
  };
}

/**
 * Discovers the active specialization for the current instance based on its historical performance.
 * The instance will adopt the role where it has the highest competence score.
 */
export function discoverActiveSpecialization(): SpecializationRole {
  const profiles = loadSpecializations();
  let bestRole: SpecializationRole = "generalist";
  let maxScore = -1;
  
  for (const [role, profile] of Object.entries(profiles)) {
    if (profile.competenceScore > maxScore) {
      maxScore = profile.competenceScore;
      bestRole = role as SpecializationRole;
    }
  }
  
  return bestRole;
}

/**
 * Records the outcome of a proposal for a specific role, updating its competence score.
 * Uses a Bayesian-inspired update for the competence score.
 */
export function recordSpecializationOutcome(role: SpecializationRole, success: boolean) {
  const profiles = loadSpecializations();
  const profile = profiles[role];
  
  profile.totalProposals += 1;
  if (success) {
    profile.successfulProposals += 1;
  }
  
  // Update competence score (simple moving average for now, could be Beta distribution)
  // Give more weight to recent successes, but keep it bounded [0, 1]
  const alpha = 0.1; // learning rate
  const reward = success ? 1.0 : 0.0;
  profile.competenceScore = (1 - alpha) * profile.competenceScore + alpha * reward;
  
  saveSpecializations(profiles);
  console.log(`[Specialization] Updated ${role} competence to ${profile.competenceScore.toFixed(3)}`);
}

/**
 * Returns the specialized system prompt for the active role.
 */
export function getSpecializedPrompt(role: SpecializationRole): string {
  switch (role) {
    case "security_expert":
      return "You are a senior security researcher. Focus on identifying and mitigating vulnerabilities, ensuring strict input validation, and preventing common attack vectors (XSS, SQLi, CSRF).";
    case "performance_optimizer":
      return "You are a performance optimization expert. Focus on reducing time complexity, minimizing memory allocations, eliminating redundant operations, and improving cache locality.";
    case "api_designer":
      return "You are a senior API architect. Focus on designing clean, orthogonal, and highly usable interfaces with consistent naming conventions and robust error handling.";
    case "generalist":
    default:
      return "You are an expert software engineer. Focus on writing clean, correct, and maintainable code.";
  }
}
