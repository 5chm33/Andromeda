/**
 * rewardModel.ts — Bradley-Terry Reward Model (v10.7.0)
 * Trains a preference model on RLHF pairs to score RSI proposals.
 */
import fs from "fs";
import path from "path";

export interface RewardFeatures {
  complexityDelta: number;
  testCoverageDelta: number;
  docDensity: number;
  avgFunctionLength: number;
  typeAnnotationRatio: number;
  errorHandlingDensity: number;
  linesAdded: number;
  linesRemoved: number;
  netChange: number;
}

export interface RewardModelWeights {
  complexityDelta: number;
  testCoverageDelta: number;
  docDensity: number;
  avgFunctionLength: number;
  typeAnnotationRatio: number;
  errorHandlingDensity: number;
  netChange: number;
  bias: number;
}

export interface RewardModelState {
  weights: RewardModelWeights;
  trainedOn: number;
  lastTrainedAt: number;
  version: number;
  trainLoss: number;
  evalAccuracy: number;
  trainingPairs?: number; // v11.9.1: number of DPO pairs used in last training run
}

const MODEL_STATE_PATH = path.join(process.cwd(), ".andromeda", "reward_model_weights.json");

const DEFAULT_WEIGHTS: RewardModelWeights = {
  complexityDelta: -0.8,
  testCoverageDelta: 1.2,
  docDensity: 0.4,
  avgFunctionLength: -0.3,
  typeAnnotationRatio: 0.6,
  errorHandlingDensity: 0.5,
  netChange: -0.1,
  bias: 0.0,
};

let modelState: RewardModelState = {
  weights: { ...DEFAULT_WEIGHTS },
  trainedOn: 0,
  lastTrainedAt: 0,
  version: 0,
  trainLoss: 1.0,
  evalAccuracy: 0.5,
};

if (fs.existsSync(MODEL_STATE_PATH)) {
  try {
    const saved = JSON.parse(fs.readFileSync(MODEL_STATE_PATH, "utf-8"));
    modelState = { ...modelState, ...saved };
  } catch { /* use defaults */ }
}

