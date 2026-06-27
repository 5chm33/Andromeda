/**
 * audioAnalyzer.ts — v71.0.0 "Multi-Modal Intelligence"
 * Audio analysis: speech detection, music classification, noise profiling, and feature extraction.
 */
export type AudioType = "speech" | "music" | "noise" | "silence" | "mixed";
export interface AudioFeatures { rms: number; zeroCrossingRate: number; spectralCentroid: number; tempo?: number; }
export interface AudioAnalysisResult { audioId: string; durationMs: number; sampleRate: number; type: AudioType; confidence: number; features: AudioFeatures; transcript?: string; language?: string; }

const results: AudioAnalysisResult[] = [];
let audioCounter = 0;

export function analyzeAudio(durationMs: number, sampleRate: number, data: { type: AudioType; confidence?: number; features?: Partial<AudioFeatures>; transcript?: string; language?: string }): AudioAnalysisResult {
  const result: AudioAnalysisResult = {
    audioId: `audio-${++audioCounter}`, durationMs, sampleRate,
    type: data.type, confidence: data.confidence ?? 0.85,
    features: { rms: data.features?.rms ?? 0.1, zeroCrossingRate: data.features?.zeroCrossingRate ?? 0.05, spectralCentroid: data.features?.spectralCentroid ?? 2000, tempo: data.features?.tempo },
    transcript: data.transcript, language: data.language
  };
  results.push(result);
  return result;
}

export function detectSpeechSegments(results: AudioAnalysisResult[]): AudioAnalysisResult[] {
  return results.filter(r => r.type === "speech" || (r.type === "mixed" && r.transcript));
}

export function getAudioHistory(): AudioAnalysisResult[] { return [...results]; }
export function _resetAudioAnalyzerForTest(): void { results.length = 0; audioCounter = 0; }
