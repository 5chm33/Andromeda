/**
 * v73.test.ts — Video Understanding Enhancements
 * Comprehensive tests for all 6 v73 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { segmentScenes, getSceneSegmentationHistory, _resetSceneSegmenterForTest } from "./sceneSegmenter";
import { trackObjects, getTrackingHistory, _resetObjectTrackerForTest } from "./objectTracker";
import { detectMotionEvents, getMotionEventHistory, _resetMotionEventDetectorForTest } from "./motionEventDetector";
import { generateTemporalCaptions, getCaptionHistory, _resetTemporalCaptionerForTest } from "./temporalCaptioner";
import { alignSubtitles, getAlignmentHistory, _resetSubtitleAlignerForTest } from "./subtitleAligner";
import { summarizeVideo, getSummaryHistory, _resetVideoSummarizerForTest } from "./videoSummarizer";

// ─── sceneSegmenter ──────────────────────────────────────────────────────────
describe("sceneSegmenter", () => {
  beforeEach(() => _resetSceneSegmenterForTest());

  it("segments frames into scenes by label change", () => {
    const frames = [
      { timestampMs: 0, sceneLabel: "indoor", motionScore: 0.2, confidence: 0.9 },
      { timestampMs: 500, sceneLabel: "indoor", motionScore: 0.2, confidence: 0.9 },
      { timestampMs: 1000, sceneLabel: "outdoor", motionScore: 0.3, confidence: 0.9 },
      { timestampMs: 1500, sceneLabel: "outdoor", motionScore: 0.3, confidence: 0.9 },
    ];
    const result = segmentScenes("vid-1", frames);
    expect(result.videoId).toBe("vid-1");
    expect(result.segments.length).toBe(2);
    expect(result.segments[0].dominantLabel).toBe("indoor");
    expect(result.segments[1].dominantLabel).toBe("outdoor");
    expect(result.totalFrames).toBe(4);
  });

  it("handles empty frames gracefully", () => {
    const result = segmentScenes("vid-empty", []);
    expect(result.segments.length).toBe(0);
    expect(result.totalFrames).toBe(0);
  });

  it("segments by motion delta threshold", () => {
    const frames = [
      { timestampMs: 0, sceneLabel: "A", motionScore: 0.1, confidence: 0.9 },
      { timestampMs: 500, sceneLabel: "A", motionScore: 0.8, confidence: 0.9 },
    ];
    const result = segmentScenes("vid-2", frames, 0.35);
    expect(result.segments.length).toBe(2);
  });

  it("accumulates segmentation history", () => {
    segmentScenes("v1", [{ timestampMs: 0, sceneLabel: "A", motionScore: 0.1, confidence: 0.9 }]);
    segmentScenes("v2", [{ timestampMs: 0, sceneLabel: "B", motionScore: 0.1, confidence: 0.9 }]);
    expect(getSceneSegmentationHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    segmentScenes("v1", [{ timestampMs: 0, sceneLabel: "A", motionScore: 0.1, confidence: 0.9 }]);
    _resetSceneSegmenterForTest();
    expect(getSceneSegmentationHistory().length).toBe(0);
  });
});

// ─── objectTracker ───────────────────────────────────────────────────────────
describe("objectTracker", () => {
  beforeEach(() => _resetObjectTrackerForTest());

  it("tracks objects across frames", () => {
    const frames = [
      { timestampMs: 0, detections: [{ label: "cat", x: 10, y: 20, confidence: 0.9 }] },
      { timestampMs: 500, detections: [{ label: "cat", x: 15, y: 25, confidence: 0.85 }] },
      { timestampMs: 1000, detections: [{ label: "dog", x: 50, y: 60, confidence: 0.8 }] },
    ];
    const tracks = trackObjects(frames);
    expect(tracks.length).toBe(2);
    const catTrack = tracks.find(t => t.label === "cat");
    expect(catTrack).toBeDefined();
    expect(catTrack?.points.length).toBe(2);
    expect(catTrack?.firstSeenMs).toBe(0);
    expect(catTrack?.lastSeenMs).toBe(500);
  });

  it("computes average confidence correctly", () => {
    const frames = [
      { timestampMs: 0, detections: [{ label: "car", x: 0, y: 0, confidence: 0.8 }] },
      { timestampMs: 100, detections: [{ label: "car", x: 5, y: 5, confidence: 0.6 }] },
    ];
    const tracks = trackObjects(frames);
    const carTrack = tracks.find(t => t.label === "car");
    expect(carTrack?.averageConfidence).toBeCloseTo(0.7);
  });

  it("handles empty frames", () => {
    const tracks = trackObjects([]);
    expect(tracks.length).toBe(0);
  });

  it("accumulates tracking history", () => {
    trackObjects([{ timestampMs: 0, detections: [{ label: "x", x: 0, y: 0, confidence: 0.9 }] }]);
    trackObjects([{ timestampMs: 0, detections: [{ label: "y", x: 0, y: 0, confidence: 0.9 }] }]);
    expect(getTrackingHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    trackObjects([{ timestampMs: 0, detections: [{ label: "x", x: 0, y: 0, confidence: 0.9 }] }]);
    _resetObjectTrackerForTest();
    expect(getTrackingHistory().length).toBe(0);
  });
});

// ─── motionEventDetector ─────────────────────────────────────────────────────
describe("motionEventDetector", () => {
  beforeEach(() => _resetMotionEventDetectorForTest());

  it("detects motion start event", () => {
    const samples = [
      { timestampMs: 0, motionScore: 0.1 },
      { timestampMs: 100, motionScore: 0.5 },
    ];
    const events = detectMotionEvents(samples, 0.3);
    const startEvent = events.find(e => e.eventType === "start");
    expect(startEvent).toBeDefined();
    expect(startEvent?.timestampMs).toBe(100);
  });

  it("detects motion stop event", () => {
    const samples = [
      { timestampMs: 0, motionScore: 0.5 },
      { timestampMs: 100, motionScore: 0.05 },
    ];
    const events = detectMotionEvents(samples, 0.3, 0.1);
    const stopEvent = events.find(e => e.eventType === "stop");
    expect(stopEvent).toBeDefined();
  });

  it("detects spike event", () => {
    const samples = [
      { timestampMs: 0, motionScore: 0.3 },
      { timestampMs: 100, motionScore: 0.9 },
    ];
    const events = detectMotionEvents(samples, 0.3, 0.1, 0.7);
    const spikeEvent = events.find(e => e.eventType === "spike");
    expect(spikeEvent).toBeDefined();
  });

  it("handles empty samples", () => {
    const events = detectMotionEvents([]);
    expect(events.length).toBe(0);
  });

  it("accumulates event history", () => {
    detectMotionEvents([{ timestampMs: 0, motionScore: 0.1 }]);
    detectMotionEvents([{ timestampMs: 0, motionScore: 0.5 }]);
    expect(getMotionEventHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    detectMotionEvents([{ timestampMs: 0, motionScore: 0.5 }]);
    _resetMotionEventDetectorForTest();
    expect(getMotionEventHistory().length).toBe(0);
  });
});

// ─── temporalCaptioner ───────────────────────────────────────────────────────
describe("temporalCaptioner", () => {
  beforeEach(() => _resetTemporalCaptionerForTest());

  it("generates captions for video segments", () => {
    const inputs = [
      { timestampMs: 0, sceneLabel: "indoor", detectedObjects: ["table", "chair"], motionScore: 0.2 },
      { timestampMs: 500, sceneLabel: "indoor", detectedObjects: ["lamp"], motionScore: 0.15 },
      { timestampMs: 2500, sceneLabel: "outdoor", detectedObjects: ["tree"], motionScore: 0.6 },
    ];
    const captions = generateTemporalCaptions(inputs, 2000);
    expect(captions.length).toBeGreaterThan(0);
    expect(captions[0].text).toContain("indoor");
  });

  it("handles empty inputs", () => {
    const captions = generateTemporalCaptions([]);
    expect(captions.length).toBe(0);
  });

  it("assigns correct timestamps to captions", () => {
    const inputs = [
      { timestampMs: 0, sceneLabel: "A", detectedObjects: [], motionScore: 0.1 },
      { timestampMs: 3000, sceneLabel: "B", detectedObjects: [], motionScore: 0.2 },
    ];
    const captions = generateTemporalCaptions(inputs, 2000);
    expect(captions[0].startMs).toBe(0);
  });

  it("accumulates caption history", () => {
    generateTemporalCaptions([{ timestampMs: 0, sceneLabel: "A", detectedObjects: [], motionScore: 0.1 }]);
    generateTemporalCaptions([{ timestampMs: 0, sceneLabel: "B", detectedObjects: [], motionScore: 0.2 }]);
    expect(getCaptionHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    generateTemporalCaptions([{ timestampMs: 0, sceneLabel: "A", detectedObjects: [], motionScore: 0.1 }]);
    _resetTemporalCaptionerForTest();
    expect(getCaptionHistory().length).toBe(0);
  });
});

// ─── subtitleAligner ─────────────────────────────────────────────────────────
describe("subtitleAligner", () => {
  beforeEach(() => _resetSubtitleAlignerForTest());

  it("aligns subtitles with drift offset", () => {
    const blocks = [
      { blockId: "s1", text: "Hello world", startMs: 1000, endMs: 2000 },
      { blockId: "s2", text: "Goodbye world", startMs: 3000, endMs: 4000 },
    ];
    const result = alignSubtitles(blocks, 200);
    expect(result.aligned.length).toBe(2);
    expect(result.aligned[0].alignedStartMs).toBe(1200);
    expect(result.aligned[0].driftMs).toBe(200);
    expect(result.averageDriftMs).toBe(200);
  });

  it("handles zero drift offset", () => {
    const blocks = [{ blockId: "s1", text: "Test", startMs: 500, endMs: 1000 }];
    const result = alignSubtitles(blocks, 0);
    expect(result.aligned[0].alignedStartMs).toBe(500);
    expect(result.aligned[0].driftMs).toBe(0);
  });

  it("handles empty blocks", () => {
    const result = alignSubtitles([]);
    expect(result.aligned.length).toBe(0);
    expect(result.totalDriftMs).toBe(0);
  });

  it("sorts blocks by startMs", () => {
    const blocks = [
      { blockId: "s2", text: "Second", startMs: 2000, endMs: 3000 },
      { blockId: "s1", text: "First", startMs: 0, endMs: 1000 },
    ];
    const result = alignSubtitles(blocks, 0);
    expect(result.aligned[0].blockId).toBe("s1");
  });

  it("accumulates alignment history", () => {
    alignSubtitles([{ blockId: "s1", text: "A", startMs: 0, endMs: 500 }]);
    alignSubtitles([{ blockId: "s2", text: "B", startMs: 0, endMs: 500 }]);
    expect(getAlignmentHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    alignSubtitles([{ blockId: "s1", text: "A", startMs: 0, endMs: 500 }]);
    _resetSubtitleAlignerForTest();
    expect(getAlignmentHistory().length).toBe(0);
  });
});

// ─── videoSummarizer ─────────────────────────────────────────────────────────
describe("videoSummarizer", () => {
  beforeEach(() => _resetVideoSummarizerForTest());

  it("generates a structured video summary", () => {
    const input = {
      videoId: "vid-1",
      durationMs: 60000,
      sceneLabels: ["indoor", "outdoor", "indoor"],
      trackedObjects: ["person", "car", "tree"],
      captions: ["Person walking indoors", "Car passing by"],
      motionProfile: "moderate" as const,
    };
    const summary = summarizeVideo(input);
    expect(summary.summaryId).toBe("video-summary-1");
    expect(summary.videoId).toBe("vid-1");
    expect(summary.headline).toContain("indoor");
    expect(summary.body).toContain("moderate");
    expect(summary.keyTopics.length).toBeGreaterThan(0);
  });

  it("deduplicates scene labels and objects", () => {
    const input = {
      videoId: "vid-2",
      durationMs: 30000,
      sceneLabels: ["A", "A", "B", "B"],
      trackedObjects: ["cat", "cat", "dog"],
      captions: [],
      motionProfile: "low" as const,
    };
    const summary = summarizeVideo(input);
    expect(summary.body).toContain("2 distinct scene type(s)");
  });

  it("handles empty inputs gracefully", () => {
    const input = {
      videoId: "vid-empty",
      durationMs: 5000,
      sceneLabels: [],
      trackedObjects: [],
      captions: [],
      motionProfile: "static" as const,
    };
    const summary = summarizeVideo(input);
    expect(summary.body).toContain("static");
  });

  it("formats duration correctly", () => {
    const input = {
      videoId: "vid-3",
      durationMs: 90000,
      sceneLabels: ["A"],
      trackedObjects: [],
      captions: [],
      motionProfile: "high" as const,
    };
    const summary = summarizeVideo(input);
    expect(summary.headline).toContain("1m 30s");
  });

  it("accumulates summary history", () => {
    const base = { durationMs: 1000, sceneLabels: ["A"], trackedObjects: [], captions: [], motionProfile: "low" as const };
    summarizeVideo({ ...base, videoId: "v1" });
    summarizeVideo({ ...base, videoId: "v2" });
    expect(getSummaryHistory().length).toBe(2);
  });

  it("resets cleanly", () => {
    summarizeVideo({ videoId: "v1", durationMs: 1000, sceneLabels: [], trackedObjects: [], captions: [], motionProfile: "static" });
    _resetVideoSummarizerForTest();
    expect(getSummaryHistory().length).toBe(0);
  });
});
