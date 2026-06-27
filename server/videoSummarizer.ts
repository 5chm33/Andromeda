import { createLogger } from "./logger.js";
const log = createLogger("VideoSummarizer");
/**
 * videoSummarizer.ts — v73.0.0 "Video Understanding Enhancements"
 * Produces a structured textual summary of a video from scene segments, captions, and tracked objects.
 */
export interface VideoSummaryInput {
  videoId: string;
  durationMs: number;
  sceneLabels: string[];
  trackedObjects: string[];
  captions: string[];
  motionProfile: "static" | "low" | "moderate" | "high" | "dynamic";
}

export interface VideoSummary {
  summaryId: string;
  videoId: string;
  durationMs: number;
  headline: string;
  body: string;
  keyTopics: string[];
  motionProfile: string;
  generatedAt: number;
}

const summaryHistory: VideoSummary[] = [];
let summaryCounter = 0;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${seconds}s`;
}

export function summarizeVideo(input: VideoSummaryInput): VideoSummary {
  const uniqueScenes = [...new Set(input.sceneLabels)];
  const uniqueObjects = [...new Set(input.trackedObjects)];
  const durationStr = formatDuration(input.durationMs);

  const headline = `${durationStr} video featuring ${uniqueScenes.slice(0, 2).join(" and ") || "unclassified"} scenes`;

  const parts: string[] = [];
  if (uniqueScenes.length > 0) parts.push(`The video spans ${durationStr} and contains ${uniqueScenes.length} distinct scene type(s): ${uniqueScenes.join(", ")}.`);
  if (uniqueObjects.length > 0) parts.push(`Detected objects include: ${uniqueObjects.slice(0, 5).join(", ")}.`);
  if (input.captions.length > 0) parts.push(`Key moments: ${input.captions.slice(0, 2).join("; ")}.`);
  parts.push(`Overall motion profile: ${input.motionProfile}.`);

  const body = parts.join(" ");
  const keyTopics = [...uniqueScenes.slice(0, 3), ...uniqueObjects.slice(0, 3)].filter(Boolean);

  const summary: VideoSummary = {
    summaryId: `video-summary-${++summaryCounter}`,
    videoId: input.videoId,
    durationMs: input.durationMs,
    headline,
    body,
    keyTopics,
    motionProfile: input.motionProfile,
    generatedAt: Date.now(),
  };

  summaryHistory.push(summary);
  log.info(`[VideoSummarizer] Summarized video ${input.videoId}: "${headline}"`);
  return summary;
}

export function getSummaryHistory(): VideoSummary[] {
  return [...summaryHistory];
}

export function _resetVideoSummarizerForTest(): void {
  summaryHistory.length = 0;
  summaryCounter = 0;
}
