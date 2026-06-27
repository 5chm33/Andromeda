/**
 * neuralPopulationCoder.ts — v97.0.0 "Neuromorphic Computing & Spiking Networks"
 * Population coding: encodes scalar values as distributed patterns of neural activity.
 */
export interface PopulationCode {
  codeId: string;
  value: number;
  preferredValues: number[];
  activations: number[];
  encodingWidth: number;
  decodedValue: number;
  encodingError: number;
}

const codes: PopulationCode[] = [];
let codeCounter = 0;

function gaussian(x: number, mu: number, sigma: number): number {
  return Math.exp(-0.5 * ((x - mu) / sigma) ** 2);
}

export function encode(value: number, numNeurons: number, minVal: number, maxVal: number, sigma?: number): PopulationCode {
  const preferredValues = Array.from({ length: numNeurons }, (_, i) => minVal + (i / (numNeurons - 1)) * (maxVal - minVal));
  const tuningWidth = sigma ?? (maxVal - minVal) / numNeurons;
  const activations = preferredValues.map(pv => gaussian(value, pv, tuningWidth));

  // Decode using population vector
  const totalActivation = activations.reduce((s, a) => s + a, 0);
  const decodedValue = totalActivation > 0 ? activations.reduce((s, a, i) => s + a * preferredValues[i], 0) / totalActivation : (minVal + maxVal) / 2;
  const encodingError = Math.abs(value - decodedValue);

  const code: PopulationCode = { codeId: `pc-${++codeCounter}`, value, preferredValues, activations, encodingWidth: tuningWidth, decodedValue, encodingError };
  codes.push(code);
  return code;
}

export function decode(activations: number[], preferredValues: number[]): number {
  const totalActivation = activations.reduce((s, a) => s + a, 0);
  if (totalActivation === 0) return preferredValues[Math.floor(preferredValues.length / 2)];
  return activations.reduce((s, a, i) => s + a * (preferredValues[i] ?? 0), 0) / totalActivation;
}

export function getCodes(): PopulationCode[] { return [...codes]; }
export function _resetNeuralPopulationCoderForTest(): void { codes.length = 0; codeCounter = 0; }
