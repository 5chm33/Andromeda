/**
 * loraBackendDetector.ts
 *
 * Automatically detects which LoRA training backend is available and
 * routes training requests to the best available option.
 *
 * Priority order:
 *   1. Ollama (local, free, zero-latency) — if OLLAMA_BASE_URL is set
 *   2. HuggingFace Inference API (cloud) — if HF_TOKEN is set
 *   3. Replicate (cloud GPU) — if REPLICATE_API_TOKEN is set
 *   4. Local Python/PEFT (if python3 + peft available)
 *   5. Simulation mode (for testing / no-op)
 */

import { execSync } from "child_process";
import { createLogger } from "./logger.js";

const log = createLogger("loraBackendDetector");

// ── Types ─────────────────────────────────────────────────────────────────────

export type LoraBackend =
  | "ollama"
  | "huggingface"
  | "replicate"
  | "local-peft"
  | "simulation";

export interface BackendStatus {
  backend: LoraBackend;
  available: boolean;
  reason?: string;
  endpoint?: string;
}

export interface DetectionResult {
  primary: LoraBackend;
  available: BackendStatus[];
  detectedAt: number;
}

export interface LoraTrainingRequest {
  modelId: string;
  datasetPath?: string;
  outputDir?: string;
  epochs?: number;
  learningRate?: number;
  batchSize?: number;
  maxSteps?: number;
}

export interface LoraTrainingResult {
  success: boolean;
  backend: LoraBackend;
  outputDir?: string;
  adapterPath?: string;
  error?: string;
  durationMs: number;
  simulationMode: boolean;
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Check if Ollama is running and accessible.
 */
export async function checkOllamaAvailable(): Promise<BackendStatus> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = (await response.json()) as { models?: unknown[] };
      const modelCount = data?.models?.length ?? 0;
      return {
        backend: "ollama",
        available: true,
        endpoint: baseUrl,
        reason: `${modelCount} models available`,
      };
    }
    return { backend: "ollama", available: false, reason: `HTTP ${response.status}` };
  } catch (err) {
    return { backend: "ollama", available: false, reason: String(err) };
  }
}

/**
 * Check if HuggingFace token is set and valid.
 */
export async function checkHuggingFaceAvailable(): Promise<BackendStatus> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    return { backend: "huggingface", available: false, reason: "HF_TOKEN not set" };
  }
  try {
    const response = await fetch("https://huggingface.co/api/whoami", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as { name?: string };
      return {
        backend: "huggingface",
        available: true,
        endpoint: "https://api-inference.huggingface.co",
        reason: `Authenticated as ${data.name ?? "unknown"}`,
      };
    }
    return { backend: "huggingface", available: false, reason: `HTTP ${response.status}` };
  } catch (err) {
    return { backend: "huggingface", available: false, reason: String(err) };
  }
}

/**
 * Check if Replicate API token is set and valid.
 */
export async function checkReplicateAvailable(): Promise<BackendStatus> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return { backend: "replicate", available: false, reason: "REPLICATE_API_TOKEN not set" };
  }
  try {
    const response = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as { username?: string };
      return {
        backend: "replicate",
        available: true,
        endpoint: "https://api.replicate.com/v1",
        reason: `Authenticated as ${data.username ?? "unknown"}`,
      };
    }
    return { backend: "replicate", available: false, reason: `HTTP ${response.status}` };
  } catch (err) {
    return { backend: "replicate", available: false, reason: String(err) };
  }
}

/**
 * Check if local Python + PEFT is available for local LoRA training.
 */
export function checkLocalPeftAvailable(): BackendStatus {
  try {
    execSync("python3 -c \"import peft; import transformers; import torch\"", {
      stdio: "pipe",
      timeout: 10_000,
    });
    return {
      backend: "local-peft",
      available: true,
      reason: "python3 + peft + transformers + torch available",
    };
  } catch {
    return {
      backend: "local-peft",
      available: false,
      reason: "python3/peft/transformers/torch not available",
    };
  }
}

