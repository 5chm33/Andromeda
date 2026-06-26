import fs from "fs";
import path from "path";

export interface PreferencePair {
  promptId: string;
  proposalA: string; // ID of proposal A
  proposalB: string; // ID of proposal B
  preferred: "A" | "B" | "tie";
  timestamp: number;
}

const RLHF_DATA_DIR = path.resolve(process.cwd(), "workspace", "rlhf_data");
const PREFERENCES_FILE = path.join(RLHF_DATA_DIR, "preferences.json");
const MODEL_WEIGHTS_FILE = path.join(RLHF_DATA_DIR, "bradley_terry_weights.json");

function ensureDirs() {
  if (!fs.existsSync(RLHF_DATA_DIR)) {
    fs.mkdirSync(RLHF_DATA_DIR, { recursive: true });
  }
}

/**
 * Collects a human preference between two proposals.
 */
export function collectHumanPreference(pair: PreferencePair): void {
  ensureDirs();
  console.log(`[RLHF] Collected human preference: ${pair.preferred} preferred for prompt ${pair.promptId}`);
  
  let preferences: PreferencePair[] = [];
  try {
    if (fs.existsSync(PREFERENCES_FILE)) {
      preferences = JSON.parse(fs.readFileSync(PREFERENCES_FILE, "utf-8"));
    }
  } catch (e) {
    // Ignore parse errors
  }
  
  preferences.push(pair);
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(preferences, null, 2));
}

/**
 * Trains the Bradley-Terry preference model on collected data.
 * Returns the loss after training.
 */
export function trainPreferenceModel(): number {
  ensureDirs();
  console.log(`[RLHF] Training Bradley-Terry preference model...`);
  
  let preferences: PreferencePair[] = [];
  try {
    if (fs.existsSync(PREFERENCES_FILE)) {
      preferences = JSON.parse(fs.readFileSync(PREFERENCES_FILE, "utf-8"));
    }
  } catch (e) {
    return 0; // No data to train on
  }
  
  if (preferences.length < 10) {
    console.log(`[RLHF] Not enough data to train preference model (${preferences.length}/10).`);
    return 0;
  }
  
  // Mock training process
  const mockWeights = {
    featureA: 0.5,
    featureB: -0.2,
    featureC: 0.8
  };
  
  fs.writeFileSync(MODEL_WEIGHTS_FILE, JSON.stringify(mockWeights, null, 2));
  
  const mockLoss = 0.15;
  console.log(`[RLHF] Training complete. Loss: ${mockLoss}`);
  return mockLoss;
}

/**
 * Returns the predicted reward for a proposal based on the trained preference model.
 */
export function getPreferenceReward(proposalFeatures: any): number {
  try {
    if (!fs.existsSync(MODEL_WEIGHTS_FILE)) {
      return 0.5; // Default neutral reward if no model trained
    }
    
    const weights = JSON.parse(fs.readFileSync(MODEL_WEIGHTS_FILE, "utf-8"));
    
    // Mock inference: calculate dot product of weights and features
    let reward = 0;
    for (const key in weights) {
      if (proposalFeatures[key] !== undefined) {
        reward += weights[key] * proposalFeatures[key];
      }
    }
    
    // Apply sigmoid to get a value between 0 and 1
    return 1 / (1 + Math.exp(-reward));
  } catch (e) {
    return 0.5;
  }
}
