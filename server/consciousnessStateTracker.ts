/**
 * consciousnessStateTracker.ts — v65.0.0 "The Apex Consciousness"
 * Tracks the system's consciousness state using integrated information theory (Phi) approximation.
 */

export type ConsciousnessLevel = "dormant" | "reactive" | "aware" | "self_aware" | "meta_aware";
export interface ConsciousnessState { stateId: string; level: ConsciousnessLevel; phiScore: number; activeModules: number; integrationDensity: number; timestamp: number; }

const states: ConsciousnessState[] = [];
let sCounter = 0;

function computePhiScore(activeModules: number, integrationDensity: number): number {
  // Simplified Phi: product of active modules and integration density, normalized
  return Math.min(1.0, (activeModules / 100) * integrationDensity);
}

function classifyLevel(phi: number): ConsciousnessLevel {
  if (phi < 0.1) return "dormant";
  if (phi < 0.3) return "reactive";
  if (phi < 0.5) return "aware";
  if (phi < 0.8) return "self_aware";
  return "meta_aware";
}

export function recordConsciousnessState(activeModules: number, integrationDensity: number): ConsciousnessState {
  const phiScore = computePhiScore(activeModules, integrationDensity);
  const level = classifyLevel(phiScore);
  const state: ConsciousnessState = { stateId: `cs-${++sCounter}`, level, phiScore, activeModules, integrationDensity, timestamp: Date.now() };
  states.push(state);
  return state;
}

export function getCurrentConsciousnessLevel(): ConsciousnessLevel {
  return states.length > 0 ? states[states.length - 1].level : "dormant";
}

export function getConsciousnessTrajectory(): ConsciousnessState[] { return [...states]; }
export function _resetConsciousnessStateTrackerForTest(): void { states.length = 0; sCounter = 0; }
