/**
 * speechRecognizer.ts — v72.0.0 "Multi-Modal Fusion"
 * Speech recognition with word timestamps, speaker diarization, and confidence scoring.
 */
export interface WordTimestamp { word: string; startMs: number; endMs: number; confidence: number; }
export interface SpeakerSegment { speakerId: string; startMs: number; endMs: number; text: string; }
export interface RecognitionResult { recognitionId: string; audioId: string; transcript: string; words: WordTimestamp[]; speakers: SpeakerSegment[]; language: string; overallConfidence: number; processingMs: number; }

const results: RecognitionResult[] = [];
let recCounter = 0;

export function recognizeSpeech(audioId: string, language: string, words: Array<{ word: string; startMs: number; endMs: number; confidence: number }>, speakers?: Array<{ speakerId: string; startMs: number; endMs: number }>): RecognitionResult {
  const start = Date.now();
  const wordTimestamps: WordTimestamp[] = words.map(w => ({ ...w }));
  const transcript = words.map(w => w.word).join(" ");
  const overallConfidence = words.length > 0 ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  const speakerSegments: SpeakerSegment[] = (speakers ?? []).map(s => {
    const segWords = words.filter(w => w.startMs >= s.startMs && w.endMs <= s.endMs);
    return { ...s, text: segWords.map(w => w.word).join(" ") };
  });
  const result: RecognitionResult = { recognitionId: `rec-${++recCounter}`, audioId, transcript, words: wordTimestamps, speakers: speakerSegments, language, overallConfidence, processingMs: Date.now() - start };
  results.push(result);
  return result;
}

export function getRecognitionHistory(): RecognitionResult[] { return [...results]; }
export function _resetSpeechRecognizerForTest(): void { results.length = 0; recCounter = 0; }
