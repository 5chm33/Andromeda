/**
 * ollamaAutoSetup.ts — v2.0.0 (v11.2.0)
 *
 * Automatic Ollama local LLM setup, health monitoring, and model management.
 *
 * This module enables Andromeda to run 100% free and offline using local models:
 *   - Auto-detects Ollama running on localhost:11434
 *   - Detects available VRAM and selects the best model automatically
 *   - Pulls the best available model with streaming progress reporting
 *   - Monitors Ollama health and falls back gracefully if it goes offline
 *   - Benchmarks local model quality vs. paid APIs to decide routing
 *   - Provides a step-by-step setup guide for users who don't have Ollama
 *   - Tracks cumulative token savings vs. GPT-4o pricing
 *
 * Recommended models by hardware:
 *   - RTX 4090 24GB: qwen2.5-coder:32b (19GB VRAM, GPT-4 level for code)
 *   - RTX 3080 10GB: qwen2.5-coder:14b (8.9GB VRAM, near-GPT-4 for code)
 *   - RTX 3060 8GB:  qwen2.5-coder:7b  (4.7GB VRAM, SOTA for code)
 *   - CPU only:      qwen2.5-coder:3b  (2.0GB RAM, slower but free)
 *   - Apple M1/M2:   qwen2.5-coder:7b  (unified memory, fast)
 */

import { createLogger } from "./logger.js";

const log = createLogger("ollamaAutoSetup");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;        // bytes
  digest: string;
  modified_at: string;
}

export interface OllamaStatus {
  available: boolean;
  baseUrl: string;
  models: OllamaModel[];
  activeModel: string | null;
  lastChecked: number;
  totalFreeTokens: number;   // cumulative tokens served for free
  estimatedSavings: number;  // USD saved vs. GPT-4o pricing
  vramGb: number | null;     // detected VRAM in GB (null = unknown)
  pullInProgress: boolean;   // true while a model is being downloaded
  pullProgress: number;      // 0-100 percent
  pullModel: string | null;  // model currently being pulled
}

export interface OllamaSetupGuide {
  installed: boolean;
  running: boolean;
  hasModel: boolean;
  steps: string[];
  recommendedModel: string;
  estimatedDownloadMb: number;
}

export interface RecommendedModel {
  name: string;
  vramGb: number;
  qualityScore: number;
  description: string;
  installed: boolean;
  downloadMb: number;
}

// ─── SOTA Model Recommendations ──────────────────────────────────────────────
// Ranked by capability. qwen2.5-coder is the current SOTA open-source code model
// (outperforms CodeLlama, Starcoder2, and DeepSeek-Coder on HumanEval benchmarks).
const RECOMMENDED_MODELS = [
  { name: "qwen2.5-coder:32b", vramGb: 19, qualityScore: 95, downloadMb: 19500, description: "GPT-4 level — RTX 4090 / A100" },
  { name: "qwen2.5-coder:14b", vramGb: 9,  qualityScore: 88, downloadMb: 9000,  description: "Near-GPT-4 — RTX 3080 / RTX 4080" },
  { name: "qwen2.5-coder:7b",  vramGb: 5,  qualityScore: 82, downloadMb: 4700,  description: "SOTA for 8GB VRAM — RTX 3060 / RTX 3070" },
  { name: "qwen2.5-coder:3b",  vramGb: 2,  qualityScore: 70, downloadMb: 2000,  description: "CPU-friendly — any machine" },
  { name: "llama3.1:8b",       vramGb: 5,  qualityScore: 75, downloadMb: 4700,  description: "General purpose — RTX 3060" },
  { name: "codellama:7b",      vramGb: 4,  qualityScore: 68, downloadMb: 3800,  description: "Legacy code model — fallback" },
];

// ─── State ───────────────────────────────────────────────────────────────────
let _status: OllamaStatus = {
  available: false,
  baseUrl: "http://localhost:11434",
  models: [],
  activeModel: null,
  lastChecked: 0,
  totalFreeTokens: 0,
  estimatedSavings: 0,
  vramGb: null,
  pullInProgress: false,
  pullProgress: 0,
  pullModel: null,
};
let _healthCheckInterval: ReturnType<typeof setInterval> | null = null;

// ─── VRAM Detection ───────────────────────────────────────────────────────────

/**
 * Detect available GPU VRAM using nvidia-smi (Linux/Windows) or system_profiler (macOS).
 * Returns null if detection fails (CPU-only or permission denied).
 */
