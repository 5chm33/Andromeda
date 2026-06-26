import fs from "fs";
import path from "path";
import { ImprovementProposal } from "./selfImprove.js";

const DISTILLATION_DB = path.join(process.cwd(), "data", "reward_distillation.json");

export interface DistilledReward {
  score: number;
  confidence: number;
  source: "local_model" | "api_fallback";
}

/**
 * Loads the local distilled model weights (mocked for this implementation).
 */
function loadLocalModel(): any {
  if (fs.existsSync(DISTILLATION_DB)) {
    try {
      return JSON.parse(fs.readFileSync(DISTILLATION_DB, "utf-8"));
    } catch {
      return { weights: {}, samplesSeen: 0 };
    }
  }
  return { weights: {}, samplesSeen: 0 };
}

/**
 * Uses a lightweight local model (e.g., distilbert) to predict the reward score.
 * If the local model is highly confident, we skip the expensive API call.
 */
export async function getDistilledReward(proposal: ImprovementProposal): Promise<DistilledReward> {
  const model = loadLocalModel();
  
  // Mock local model prediction
  const isSyntaxFix = proposal.rationale.toLowerCase().includes("syntax") || proposal.title.toLowerCase().includes("syntax");
  const localScore = isSyntaxFix ? 0.95 : 0.6;
  const localConfidence = isSyntaxFix ? 0.99 : 0.4;
  
  // If confidence > 0.8, trust the local model and save an API call
  if (localConfidence > 0.8) {
    console.log(`[RewardDistiller] Local model highly confident (${localConfidence.toFixed(2)}). Skipping API.`);
    return { score: localScore, confidence: localConfidence, source: "local_model" };
  }
  
  console.log(`[RewardDistiller] Local model uncertain (${localConfidence.toFixed(2)}). Falling back to API.`);
  
  // Mock API fallback
  return { score: 0.85, confidence: 0.9, source: "api_fallback" };
}

/**
 * Trains the local model online using the results from the API fallback.
 */
export function distillFromApi(proposal: ImprovementProposal, apiScore: number) {
  const model = loadLocalModel();
  model.samplesSeen++;
  // Update weights...
  
  const dir = path.dirname(DISTILLATION_DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DISTILLATION_DB, JSON.stringify(model));
}