export function extractFeatures(diff: string): RewardFeatures {
  const lines = diff.split("\n");
  const addedLines = lines.filter(l => l.startsWith("+") && !l.startsWith("+++"));
  const removedLines = lines.filter(l => l.startsWith("-") && !l.startsWith("---"));
  const addedCode = addedLines.map(l => l.slice(1)).join("\n");
  const removedCode = removedLines.map(l => l.slice(1)).join("\n");

  const complexityKeywords = /\b(if|else|for|while|switch|case|catch|&&|\|\||\?)\b/g;
  const complexityDelta = (addedCode.match(complexityKeywords) || []).length -
    (removedCode.match(complexityKeywords) || []).length;

  const testKeywords = /\b(test|it\(|describe|expect|assert|should|spec)\b/g;
  const testCoverageDelta = (addedCode.match(testKeywords) || []).length -
    (removedCode.match(testKeywords) || []).length;

  const commentLines = addedLines.filter(l => {
    const code = l.slice(1).trim();
    return code.startsWith("//") || code.startsWith("*") || code.startsWith("/*");
  });
  const docDensity = addedLines.length > 0 ? commentLines.length / addedLines.length : 0;

  const functionMatches = addedCode.match(/function\s+\w+|=>\s*{|\w+\s*\([^)]*\)\s*{/g) || [];
  const avgFunctionLength = functionMatches.length > 0
    ? addedLines.length / functionMatches.length : addedLines.length;

  const typeAnnotations = (addedCode.match(/:\s*[A-Z][a-zA-Z<>[\]|]+|:\s*(string|number|boolean|void|any|unknown)/g) || []).length;
  const identifiers = (addedCode.match(/\b[a-zA-Z_]\w*\b/g) || []).length;
  const typeAnnotationRatio = identifiers > 0 ? typeAnnotations / identifiers : 0;

  const tryCatches = (addedCode.match(/\btry\s*{/g) || []).length;
  const errorHandlingDensity = functionMatches.length > 0 ? tryCatches / functionMatches.length : 0;

  return {
    complexityDelta,
    testCoverageDelta,
    docDensity,
    avgFunctionLength: Math.min(avgFunctionLength / 50, 2),
    typeAnnotationRatio: Math.min(typeAnnotationRatio * 10, 1),
    errorHandlingDensity: Math.min(errorHandlingDensity, 1),
    linesAdded: addedLines.length,
    linesRemoved: removedLines.length,
    netChange: Math.abs(addedLines.length - removedLines.length) / Math.max(addedLines.length + removedLines.length, 1),
  };
}

function computeRawScore(features: RewardFeatures, weights: RewardModelWeights): number {
  return (
    weights.complexityDelta * Math.tanh(features.complexityDelta / 5) +
    weights.testCoverageDelta * Math.tanh(features.testCoverageDelta / 3) +
    weights.docDensity * features.docDensity +
    weights.avgFunctionLength * Math.tanh(-features.avgFunctionLength) +
    weights.typeAnnotationRatio * features.typeAnnotationRatio +
    weights.errorHandlingDensity * features.errorHandlingDensity +
    weights.netChange * (-features.netChange) +
    weights.bias
  );
}

export function getRewardScore(diff: string): number {
  const features = extractFeatures(diff);
  const rawScore = computeRawScore(features, modelState.weights);
  return 1 / (1 + Math.exp(-rawScore));
}

/** Alias used by selfImprove.ts — delegates to getRewardScore */
export const scoreWithRewardModel = getRewardScore;

export function trainOnPairs(
  pairs: Array<{ chosen: string; rejected: string }>,
  learningRate = 0.01,
  epochs = 5
): RewardModelState {
  const weights = { ...modelState.weights };

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;
    for (const pair of pairs) {
      const chosenFeatures = extractFeatures(pair.chosen);
      const rejectedFeatures = extractFeatures(pair.rejected);
      const rChosen = computeRawScore(chosenFeatures, weights);
      const rRejected = computeRawScore(rejectedFeatures, weights);
      const diff = rChosen - rRejected;
      const sigDiff = 1 / (1 + Math.exp(-diff));
      totalLoss += -Math.log(sigDiff + 1e-8);
      const grad = -(1 - sigDiff);
      const featureKeys: Array<keyof RewardFeatures> = [
        "complexityDelta", "testCoverageDelta", "docDensity",
        "avgFunctionLength", "typeAnnotationRatio", "errorHandlingDensity", "netChange"
      ];
      for (const key of featureKeys) {
        const featureDiff = (chosenFeatures[key] as number) - (rejectedFeatures[key] as number);
        (weights as Record<string, number>)[key] -= learningRate * grad * featureDiff;
      }
      weights.bias -= learningRate * grad;
    }
    modelState.trainLoss = totalLoss / pairs.length;
  }

  let correct = 0;
  for (const pair of pairs) {
    if (computeRawScore(extractFeatures(pair.chosen), weights) >
        computeRawScore(extractFeatures(pair.rejected), weights)) correct++;
  }

  modelState.weights = weights;
  modelState.trainedOn += pairs.length;
  modelState.lastTrainedAt = Date.now();
  modelState.version++;
  modelState.evalAccuracy = pairs.length > 0 ? correct / pairs.length : 0.5;

  fs.mkdirSync(path.dirname(MODEL_STATE_PATH), { recursive: true });
  fs.writeFileSync(MODEL_STATE_PATH, JSON.stringify(modelState, null, 2));
  return { ...modelState };
}

export function getModelState(): RewardModelState {
  return { ...modelState };
}

export function resetModel(): void {
  modelState = {
    weights: { ...DEFAULT_WEIGHTS },
    trainedOn: 0, lastTrainedAt: 0, version: 0, trainLoss: 1.0, evalAccuracy: 0.5,
  };
  if (fs.existsSync(MODEL_STATE_PATH)) fs.unlinkSync(MODEL_STATE_PATH);
}

export function trainFromRlhfFile(feedbackPath: string, maxPairs = 10000): RewardModelState {
  if (!fs.existsSync(feedbackPath)) throw new Error(`RLHF feedback file not found: ${feedbackPath}`);
  const lines = fs.readFileSync(feedbackPath, "utf-8").split("\n").filter(Boolean);
  const pairs: Array<{ chosen: string; rejected: string }> = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (!entry.chosen || !entry.rejected || entry.verdict === "error") continue;
      pairs.push({
        chosen: typeof entry.chosen === "string" ? entry.chosen : JSON.stringify(entry.chosen),
        rejected: typeof entry.rejected === "string" ? entry.rejected : JSON.stringify(entry.rejected),
      });
      if (pairs.length >= maxPairs) break;
    } catch { /* skip */ }
  }
  return trainOnPairs(pairs);
}

/**
 * v11.9.1: Train the reward model from the proposal store.
 * Applied proposals (chosen) are paired with rejected ones (rejected) to create
 * real code-diff DPO pairs. This is the primary training signal for code quality.
 */
export function trainFromProposalStore(proposalStorePath: string): RewardModelState {
  if (!fs.existsSync(proposalStorePath)) return { ...modelState };
  try {
    const store = JSON.parse(fs.readFileSync(proposalStorePath, "utf-8"));
    const proposals: Array<{ status: string; originalSnippet?: string; proposedSnippet?: string }> = store.proposals ?? [];
    const applied = proposals.filter(p => p.status === "applied" && p.originalSnippet && p.proposedSnippet);
    const rejected = proposals.filter(p => p.status === "rejected" && p.originalSnippet && p.proposedSnippet);
    if (applied.length === 0 || rejected.length === 0) return { ...modelState };
    // Build pairs: each applied proposal paired with a random rejected one
    const pairs: Array<{ chosen: string; rejected: string }> = [];
    for (const app of applied) {
      const rej = rejected[Math.floor(Math.random() * rejected.length)];
      // Build pseudo-diffs from snippets (+ lines = proposed, - lines = original)
      const chosenDiff = (app.originalSnippet ?? "").split("\n").map(l => `- ${l}`).join("\n") + "\n" +
        (app.proposedSnippet ?? "").split("\n").map(l => `+ ${l}`).join("\n");
      const rejectedDiff = (rej.originalSnippet ?? "").split("\n").map(l => `- ${l}`).join("\n") + "\n" +
        (rej.proposedSnippet ?? "").split("\n").map(l => `+ ${l}`).join("\n");
      pairs.push({ chosen: chosenDiff, rejected: rejectedDiff });
    }
    const result = trainOnPairs(pairs);
    return { ...result, trainingPairs: pairs.length };
  } catch { return { ...modelState }; }
}
