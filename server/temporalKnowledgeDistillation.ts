/**
 * Temporal Knowledge Distillation — compresses accumulated improvement history
 * into a compact "knowledge crystal" for rapid bootstrapping of future versions.
 */

export interface VersionSnapshot {
  version: string;
  timestamp: number;
  capabilityLevels: Record<string, number>;
  keyLessons: string[];
  topModules: string[];
  acceptanceRate: number;
}

export interface KnowledgeCrystal {
  id: string;
  sourceVersions: string[];
  distilledAt: number;
  compressedLessons: string[];
  capabilityTrajectory: Record<string, number[]>;
  criticalPatterns: CriticalPattern[];
  bootstrapInstructions: string[];
  fidelityScore: number;
}

export interface CriticalPattern {
  pattern: string;
  frequency: number;
  impact: number;
  dimension: string;
}

export interface DistillationFidelity {
  informationRetained: number;  // 0-1
  compressionRatio: number;
  criticalPatternsPreserved: number;
  trajectoryAccuracy: number;
}

class TemporalKnowledgeDistillationEngine {
  private crystals: Map<string, KnowledgeCrystal> = new Map();
  private crystalCounter = 0;

  distillKnowledge(versionHistory: VersionSnapshot[]): KnowledgeCrystal {
    const crystalId = `crystal-${++this.crystalCounter}-${Date.now()}`;

    // Extract critical patterns from lesson history
    const allLessons = versionHistory.flatMap(v => v.keyLessons);
    const lessonFreq = new Map<string, number>();
    for (const lesson of allLessons) {
      lessonFreq.set(lesson, (lessonFreq.get(lesson) ?? 0) + 1);
    }

    const criticalPatterns: CriticalPattern[] = Array.from(lessonFreq.entries())
      .filter(([, freq]) => freq >= 2)
      .map(([pattern, frequency]) => ({
        pattern,
        frequency,
        impact: frequency / versionHistory.length,
        dimension: this._inferDimension(pattern),
      }))
      .sort((a, b) => b.impact - a.impact);

    // Compress lessons: keep only unique high-impact ones
    const compressedLessons = Array.from(new Set(
      versionHistory
        .sort((a, b) => b.acceptanceRate - a.acceptanceRate)
        .flatMap(v => v.keyLessons)
        .slice(0, 20)
    ));

    // Build capability trajectory
    const capabilityTrajectory: Record<string, number[]> = {};
    for (const snapshot of versionHistory) {
      for (const [dim, level] of Object.entries(snapshot.capabilityLevels)) {
        if (!capabilityTrajectory[dim]) capabilityTrajectory[dim] = [];
        capabilityTrajectory[dim].push(level);
      }
    }

    // Generate bootstrap instructions
    const bootstrapInstructions = [
      `Initialize with ${criticalPatterns.length} critical patterns from v${versionHistory[0]?.version ?? "unknown"} to v${versionHistory[versionHistory.length - 1]?.version ?? "unknown"}`,
      `Focus first on: ${Object.entries(capabilityTrajectory).sort((a, b) => (b[1][b[1].length - 1] ?? 0) - (a[1][a[1].length - 1] ?? 0))[0]?.[0] ?? "accuracy"}`,
      `Apply ${compressedLessons.length} distilled lessons from ${versionHistory.length} versions`,
      `Expected acceptance rate: ${(versionHistory[versionHistory.length - 1]?.acceptanceRate ?? 0.99 * 100).toFixed(4)}%`,
    ];

    const originalSize = allLessons.length;
    const compressedSize = compressedLessons.length;
    const fidelityScore = criticalPatterns.length > 0
      ? Math.min(1, criticalPatterns.filter(p => p.impact > 0.5).length / criticalPatterns.length + 0.5)
      : 0.5;

    const crystal: KnowledgeCrystal = {
      id: crystalId,
      sourceVersions: versionHistory.map(v => v.version),
      distilledAt: Date.now(),
      compressedLessons,
      capabilityTrajectory,
      criticalPatterns,
      bootstrapInstructions,
      fidelityScore,
    };

    this.crystals.set(crystalId, crystal);
    console.log(`[Distillation] Crystal ${crystalId}: ${versionHistory.length} versions → ${compressedLessons.length} lessons (${(originalSize / Math.max(compressedSize, 1)).toFixed(1)}x compression)`);
    return crystal;
  }

