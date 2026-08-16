import { afterEach, describe, expect, it, vi } from "vitest";

// The shared setup mocks LLM calls for ordinary tests. This suite verifies the
// real provider implementation and supplies its own deterministic fetch mock.
vi.unmock("./llmProvider.js");

import {
  chatCompletion,
  getActiveProvider,
  resolveProviderFromEnv,
  setActiveProvider,
  streamChatCompletion,
  switchProvider,
} from "./llmProvider.js";

const ENV_KEYS = [
  "LLM_MODEL",
  "LLM_LOCAL_ONLY",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_FALLBACK_ENABLED",
  "DEEPSEEK_API_KEY",
  "KIMI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
];
const originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("local Ollama fallback", () => {
  it("uses Ollama directly when local-only mode is enabled", () => {
    process.env.LLM_LOCAL_ONLY = "1";
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434";
    process.env.OLLAMA_MODEL = "qwen2.5-coder:7b";

    const provider = resolveProviderFromEnv();

    expect(provider.id).toBe("ollama");
    expect(provider.apiUrl).toBe("http://ollama.test:11434/v1/chat/completions");
    expect(provider.model).toBe("qwen2.5-coder:7b");
    expect(provider.apiKey).toBe("ollama");
  });

  it("keeps Ollama active when UI state attempts to restore a paid provider", () => {
    process.env.LLM_LOCAL_ONLY = "true";
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434";
    process.env.OLLAMA_MODEL = "qwen2.5-coder:7b";

    switchProvider("deepseek");
    setActiveProvider({ id: "openrouter", model: "some-paid-model" });

    const active = getActiveProvider();
    expect(active.id).toBe("ollama");
    expect(active.apiUrl).toBe("http://ollama.test:11434/v1/chat/completions");
    expect(active.model).toBe("qwen2.5-coder:7b");
  });

  it("falls back from a DeepSeek 402 to local Ollama without another paid request", async () => {
    process.env.LLM_LOCAL_ONLY = "0";
    process.env.LLM_MODEL = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434";
    process.env.OLLAMA_MODEL = "qwen2.5-coder:7b";
    process.env.OLLAMA_FALLBACK_ENABLED = "true";
    delete process.env.KIMI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
    switchProvider("deepseek");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "local answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion([{ role: "user", content: "hello" }], { plainText: true });

    expect(result.content).toBe("local answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(fetchMock.mock.calls[1][0]).toBe("http://ollama.test:11434/v1/chat/completions");
    const ollamaBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(ollamaBody.model).toBe("qwen2.5-coder:7b");
    expect(ollamaBody.tools).toBeUndefined();
  });

  it("retries a streaming DeepSeek 402 through local Ollama", async () => {
    process.env.LLM_LOCAL_ONLY = "0";
    process.env.LLM_MODEL = "deepseek";
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434";
    process.env.OLLAMA_MODEL = "qwen2.5-coder:7b";
    process.env.OLLAMA_FALLBACK_ENABLED = "true";
    delete process.env.KIMI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GROQ_API_KEY;
    switchProvider("deepseek");

    const stream = [
      'data: {"choices":[{"delta":{"content":"local stream"},"finish_reason":null}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      "data: [DONE]\n",
    ].join("\n");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }))
      .mockResolvedValueOnce(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks = [];
    for await (const chunk of streamChatCompletion([{ role: "user", content: "hello" }])) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual(expect.objectContaining({ type: "text", text: "local stream" }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: "done" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("http://ollama.test:11434/v1/chat/completions");
  });
});
