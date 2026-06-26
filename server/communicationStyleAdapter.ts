/**
 * communicationStyleAdapter.ts — v60.0.0 "The Communication Layer"
 * Adapts communication style based on audience, channel, and cultural context.
 */

export type Channel = "chat" | "email" | "api" | "voice" | "report";
export interface StyleAdaptation { adaptationId: string; originalText: string; adaptedText: string; channel: Channel; readabilityScore: number; transformations: string[]; }

const adaptations: StyleAdaptation[] = [];
let aCounter = 0;

export function adaptStyle(text: string, channel: Channel, targetReadingLevel: "elementary" | "general" | "professional"): StyleAdaptation {
  const transformations: string[] = [];
  let adapted = text;
  if (channel === "voice") {
    adapted = adapted.replace(/\./g, ",").replace(/\n/g, " ");
    transformations.push("punctuation_for_speech");
  }
  if (channel === "email") {
    adapted = `Dear User,\n\n${adapted}\n\nBest regards,\nAndromeda`;
    transformations.push("email_wrapper");
  }
  if (targetReadingLevel === "elementary") {
    adapted = adapted.replace(/\butilize\b/g, "use").replace(/\bfacilitate\b/g, "help");
    transformations.push("simplified_vocabulary");
  }
  if (channel === "api") {
    adapted = JSON.stringify({ message: adapted });
    transformations.push("json_serialization");
  }
  const wordCount = text.split(/\s+/).length;
  const readabilityScore = Math.max(0, Math.min(100, 100 - wordCount * 0.5));
  const adaptation: StyleAdaptation = { adaptationId: `adp-${++aCounter}`, originalText: text, adaptedText: adapted, channel, readabilityScore, transformations };
  adaptations.push(adaptation);
  return adaptation;
}

export function getAdaptations(): StyleAdaptation[] { return [...adaptations]; }
export function _resetCommunicationStyleAdapterForTest(): void { adaptations.length = 0; aCounter = 0; }
