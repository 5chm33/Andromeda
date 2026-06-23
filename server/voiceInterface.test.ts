import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  detectVoiceProvider,
  transcribeAudio,
  synthesizeSpeech,
  getSupportedFormats,
  voiceToVoice,
} from './voiceInterface.js';

// No API keys — all calls use mock provider
vi.stubEnv('OPENAI_API_KEY', '');

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice_test_'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectVoiceProvider', () => {
  it('returns mock when no API keys are set', () => {
    expect(detectVoiceProvider()).toBe('mock');
  });
});

describe('getSupportedFormats', () => {
  it('returns formats for openai', () => {
    const formats = getSupportedFormats('openai');
    expect(formats).toContain('mp3');
    expect(formats).toContain('wav');
  });

  it('returns formats for mock', () => {
    const formats = getSupportedFormats('mock');
    expect(Array.isArray(formats)).toBe(true);
    expect(formats.length).toBeGreaterThan(0);
  });
});

describe('transcribeAudio (mock)', () => {
  it('returns a TranscriptionResult with all fields', async () => {
    const result = await transcribeAudio('test.mp3', { provider: 'mock' });
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('language');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('provider');
  });

  it('provider is mock', async () => {
    const result = await transcribeAudio('test.mp3', { provider: 'mock' });
    expect(result.provider).toBe('mock');
  });

  it('confidence is between 0 and 1', async () => {
    const result = await transcribeAudio('test.wav', { provider: 'mock' });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('synthesizeSpeech (mock)', () => {
  it('creates an output file', async () => {
    const outPath = path.join(tmpDir, 'output.mp3');
    const result = await synthesizeSpeech('Hello world', outPath, { provider: 'mock' });
    expect(result.audioPath).toBe(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('returns a SpeechResult with all fields', async () => {
    const outPath = path.join(tmpDir, 'speech.mp3');
    const result = await synthesizeSpeech('Test text', outPath, { provider: 'mock' });
    expect(result).toHaveProperty('audioPath');
    expect(result).toHaveProperty('durationMs');
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('sizeBytes');
  });

  it('sizeBytes is positive', async () => {
    const outPath = path.join(tmpDir, 'test.mp3');
    const result = await synthesizeSpeech('Some text here', outPath, { provider: 'mock' });
    expect(result.sizeBytes).toBeGreaterThan(0);
  });
});

describe('voiceToVoice (mock)', () => {
  it('runs the full pipeline and returns all fields', async () => {
    const inputPath = path.join(tmpDir, 'input.mp3');
    const outputPath = path.join(tmpDir, 'output.mp3');
    // Create a dummy input file
    fs.writeFileSync(inputPath, 'dummy audio data');

    const result = await voiceToVoice(
      inputPath,
      async (text) => `Response to: ${text}`,
      outputPath,
      { provider: 'mock' }
    );

    expect(result).toHaveProperty('inputText');
    expect(result).toHaveProperty('outputText');
    expect(result).toHaveProperty('outputAudio');
    expect(result.outputText).toContain('Response to:');
  });
});
