/**
 * intentionalityEngine.ts — v65.0.0 "The Apex Consciousness"
 * Models intentional states: beliefs, desires, and intentions with goal-directed reasoning.
 */

export type IntentionalStateType = "belief" | "desire" | "intention" | "expectation";
export interface IntentionalState { stateId: string; type: IntentionalStateType; content: string; strength: number; relatedGoal?: string; timestamp: number; }
export interface IntentionPlan { planId: string; goal: string; steps: string[]; confidence: number; estimatedSteps: number; }

const states: IntentionalState[] = [];
const plans: IntentionPlan[] = [];
let sCounter = 0, pCounter = 0;

export function addIntentionalState(type: IntentionalStateType, content: string, strength: number, relatedGoal?: string): IntentionalState {
  const state: IntentionalState = { stateId: `is-${++sCounter}`, type, content, strength: Math.max(0, Math.min(1, strength)), relatedGoal, timestamp: Date.now() };
  states.push(state);
  return state;
}

export function formIntention(goal: string): IntentionPlan {
  const relevantBeliefs = states.filter(s => s.type === "belief" && s.strength > 0.5);
  const relevantDesires = states.filter(s => s.type === "desire" && s.relatedGoal === goal);
  const steps: string[] = [];
  if (relevantBeliefs.length > 0) steps.push(`Leverage ${relevantBeliefs.length} active beliefs`);
  steps.push(`Analyze goal: ${goal}`);
  steps.push("Decompose into sub-goals");
  steps.push("Allocate resources");
  steps.push("Execute and monitor");
  const confidence = Math.min(0.95, 0.5 + relevantDesires.length * 0.1 + relevantBeliefs.length * 0.05);
  const plan: IntentionPlan = { planId: `plan-${++pCounter}`, goal, steps, confidence, estimatedSteps: steps.length };
  plans.push(plan);
  return plan;
}

export function getIntentionalStates(type?: IntentionalStateType): IntentionalState[] {
  return type ? states.filter(s => s.type === type) : [...states];
}

export function _resetIntentionalityEngineForTest(): void { states.length = 0; plans.length = 0; sCounter = 0; pCounter = 0; }
