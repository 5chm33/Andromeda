/**
 * multimodalFusion.ts — v72.0.0 "Multi-Modal Fusion"
 * Fuses signals from multiple modalities into a unified representation.
 */
export type Modality = "vision" | "audio" | "text" | "video" | "diagram";
export interface ModalSignal { modality: Modality; content: unknown; confidence: number; timestamp: number; }
export interface FusedRepresentation { fusionId: string; signals: ModalSignal[]; dominantModality: Modality; unifiedDescription: string; overallConfidence: number; fusedAt: number; }

const fusions: FusedRepresentation[] = [];
let fusionCounter = 0;

export function fuseModalities(signals: ModalSignal[]): FusedRepresentation {
  if (signals.length === 0) throw new Error("[MultimodalFusion] No signals to fuse");
  const dominant = signals.reduce((best, s) => s.confidence > best.confidence ? s : best, signals[0]);
  const overallConfidence = signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length;
  const modalityList = signals.map(s => s.modality).join(", ");
  const fusion: FusedRepresentation = {
    fusionId: `fusion-${++fusionCounter}`, signals, dominantModality: dominant.modality,
    unifiedDescription: `Fused ${signals.length} signals (${modalityList}), dominant: ${dominant.modality}`,
    overallConfidence, fusedAt: Date.now()
  };
  fusions.push(fusion);
  return fusion;
}

export function getFusions(): FusedRepresentation[] { return [...fusions]; }
export function _resetMultimodalFusionForTest(): void { fusions.length = 0; fusionCounter = 0; }
