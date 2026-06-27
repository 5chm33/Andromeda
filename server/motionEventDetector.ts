import { createLogger } from "./logger.js";
const log = createLogger("MotionEventDetector");
/**
 * motionEventDetector.ts — v73.0.0 "Video Understanding Enhancements"
 * Detects discrete motion events (sudden starts, stops, direction changes) in a video stream.
 */
export interface MotionSample {
  timestampMs: number;
  motionScore: number;
}

export type MotionEventType = "start" | "stop" | "spike" | "sustained";

export interface MotionEvent {
  eventId: string;
  eventType: MotionEventType;
  timestampMs: number;
  motionScore: number;
  description: string;
}

const eventHistory: MotionEvent[][] = [];
let eventCounter = 0;

export function detectMotionEvents(
  samples: MotionSample[],
  startThreshold = 0.3,
  stopThreshold = 0.1,
  spikeThreshold = 0.6,
  sustainedMinFrames = 3,
): MotionEvent[] {
  const events: MotionEvent[] = [];
  if (samples.length === 0) {
    eventHistory.push(events);
    return events;
  }

  const sorted = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
  let wasMoving = sorted[0].motionScore >= startThreshold;
  let sustainedCount = wasMoving ? 1 : 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const isMoving = curr.motionScore >= startThreshold;

    if (!wasMoving && isMoving) {
      events.push({ eventId: `motion-event-${++eventCounter}`, eventType: "start", timestampMs: curr.timestampMs, motionScore: curr.motionScore, description: `Motion started at ${curr.timestampMs}ms (score=${curr.motionScore.toFixed(2)})` });
    } else if (wasMoving && !isMoving) {
      events.push({ eventId: `motion-event-${++eventCounter}`, eventType: "stop", timestampMs: curr.timestampMs, motionScore: curr.motionScore, description: `Motion stopped at ${curr.timestampMs}ms (score=${curr.motionScore.toFixed(2)})` });
      sustainedCount = 0;
    }

    if (curr.motionScore >= spikeThreshold && (prev.motionScore < spikeThreshold)) {
      events.push({ eventId: `motion-event-${++eventCounter}`, eventType: "spike", timestampMs: curr.timestampMs, motionScore: curr.motionScore, description: `Motion spike at ${curr.timestampMs}ms (score=${curr.motionScore.toFixed(2)})` });
    }

    if (isMoving) {
      sustainedCount++;
      if (sustainedCount === sustainedMinFrames) {
        events.push({ eventId: `motion-event-${++eventCounter}`, eventType: "sustained", timestampMs: curr.timestampMs, motionScore: curr.motionScore, description: `Sustained motion detected at ${curr.timestampMs}ms (${sustainedMinFrames} frames)` });
      }
    }

    wasMoving = isMoving;
  }

  eventHistory.push(events);
  log.info(`[MotionEventDetector] Detected ${events.length} motion events.`);
  return events;
}

export function getMotionEventHistory(): MotionEvent[][] {
  return eventHistory.map(batch => [...batch]);
}

export function _resetMotionEventDetectorForTest(): void {
  eventHistory.length = 0;
  eventCounter = 0;
}
