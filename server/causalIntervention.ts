import { loadCausalDAG } from "./causalWorldModel.js";
import { buildDependencyMap } from "./selfRollback.js";
import { ImprovementProposal } from "./selfImprove.js";

export interface InterventionSimulation {
  predictedSuccessProbability: number;
  cascadingFailureRisk: number;
  affectedDownstreamNodes: string[];
  isSafeToProceed: boolean;
}

/**
 * Implements Pearl's do-calculus to simulate the effect of a code change
 * before it is actually applied to the file system.
 */
export function simulateCausalIntervention(proposal: ImprovementProposal): InterventionSimulation {
  const targetFile = proposal.targetFile;
  const dag = loadCausalDAG();
  
  // Get all files that depend on the target file
  const depMap = buildDependencyMap(process.cwd(), targetFile);
  const downstreamFiles: string[] = [];
  
  for (const [file, deps] of Object.entries(depMap)) {
    if (deps.includes(targetFile)) {
      downstreamFiles.push(file);
    }
  }

  // Calculate cascading failure risk based on historical DAG data
  let cascadingFailureRisk = 0;
  let riskFactors = 0;

  for (const dsFile of downstreamFiles) {
    const node = dag.nodes[dsFile];
    if (node && node.probability < 0.5) {
      // If downstream files are historically brittle, changing their dependency is risky
      cascadingFailureRisk += (1 - node.probability);
      riskFactors++;
    }
  }

  if (riskFactors > 0) {
    cascadingFailureRisk = cascadingFailureRisk / riskFactors;
  }

  // Calculate baseline success probability for the target file
  let predictedSuccessProbability = 0.8; // Default optimistic prior
  const targetNode = dag.nodes[targetFile];
  if (targetNode) {
    // Bayesian update based on historical success
    predictedSuccessProbability = targetNode.probability;
  }

  // Combine metrics to determine safety
  // High risk of cascading failure requires higher baseline success probability
  const safetyThreshold = 0.5 + (cascadingFailureRisk * 0.4);
  const isSafeToProceed = predictedSuccessProbability >= safetyThreshold;

  return {
    predictedSuccessProbability,
    cascadingFailureRisk,
    affectedDownstreamNodes: downstreamFiles,
    isSafeToProceed
  };
}
