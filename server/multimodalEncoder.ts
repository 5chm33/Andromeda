/**
 * multimodalEncoder.ts — v60.0.0 "The Communication Layer"
 * Encodes text, structured data, and metadata into a unified multimodal representation.
 */

export type Modality = "text" | "structured" | "numeric" | "categorical";
export interface ModalityInput { modality: Modality; data: string | number | Record<string, unknown>; weight: number; }
export interface MultimodalEncoding { encodingId: string; vector: number[]; modalitiesUsed: Modality[]; fusionMethod: string; dimensionality: number; }

const encodings: MultimodalEncoding[] = [];
let encCounter = 0;

export function encodeMultimodal(inputs: ModalityInput[], targetDim = 64): MultimodalEncoding {
  const vector: number[] = new Array(targetDim).fill(0);
  const modalitiesUsed: Modality[] = [];
  for (const input of inputs) {
    if (!modalitiesUsed.includes(input.modality)) modalitiesUsed.push(input.modality);
    const hash = JSON.stringify(input.data).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xFFFFFF, 0);
    for (let i = 0; i < targetDim; i++) {
      vector[i] += input.weight * Math.sin((hash + i) * 0.1) / inputs.length;
    }
  }
  const enc: MultimodalEncoding = { encodingId: `enc-${++encCounter}`, vector, modalitiesUsed, fusionMethod: "weighted_sum", dimensionality: targetDim };
  encodings.push(enc);
  return enc;
}

export function computeSimilarity(enc1: MultimodalEncoding, enc2: MultimodalEncoding): number {
  const dot = enc1.vector.reduce((s, v, i) => s + v * enc2.vector[i], 0);
  const norm1 = Math.sqrt(enc1.vector.reduce((s, v) => s + v * v, 0));
  const norm2 = Math.sqrt(enc2.vector.reduce((s, v) => s + v * v, 0));
  return norm1 * norm2 > 0 ? dot / (norm1 * norm2) : 0;
}

export function _resetMultimodalEncoderForTest(): void { encodings.length = 0; encCounter = 0; }
