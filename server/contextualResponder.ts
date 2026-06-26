/**
 * contextualResponder.ts — v60.0.0 "The Communication Layer"
 * Generates contextually appropriate responses based on dialogue history and user profile.
 */

export interface UserProfile { userId: string; preferredStyle: "formal" | "casual" | "technical"; expertiseLevel: "novice" | "intermediate" | "expert"; }
export interface ContextualResponse { responseId: string; text: string; confidence: number; adaptedToProfile: boolean; }

const profiles = new Map<string, UserProfile>();
const responses: ContextualResponse[] = [];
let rCounter = 0;

export function registerProfile(profile: UserProfile): void { profiles.set(profile.userId, profile); }

export function generateContextualResponse(userId: string, intent: string, context: string[]): ContextualResponse {
  const profile = profiles.get(userId);
  const style = profile?.preferredStyle ?? "formal";
  const expertise = profile?.expertiseLevel ?? "intermediate";
  const prefix = style === "casual" ? "Hey! " : style === "technical" ? "Processing: " : "Understood. ";
  const suffix = expertise === "novice" ? " Let me know if you need clarification." : expertise === "expert" ? " See technical details above." : "";
  const text = `${prefix}Responding to "${intent}" with ${context.length} context items.${suffix}`;
  const response: ContextualResponse = { responseId: `resp-${++rCounter}`, text, confidence: 0.85, adaptedToProfile: !!profile };
  responses.push(response);
  return response;
}

export function _resetContextualResponderForTest(): void { profiles.clear(); responses.length = 0; rCounter = 0; }
