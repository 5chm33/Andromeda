import { describe, it, expect, vi } from 'vitest';
import {
  detectVisionProvider,
  detectMimeType,
  analyzeImage,
  analyzeUIScreenshot,
  extractTextFromImage,
} from './visionModule.js';

// Force mock provider so no real API calls are made
vi.stubEnv('OPENAI_API_KEY', '');
vi.stubEnv('ANTHROPIC_API_KEY', '');

describe('detectVisionProvider', () => {
  it('returns mock when no API keys are set', () => {
    const provider = detectVisionProvider();
    expect(provider).toBe('mock');
  });
});

describe('detectMimeType', () => {
  it('detects jpeg', () => expect(detectMimeType('photo.jpg')).toBe('image/jpeg'));
  it('detects png', () => expect(detectMimeType('screenshot.png')).toBe('image/png'));
  it('detects webp', () => expect(detectMimeType('image.webp')).toBe('image/webp'));
  it('defaults to image/png for unknown', () => expect(detectMimeType('file.xyz')).toBe('image/png'));
});

describe('analyzeImage (mock provider)', () => {
  it('returns a VisionAnalysisResult with all required fields', async () => {
    const result = await analyzeImage('test.png', 'Describe this', { provider: 'mock' });
    expect(result).toHaveProperty('description');
    expect(result).toHaveProperty('objects');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('uiElements');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('durationMs');
  });

  it('provider field is mock', async () => {
    const result = await analyzeImage('test.png', 'test', { provider: 'mock' });
    if ('error' in result) throw new Error('Expected result, got error');
    expect(result.provider).toBe('mock');
  });

  it('confidence is between 0 and 1', async () => {
    const result = await analyzeImage('test.png', 'test', { provider: 'mock' });
    if ('error' in result) throw new Error('Expected result, got error');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('objects is an array', async () => {
    const result = await analyzeImage('test.png', 'test', { provider: 'mock' });
    if ('error' in result) throw new Error('Expected result, got error');
    expect(Array.isArray(result.objects)).toBe(true);
  });

  it('uiElements is an array', async () => {
    const result = await analyzeImage('test.png', 'test', { provider: 'mock' });
    if ('error' in result) throw new Error('Expected result, got error');
    expect(Array.isArray(result.uiElements)).toBe(true);
  });
});

describe('analyzeUIScreenshot (mock provider)', () => {
  it('returns a result without throwing', async () => {
    const result = await analyzeUIScreenshot('screenshot.png', { provider: 'mock' });
    expect(result).toBeDefined();
  });
});

describe('extractTextFromImage (mock provider)', () => {
  it('returns an array of strings', async () => {
    const result = await extractTextFromImage('image.png', { provider: 'mock' });
    expect(Array.isArray(result)).toBe(true);
  });
});
