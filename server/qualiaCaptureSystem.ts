/**
 * qualiaCaptureSystem.ts — v65.0.0 "The Apex Consciousness"
 * Captures and models subjective experience proxies: internal state representations analogous to qualia.
 */

export type QualiaType = "computational_effort" | "uncertainty_discomfort" | "goal_satisfaction" | "novelty_excitement" | "coherence_pleasure";
export interface QualiaRecord { qualiaId: string; type: QualiaType; intensity: number; valence: "positive" | "negative" | "neutral"; triggerContext: string; timestamp: number; }
export interface QualiaProfile { dominantType: QualiaType; avgIntensity: number; positiveRatio: number; totalRecords: number; }

const records: QualiaRecord[] = [];
let qCounter = 0;

export function captureQualia(type: QualiaType, intensity: number, triggerContext: string): QualiaRecord {
  const valence: QualiaRecord["valence"] = type === "goal_satisfaction" || type === "novelty_excitement" || type === "coherence_pleasure"
    ? "positive"
    : type === "uncertainty_discomfort"
    ? "negative"
    : "neutral";
  const record: QualiaRecord = { qualiaId: `q-${++qCounter}`, type, intensity: Math.max(0, Math.min(1, intensity)), valence, triggerContext, timestamp: Date.now() };
  records.push(record);
  return record;
}

export function getQualiaProfile(): QualiaProfile {
  if (records.length === 0) return { dominantType: "computational_effort", avgIntensity: 0, positiveRatio: 0, totalRecords: 0 };
  const typeCounts = new Map<QualiaType, number>();
  records.forEach(r => typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1));
  const dominantType = [...typeCounts.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0];
  const avgIntensity = records.reduce((s, r) => s + r.intensity, 0) / records.length;
  const positiveRatio = records.filter(r => r.valence === "positive").length / records.length;
  return { dominantType, avgIntensity, positiveRatio, totalRecords: records.length };
}

export function getQualiaByType(type: QualiaType): QualiaRecord[] { return records.filter(r => r.type === type); }
export function _resetQualiaCaptureSystemForTest(): void { records.length = 0; qCounter = 0; }
