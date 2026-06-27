/**
 * videoFrameAnalyzer.ts — v72.0.0 "Multi-Modal Fusion"
 * Video frame analysis: keyframe extraction, scene change detection, motion analysis, and temporal summarization.
 */
export interface VideoFrame { frameId: string; timestamp: number; sceneType: string; objects: string[]; isKeyframe: boolean; motionScore: number; }
export interface VideoAnalysis { videoId: string; totalFrames: number; durationMs: number; keyframes: VideoFrame[]; sceneChanges: number; dominantScenes: string[]; summary: string; }

const analyses: VideoAnalysis[] = [];
let videoCounter = 0;

export function analyzeVideo(durationMs: number, frames: Array<{ timestamp: number; sceneType: string; objects: string[]; motionScore?: number }>): VideoAnalysis {
  const processedFrames: VideoFrame[] = frames.map((f, i) => ({
    frameId: `frame-${i + 1}`, timestamp: f.timestamp, sceneType: f.sceneType, objects: f.objects,
    isKeyframe: i === 0 || f.sceneType !== frames[i - 1]?.sceneType || (f.motionScore ?? 0) > 0.7,
    motionScore: f.motionScore ?? 0
  }));
  const keyframes = processedFrames.filter(f => f.isKeyframe);
  const sceneTypes = frames.map(f => f.sceneType);
  const sceneCounts = sceneTypes.reduce((acc: Record<string, number>, s) => { acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});
  const dominantScenes = Object.entries(sceneCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
  let sceneChanges = 0;
  for (let i = 1; i < frames.length; i++) if (frames[i].sceneType !== frames[i - 1].sceneType) sceneChanges++;
  const analysis: VideoAnalysis = { videoId: `video-${++videoCounter}`, totalFrames: frames.length, durationMs, keyframes, sceneChanges, dominantScenes, summary: `${frames.length} frames, ${sceneChanges} scene changes, dominant: ${dominantScenes[0] ?? "unknown"}` };
  analyses.push(analysis);
  return analysis;
}

export function getVideoAnalyses(): VideoAnalysis[] { return [...analyses]; }
export function _resetVideoFrameAnalyzerForTest(): void { analyses.length = 0; videoCounter = 0; }
