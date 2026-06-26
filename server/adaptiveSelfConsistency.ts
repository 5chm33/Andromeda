/**
 * Determines how many LLM samples to generate based on the confidence 
 * of the first sample. Saves LLM calls on easy tasks.
 */
export function determineSampleCount(firstSampleConfidence: number): number {
  if (firstSampleConfidence > 0.9) {
    console.log(`[AdaptiveSampling] First sample confidence high (${firstSampleConfidence.toFixed(2)}). Skipping extra samples.`);
    return 1;
  }
  
  if (firstSampleConfidence > 0.5) {
    console.log(`[AdaptiveSampling] First sample confidence medium (${firstSampleConfidence.toFixed(2)}). Taking 1 extra sample.`);
    return 2;
  }
  
  console.log(`[AdaptiveSampling] First sample confidence low (${firstSampleConfidence.toFixed(2)}). Taking full 3 samples.`);
  return 3;
}

/**
 * Selects the best sample from a list using majority voting or highest confidence.
 */
export function selectBestSample(samples: Array<{ code: string; confidence: number }>) {
  if (samples.length === 0) return null;
  if (samples.length === 1) return samples[0];
  
  // Sort by confidence descending
  const sorted = [...samples].sort((a, b) => b.confidence - a.confidence);
  return sorted[0];
}