  private _inferDimension(lesson: string): string {
    if (/accur|quality|correct/i.test(lesson)) return "accuracy";
    if (/speed|fast|latency|perf/i.test(lesson)) return "speed";
    if (/safe|secur|constit/i.test(lesson)) return "safety";
    if (/general|transfer|adapt/i.test(lesson)) return "generalization";
    return "general";
  }

  extractLessons(crystal: KnowledgeCrystal): string[] {
    return crystal.compressedLessons;
  }

  bootstrapFromCrystal(crystal: KnowledgeCrystal, targetVersion: string): Record<string, unknown> {
    const latestCapabilities: Record<string, number> = {};
    for (const [dim, trajectory] of Object.entries(crystal.capabilityTrajectory)) {
      latestCapabilities[dim] = trajectory[trajectory.length - 1] ?? 0;
    }

    console.log(`[Distillation] Bootstrapping ${targetVersion} from crystal ${crystal.id}`);
    return {
      targetVersion,
      initialCapabilities: latestCapabilities,
      lessons: crystal.compressedLessons,
      criticalPatterns: crystal.criticalPatterns.slice(0, 10),
      instructions: crystal.bootstrapInstructions,
    };
  }

  measureDistillationFidelity(original: VersionSnapshot[], distilled: KnowledgeCrystal): DistillationFidelity {
    const originalLessons = new Set(original.flatMap(v => v.keyLessons));
    const distilledLessons = new Set(distilled.compressedLessons);
    const intersection = [...originalLessons].filter(l => distilledLessons.has(l)).length;

    const informationRetained = originalLessons.size > 0 ? intersection / originalLessons.size : 1;
    const compressionRatio = originalLessons.size / Math.max(distilledLessons.size, 1);
    const criticalPatternsPreserved = distilled.criticalPatterns.filter(p => p.impact > 0.3).length / Math.max(distilled.criticalPatterns.length, 1);

    // Trajectory accuracy: how well the distilled trajectory matches the original
    let trajectoryAccuracy = 1.0;
    for (const [dim, trajectory] of Object.entries(distilled.capabilityTrajectory)) {
      const originalTrajectory = original.map(v => v.capabilityLevels[dim] ?? 0);
      if (originalTrajectory.length === trajectory.length) {
        const mse = originalTrajectory.reduce((sum, v, i) => sum + (v - trajectory[i]) ** 2, 0) / originalTrajectory.length;
        trajectoryAccuracy = Math.min(trajectoryAccuracy, 1 - Math.sqrt(mse));
      }
    }

    return { informationRetained, compressionRatio, criticalPatternsPreserved, trajectoryAccuracy };
  }

  getCrystals(): KnowledgeCrystal[] {
    return Array.from(this.crystals.values());
  }
}

export const globalKnowledgeDistillation = new TemporalKnowledgeDistillationEngine();

export function distillKnowledge(versionHistory: VersionSnapshot[]): KnowledgeCrystal {
  return globalKnowledgeDistillation.distillKnowledge(versionHistory);
}

export function extractLessons(crystal: KnowledgeCrystal): string[] {
  return globalKnowledgeDistillation.extractLessons(crystal);
}

export function bootstrapFromCrystal(crystal: KnowledgeCrystal, targetVersion: string): Record<string, unknown> {
  return globalKnowledgeDistillation.bootstrapFromCrystal(crystal, targetVersion);
}

export function measureDistillationFidelity(original: VersionSnapshot[], distilled: KnowledgeCrystal): DistillationFidelity {
  return globalKnowledgeDistillation.measureDistillationFidelity(original, distilled);
}

export function initTemporalKnowledgeDistillation(): void {
  console.log("[Distillation] Temporal Knowledge Distillation Engine initialized.");
}
