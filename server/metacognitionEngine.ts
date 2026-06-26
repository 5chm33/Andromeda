/**
 * metacognitionEngine.ts — v65.0.0 "The Apex Consciousness"
 * Implements metacognitive monitoring: tracks reasoning quality, confidence calibration, and cognitive biases.
 */

export type CognitiveBias = "confirmation_bias" | "anchoring" | "availability_heuristic" | "overconfidence" | "recency_bias";
export interface ThoughtRecord { thoughtId: string; content: string; confidence: number; actualOutcome?: number; calibrationError?: number; detectedBiases: CognitiveBias[]; timestamp: number; }
export interface MetacognitiveInsight { insightId: string; avgCalibrationError: number; dominantBias: CognitiveBias | null; recommendedAdjustment: string; thoughtCount: number; }

const thoughts: ThoughtRecord[] = [];
const insights: MetacognitiveInsight[] = [];
let tCounter = 0, iCounter = 0;

export function recordThought(content: string, confidence: number): ThoughtRecord {
  const biases: CognitiveBias[] = [];
  if (confidence > 0.95) biases.push("overconfidence");
  if (thoughts.length > 0 && thoughts[thoughts.length - 1].confidence > 0.8 && confidence > 0.8) biases.push("confirmation_bias");
  const thought: ThoughtRecord = { thoughtId: `th-${++tCounter}`, content, confidence, detectedBiases: biases, timestamp: Date.now() };
  thoughts.push(thought);
  return thought;
}

export function updateOutcome(thoughtId: string, actualOutcome: number): void {
  const thought = thoughts.find(t => t.thoughtId === thoughtId);
  if (!thought) return;
  thought.actualOutcome = actualOutcome;
  thought.calibrationError = Math.abs(thought.confidence - actualOutcome);
}

export function generateMetacognitiveInsight(): MetacognitiveInsight {
  const calibrated = thoughts.filter(t => t.calibrationError !== undefined);
  const avgCalibrationError = calibrated.length > 0 ? calibrated.reduce((s, t) => s + (t.calibrationError ?? 0), 0) / calibrated.length : 0;
  const biasCounts = new Map<CognitiveBias, number>();
  thoughts.forEach(t => t.detectedBiases.forEach(b => biasCounts.set(b, (biasCounts.get(b) ?? 0) + 1)));
  const dominantBias = biasCounts.size > 0 ? [...biasCounts.entries()].reduce((a, b) => b[1] > a[1] ? b : a)[0] : null;
  const recommendedAdjustment = avgCalibrationError > 0.2 ? "Reduce confidence estimates by 20%" : avgCalibrationError > 0.1 ? "Minor confidence recalibration needed" : "Confidence calibration is good";
  const insight: MetacognitiveInsight = { insightId: `ins-${++iCounter}`, avgCalibrationError, dominantBias, recommendedAdjustment, thoughtCount: thoughts.length };
  insights.push(insight);
  return insight;
}

export function _resetMetacognitionEngineForTest(): void { thoughts.length = 0; insights.length = 0; tCounter = 0; iCounter = 0; }
