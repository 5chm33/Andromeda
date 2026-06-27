import { createLogger } from "./logger.js";
const log = createLogger("SceneSegmenter");
/**
 * sceneSegmenter.ts — v73.0.0 "Video Understanding Enhancements"
 * Segments a video timeline into scenes using label changes, motion deltas, and confidence thresholds.
 */
export interface SceneFrameInput {
  timestampMs: number;
  sceneLabel: string;
  motionScore: number;
  confidence: number;
}

export interface SceneSegment {
  segmentId: string;
  startMs: number;
  endMs: number;
  dominantLabel: string;
  averageMotionScore: number;
  averageConfidence: number;
  frameCount: number;
}

export interface SceneSegmentationResult {
  analysisId: string;
  videoId: string;
  segments: SceneSegment[];
  totalFrames: number;
  generatedAt: number;
}

const segmentationHistory: SceneSegmentationResult[] = [];
let analysisCounter = 0;
let segmentCounter = 0;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildSegment(frames: SceneFrameInput[]): SceneSegment {
  const labels = new Map<string, number>();
  frames.forEach(frame => labels.set(frame.sceneLabel, (labels.get(frame.sceneLabel) ?? 0) + 1));
  const dominantLabel = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
  return {
    segmentId: `scene-segment-${++segmentCounter}`,
    startMs: frames[0]?.timestampMs ?? 0,
    endMs: frames[frames.length - 1]?.timestampMs ?? 0,
    dominantLabel,
    averageMotionScore: average(frames.map(frame => frame.motionScore)),
    averageConfidence: average(frames.map(frame => frame.confidence)),
    frameCount: frames.length,
  };
}

export function segmentScenes(
  videoId: string,
  frames: SceneFrameInput[],
  motionDeltaThreshold = 0.35,
  confidenceFloor = 0.45,
): SceneSegmentationResult {
  if (frames.length === 0) {
    const emptyResult: SceneSegmentationResult = {
      analysisId: `scene-analysis-${++analysisCounter}`,
      videoId,
      segments: [],
      totalFrames: 0,
      generatedAt: Date.now(),
    };
    segmentationHistory.push(emptyResult);
    return emptyResult;
  }

  const orderedFrames = [...frames].sort((a, b) => a.timestampMs - b.timestampMs);
  const segments: SceneSegment[] = [];
  let current: SceneFrameInput[] = [orderedFrames[0]];

  for (let i = 1; i < orderedFrames.length; i++) {
    const previous = orderedFrames[i - 1];
    const frame = orderedFrames[i];
    const labelChanged = previous.sceneLabel !== frame.sceneLabel;
    const motionJump = Math.abs(previous.motionScore - frame.motionScore) >= motionDeltaThreshold;
    const lowConfidenceBoundary = previous.confidence < confidenceFloor || frame.confidence < confidenceFloor;

    if (labelChanged || motionJump || lowConfidenceBoundary) {
      segments.push(buildSegment(current));
      current = [frame];
    } else {
      current.push(frame);
    }
  }

  if (current.length > 0) segments.push(buildSegment(current));

  const result: SceneSegmentationResult = {
    analysisId: `scene-analysis-${++analysisCounter}`,
    videoId,
    segments,
    totalFrames: orderedFrames.length,
    generatedAt: Date.now(),
  };

  segmentationHistory.push(result);
  log.info(`[SceneSegmenter] Segmented ${videoId} into ${segments.length} scenes.`);
  return result;
}

export function getSceneSegmentationHistory(): SceneSegmentationResult[] {
  return [...segmentationHistory];
}

export function _resetSceneSegmenterForTest(): void {
  segmentationHistory.length = 0;
  analysisCounter = 0;
  segmentCounter = 0;
}
