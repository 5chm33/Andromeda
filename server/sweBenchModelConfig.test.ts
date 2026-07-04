/**
 * sweBenchModelConfig.test.ts — Tests for the configurable model provider
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveSWEBenchModelConfig,
  callSWEBenchLLM,
  createSWEBenchLLMProvider,
  type SWEBenchModelConfig,
} from './sweBenchModelConfig.js';

// ─── resolveSWEBenchModelConfig ───────────────────────────────────────────────

describe('resolveSWEBenchModelConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    delete process.env.SWEBENCH_MODEL;
    delete process.env.SWEBENCH_PROVIDER;
    delete process.env.SWEBENCH_THINKING;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    // Restore env
    Object.assign(process.env, originalEnv);
  });

  it('returns claude-sonnet preset by default', () => {
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('anthropic/claude-sonnet-4-5');
    expect(config.modelName).toContain('claude-sonnet');
    expect(config.extendedThinking).toBe(false);
    expect(config.maxTokens).toBe(16000);
  });

  it('returns claude-3-7 preset when SWEBENCH_PROVIDER=claude-3-7', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-3-7';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('anthropic/claude-3-7-sonnet');
    expect(config.modelName).toContain('claude-3-7');
  });

  it('enables extended thinking when SWEBENCH_THINKING=1 and provider is claude-3-7', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-3-7';
    process.env.SWEBENCH_THINKING = '1';
    const config = resolveSWEBenchModelConfig();
    expect(config.extendedThinking).toBe(true);
    expect(config.thinkingBudget).toBe(8000);
    expect(config.temperature).toBe(1); // Required for extended thinking
  });

  it('does not enable extended thinking for claude-sonnet even with SWEBENCH_THINKING=1', () => {
    process.env.SWEBENCH_THINKING = '1';
    const config = resolveSWEBenchModelConfig();
    expect(config.extendedThinking).toBe(false); // claude-sonnet preset has it hardcoded false
  });

  it('returns o3 preset when SWEBENCH_PROVIDER=openai-o3', () => {
    process.env.SWEBENCH_PROVIDER = 'openai-o3';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('openai/o3');
    expect(config.modelName).toContain('o3');
    expect(config.timeoutMs).toBe(300_000);
  });

  it('returns o3-mini preset when SWEBENCH_PROVIDER=openai-o3-mini', () => {
    process.env.SWEBENCH_PROVIDER = 'openai-o3-mini';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('openai/o3-mini');
  });

  it('returns kimi preset when SWEBENCH_PROVIDER=kimi', () => {
    process.env.SWEBENCH_PROVIDER = 'kimi';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('moonshotai/kimi-k2');
    expect(config.temperature).toBe(1);
  });

  it('uses SWEBENCH_MODEL for custom model override', () => {
    process.env.SWEBENCH_MODEL = 'meta-llama/llama-3.1-70b-instruct';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('meta-llama/llama-3.1-70b-instruct');
    expect(config.modelName).toContain('meta-llama');
  });

  it('SWEBENCH_MODEL takes priority over SWEBENCH_PROVIDER', () => {
    process.env.SWEBENCH_MODEL = 'custom/model';
    process.env.SWEBENCH_PROVIDER = 'openai-o3';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('custom/model');
  });

  it('falls back to claude-sonnet for unknown SWEBENCH_PROVIDER', () => {
    process.env.SWEBENCH_PROVIDER = 'nonexistent-provider';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('anthropic/claude-sonnet-4-5');
  });

  it('picks up OPENROUTER_API_KEY', () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('test-key-123');
  });

  it('falls back to ANTHROPIC_API_KEY when OPENROUTER_API_KEY is not set', () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'anthropic-key-456';
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('anthropic-key-456');
  });

  it('returns empty apiKey when no key env vars are set', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('');
  });
});

// ─── callSWEBenchLLM ──────────────────────────────────────────────────────────

describe('callSWEBenchLLM', () => {
  it('returns text content from a successful API response', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test-model',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'test-key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'def fix(): pass' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callSWEBenchLLM(mockConfig, 'Fix this bug');
    expect(result).toBe('def fix(): pass');
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('handles extended thinking response format (array of content blocks)', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'claude-3-7',
      modelId: 'anthropic/claude-3-7-sonnet',
      apiUrl: 'https://example.com/api',
      apiKey: 'test-key',
      maxTokens: 16000,
      temperature: 1,
      extendedThinking: true,
      thinkingBudget: 8000,
      timeoutMs: 30000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: [
              { type: 'thinking', thinking: 'Let me analyze this...' },
              { type: 'text', text: 'Here is the fix:' },
              { type: 'text', text: '\ndef fix(): return True' },
            ],
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callSWEBenchLLM(mockConfig, 'Fix this bug');
    expect(result).toContain('Here is the fix:');
    expect(result).toContain('def fix(): return True');
    expect(result).not.toContain('Let me analyze this'); // thinking block excluded

    vi.unstubAllGlobals();
  });

  it('throws on non-ok HTTP response', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'bad-key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(mockConfig, 'test')).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });

  it('throws on API error in response body', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(mockConfig, 'test')).rejects.toThrow('Rate limit exceeded');

    vi.unstubAllGlobals();
  });

  it('throws when no choices are returned', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(mockConfig, 'test')).rejects.toThrow('no choices');

    vi.unstubAllGlobals();
  });

  it('includes thinking block in request when extendedThinking=true', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'claude-3-7',
      modelId: 'anthropic/claude-3-7-sonnet',
      apiUrl: 'https://example.com/api',
      apiKey: 'key',
      maxTokens: 16000,
      temperature: 1,
      extendedThinking: true,
      thinkingBudget: 8000,
      timeoutMs: 30000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'result' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(mockConfig, 'test');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(body.temperature).toBe(1);

    vi.unstubAllGlobals();
  });
});

// ─── createSWEBenchLLMProvider ────────────────────────────────────────────────

describe('createSWEBenchLLMProvider', () => {
  it('returns a function that calls callSWEBenchLLM with the config', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'patch output' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = createSWEBenchLLMProvider(mockConfig);
    expect(typeof provider).toBe('function');

    const result = await provider('Fix the bug');
    expect(result).toBe('patch output');

    vi.unstubAllGlobals();
  });

  it('passes temperature override to callSWEBenchLLM', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'key',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'result' } }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = createSWEBenchLLMProvider(mockConfig);
    await provider('prompt', 0.7);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.7);

    vi.unstubAllGlobals();
  });
});