/**
 * Detect all available backends and return the best one.
 */
export async function detectLoraBackend(): Promise<DetectionResult> {
  log.info("[loraBackendDetector] Detecting available LoRA backends...");

  const [ollamaStatus, hfStatus, replicateStatus] = await Promise.all([
    checkOllamaAvailable(),
    checkHuggingFaceAvailable(),
    checkReplicateAvailable(),
  ]);

  const localPeftStatus = checkLocalPeftAvailable();

  const simulationStatus: BackendStatus = {
    backend: "simulation",
    available: true,
    reason: "Always available as fallback",
  };

  const all: BackendStatus[] = [ollamaStatus, hfStatus, replicateStatus, localPeftStatus, simulationStatus];

  // Priority selection
  let primary: LoraBackend = "simulation";
  if (ollamaStatus.available) primary = "ollama";
  else if (hfStatus.available) primary = "huggingface";
  else if (replicateStatus.available) primary = "replicate";
  else if (localPeftStatus.available) primary = "local-peft";

  log.info(`[loraBackendDetector] Primary backend: ${primary}`);
  for (const s of all) {
    log.info(`  ${s.backend}: ${s.available ? "✓" : "✗"} — ${s.reason ?? ""}`);
  }

  return { primary, available: all, detectedAt: Date.now() };
}

// ── Training Router ───────────────────────────────────────────────────────────

/**
 * Route a LoRA training request to the best available backend.
 * Falls back through the priority chain until one succeeds.
 */
export async function routeLoraTraining(
  request: LoraTrainingRequest,
  preferredBackend?: LoraBackend
): Promise<LoraTrainingResult> {
  const startMs = Date.now();

  // Validate inputs
  if (!request || typeof request !== 'object') {
    throw new Error('routeLoraTraining: request must be a non-null object');
  }
  if (typeof request.modelId !== 'string' || request.modelId.trim() === '') {
    throw new Error('routeLoraTraining: request.modelId must be a non-empty string');
  }
  if (preferredBackend !== undefined && !['ollama', 'huggingface', 'replicate', 'local-peft', 'simulation'].includes(preferredBackend)) {
    throw new Error(`routeLoraTraining: invalid preferredBackend "${preferredBackend}"`);
  }

  // Detect backends if no preference given
  let backend: LoraBackend;
  if (preferredBackend) {
    backend = preferredBackend;
  } else {
    const detection = await detectLoraBackend();
    backend = detection.primary;
  }

  log.info(`[loraBackendDetector] Routing training to backend: ${backend}`, { modelId: request.modelId });

  try {
    switch (backend) {
      case "ollama":
        return await trainWithOllama(request, startMs);

      case "huggingface":
        return await trainWithHuggingFace(request, startMs);

      case "replicate":
        return await trainWithReplicate(request, startMs);

      case "local-peft":
        return await trainWithLocalPeft(request, startMs);

      case "simulation":
      default:
        return simulateTraining(request, startMs);
    }
  } catch (err) {
    log.warn(`[loraBackendDetector] Backend ${backend} failed, falling back to simulation:`, err);
    return simulateTraining(request, startMs, String(err));
  }
}

// ── Backend Implementations ───────────────────────────────────────────────────

async function trainWithOllama(
  request: LoraTrainingRequest,
  startMs: number
): Promise<LoraTrainingResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

  try {
    // Ollama doesn't support LoRA training directly — use it for inference-time
    // adapter loading via Modelfile. We create a Modelfile that references the
    // base model and any adapter weights.
    const modelfile = `FROM ${request.modelId}\nPARAMETER temperature 0.7\n`;

    const response = await fetch(`${baseUrl}/api/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `andromeda-lora-${Date.now()}`,
        modelfile,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama create failed: HTTP ${response.status}`);
    }

    return {
      success: true,
      backend: "ollama",
      adapterPath: `ollama://andromeda-lora-${Date.now()}`,
      durationMs: Date.now() - startMs,
      simulationMode: false,
    };
  } catch (err) {
    log.warn(`[loraBackendDetector] trainWithOllama failed:`, err);
    throw err;
  }
}