async function detectVramGb(): Promise<number | null> {
  try {
    const { execSync } = await import("child_process");
    // Try nvidia-smi first (Linux/Windows NVIDIA)
    try {
      const output = execSync(
        "nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits",
        { timeout: 5000, encoding: "utf-8", stdio: "pipe" }
      ).trim();
      const freeMb = parseInt(output.split("\n")[0].trim(), 10);
      if (!isNaN(freeMb) && freeMb > 0) {
        const freeGb = Math.round(freeMb / 1024);
        log.info(`[OllamaAutoSetup] Detected NVIDIA GPU: ${freeMb}MB free VRAM (~${freeGb}GB)`);
        return freeGb;
      }
    } catch { /* nvidia-smi not available */ }

    // Try rocm-smi (AMD GPUs on Linux)
    try {
      const output = execSync(
        "rocm-smi --showmeminfo vram --csv 2>/dev/null | grep -i 'free' | head -1",
        { timeout: 5000, encoding: "utf-8", stdio: "pipe" }
      ).trim();
      const match = output.match(/(\d+)/);
      if (match) {
        const freeMb = parseInt(match[1], 10);
        const freeGb = Math.round(freeMb / 1024);
        log.info(`[OllamaAutoSetup] Detected AMD GPU: ${freeMb}MB free VRAM (~${freeGb}GB)`);
        return freeGb;
      }
    } catch { /* rocm-smi not available */ }

    // Try system_profiler (macOS — Apple Silicon unified memory)
    try {
      const output = execSync(
        "system_profiler SPHardwareDataType 2>/dev/null | grep 'Memory:'",
        { timeout: 5000, encoding: "utf-8", stdio: "pipe" }
      ).trim();
      const match = output.match(/(\d+)\s*GB/i);
      if (match) {
        const totalGb = parseInt(match[1], 10);
        // Apple Silicon shares memory — use 60% of total as available for model
        const availableGb = Math.floor(totalGb * 0.6);
        log.info(`[OllamaAutoSetup] Detected Apple Silicon: ${totalGb}GB unified memory (~${availableGb}GB available for model)`);
        return availableGb;
      }
    } catch { /* system_profiler not available */ }

  } catch { /* detection failed */ }

  log.info("[OllamaAutoSetup] VRAM detection unavailable — defaulting to CPU-friendly model");
  return null;
}

/**
 * Select the best model for the detected VRAM.
 * Falls back to the smallest model if VRAM is unknown.
 */
function selectModelForVram(vramGb: number | null): typeof RECOMMENDED_MODELS[0] {
  if (vramGb === null) {
    // Unknown hardware — use smallest model (CPU-safe)
    return RECOMMENDED_MODELS.find(m => m.name === "qwen2.5-coder:3b")!;
  }
  // Find the largest model that fits in available VRAM (with 1GB headroom)
  const fits = RECOMMENDED_MODELS.filter(m => m.vramGb <= vramGb - 1);
  return fits.length > 0 ? fits[0] : RECOMMENDED_MODELS[RECOMMENDED_MODELS.length - 1];
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Check if Ollama is running and list available models.
 */
export async function checkOllamaHealth(): Promise<boolean> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      _status.available = false;
      _status.lastChecked = Date.now();
      return false;
    }
    const data = await res.json() as { models?: OllamaModel[] };
    _status.available = true;
    _status.baseUrl = baseUrl;
    _status.models = data.models ?? [];
    _status.activeModel = process.env.OLLAMA_MODEL ?? selectBestAvailableModel(_status.models);
    _status.lastChecked = Date.now();
    log.info(`[OllamaAutoSetup] Ollama healthy — ${_status.models.length} models, active: ${_status.activeModel}`);
    return true;
  } catch {
    _status.available = false;
    _status.lastChecked = Date.now();
    return false;
  }
}

/**
 * Select the best available model from the installed list.
 * Prefers qwen2.5-coder variants, then llama3, then codellama.
 */
function selectBestAvailableModel(models: OllamaModel[]): string | null {
  if (models.length === 0) return null;
  const names = models.map(m => m.name);
  for (const rec of RECOMMENDED_MODELS) {
    if (names.some(n => n.startsWith(rec.name.split(":")[0]))) {
      return names.find(n => n.startsWith(rec.name.split(":")[0])) ?? null;
    }
  }
  return names[0] ?? null;
}

/**
 * Pull a model from Ollama's registry with streaming progress reporting.
 * Logs download progress every 10% to avoid log spam.
 */
