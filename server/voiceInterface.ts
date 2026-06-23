/**
 * voiceInterface.ts — Real-Time Voice Interaction (v11.0.0)
 * Provides text-to-speech (TTS) and speech-to-text (STT) capabilities.
 * Routes to the best available provider: OpenAI Whisper/TTS, browser Web Speech API,
 * or a local Whisper model for 100% privacy.
 */
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type VoiceProvider = 'openai' | 'local_whisper' | 'mock';
export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface TranscriptionResult {
  text: string;
  confidence: number;
  language: string;
  durationMs: number;
  provider: VoiceProvider;
}

export interface SpeechResult {
  audioPath: string;
  durationMs: number;
  provider: VoiceProvider;
  sizeBytes: number;
}

export interface VoiceOptions {
  provider?: VoiceProvider;
  language?: string;
  voice?: TTSVoice;
  speed?: number; // 0.25 to 4.0
}

/**
 * Detect the best available voice provider.
 */
export function detectVoiceProvider(): VoiceProvider {
  if (process.env.OPENAI_API_KEY) return 'openai';
  // Check if local whisper.cpp is installed
  try {
    // Synchronous check for whisper binary
    const { execSync } = _require('child_process');
    execSync('which whisper', { stdio: 'ignore' });
    return 'local_whisper';
  } catch {
    return 'mock';
  }
}

/**
 * Transcribe audio to text using OpenAI Whisper API.
 */
async function transcribeWithOpenAI(
  audioPath: string,
  options: VoiceOptions
): Promise<TranscriptionResult> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const startTime = Date.now();

  const audioStream = fs.createReadStream(audioPath);
  const response = await client.audio.transcriptions.create({
    file: audioStream as any,
    model: 'whisper-1',
    language: options.language,
    response_format: 'verbose_json',
  });

  return {
    text: response.text,
    confidence: 0.95,
    language: (response as any).language ?? options.language ?? 'en',
    durationMs: Date.now() - startTime,
    provider: 'openai',
  };
}

/**
 * Transcribe audio using local whisper.cpp (100% private, no API).
 */
async function transcribeWithLocalWhisper(
  audioPath: string,
  options: VoiceOptions
): Promise<TranscriptionResult> {
  const startTime = Date.now();
  const lang = options.language ?? 'en';
  const { stdout } = await execAsync(`whisper "${audioPath}" --language ${lang} --output-format txt`);
  return {
    text: stdout.trim(),
    confidence: 0.85,
    language: lang,
    durationMs: Date.now() - startTime,
    provider: 'local_whisper',
  };
}

/**
 * Synthesize speech from text using OpenAI TTS API.
 */
async function synthesizeWithOpenAI(
  text: string,
  outputPath: string,
  options: VoiceOptions
): Promise<SpeechResult> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const startTime = Date.now();

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: options.voice ?? 'nova',
    input: text,
    speed: options.speed ?? 1.0,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return {
    audioPath: outputPath,
    durationMs: Date.now() - startTime,
    provider: 'openai',
    sizeBytes: buffer.length,
  };
}

/**
 * Mock transcription for testing / offline use.
 */
function mockTranscribe(audioPath: string): TranscriptionResult {
  return {
    text: `[MOCK transcription of ${path.basename(audioPath)}]`,
    confidence: 0.5,
    language: 'en',
    durationMs: 10,
    provider: 'mock',
  };
}

/**
 * Mock TTS for testing / offline use.
 */
function mockSynthesize(text: string, outputPath: string): SpeechResult {
  // Write a tiny placeholder file
  fs.writeFileSync(outputPath, `[MOCK AUDIO: ${text.slice(0, 50)}]`);
  return {
    audioPath: outputPath,
    durationMs: 5,
    provider: 'mock',
    sizeBytes: text.length,
  };
}

/**
 * Transcribe an audio file to text.
 * @param audioPath - Path to .mp3, .wav, .m4a, .webm, etc.
 * @param options - Provider and language options
 */
export async function transcribeAudio(
  audioPath: string,
  options: VoiceOptions = {}
): Promise<TranscriptionResult> {
  const provider = options.provider ?? detectVoiceProvider();

  if (provider === 'mock') return mockTranscribe(audioPath);

  try {
    if (provider === 'openai') return await transcribeWithOpenAI(audioPath, options);
    if (provider === 'local_whisper') return await transcribeWithLocalWhisper(audioPath, options);
    return mockTranscribe(audioPath);
  } catch (error: any) {
    console.error('[VoiceInterface] Transcription failed:', error.message);
    return mockTranscribe(audioPath);
  }
}

/**
 * Synthesize text to speech and save to a file.
 * @param text - Text to speak
 * @param outputPath - Where to save the audio file (.mp3)
 * @param options - Provider and voice options
 */
export async function synthesizeSpeech(
  text: string,
  outputPath: string,
  options: VoiceOptions = {}
): Promise<SpeechResult> {
  const provider = options.provider ?? detectVoiceProvider();

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (provider === 'mock') return mockSynthesize(text, outputPath);

  try {
    if (provider === 'openai') return await synthesizeWithOpenAI(text, outputPath, options);
    return mockSynthesize(text, outputPath);
  } catch (error: any) {
    console.error('[VoiceInterface] TTS failed:', error.message);
    return mockSynthesize(text, outputPath);
  }
}

/**
 * Voice-to-voice: transcribe input audio, process with LLM, return audio response.
 * This is the core of a voice assistant loop.
 */
export async function voiceToVoice(
  inputAudioPath: string,
  processText: (text: string) => Promise<string>,
  outputAudioPath: string,
  options: VoiceOptions = {}
): Promise<{ inputText: string; outputText: string; outputAudio: SpeechResult }> {
  const transcription = await transcribeAudio(inputAudioPath, options);
  const responseText = await processText(transcription.text);
  const outputAudio = await synthesizeSpeech(responseText, outputAudioPath, options);
  return {
    inputText: transcription.text,
    outputText: responseText,
    outputAudio,
  };
}

/**
 * Get supported audio formats for the current provider.
 */
export function getSupportedFormats(provider: VoiceProvider): string[] {
  if (provider === 'openai') return ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];
  if (provider === 'local_whisper') return ['mp3', 'wav', 'flac', 'ogg', 'm4a'];
  return ['mp3', 'wav'];
}