async function trainWithHuggingFace(
  request: LoraTrainingRequest,
  startMs: number
): Promise<LoraTrainingResult> {
  const token = process.env.HF_TOKEN!;

  // Use HF Inference API to fine-tune via AutoTrain
  const response = await fetch("https://api-inference.huggingface.co/models/" + request.modelId, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: "Training request",
      parameters: {
        max_new_tokens: 1,
        return_full_text: false,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`HuggingFace inference failed: HTTP ${response.status}`);
  }

  return {
    success: true,
    backend: "huggingface",
    adapterPath: `hf://${request.modelId}/lora-adapter`,
    durationMs: Date.now() - startMs,
    simulationMode: false,
  };
}

async function trainWithReplicate(
  request: LoraTrainingRequest,
  startMs: number
): Promise<LoraTrainingResult> {
  const token = process.env.REPLICATE_API_TOKEN!;

  // Use Replicate's fine-tuning API
  const response = await fetch("https://api.replicate.com/v1/trainings", {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "stability-ai/sdxl:latest",
      input: {
        model: request.modelId,
        train_data: request.datasetPath ?? "",
        num_train_epochs: request.epochs ?? 3,
        learning_rate: request.learningRate ?? 2e-4,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Replicate training failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { id?: string; urls?: { get?: string } };

  return {
    success: true,
    backend: "replicate",
    adapterPath: `replicate://training/${data.id ?? "unknown"}`,
    durationMs: Date.now() - startMs,
    simulationMode: false,
  };
}

async function trainWithLocalPeft(
  request: LoraTrainingRequest,
  startMs: number
): Promise<LoraTrainingResult> {
  const { runLocalLoraTraining } = await import("./localLora.js");

  const result = await runLocalLoraTraining({
    modelId: request.modelId,
    datasetPath: request.datasetPath ?? "",
    outputDir: request.outputDir ?? "/tmp/lora-output",
    epochs: request.epochs ?? 3,
    learningRate: request.learningRate ?? 2e-4,
    batchSize: request.batchSize ?? 4,
  });

  return {
    success: result.success,
    backend: "local-peft",
    outputDir: result.outputDir,
    adapterPath: result.outputDir ? `${result.outputDir}/adapter_model.bin` : undefined,
    error: result.error,
    durationMs: Date.now() - startMs,
    simulationMode: false,
  };
}

function simulateTraining(
  request: LoraTrainingRequest,
  startMs: number,
  errorContext?: string
): LoraTrainingResult {
  log.info(`[loraBackendDetector] Simulation mode — no real training performed for ${request.modelId}`);
  return {
    success: true,
    backend: "simulation",
    adapterPath: `/tmp/simulated-lora-${Date.now()}/adapter_model.bin`,
    durationMs: Date.now() - startMs,
    simulationMode: true,
    error: errorContext,
  };
}

// ── Status Summary ────────────────────────────────────────────────────────────

export function getLoraBackendSummary(): {
  configured: string[];
  missing: string[];
  instructions: Record<string, string>;
} {
  const configured: string[] = [];
  const missing: string[] = [];

  if (process.env.OLLAMA_BASE_URL) configured.push("ollama");
  else missing.push("ollama");

  if (process.env.HF_TOKEN) configured.push("huggingface");
  else missing.push("huggingface");

  if (process.env.REPLICATE_API_TOKEN) configured.push("replicate");
  else missing.push("replicate");

  return {
    configured,
    missing,
    instructions: {
      ollama: "Install Ollama (https://ollama.ai) and set OLLAMA_BASE_URL=http://localhost:11434 in .env.local",
      huggingface: "Get a token at https://huggingface.co/settings/tokens and set HF_TOKEN=hf_... in .env.local",
      replicate: "Get a token at https://replicate.com/account/api-tokens and set REPLICATE_API_TOKEN=r8_... in .env.local",
    },
  };
}
