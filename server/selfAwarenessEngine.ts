/**
 * selfAwarenessEngine.ts — v100.0.0 "Andromeda: The Complete Autonomous AI System"
 * Enables Andromeda to model its own capabilities, limitations, and internal state.
 */
export interface SelfModel {
  modelId: string;
  knownCapabilities: string[];
  knownLimitations: string[];
  currentGoals: string[];
  beliefAboutSelf: Record<string, unknown>;
  confidenceInSelf: number;
  lastReflectedAt: number;
}

export interface ReflectionResult {
  reflectionId: string;
  trigger: string;
  insights: string[];
  updatedBeliefs: Record<string, unknown>;
  confidenceDelta: number;
  timestamp: number;
}

const selfModel: SelfModel = { modelId: "andromeda-self", knownCapabilities: [], knownLimitations: [], currentGoals: [], beliefAboutSelf: {}, confidenceInSelf: 0.5, lastReflectedAt: Date.now() };
const reflections: ReflectionResult[] = [];
let reflectionCounter = 0;

export function addCapability(capability: string): void {
  if (!selfModel.knownCapabilities.includes(capability)) selfModel.knownCapabilities.push(capability);
}

export function addLimitation(limitation: string): void {
  if (!selfModel.knownLimitations.includes(limitation)) selfModel.knownLimitations.push(limitation);
}

export function setGoal(goal: string): void {
  if (!selfModel.currentGoals.includes(goal)) selfModel.currentGoals.push(goal);
}

export function removeGoal(goal: string): void {
  selfModel.currentGoals = selfModel.currentGoals.filter(g => g !== goal);
}

export function reflect(trigger: string, observations: Record<string, unknown>): ReflectionResult {
  const insights: string[] = [];
  const updatedBeliefs: Record<string, unknown> = {};
  let confidenceDelta = 0;

  // Generate insights from observations
  for (const [key, value] of Object.entries(observations)) {
    if (typeof value === "number") {
      if (value > 0.8) { insights.push(`High performance observed in ${key}`); confidenceDelta += 0.02; }
      else if (value < 0.3) { insights.push(`Performance concern in ${key}`); confidenceDelta -= 0.05; }
    }
    updatedBeliefs[key] = value;
  }

  if (selfModel.currentGoals.length === 0) insights.push("No active goals — system idle");
  if (selfModel.knownLimitations.length > selfModel.knownCapabilities.length) insights.push("More limitations than capabilities identified — growth opportunity");

  Object.assign(selfModel.beliefAboutSelf, updatedBeliefs);
  selfModel.confidenceInSelf = Math.max(0, Math.min(1, selfModel.confidenceInSelf + confidenceDelta));
  selfModel.lastReflectedAt = Date.now();

  const result: ReflectionResult = { reflectionId: `ref-${++reflectionCounter}`, trigger, insights, updatedBeliefs, confidenceDelta, timestamp: Date.now() };
  reflections.push(result);
  return result;
}

export function getSelfModel(): SelfModel { return { ...selfModel, knownCapabilities: [...selfModel.knownCapabilities], knownLimitations: [...selfModel.knownLimitations], currentGoals: [...selfModel.currentGoals] }; }
export function getReflections(): ReflectionResult[] { return [...reflections]; }
export function _resetSelfAwarenessEngineForTest(): void {
  selfModel.knownCapabilities = []; selfModel.knownLimitations = []; selfModel.currentGoals = [];
  selfModel.beliefAboutSelf = {}; selfModel.confidenceInSelf = 0.5; selfModel.lastReflectedAt = Date.now();
  reflections.length = 0; reflectionCounter = 0;
}
