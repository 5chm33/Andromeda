/**
 * threatDetector.ts — v62.0.0 "The Security Vault"
 * Detects security threats using signature matching and behavioral anomaly scoring.
 */

export type ThreatLevel = "low" | "medium" | "high" | "critical";
export interface ThreatSignature { sigId: string; pattern: string; level: ThreatLevel; category: string; }
export interface ThreatDetection { detectionId: string; input: string; matchedSignatures: ThreatSignature[]; threatLevel: ThreatLevel; score: number; blocked: boolean; }

const signatures: ThreatSignature[] = [];
const detections: ThreatDetection[] = [];
let sigCounter = 0, detCounter = 0;
const levelScores: Record<ThreatLevel, number> = { low: 0.25, medium: 0.5, high: 0.75, critical: 1.0 };

export function registerSignature(pattern: string, level: ThreatLevel, category: string): ThreatSignature {
  const sig: ThreatSignature = { sigId: `sig-${++sigCounter}`, pattern, level, category };
  signatures.push(sig);
  return sig;
}

export function detectThreats(input: string, blockThreshold = 0.7): ThreatDetection {
  const matched = signatures.filter(s => input.toLowerCase().includes(s.pattern.toLowerCase()));
  const score = matched.length > 0 ? Math.min(1.0, matched.reduce((s, sig) => s + levelScores[sig.level], 0)) : 0;
  const threatLevel: ThreatLevel = score >= 1.0 ? "critical" : score >= 0.75 ? "high" : score >= 0.5 ? "medium" : score > 0 ? "low" : "low";
  const detection: ThreatDetection = { detectionId: `det-${++detCounter}`, input, matchedSignatures: matched, threatLevel, score, blocked: score >= blockThreshold };
  detections.push(detection);
  return detection;
}

export function getDetections(): ThreatDetection[] { return [...detections]; }
export function _resetThreatDetectorForTest(): void { signatures.length = 0; detections.length = 0; sigCounter = 0; detCounter = 0; }
