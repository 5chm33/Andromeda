/**
 * temporalPatternDetector.ts — v97.0.0 "Neuromorphic Computing & Spiking Networks"
 * Detects temporal spike patterns using coincidence detection and sequence matching.
 */
export interface SpikePattern {
  patternId: string;
  name: string;
  spikeTimes: number[];
  neuronIds: string[];
  tolerance: number;
}

export interface PatternMatch {
  matchId: string;
  patternId: string;
  patternName: string;
  detectedAt: number;
  confidence: number;
  matchedSpikes: number;
}

const patterns: SpikePattern[] = [];
const matches: PatternMatch[] = [];
const spikeHistory: Array<{ neuronId: string; time: number }> = [];
let patternCounter = 0;
let matchCounter = 0;

export function registerPattern(name: string, spikeTimes: number[], neuronIds: string[], tolerance = 1.0): SpikePattern {
  const pattern: SpikePattern = { patternId: `sp-${++patternCounter}`, name, spikeTimes, neuronIds, tolerance };
  patterns.push(pattern);
  return pattern;
}

export function recordSpike(neuronId: string, time: number): void {
  spikeHistory.push({ neuronId, time });
}

export function detectPatterns(currentTime: number, windowSize = 50): PatternMatch[] {
  const recentSpikes = spikeHistory.filter(s => s.time >= currentTime - windowSize);
  const newMatches: PatternMatch[] = [];

  for (const pattern of patterns) {
    let matchedSpikes = 0;
    for (let i = 0; i < pattern.neuronIds.length; i++) {
      const targetNeuron = pattern.neuronIds[i];
      const targetTime = pattern.spikeTimes[i];
      const found = recentSpikes.some(s => s.neuronId === targetNeuron && Math.abs(s.time - (currentTime - windowSize + targetTime)) <= pattern.tolerance);
      if (found) matchedSpikes++;
    }
    const confidence = pattern.neuronIds.length > 0 ? matchedSpikes / pattern.neuronIds.length : 0;
    if (confidence >= 0.5) {
      const match: PatternMatch = { matchId: `pm-${++matchCounter}`, patternId: pattern.patternId, patternName: pattern.name, detectedAt: currentTime, confidence, matchedSpikes };
      matches.push(match);
      newMatches.push(match);
    }
  }
  return newMatches;
}

export function getPatterns(): SpikePattern[] { return [...patterns]; }
export function getMatches(patternId?: string): PatternMatch[] { return patternId ? matches.filter(m => m.patternId === patternId) : [...matches]; }
export function _resetTemporalPatternDetectorForTest(): void { patterns.length = 0; matches.length = 0; spikeHistory.length = 0; patternCounter = 0; matchCounter = 0; }
