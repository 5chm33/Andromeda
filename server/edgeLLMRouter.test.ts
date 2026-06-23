import { describe, it, expect, vi } from 'vitest';
import {
  routeRequest,
  getModelCatalog,
  estimateCost,
  isOllamaAvailable,
  infer,
} from './edgeLLMRouter.js';

// Mock fetch so no real network calls are made
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url.includes('11434')) {
    // Ollama not available in test
    throw new Error('Connection refused');
  }
  return { ok: false, status: 503 };
}));

vi.stubEnv('OPENAI_API_KEY', '');

describe('getModelCatalog', () => {
  it('returns a non-empty array', () => {
    const catalog = getModelCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('every entry has required fields', () => {
    for (const entry of getModelCatalog()) {
      expect(entry).toHaveProperty('provider');
      expect(entry).toHaveProperty('model');
      expect(entry).toHaveProperty('tier');
      expect(entry).toHaveProperty('costPerToken');
      expect(entry).toHaveProperty('capabilities');
    }
  });

  it('contains at least one edge model', () => {
    const edgeModels = getModelCatalog().filter(m => m.tier === 'edge');
    expect(edgeModels.length).toBeGreaterThan(0);
  });

  it('contains at least one cloud model', () => {
    const cloudModels = getModelCatalog().filter(m => m.tier !== 'edge');
    expect(cloudModels.length).toBeGreaterThan(0);
  });
});

describe('estimateCost', () => {
  it('returns 0 for edge models', () => {
    const cost = estimateCost(1000, 'llama3.1:8b');
    expect(cost).toBe(0);
  });

  it('returns a positive number for cloud models', () => {
    const cost = estimateCost(4000, 'gpt-4o');
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for unknown models', () => {
    const cost = estimateCost(1000, 'unknown-model');
    expect(cost).toBe(0);
  });
});

describe('isOllamaAvailable', () => {
  it('returns false when Ollama is not running', async () => {
    const available = await isOllamaAvailable();
    expect(available).toBe(false);
  });
});

describe('routeRequest', () => {
  it('returns a RoutingDecision with all required fields', async () => {
    const decision = await routeRequest('What is 2+2?', { taskType: 'simple_qa' });
    expect(decision).toHaveProperty('provider');
    expect(decision).toHaveProperty('model');
    expect(decision).toHaveProperty('tier');
    expect(decision).toHaveProperty('reason');
    expect(decision).toHaveProperty('estimatedCostUSD');
    expect(decision).toHaveProperty('estimatedLatencyMs');
  });

  it('estimatedCostUSD is non-negative', async () => {
    const decision = await routeRequest('Hello', { taskType: 'classify' });
    expect(decision.estimatedCostUSD).toBeGreaterThanOrEqual(0);
  });

  it('estimatedLatencyMs is positive', async () => {
    const decision = await routeRequest('Hello', { taskType: 'summarize' });
    expect(decision.estimatedLatencyMs).toBeGreaterThan(0);
  });

  it('sensitive privacy level routes to local or fallback', async () => {
    const decision = await routeRequest('Secret data', { privacyLevel: 'sensitive' });
    // With Ollama unavailable, should fall back gracefully
    expect(decision).toHaveProperty('model');
  });
});

describe('infer', () => {
  it('returns an LLMResponse with all fields', async () => {
    const response = await infer('Say hello', { taskType: 'simple_qa' });
    expect(response).toHaveProperty('text');
    expect(response).toHaveProperty('model');
    expect(response).toHaveProperty('provider');
    expect(response).toHaveProperty('inputTokens');
    expect(response).toHaveProperty('outputTokens');
    expect(response).toHaveProperty('durationMs');
    expect(response).toHaveProperty('costUSD');
  });

  it('durationMs is non-negative', async () => {
    const response = await infer('Test', { taskType: 'classify' });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('costUSD is non-negative', async () => {
    const response = await infer('Test', { taskType: 'simple_qa' });
    expect(response.costUSD).toBeGreaterThanOrEqual(0);
  });
});
