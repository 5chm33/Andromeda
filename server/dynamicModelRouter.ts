/**
 * dynamicModelRouter.ts — v20.0.0
 * 
 * Dynamic Model Routing (DMR).
 * Uses a heuristic/embedding-based classifier to route tasks to the optimal model
 * based on complexity, saving API credits and time on simple tasks.
 */

import { getActiveModel, getApiKey } from "./aiTokens.js";

export type ModelTier = "cheap" | "expensive";

export interface RoutingDecision {
  tier: ModelTier;
  confidence: number;
  reason: string;
}

/**
 * Classifies the complexity of a task based on the prompt and target file content.
 * Returns a routing decision.
 */
export function classifyTaskComplexity(
  intent: string, 
  fileContext: string
): RoutingDecision {
  // Heuristic-based classification for the daemon
  // In a full implementation, this would use a local embedding model like all-MiniLM-L6-v2
  
  const complexityScore = calculateComplexityScore(intent, fileContext);
  
  if (complexityScore > 0.7) {
    return {
      tier: "expensive",
      confidence: complexityScore,
      reason: "High cyclomatic complexity or architectural change detected."
    };
  } else {
    return {
      tier: "cheap",
      confidence: 1 - complexityScore,
      reason: "Simple syntax fix, typo, or isolated change."
    };
  }
}

function calculateComplexityScore(intent: string, fileContext: string): number {
  let score = 0.0;
  
  const intentLower = intent.toLowerCase();
  if (intentLower.includes("architecture") || intentLower.includes("refactor") || intentLower.includes("design")) {
    score += 0.4;
  }
  
  if (intentLower.includes("typo") || intentLower.includes("lint") || intentLower.includes("format")) {
    score -= 0.3;
  }
  
  const fileLength = fileContext.split("\n").length;
  if (fileLength > 500) score += 0.3;
  if (fileLength > 1000) score += 0.2;
  
  const branchCount = (fileContext.match(/if\s*\(|for\s*\(|while\s*\(|switch\s*\(/g) || []).length;
  if (branchCount > 20) score += 0.2;
  if (branchCount > 50) score += 0.2;
  
  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Returns the model string to use based on the tier.
 * (Mocked mapping: in reality this would map to actual provider models)
 */
export function getModelForTier(tier: ModelTier): string {
  const defaultModel = getActiveModel();
  
  if (tier === "cheap") {
    // Map to a faster/cheaper model if possible, e.g., claude-3-haiku or gpt-4o-mini
    if (defaultModel.includes("claude-3-opus")) return "claude-3-haiku-20240307";
    if (defaultModel.includes("gpt-4")) return "gpt-4o-mini";
    return defaultModel; // Fallback
  }
  
  // Expensive tier uses the default frontier model
  return defaultModel;
}
