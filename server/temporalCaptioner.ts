/**
 * temporalCaptioner.ts — v73.0.0 "Video Understanding Enhancements"
 * Generates time-stamped captions for video segments based on scene labels and object detections.
 */
export interface CaptionInput {
  timestampMs: number;
  sceneLabel: string;
  detectedObjects: string[];
  motionScore: number;
}

export interface TimedCaption {
  captionId: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number;
}

const captionHistory: TimedCaption[][] = [];
let captionCounter = 0;

function buildCaptionText(inputs: CaptionInput[]): string {
  const labels = new Set(inputs.map(input => input.sceneLabel));
  const objects = new Set(inputs.flatMap(input => input.detectedObjects));
  const avgMotion = inputs.reduce((sum, input) => sum + input.motionScore, 0) / inputs.length;
  const motionDesc = avgMotion > 0.6 ? "with high motion" : avgMotion > 0.3 ? "with moderate motion" : "with low motion";
  const labelStr = [...labels].join(", ");
  const objectStr = objects.size > 0 ? ` containing ${[...objects].slice(0, 3).join(", ")}` : "";
  return `${labelStr} scene${objectStr} ${motionDesc}`;
}

export function generateTemporalCaptions(
  inputs: CaptionInput[],
  segmentDurationMs = 2000,
): TimedCaption[] {
  if (inputs.length === 0) {
    captionHistory.push([]);
    return [];
  }

  const sorted = [...inputs].sort((a, b) => a.timestampMs - b.timestampMs);
  const captions: TimedCaption[] = [];
  let segmentStart = sorted[0].timestampMs;
  let segmentInputs: CaptionInput[] = [];

  for (const input of sorted) {
    if (input.timestampMs - segmentStart >= segmentDurationMs && segmentInputs.length > 0) {
      captions.push({
        captionId: `caption-${++captionCounter}`,
        startMs: segmentStart,
        endMs: input.timestampMs,
        text: buildCaptionText(segmentInputs),
        confidence: segmentInputs.reduce((sum, s) => sum + 0.8, 0) / segmentInputs.length,
      });
      segmentStart = input.timestampMs;
      segmentInputs = [];
    }
    segmentInputs.push(input);
  }

  if (segmentInputs.length > 0) {
    const lastMs = sorted[sorted.length - 1].timestampMs;
    captions.push({
      captionId: `caption-${++captionCounter}`,
      startMs: segmentStart,
      endMs: lastMs,
      text: buildCaptionText(segmentInputs),
      confidence: 0.8,
    });
  }

  captionHistory.push(captions);
  console.log(`[TemporalCaptioner] Generated ${captions.length} captions.`);
  return captions;
}

export function getCaptionHistory(): TimedCaption[][] {
  return captionHistory.map(batch => [...batch]);
}

export function _resetTemporalCaptionerForTest(): void {
  captionHistory.length = 0;
  captionCounter = 0;
}
