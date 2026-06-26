/**
 * ntdlMemory.ts — v22.0.0
 * 
 * Neuromorphic Temporal Difference Learning (NTDL).
 * Implements TD(λ) learning over the proposal history to learn from the sequence
 * of improvement steps, enabling multi-step planning.
 */

import * as fs from "fs";
import * as path from "path";

export interface StateValue {
  stateHash: string; // Hash of the file or codebase subset
  value: number;     // Expected future reward from this state
}

function getNtdlFile(): string {
  return path.join(process.cwd(), ".ntdl_values.json");
}

// Hyperparameters for TD(λ)
const ALPHA = 0.1;   // Learning rate
const GAMMA = 0.9;   // Discount factor
const LAMBDA = 0.8;  // Trace decay parameter

export function initNtdlMemory(): void {
  const file = getNtdlFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ values: {}, traces: {} }, null, 2));
  }
}

function loadNtdlData(): { values: Record<string, number>, traces: Record<string, number> } {
  try {
    return JSON.parse(fs.readFileSync(getNtdlFile(), "utf-8"));
  } catch {
    return { values: {}, traces: {} };
  }
}

function saveNtdlData(data: any): void {
  fs.writeFileSync(getNtdlFile(), JSON.stringify(data, null, 2));
}

/**
 * Generates a simple hash for a state (e.g., file content).
 */
export function hashState(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `state_${Math.abs(hash)}`;
}

/**
 * Updates the TD(λ) values based on a transition from state S to S' with reward R.
 */
export function updateTdLambda(prevStateHash: string, nextStateHash: string, reward: number): void {
  const data = loadNtdlData();
  
  const vS = data.values[prevStateHash] || 0;
  const vSNext = data.values[nextStateHash] || 0;
  
  // TD Error: δ = R + γ * V(S') - V(S)
  const delta = reward + GAMMA * vSNext - vS;
  
  // Update eligibility trace for the visited state
  data.traces[prevStateHash] = (data.traces[prevStateHash] || 0) + 1;
  
  // Update all values and decay traces
  for (const state in data.traces) {
    const trace = data.traces[state];
    if (trace > 0.01) { // Optimization: only update if trace is significant
      data.values[state] = (data.values[state] || 0) + ALPHA * delta * trace;
      data.traces[state] = trace * GAMMA * LAMBDA;
    } else {
      delete data.traces[state]; // Prune negligible traces
    }
  }
  
  saveNtdlData(data);
}

/**
 * Predicts the expected future reward from a given state.
 */
export function predictStateValue(stateHash: string): number {
  const data = loadNtdlData();
  return data.values[stateHash] || 0;
}