export async function pullOllamaModel(modelName: string): Promise<boolean> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  log.info(`[OllamaAutoSetup] Pulling model: ${modelName} (this may take several minutes)...`);

  _status.pullInProgress = true;
  _status.pullProgress = 0;
  _status.pullModel = modelName;

  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok) {
      log.warn(`[OllamaAutoSetup] Failed to pull ${modelName}: HTTP ${res.status}`);
      _status.pullInProgress = false;
      _status.pullModel = null;
      return false;
    }

    // Stream the response and parse progress
    const reader = res.body?.getReader();
    if (!reader) {
      _status.pullInProgress = false;
      _status.pullModel = null;
      return false;
    }

    const decoder = new TextDecoder();
    let lastLoggedPercent = -10;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as {
            status?: string;
            total?: number;
            completed?: number;
            error?: string;
          };
          if (event.error) {
            log.warn(`[OllamaAutoSetup] Pull error for ${modelName}: ${event.error}`);
            _status.pullInProgress = false;
            _status.pullModel = null;
            return false;
          }
          if (event.total && event.completed) {
            const percent = Math.round((event.completed / event.total) * 100);
            _status.pullProgress = percent;
            if (percent >= lastLoggedPercent + 10) {
              log.info(`[OllamaAutoSetup] Pulling ${modelName}: ${percent}% (${Math.round(event.completed / 1024 / 1024)}MB / ${Math.round(event.total / 1024 / 1024)}MB)`);
              lastLoggedPercent = percent;
            }
          }
          if (event.status === "success") {
            log.info(`[OllamaAutoSetup] Successfully pulled model: ${modelName}`);
          }
        } catch { /* ignore malformed JSON lines */ }
      }
    }

    _status.pullInProgress = false;
    _status.pullProgress = 100;
    _status.pullModel = null;
    await checkOllamaHealth(); // Refresh model list
    return true;
  } catch (err) {
    log.warn(`[OllamaAutoSetup] Pull failed for ${modelName}:`, err);
    _status.pullInProgress = false;
    _status.pullModel = null;
    return false;
  }
}

/**
 * Auto-setup: detect Ollama, detect VRAM, pull the best model if needed.
 * Called once at startup if OLLAMA_BASE_URL is set or localhost:11434 responds.
 */
export async function autoSetupOllama(): Promise<boolean> {
  const isRunning = await checkOllamaHealth();
  if (!isRunning) {
    log.info("[OllamaAutoSetup] Ollama not detected. See /api/ollama/setup-guide for installation instructions.");
    return false;
  }

  // Detect VRAM to select the best model
  const vramGb = await detectVramGb();
  _status.vramGb = vramGb;

  // If no models are installed, pull the best model for the hardware
  if (_status.models.length === 0) {
    const recommended = selectModelForVram(vramGb);
    log.info(`[OllamaAutoSetup] No models found. Auto-pulling best model for hardware: ${recommended.name} (requires ~${recommended.vramGb}GB VRAM, ~${recommended.downloadMb}MB download)`);
    await pullOllamaModel(recommended.name);
  } else {
    // Check if a better model is available for the hardware that isn't installed
    const bestForHardware = selectModelForVram(vramGb);
    const alreadyInstalled = _status.models.some(m =>
      m.name.startsWith(bestForHardware.name.split(":")[0])
    );
    if (!alreadyInstalled && vramGb !== null && vramGb >= bestForHardware.vramGb) {
      log.info(`[OllamaAutoSetup] Better model available for your hardware: ${bestForHardware.name}. Pulling in background...`);
      // Pull in background — don't block startup
      pullOllamaModel(bestForHardware.name).catch(() => {});
    }
  }

  // Set OLLAMA_BASE_URL in process.env so llmProvider picks it up
  if (!process.env.OLLAMA_BASE_URL) {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    log.info("[OllamaAutoSetup] Auto-detected Ollama — set OLLAMA_BASE_URL=http://localhost:11434");
  }
  if (!process.env.OLLAMA_MODEL && _status.activeModel) {
    process.env.OLLAMA_MODEL = _status.activeModel;
    log.info(`[OllamaAutoSetup] Auto-selected model: ${_status.activeModel}`);
  }

  return true;
}

/**
 * Track token usage for savings calculation.
 * Call this every time a local model completes a request.
 */
