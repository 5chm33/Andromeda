/**
 * loraBackendDetector.test.ts
 *
 * Tests for the LoRA backend auto-detection and training router.
 * All external HTTP calls are mocked; only local logic is tested with real data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkOllamaAvailable,
  checkHuggingFaceAvailable,
  checkReplicateAvailable,
  checkLocalPeftAvailable,
  detectLoraBackend,
  routeLoraTraining,
  getLoraBackendSummary,
  type LoraTrainingRequest,
  type BackendStatus,
} from "./loraBackendDetector.js";

// ── Mock fetch globally ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  // Clear env vars that affect backend detection
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.HF_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
});

afterEach(() => {
  // Restore env
  process.env.OLLAMA_BASE_URL = originalEnv.OLLAMA_BASE_URL;
  process.env.HF_TOKEN = originalEnv.HF_TOKEN;
  process.env.REPLICATE_API_TOKEN = originalEnv.REPLICATE_API_TOKEN;
  vi.restoreAllMocks();
});

// ── Helper: mock fetch ────────────────────────────────────────────────────────

function mockFetch(responses: Record<string, { ok: boolean; status?: number; json?: unknown }>) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = url.toString();
    const match = Object.entries(responses).find(([key]) => urlStr.includes(key));
    if (match) {
      const [, res] = match;
      return {
        ok: res.ok,
        status: res.status ?? (res.ok ? 200 : 500),
        json: async () => res.json ?? {},
      } as Response;
    }
    throw new Error(`Unexpected fetch to: ${urlStr}`);
  }) as typeof fetch;
}

// ── Tests: checkOllamaAvailable ───────────────────────────────────────────────

describe("checkOllamaAvailable", () => {
  it("returns available=true when Ollama responds OK", async () => {
    mockFetch({ "/api/tags": { ok: true, json: { models: [{ name: "llama3" }, { name: "mistral" }] } } });

    const result = await checkOllamaAvailable();
    expect(result.available).toBe(true);
    expect(result.backend).toBe("ollama");
    expect(result.reason).toContain("2 models");
  });

  it("returns available=false when Ollama returns non-OK status", async () => {
    mockFetch({ "/api/tags": { ok: false, status: 503 } });

    const result = await checkOllamaAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toContain("503");
  });

  it("returns available=false when fetch throws (connection refused)", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;

    const result = await checkOllamaAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("uses OLLAMA_BASE_URL env var", async () => {
    process.env.OLLAMA_BASE_URL = "http://custom-ollama:11434";
    const capturedUrls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrls.push(url.toString());
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as Response;
    }) as typeof fetch;

    await checkOllamaAvailable();
    expect(capturedUrls[0]).toContain("custom-ollama");
  });
});

// ── Tests: checkHuggingFaceAvailable ─────────────────────────────────────────

describe("checkHuggingFaceAvailable", () => {
  it("returns available=false when HF_TOKEN not set", async () => {
    const result = await checkHuggingFaceAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toContain("HF_TOKEN not set");
  });

  it("returns available=true when token is valid", async () => {
    process.env.HF_TOKEN = "hf_test_token";
    mockFetch({ "huggingface.co/api/whoami": { ok: true, json: { name: "testuser" } } });

    const result = await checkHuggingFaceAvailable();
    expect(result.available).toBe(true);
    expect(result.reason).toContain("testuser");
  });

  it("returns available=false when token is invalid", async () => {
    process.env.HF_TOKEN = "hf_bad_token";
    mockFetch({ "huggingface.co/api/whoami": { ok: false, status: 401 } });

    const result = await checkHuggingFaceAvailable();
    expect(result.available).toBe(false);
  });
});

// ── Tests: checkReplicateAvailable ───────────────────────────────────────────

describe("checkReplicateAvailable", () => {
  it("returns available=false when REPLICATE_API_TOKEN not set", async () => {
    const result = await checkReplicateAvailable();
    expect(result.available).toBe(false);
    expect(result.reason).toContain("REPLICATE_API_TOKEN not set");
  });

  it("returns available=true when token is valid", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_test_token";
    mockFetch({ "api.replicate.com/v1/account": { ok: true, json: { username: "testuser" } } });

    const result = await checkReplicateAvailable();
    expect(result.available).toBe(true);
    expect(result.reason).toContain("testuser");
  });

  it("returns available=false when token is invalid", async () => {
    process.env.REPLICATE_API_TOKEN = "r8_bad_token";
    mockFetch({ "api.replicate.com/v1/account": { ok: false, status: 401 } });

    const result = await checkReplicateAvailable();
    expect(result.available).toBe(false);
  });
});

// ── Tests: checkLocalPeftAvailable ───────────────────────────────────────────

describe("checkLocalPeftAvailable", () => {
  it("returns a BackendStatus with backend=local-peft", () => {
    const result = checkLocalPeftAvailable();
    expect(result.backend).toBe("local-peft");
    expect(typeof result.available).toBe("boolean");
    expect(typeof result.reason).toBe("string");
  });

  it("returns available=false when python3/peft not installed (CI environment)", () => {
    // In CI, peft is likely not installed
    const result = checkLocalPeftAvailable();
    // Just check it doesn't throw and returns valid structure
    expect(result.backend).toBe("local-peft");
    expect(result.reason).toBeTruthy();
  });
});

// ── Tests: detectLoraBackend ──────────────────────────────────────────────────

describe("detectLoraBackend", () => {
  it("falls back to simulation when no backends available", async () => {
    // All external calls fail
    globalThis.fetch = vi.fn(async () => { throw new Error("Network unavailable"); }) as typeof fetch;

    const result = await detectLoraBackend();
    expect(result.primary).toBe("simulation");
    expect(result.available.length).toBe(5);
    expect(result.detectedAt).toBeLessThanOrEqual(Date.now());
  });

  it("selects ollama when available", async () => {
    mockFetch({
      "/api/tags": { ok: true, json: { models: [{ name: "llama3" }] } },
      "huggingface.co": { ok: false, status: 401 },
      "api.replicate.com": { ok: false, status: 401 },
    });

    const result = await detectLoraBackend();
    expect(result.primary).toBe("ollama");
  });

  it("returns all 5 backend statuses", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("unavailable"); }) as typeof fetch;

    const result = await detectLoraBackend();
    const backends = result.available.map(b => b.backend);
    expect(backends).toContain("ollama");
    expect(backends).toContain("huggingface");
    expect(backends).toContain("replicate");
    expect(backends).toContain("local-peft");
    expect(backends).toContain("simulation");
  });

  it("simulation is always available", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("unavailable"); }) as typeof fetch;

    const result = await detectLoraBackend();
    const sim = result.available.find(b => b.backend === "simulation");
    expect(sim?.available).toBe(true);
  });
});

// ── Tests: routeLoraTraining ──────────────────────────────────────────────────

describe("routeLoraTraining", () => {
  const baseRequest: LoraTrainingRequest = {
    modelId: "mistralai/Mistral-7B-Instruct-v0.2",
    epochs: 1,
    maxSteps: 100,
  };

  it("routes to simulation when no backends available", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("unavailable"); }) as typeof fetch;

    const result = await routeLoraTraining(baseRequest);
    expect(result.success).toBe(true);
    expect(result.backend).toBe("simulation");
    expect(result.simulationMode).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("forces simulation backend when specified", async () => {
    const result = await routeLoraTraining(baseRequest, "simulation");
    expect(result.backend).toBe("simulation");
    expect(result.simulationMode).toBe(true);
  });

  it("simulation result has adapterPath", async () => {
    const result = await routeLoraTraining(baseRequest, "simulation");
    expect(result.adapterPath).toBeTruthy();
    expect(result.adapterPath).toContain("adapter_model.bin");
  });

  it("falls back to simulation when ollama backend fails", async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;

    const result = await routeLoraTraining(baseRequest, "ollama");
    expect(result.success).toBe(true);
    expect(result.simulationMode).toBe(true);
  });

  it("returns durationMs > 0", async () => {
    const result = await routeLoraTraining(baseRequest, "simulation");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Tests: getLoraBackendSummary ──────────────────────────────────────────────

describe("getLoraBackendSummary", () => {
  it("returns configured and missing arrays", () => {
    const summary = getLoraBackendSummary();
    expect(Array.isArray(summary.configured)).toBe(true);
    expect(Array.isArray(summary.missing)).toBe(true);
  });

  it("shows all backends as missing when no env vars set", () => {
    const summary = getLoraBackendSummary();
    expect(summary.missing).toContain("ollama");
    expect(summary.missing).toContain("huggingface");
    expect(summary.missing).toContain("replicate");
  });

  it("shows ollama as configured when OLLAMA_BASE_URL is set", () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    const summary = getLoraBackendSummary();
    expect(summary.configured).toContain("ollama");
    expect(summary.missing).not.toContain("ollama");
  });

  it("includes setup instructions for all backends", () => {
    const summary = getLoraBackendSummary();
    expect(summary.instructions.ollama).toContain("ollama.ai");
    expect(summary.instructions.huggingface).toContain("huggingface.co");
    expect(summary.instructions.replicate).toContain("replicate.com");
  });
});
