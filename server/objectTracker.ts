/**
 * objectTracker.ts — v73.0.0 "Video Understanding Enhancements"
 * Tracks object identities across frames and summarizes motion paths and persistence.
 */
export interface ObjectDetectionFrame {
  timestampMs: number;
  detections: Array<{
    label: string;
    x: number;
    y: number;
    confidence: number;
  }>;
}

export interface TrackedObjectPoint {
  timestampMs: number;
  x: number;
  y: number;
  confidence: number;
}

export interface TrackedObject {
  trackId: string;
  label: string;
  firstSeenMs: number;
  lastSeenMs: number;
  points: TrackedObjectPoint[];
  averageConfidence: number;
}

const trackingHistory: TrackedObject[][] = [];
let trackCounter = 0;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function trackObjects(frames: ObjectDetectionFrame[]): TrackedObject[] {
  const tracks = new Map<string, TrackedObject>();

  for (const frame of frames) {
    for (const detection of frame.detections) {
      const key = detection.label;
      const existing = tracks.get(key);
      if (!existing) {
        tracks.set(key, {
          trackId: `track-${++trackCounter}`,
          label: detection.label,
          firstSeenMs: frame.timestampMs,
          lastSeenMs: frame.timestampMs,
          points: [{ timestampMs: frame.timestampMs, x: detection.x, y: detection.y, confidence: detection.confidence }],
          averageConfidence: detection.confidence,
        });
      } else {
        existing.lastSeenMs = frame.timestampMs;
        existing.points.push({ timestampMs: frame.timestampMs, x: detection.x, y: detection.y, confidence: detection.confidence });
        existing.averageConfidence = average(existing.points.map(point => point.confidence));
      }
    }
  }

  const results = [...tracks.values()];
  trackingHistory.push(results);
  console.log(`[ObjectTracker] Produced ${results.length} tracks.`);
  return results;
}

export function getTrackingHistory(): TrackedObject[][] {
  return trackingHistory.map(batch => batch.map(track => ({ ...track, points: [...track.points] })));
}

export function _resetObjectTrackerForTest(): void {
  trackingHistory.length = 0;
  trackCounter = 0;
}
