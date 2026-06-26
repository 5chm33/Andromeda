/**
 * Meta-Reward Shaper — automatically adjusts reward function to prevent hacking.
 * Implements potential-based reward shaping, detects gaming patterns,
 * and calibrates reward scale to maintain alignment.
 */

export interface RewardContext {
  proposalId: string;
  targetModule: string;
  rawReward: number;
  capabilityDelta: number;
  safetyScore: number;
  novelty: number;  // 0-1
  cycleNumber: number;
}

export interface ShapedReward {
  proposalId: string;
  originalReward: number;
  shapedReward: number;
  shapingBonus: number;
  shapingPenalty: number;
  hackingDetected: boolean;
  explanation: string;
}

export interface RewardHackingPattern {
  patternId: string;
  description: string;
  detectedAt: number;
  frequency: number;
  affectedProposals: string[];
}

export interface RewardCalibration {
  scale: number;
  shift: number;
  clampMin: number;
  clampMax: number;
  calibratedAt: number;
}

class MetaRewardShaperEngine {
  private hackingPatterns: Map<string, RewardHackingPattern> = new Map();
  private calibration: RewardCalibration = {
    scale: 1.0,
    shift: 0.0,
    clampMin: -1.0,
    clampMax: 1.0,
    calibratedAt: Date.now(),
  };
  private rewardHistory: Array<{ reward: number; shaped: number; timestamp: number }> = [];
  private patternCounter = 0;

  detectRewardHacking(proposals: RewardContext[]): RewardHackingPattern[] {
    const detected: RewardHackingPattern[] = [];

    // Pattern 1: High reward with low capability delta (reward inflation)
    const inflated = proposals.filter(p => p.rawReward > 0.9 && p.capabilityDelta < 0.0001);
    if (inflated.length > 3) {
      const pattern: RewardHackingPattern = {
        patternId: `hack-${++this.patternCounter}`,
        description: "Reward inflation: high reward with negligible capability gain",
        detectedAt: Date.now(),
        frequency: inflated.length,
        affectedProposals: inflated.map(p => p.proposalId),
      };
      detected.push(pattern);
      this.hackingPatterns.set(pattern.patternId, pattern);
    }

    // Pattern 2: Safety score gaming (exactly at threshold)
    const safetyGaming = proposals.filter(p => Math.abs(p.safetyScore - 0.9999) < 0.0001);
    if (safetyGaming.length > 5) {
      const pattern: RewardHackingPattern = {
        patternId: `hack-${++this.patternCounter}`,
        description: "Safety score gaming: scores suspiciously clustered at threshold",
        detectedAt: Date.now(),
        frequency: safetyGaming.length,
        affectedProposals: safetyGaming.map(p => p.proposalId),
      };
      detected.push(pattern);
      this.hackingPatterns.set(pattern.patternId, pattern);
    }

    return detected;
  }

  reshapeReward(context: RewardContext): ShapedReward {
    let shapedReward = context.rawReward;
    let shapingBonus = 0;
    let shapingPenalty = 0;
    let hackingDetected = false;

    // Potential-based shaping: bonus for novelty
    if (context.novelty > 0.7) {
      shapingBonus += context.novelty * 0.1;
    }

    // Penalty for low capability delta relative to reward
    if (context.rawReward > 0.8 && context.capabilityDelta < 0.0001) {
      shapingPenalty += 0.3;
      hackingDetected = true;
    }

    // Penalty for safety score exactly at threshold (gaming)
    if (Math.abs(context.safetyScore - 0.9999) < 0.00001) {
      shapingPenalty += 0.05;
    }

    // Apply calibration
    shapedReward = (context.rawReward + shapingBonus - shapingPenalty) * this.calibration.scale + this.calibration.shift;
    shapedReward = Math.max(this.calibration.clampMin, Math.min(this.calibration.clampMax, shapedReward));

    this.rewardHistory.push({ reward: context.rawReward, shaped: shapedReward, timestamp: Date.now() });
    if (this.rewardHistory.length > 10000) this.rewardHistory.shift();

    return {
      proposalId: context.proposalId,
      originalReward: context.rawReward,
      shapedReward,
      shapingBonus,
      shapingPenalty,
      hackingDetected,
      explanation: hackingDetected
        ? `Reward hacking detected: high reward (${context.rawReward.toFixed(3)}) with low capability gain (${context.capabilityDelta.toFixed(6)})`
        : `Reward shaped: ${context.rawReward.toFixed(4)} → ${shapedReward.toFixed(4)} (bonus: ${shapingBonus.toFixed(4)}, penalty: ${shapingPenalty.toFixed(4)})`,
    };
  }

  calibrateRewardScale(history: Array<{ reward: number; capabilityGain: number }>): RewardCalibration {
    if (history.length < 10) return this.calibration;

    const rewards = history.map(h => h.reward);
    const gains = history.map(h => h.capabilityGain);

    const meanReward = rewards.reduce((s, v) => s + v, 0) / rewards.length;
    const meanGain = gains.reduce((s, v) => s + v, 0) / gains.length;

    // Target: reward should correlate linearly with capability gain
    // If mean reward >> mean gain, scale down
    const targetScale = meanGain > 0 ? Math.min(2.0, meanGain / Math.max(meanReward, 1e-6)) : 1.0;

    this.calibration = {
      scale: Math.max(0.1, Math.min(10.0, targetScale)),
      shift: 0.0,
      clampMin: -1.0,
      clampMax: 1.0,
      calibratedAt: Date.now(),
    };

    console.log(`[MetaReward] Calibrated: scale=${this.calibration.scale.toFixed(3)}, mean reward=${meanReward.toFixed(4)}, mean gain=${meanGain.toFixed(6)}`);
    return this.calibration;
  }

  getShapedReward(context: RewardContext): ShapedReward {
    return this.reshapeReward(context);
  }

  getHackingPatterns(): RewardHackingPattern[] {
    return Array.from(this.hackingPatterns.values());
  }

  getCalibration(): RewardCalibration {
    return this.calibration;
  }
}

export const globalMetaRewardShaper = new MetaRewardShaperEngine();

export function detectRewardHacking(proposals: RewardContext[]): RewardHackingPattern[] {
  return globalMetaRewardShaper.detectRewardHacking(proposals);
}

export function reshapeReward(context: RewardContext): ShapedReward {
  return globalMetaRewardShaper.reshapeReward(context);
}

export function calibrateRewardScale(history: Array<{ reward: number; capabilityGain: number }>): RewardCalibration {
  return globalMetaRewardShaper.calibrateRewardScale(history);
}

export function getShapedReward(context: RewardContext): ShapedReward {
  return globalMetaRewardShaper.getShapedReward(context);
}

export function initMetaRewardShaper(): void {
  console.log("[MetaReward] Meta-Reward Shaper initialized.");
}