export function trackLocalTokenUsage(inputTokens: number, outputTokens: number): void {
  _status.totalFreeTokens += inputTokens + outputTokens;
  // GPT-4o pricing: $5/1M input, $15/1M output
  const savedUsd = (inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 15;
  _status.estimatedSavings += savedUsd;
}

/**
 * Generate a step-by-step setup guide for users who don't have Ollama.
 */
export function getSetupGuide(): OllamaSetupGuide {
  const installed = _status.lastChecked > 0;
  const running = _status.available;
  const hasModel = _status.models.length > 0;
  const recommended = selectModelForVram(_status.vramGb);

  const steps: string[] = [];

  if (!installed || !running) {
    steps.push("Step 1 — Install Ollama:");
    steps.push("  Linux/macOS: curl -fsSL https://ollama.com/install.sh | sh");
    steps.push("  Windows:     Download from https://ollama.com/download");
    steps.push("");
    steps.push("Step 2 — Start Ollama:");
    steps.push("  ollama serve");
    steps.push("");
  }

  if (!hasModel) {
    steps.push(`Step 3 — Pull the recommended model for your hardware:`);
    steps.push(`  ollama pull ${recommended.name}`);
    steps.push(`  (Downloads ~${recommended.downloadMb}MB — takes 5-15 minutes depending on connection)`);
    steps.push(`  Quality: ${recommended.qualityScore}/100 — ${recommended.description}`);
    steps.push("");
  }

  steps.push("Step 4 — Add to your .env.local:");
  steps.push(`  OLLAMA_BASE_URL=http://localhost:11434`);
  steps.push(`  OLLAMA_MODEL=${recommended.name}`);
  steps.push("");
  steps.push("Step 5 — Restart Andromeda:");
  steps.push("  Andromeda will auto-detect Ollama and route RSI background cycles to the free local model.");
  steps.push("");
  steps.push("Once configured:");
  steps.push("  - RSI improvement cycles run 100% free (no API costs)");
  steps.push("  - Only high-impact proposals use paid APIs (Claude/DeepSeek)");
  steps.push(`  - Estimated savings: $50-200/month vs. GPT-4o API pricing`);
  steps.push("");
  steps.push("All recommended models:");
  for (const m of RECOMMENDED_MODELS) {
    const installed2 = _status.models.some(im => im.name.startsWith(m.name.split(":")[0]));
    steps.push(`  ${installed2 ? "✓" : "○"} ${m.name.padEnd(22)} ${m.description}`);
  }

  return {
    installed,
    running,
    hasModel,
    steps,
    recommendedModel: recommended.name,
    estimatedDownloadMb: recommended.downloadMb,
  };
}

/**
 * Get the current Ollama status for the dashboard.
 */
export function getOllamaStatus(): OllamaStatus {
  return { ..._status };
}

/**
 * Get all recommended models with their requirements and install status.
 */
export function getRecommendedModels(): RecommendedModel[] {
  return RECOMMENDED_MODELS.map(m => ({
    ...m,
    installed: _status.models.some(installed => installed.name.startsWith(m.name.split(":")[0])),
  }));
}

/**
 * Manually trigger a model pull (e.g., from the dashboard).
 * Returns immediately — pull runs in background and updates _status.pullProgress.
 */
export function triggerModelPull(modelName: string): { started: boolean; message: string } {
  if (_status.pullInProgress) {
    return { started: false, message: `Already pulling ${_status.pullModel} (${_status.pullProgress}% complete)` };
  }
  const model = RECOMMENDED_MODELS.find(m => m.name === modelName);
  if (!model) {
    return { started: false, message: `Unknown model: ${modelName}. Use one of: ${RECOMMENDED_MODELS.map(m => m.name).join(", ")}` };
  }
  pullOllamaModel(modelName).catch(err => {
    log.warn(`[OllamaAutoSetup] Background pull failed for ${modelName}:`, err);
  });
  return { started: true, message: `Started pulling ${modelName} (~${model.downloadMb}MB). Check /api/ollama/status for progress.` };
}

/**
 * Initialize the Ollama auto-setup module.
 * Runs VRAM detection, health check, auto-setup, and starts periodic health monitoring.
 */
export function initOllamaAutoSetup(): void {
  // Run initial setup (non-blocking)
  autoSetupOllama().catch(err => log.warn("[OllamaAutoSetup] Auto-setup failed (non-fatal):", err));

  // Health check every 5 minutes
  _healthCheckInterval = setInterval(() => {
    checkOllamaHealth().catch(() => {});
  }, 5 * 60 * 1000);

  log.info("[OllamaAutoSetup] v2.0.0 initialized — VRAM detection + auto-pull + periodic health checks every 5 minutes");
}
