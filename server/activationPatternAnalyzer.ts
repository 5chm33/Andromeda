/**
 * activationPatternAnalyzer.ts — v56.0.0 "The Neural Fabric"
 *
 * Analyzes activation patterns across neural layers to identify
 * dead neurons, saturation, and feature redundancy.
 */

export interface ActivationRecord {
  recordId: string;
  layerId: string;
  activations: number[];
  timestamp: number;
  inputHash: string;
}

export interface LayerAnalysis {
  layerId: string;
  sampleCount: number;
  meanActivation: number;
  stdActivation: number;
  deadNeuronFraction: number;    // neurons always near 0
  saturatedFraction: number;     // neurons always near max
  effectiveRank: number;         // dimensionality of active subspace
  recommendations: string[];
}

const records = new Map<string, ActivationRecord[]>();
let recordCounter = 0;

export function recordActivation(layerId: string, activations: number[], inputHash: string): ActivationRecord {
  const record: ActivationRecord = {
    recordId: `act-${++recordCounter}`,
    layerId,
    activations: [...activations],
    timestamp: Date.now(),
    inputHash,
  };
  if (!records.has(layerId)) records.set(layerId, []);
  records.get(layerId)!.push(record);
  return record;
}

export function analyzeLayer(layerId: string): LayerAnalysis | null {
  const layerRecords = records.get(layerId);
  if (!layerRecords || layerRecords.length === 0) return null;

  const allActivations = layerRecords.map(r => r.activations);
  const neuronCount = allActivations[0].length;
  const sampleCount = allActivations.length;

  // Per-neuron statistics
  const neuronMeans = new Array(neuronCount).fill(0);
  const neuronStds = new Array(neuronCount).fill(0);

  for (const sample of allActivations) {
    for (let i = 0; i < neuronCount; i++) {
      neuronMeans[i] += sample[i] / sampleCount;
    }
  }
  for (const sample of allActivations) {
    for (let i = 0; i < neuronCount; i++) {
      neuronStds[i] += ((sample[i] - neuronMeans[i]) ** 2) / sampleCount;
    }
  }
  for (let i = 0; i < neuronCount; i++) {
    neuronStds[i] = Math.sqrt(neuronStds[i]);
  }

  const deadNeurons = neuronMeans.filter(m => Math.abs(m) < 0.01).length;
  const saturatedNeurons = neuronMeans.filter(m => Math.abs(m) > 0.95).length;
  const effectiveRank = neuronStds.filter(s => s > 0.05).length;

  const overallMean = neuronMeans.reduce((s, v) => s + v, 0) / neuronCount;
  const overallStd = neuronStds.reduce((s, v) => s + v, 0) / neuronCount;

  const recommendations: string[] = [];
  if (deadNeurons / neuronCount > 0.2) recommendations.push(`High dead neuron rate (${(deadNeurons / neuronCount * 100).toFixed(1)}%) — consider lower learning rate or different initialization`);
  if (saturatedNeurons / neuronCount > 0.2) recommendations.push(`High saturation (${(saturatedNeurons / neuronCount * 100).toFixed(1)}%) — consider batch normalization`);
  if (effectiveRank < neuronCount * 0.5) recommendations.push(`Low effective rank (${effectiveRank}/${neuronCount}) — layer may be over-parameterized`);

  return {
    layerId,
    sampleCount,
    meanActivation: overallMean,
    stdActivation: overallStd,
    deadNeuronFraction: deadNeurons / neuronCount,
    saturatedFraction: saturatedNeurons / neuronCount,
    effectiveRank,
    recommendations,
  };
}

export function getActivationHistory(layerId: string, limit = 100): ActivationRecord[] {
  return (records.get(layerId) ?? []).slice(-limit);
}

export function _resetActivationPatternAnalyzerForTest(): void {
  records.clear();
  recordCounter = 0;
}
