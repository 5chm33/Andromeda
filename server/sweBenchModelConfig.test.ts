/**
 * sweBenchModelConfig.test.ts — Tests for the configurable model provider (v2.0.0)
 *
 * Covers:
 *   - resolveSWEBenchModelConfig: env-based config resolution for all presets
 *   - callSWEBenchLLM (OpenRouter): request/response handling, extended thinking
 *   - callSWEBenchLLM (Anthropic native): Fable 5, prompt caching, cache_control blocks
 *   - createSWEBenchLLMProvider: drop-in provider factory
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
    delete process.env.ANTHROPIC_FABLE_API_KEY;
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
    expect(config.apiFormat).toBe('openrouter');
    expect(config.promptCaching).toBe(false);
  });

  it('returns claude-3-7 preset when SWEBENCH_PROVIDER=claude-3-7', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-3-7';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('anthropic/claude-3-7-sonnet');
    expect(config.modelName).toContain('claude-3-7');
    expect(config.apiFormat).toBe('openrouter');
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
    expect(config.apiFormat).toBe('openrouter');
  });

  it('returns o3-mini preset when SWEBENCH_PROVIDER=openai-o3-mini', () => {
    process.env.SWEBENCH_PROVIDER = 'openai-o3-mini';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('openai/o3-mini');
    expect(config.apiFormat).toBe('openrouter');
  });

  it('returns kimi preset when SWEBENCH_PROVIDER=kimi', () => {
    process.env.SWEBENCH_PROVIDER = 'kimi';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('moonshotai/kimi-k2');
    expect(config.temperature).toBe(1);
    expect(config.apiFormat).toBe('openrouter');
  });

  it('returns claude-fable-5 preset when SWEBENCH_PROVIDER=claude-fable-5', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-fable-5';
    const config = resolveSWEBenchModelConfig();
    expect(config.modelId).toBe('claude-fable-5');
    expect(config.modelName).toContain('fable-5');
    expect(config.apiUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(config.apiFormat).toBe('anthropic');
    expect(config.promptCaching).toBe(true);
    expect(config.temperature).toBe(1);
    expect(config.maxTokens).toBe(16000);
  });

  it('uses ANTHROPIC_FABLE_API_KEY for claude-fable-5 preset', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-fable-5';
    process.env.ANTHROPIC_FABLE_API_KEY = 'fable-key-xyz';
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('fable-key-xyz');
  });

  it('falls back to ANTHROPIC_API_KEY for fable-5 when ANTHROPIC_FABLE_API_KEY is not set', () => {
    process.env.SWEBENCH_PROVIDER = 'claude-fable-5';
    delete process.env.ANTHROPIC_FABLE_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'fallback-key';
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('fallback-key');
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

  it('picks up OPENROUTER_API_KEY for OpenRouter presets', () => {
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
    delete process.env.ANTHROPIC_FABLE_API_KEY;
    const config = resolveSWEBenchModelConfig();
    expect(config.apiKey).toBe('');
  });
});

// ─── callSWEBenchLLM (OpenRouter format) ─────────────────────────────────────

describe('callSWEBenchLLM (OpenRouter)', () => {
  it('returns text content from a successful API response', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test-model',
      modelId: 'test/model',
      apiUrl: 'https://example.com/api',
      apiKey: 'test-key',
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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

  it('sends Authorization header for OpenRouter', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'test',
      modelId: 'test/model',
      apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'or-key-abc',
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(mockConfig, 'test');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer or-key-abc');
    expect(headers['HTTP-Referer']).toBe('https://andromeda-swebench.ai');

    vi.unstubAllGlobals();
  });

  it('handles extended thinking response format (array of content blocks)', async () => {
    const mockConfig: SWEBenchModelConfig = {
      modelName: 'claude-3-7',
      modelId: 'anthropic/claude-3-7-sonnet',
      apiUrl: 'https://example.com/api',
      apiKey: 'test-key',
      apiFormat: 'openrouter',
      maxTokens: 16000,
      temperature: 1,
      extendedThinking: true,
      thinkingBudget: 8000,
      timeoutMs: 30000,
      promptCaching: false,
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
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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
      apiFormat: 'openrouter',
      maxTokens: 16000,
      temperature: 1,
      extendedThinking: true,
      thinkingBudget: 8000,
      timeoutMs: 30000,
      promptCaching: false,
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

// ─── callSWEBenchLLM (Anthropic native format) ───────────────────────────────

describe('callSWEBenchLLM (Anthropic native / Fable 5)', () => {
  const fableConfig: SWEBenchModelConfig = {
    modelName: 'andromeda-v6-claude-fable-5',
    modelId: 'claude-fable-5',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: 'sk-ant-test-key',
    apiFormat: 'anthropic',
    maxTokens: 16000,
    temperature: 1,
    extendedThinking: false,
    thinkingBudget: 0,
    timeoutMs: 5000,
    promptCaching: true,
  };

  it('uses x-api-key header (not Authorization) for Anthropic native', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'def fix(): pass' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(fableConfig, 'Fix this bug');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['x-api-key']).toBe('sk-ant-test-key');
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');

    vi.unstubAllGlobals();
  });

  it('sends anthropic-beta header when promptCaching=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(fableConfig, 'test');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');

    vi.unstubAllGlobals();
  });

  it('does NOT send anthropic-beta header when promptCaching=false', async () => {
    const noCacheConfig: SWEBenchModelConfig = {
      ...fableConfig,
      promptCaching: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(noCacheConfig, 'test');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['anthropic-beta']).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('adds cache_control to user content block when promptCaching=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(fableConfig, 'Fix this bug');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // User message should have cache_control on the content block
    const userContent = body.messages[0].content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent[0].cache_control).toEqual({ type: 'ephemeral' });

    vi.unstubAllGlobals();
  });

  it('does NOT add cache_control when promptCaching=false', async () => {
    const noCacheConfig: SWEBenchModelConfig = {
      ...fableConfig,
      promptCaching: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(noCacheConfig, 'Fix this bug');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userContent = body.messages[0].content;
    expect(userContent[0].cache_control).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('splits prompt into system + user when ---SYSTEM--- markers are present', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const prompt = '---SYSTEM---\nYou are an expert engineer.\n---USER---\nFix this bug.';
    await callSWEBenchLLM(fableConfig, prompt);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system).toBeDefined();
    expect(body.system[0].text).toContain('You are an expert engineer.');
    expect(body.messages[0].content[0].text).toContain('Fix this bug.');

    vi.unstubAllGlobals();
  });

  it('adds cache_control to system block when promptCaching=true and system is present', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const prompt = '---SYSTEM---\nSystem context here.\n---USER---\nUser message here.';
    await callSWEBenchLLM(fableConfig, prompt);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });

    vi.unstubAllGlobals();
  });

  it('sends entire prompt as user message when no system markers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(fableConfig, 'Plain prompt without markers');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // No system block when no system markers
    expect(body.system).toBeUndefined();
    expect(body.messages[0].content[0].text).toBe('Plain prompt without markers');

    vi.unstubAllGlobals();
  });

  it('returns text content from Anthropic native response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Here is the fix:\n' },
          { type: 'text', text: 'def fix(): return True' },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await callSWEBenchLLM(fableConfig, 'Fix this bug');
    expect(result).toContain('Here is the fix:');
    expect(result).toContain('def fix(): return True');

    vi.unstubAllGlobals();
  });

  it('throws on Anthropic API error response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => 'Overloaded',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(fableConfig, 'test')).rejects.toThrow('529');

    vi.unstubAllGlobals();
  });

  it('throws when Anthropic returns error in body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { message: 'Invalid API key' },
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(fableConfig, 'test')).rejects.toThrow('Invalid API key');

    vi.unstubAllGlobals();
  });

  it('throws when Anthropic returns empty content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(callSWEBenchLLM(fableConfig, 'test')).rejects.toThrow('no content');

    vi.unstubAllGlobals();
  });

  it('uses Anthropic messages format (not OpenAI chat format)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await callSWEBenchLLM(fableConfig, 'test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Anthropic format uses 'messages' array with 'content' array, not 'choices'
    expect(body.messages).toBeDefined();
    expect(body.choices).toBeUndefined();
    // Model field should be the Anthropic model ID
    expect(body.model).toBe('claude-fable-5');

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
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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
      apiFormat: 'openrouter',
      maxTokens: 1000,
      temperature: 0,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: false,
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

  it('works with Fable 5 config (Anthropic native format)', async () => {
    const fableConfig: SWEBenchModelConfig = {
      modelName: 'andromeda-v6-claude-fable-5',
      modelId: 'claude-fable-5',
      apiUrl: 'https://api.anthropic.com/v1/messages',
      apiKey: 'sk-ant-test',
      apiFormat: 'anthropic',
      maxTokens: 16000,
      temperature: 1,
      extendedThinking: false,
      thinkingBudget: 0,
      timeoutMs: 5000,
      promptCaching: true,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'fable result' }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const provider = createSWEBenchLLMProvider(fableConfig);
    const result = await provider('Fix the bug');
    expect(result).toBe('fable result');

    vi.unstubAllGlobals();
  });
});
