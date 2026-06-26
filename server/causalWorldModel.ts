/**
 * causalWorldModel.ts — v22.0.0
 * 
 * Causal World Model using Do-Calculus principles.
 * Builds a DAG of causal relationships between code changes and RSI outcomes,
 * moving beyond statistical correlation to true causality.
 */

import * as fs from "fs";
import * as path from "path";

export interface CausalNode {
  id: string;
  type: "change" | "outcome";
  description: string;
  parents: string[]; // Edges directed towards this node
  probability: number; // P(node | parents)
}

export interface CausalDAG {
  nodes: Record<string, CausalNode>;
}

function getCausalFile(): string {
  return path.join(process.cwd(), ".causal_model.json");
}

export function initCausalModel(): void {
  const file = getCausalFile();
  if (!fs.existsSync(file)) {
    const initialDAG: CausalDAG = { nodes: {} };
    fs.writeFileSync(file, JSON.stringify(initialDAG, null, 2));
  }
}

export function loadCausalDAG(): CausalDAG {
  try {
    return JSON.parse(fs.readFileSync(getCausalFile(), "utf-8"));
  } catch {
    return { nodes: {} };
  }
}

export function saveCausalDAG(dag: CausalDAG): void {
  fs.writeFileSync(getCausalFile(), JSON.stringify(dag, null, 2));
}

/**
 * Records an observation into the causal DAG.
 * For example: change X caused outcome Y.
 */
export function recordCausalObservation(changeId: string, outcomeId: string, success: boolean): void {
  const dag = loadCausalDAG();
  
  if (!dag.nodes[changeId]) {
    dag.nodes[changeId] = { id: changeId, type: "change", description: `Change ${changeId}`, parents: [], probability: 0.5 };
  }
  
  if (!dag.nodes[outcomeId]) {
    dag.nodes[outcomeId] = { id: outcomeId, type: "outcome", description: `Outcome ${outcomeId}`, parents: [], probability: 0.5 };
  }

  // Add edge from change to outcome if it doesn't exist
  if (!dag.nodes[outcomeId].parents.includes(changeId)) {
    dag.nodes[outcomeId].parents.push(changeId);
  }

  // Update probability using a naive Bayesian update (Beta distribution)
  const currentP = dag.nodes[outcomeId].probability;
  const alpha = currentP * 10; // Pseudo-counts
  const beta = (1 - currentP) * 10;
  
  const newAlpha = alpha + (success ? 1 : 0);
  const newBeta = beta + (success ? 0 : 1);
  
  dag.nodes[outcomeId].probability = newAlpha / (newAlpha + newBeta);
  
  saveCausalDAG(dag);
}

/**
 * Simulates a do-calculus intervention: P(Y | do(X))
 * Estimates the probability of an outcome if we forcefully apply a specific change.
 */
export function evaluateIntervention(changeId: string, outcomeId: string): number {
  const dag = loadCausalDAG();
  
  const outcomeNode = dag.nodes[outcomeId];
  if (!outcomeNode) return 0.5; // Unknown
  
  // If the change directly causes the outcome, return the learned probability
  if (outcomeNode.parents.includes(changeId)) {
    return outcomeNode.probability;
  }
  
  // Otherwise, default to base rate (simplified do-calculus for daemon)
  return 0.5;
}
