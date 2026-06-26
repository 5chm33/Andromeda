export type ModelTier = "local" | "mini" | "standard" | "frontier";

export interface TaskComplexity {
  tier: ModelTier;
  reason: string;
}

/**
 * Routes tasks to the cheapest capable model based on task characteristics.
 */
export function routePrompt(prompt: string, contextLength: number): TaskComplexity {
  const promptLower = prompt.toLowerCase();
  
  // Local tier: Documentation, comments, simple formatting
  if (promptLower.includes("jsdoc") || promptLower.includes("changelog") || promptLower.includes("format")) {
    return { tier: "local", reason: "Documentation/formatting task" };
  }
  
  // Mini tier: Syntax fixes, typos, linting, simple refactors
  if (promptLower.includes("syntax") || promptLower.includes("typo") || promptLower.includes("lint") || contextLength < 1000) {
    return { tier: "mini", reason: "Syntax fix or small context" };
  }
  
  // Frontier tier: Architecture, complex bugs, large context
  if (promptLower.includes("architecture") || promptLower.includes("design pattern") || contextLength > 15000) {
    return { tier: "frontier", reason: "Architectural change or massive context" };
  }
  
  // Standard tier: Everything else
  return { tier: "standard", reason: "Standard complexity" };
}

/**
 * Returns the actual model name for a given tier.
 */
export function getModelForTier(tier: ModelTier): string {
  switch (tier) {
    case "local": return "llama-3.1-8b";
    case "mini": return "gpt-4o-mini";
    case "frontier": return "o1-preview";
    case "standard":
    default:
      return "gpt-4o";
  }
}
