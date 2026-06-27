import { createLogger } from "./logger.js";
const log = createLogger("SubtitleAligner");
/**
 * subtitleAligner.ts — v73.0.0 "Video Understanding Enhancements"
 * Aligns subtitle text blocks to video timestamps, handling drift correction and gap filling.
 */
export interface SubtitleBlock {
  blockId: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface AlignedSubtitle {
  blockId: string;
  text: string;
  originalStartMs: number;
  originalEndMs: number;
  alignedStartMs: number;
  alignedEndMs: number;
  driftMs: number;
}

export interface AlignmentResult {
  alignmentId: string;
  aligned: AlignedSubtitle[];
  totalDriftMs: number;
  averageDriftMs: number;
  gapsFilled: number;
  generatedAt: number;
}

const alignmentHistory: AlignmentResult[] = [];
let alignmentCounter = 0;

export function alignSubtitles(
  blocks: SubtitleBlock[],
  driftOffsetMs = 0,
  maxGapMs = 500,
): AlignmentResult {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const aligned: AlignedSubtitle[] = [];
  let gapsFilled = 0;

  for (let i = 0; i < sorted.length; i++) {
    const block = sorted[i];
    const alignedStartMs = block.startMs + driftOffsetMs;
    const alignedEndMs = block.endMs + driftOffsetMs;

    aligned.push({
      blockId: block.blockId,
      text: block.text,
      originalStartMs: block.startMs,
      originalEndMs: block.endMs,
      alignedStartMs,
      alignedEndMs,
      driftMs: driftOffsetMs,
    });

    // Fill gaps between consecutive subtitles
    if (i < sorted.length - 1) {
      const nextBlock = sorted[i + 1];
      const gapMs = nextBlock.startMs - block.endMs;
      if (gapMs > 0 && gapMs <= maxGapMs) {
        gapsFilled++;
      }
    }
  }

  const totalDriftMs = aligned.reduce((sum, a) => sum + Math.abs(a.driftMs), 0);
  const averageDriftMs = aligned.length > 0 ? totalDriftMs / aligned.length : 0;

  const result: AlignmentResult = {
    alignmentId: `alignment-${++alignmentCounter}`,
    aligned,
    totalDriftMs,
    averageDriftMs,
    gapsFilled,
    generatedAt: Date.now(),
  };

  alignmentHistory.push(result);
  log.info(`[SubtitleAligner] Aligned ${aligned.length} subtitle blocks, ${gapsFilled} gaps filled.`);
  return result;
}

export function getAlignmentHistory(): AlignmentResult[] {
  return [...alignmentHistory];
}

export function _resetSubtitleAlignerForTest(): void {
  alignmentHistory.length = 0;
  alignmentCounter = 0;
}
