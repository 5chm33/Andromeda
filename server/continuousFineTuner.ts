/**
 * continuousFineTuner.ts — Autonomous Fine-Tuning Feedback Loop (v15.0.0)
 *
 * This is the most important module for crossing the 99% RSI acceptance rate threshold.
 *
 * How it works:
 *   1. Every time a proposal is successfully applied, `recordSuccess()` is called with
 *      the (systemPrompt, userPrompt, diff) triple.
 *   2. Once `FINETUNE_THRESHOLD` successful examples are collected, `triggerFineTuning()`
 *      is called automatically.
 *   3. The module submits a fine-tuning job to the OpenAI API using the collected examples.
 *   4. It polls for job completion and, when done, stores the fine-tuned model ID.
 *   5. The `getFineTunedModelId()` export allows `llmProvider.ts` to swap to the
 *      fine-tuned model for RSI proposal generation.
 *
 * The result: the LLM learns the exact dialect, patterns, and architecture of THIS
 * specific codebase. Each fine-tuning round makes proposals more accurate, driving
 * the acceptance rate from ~85% (zero-shot ceiling) toward 99%.
 *
 * @module continuousFineTuner
 * @version 16.0.0
 */

import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("continuousFineTuner");

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of successful examples required before triggering a fine-tuning job.
 * v16: lowered from 500 → 100 to activate the learning loop sooner.
 * Once the first fine-tuned model is active, this can be raised back to 500
 * for subsequent rounds (diminishing returns on small batches). */
const FINETUNE_THRESHOLD = 100;

/** Minimum interval between fine-tuning jobs (24 hours) to avoid runaway costs */
const MIN_FINETUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Base model to fine-tune from (cheapest capable model) */
const BASE_MODEL = "gpt-4o-mini-2024-07-18";

/** Path to the persistent fine-tuning ledger */
const LEDGER_PATH = path.resolve(process.cwd(), ".andromeda", "finetune-ledger.json");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FineTuneExample {
  /** The system prompt used for the successful proposal */
  systemPrompt: string;
  /** The user prompt (file content + debate brief + pattern context) */
  userPrompt: string;
  /** The accepted diff / new file content that was applied */
  acceptedOutput: string;
  /** ISO timestamp of when this example was recorded */
  recordedAt: string;
  /** The target file this example relates to */
  targetFile: string;
  /** RSI area (e.g., "performance", "security") */
  area: string;
}

export interface FineTuneLedger {
  /** Pending examples not yet submitted for fine-tuning */
  pendingExamples: FineTuneExample[];
  /** History of completed fine-tuning jobs */
  completedJobs: FineTuneJob[];
  /** The currently active fine-tuned model ID (null if using base model) */
  activeModelId: string | null;
  /** ISO timestamp of the last fine-tuning job submission */
  lastJobAt: string | null;
  /** Total examples ever recorded */
  totalExamplesRecorded: number;
}

export interface FineTuneJob {
  jobId: string;
  baseModel: string;
  exampleCount: number;
  submittedAt: string;
  completedAt: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  resultModelId: string | null;
  error: string | null;
}

export interface FineTunerStatus {
  pendingExamples: number;
  thresholdRequired: number;
  progressPercent: number;
  activeModelId: string | null;
  lastJobAt: string | null;
  completedJobs: number;
  isFineTuningAvailable: boolean;
}

// ─── Ledger Persistence ───────────────────────────────────────────────────────

function _loadLedger(): FineTuneLedger {
  try {
    if (fs.existsSync(LEDGER_PATH)) {
      return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8")) as FineTuneLedger;
    }
  } catch { /* corrupt ledger — start fresh */ }

  return {
    pendingExamples: [],
    completedJobs: [],
    activeModelId: null,
    lastJobAt: null,
    totalExamplesRecorded: 0,
  };
}

function _saveLedger(ledger: FineTuneLedger): void {
  try {
    const dir = path.dirname(LEDGER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf-8");
  } catch (err) {
    log.warn(`[continuousFineTuner] Failed to save ledger: ${(err as Error).message}`);
  }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Record a successful RSI proposal as a fine-tuning training example.
 * Automatically triggers fine-tuning when the threshold is reached.
 *
 * @param example  The successful (prompt, output) pair to record
 */
export async function recordSuccess(example: FineTuneExample): Promise<void> {
  const ledger = _loadLedger();
  ledger.pendingExamples.push(example);
  ledger.totalExamplesRecorded++;
  _saveLedger(ledger);

  log.info(
    `[continuousFineTuner] Recorded example #${ledger.totalExamplesRecorded} ` +
    `(${ledger.pendingExamples.length}/${FINETUNE_THRESHOLD} toward next fine-tune)`
  );

  // Auto-trigger when threshold is reached
  if (ledger.pendingExamples.length >= FINETUNE_THRESHOLD) {
    const lastJob = ledger.lastJobAt ? new Date(ledger.lastJobAt).getTime() : 0;
    const timeSinceLast = Date.now() - lastJob;

    if (timeSinceLast >= MIN_FINETUNE_INTERVAL_MS) {
      log.info(`[continuousFineTuner] Threshold reached (${ledger.pendingExamples.length} examples) — triggering fine-tuning`);
      await triggerFineTuning();
    } else {
      const waitHours = Math.round((MIN_FINETUNE_INTERVAL_MS - timeSinceLast) / 3_600_000);
      log.info(`[continuousFineTuner] Threshold reached but cooldown active — next job in ~${waitHours}h`);
    }
  }
}

/**
 * Manually trigger a fine-tuning job with all pending examples.
 * Normally called automatically by `recordSuccess()` when the threshold is reached.
 *
 * @returns The submitted job object, or null if no API key is available
 */
export async function triggerFineTuning(): Promise<FineTuneJob | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("[continuousFineTuner] OPENAI_API_KEY not set — fine-tuning skipped");
    return null;
  }

  const ledger = _loadLedger();
  if (ledger.pendingExamples.length === 0) {
    log.warn("[continuousFineTuner] No pending examples — fine-tuning skipped");
    return null;
  }

  // Convert examples to OpenAI JSONL format
  const jsonlLines = ledger.pendingExamples.map(ex => JSON.stringify({
    messages: [
      { role: "system", content: ex.systemPrompt },
      { role: "user", content: ex.userPrompt },
      { role: "assistant", content: ex.acceptedOutput },
    ],
  }));
  const jsonlContent = jsonlLines.join("\n");

  try {
    // Upload training file
    const formData = new FormData();
    formData.append("file", new Blob([jsonlContent], { type: "application/json" }), "training.jsonl");
    formData.append("purpose", "fine-tune");

    const uploadResp = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!uploadResp.ok) {
      const err = await uploadResp.text();
      throw new Error(`File upload failed: ${uploadResp.status} ${err}`);
    }

    const uploadData = await uploadResp.json() as { id: string };
    const fileId = uploadData.id;
    log.info(`[continuousFineTuner] Training file uploaded: ${fileId}`);

    // Submit fine-tuning job
    const jobResp = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        training_file: fileId,
        model: BASE_MODEL,
        hyperparameters: {
          n_epochs: 3,
          batch_size: "auto",
          learning_rate_multiplier: "auto",
        },
        suffix: "andromeda-rsi",
      }),
    });

    if (!jobResp.ok) {
      const err = await jobResp.text();
      throw new Error(`Job submission failed: ${jobResp.status} ${err}`);
    }

    const jobData = await jobResp.json() as { id: string };
    const jobId = jobData.id;
    log.info(`[continuousFineTuner] Fine-tuning job submitted: ${jobId}`);

    const job: FineTuneJob = {
      jobId,
      baseModel: BASE_MODEL,
      exampleCount: ledger.pendingExamples.length,
      submittedAt: new Date().toISOString(),
      completedAt: null,
      status: "pending",
      resultModelId: null,
      error: null,
    };

    // Clear pending examples and record the job
    ledger.completedJobs.push(job);
    ledger.pendingExamples = [];
    ledger.lastJobAt = new Date().toISOString();
    _saveLedger(ledger);

    // Poll for completion in the background
    _pollJobCompletion(jobId, apiKey).catch(err => {
      log.warn(`[continuousFineTuner] Job polling error: ${(err as Error).message}`);
    });

    return job;
  } catch (err) {
    log.error(`[continuousFineTuner] Fine-tuning failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Poll a fine-tuning job until it completes, then update the active model ID.
 */
async function _pollJobCompletion(jobId: string, apiKey: string): Promise<void> {
  const POLL_INTERVAL_MS = 60_000; // 1 minute
  const MAX_POLLS = 120; // 2 hours max

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const resp = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!resp.ok) continue;

      const data = await resp.json() as {
        status: string;
        fine_tuned_model: string | null;
        error?: { message: string };
      };

      const ledger = _loadLedger();
      const job = ledger.completedJobs.find(j => j.jobId === jobId);
      if (!job) break;

      job.status = data.status as FineTuneJob["status"];

      if (data.status === "succeeded" && data.fine_tuned_model) {
        job.resultModelId = data.fine_tuned_model;
        job.completedAt = new Date().toISOString();
        ledger.activeModelId = data.fine_tuned_model;
        _saveLedger(ledger);
        log.info(`[continuousFineTuner] Fine-tuning SUCCEEDED — new model: ${data.fine_tuned_model}`);
        return;
      }

      if (data.status === "failed" || data.status === "cancelled") {
        job.error = data.error?.message ?? "Unknown error";
        job.completedAt = new Date().toISOString();
        _saveLedger(ledger);
        log.warn(`[continuousFineTuner] Fine-tuning ${data.status}: ${job.error}`);
        return;
      }

      _saveLedger(ledger);
      log.info(`[continuousFineTuner] Job ${jobId} status: ${data.status} (poll ${i + 1}/${MAX_POLLS})`);
    } catch { /* transient error — keep polling */ }
  }

  log.warn(`[continuousFineTuner] Job ${jobId} polling timed out after ${MAX_POLLS} polls`);
}

// ─── Model Selection ──────────────────────────────────────────────────────────

/**
 * Get the currently active fine-tuned model ID.
 * Returns null if no fine-tuned model is available (use base model).
 *
 * @returns Fine-tuned model ID or null
 */
export function getFineTunedModelId(): string | null {
  try {
    const ledger = _loadLedger();
    return ledger.activeModelId;
  } catch {
    return null;
  }
}

/**
 * Get the model ID to use for RSI proposal generation.
 * Prefers the fine-tuned model if available, falls back to the provided default.
 *
 * @param defaultModel  The default model to use if no fine-tuned model is available
 * @returns             The model ID to use
 */
export function getRsiModel(defaultModel: string): string {
  const fineTunedId = getFineTunedModelId();
  if (fineTunedId) {
    log.info(`[continuousFineTuner] Using fine-tuned model: ${fineTunedId}`);
    return fineTunedId;
  }
  return defaultModel;
}

// ─── Status & Observability ───────────────────────────────────────────────────

/**
 * Get the current fine-tuner status for dashboards and health checks.
 */
export function getFineTunerStatus(): FineTunerStatus {
  const ledger = _loadLedger();
  const pendingCount = ledger.pendingExamples.length;
  const isAvailable = !!process.env.OPENAI_API_KEY;

  return {
    pendingExamples: pendingCount,
    thresholdRequired: FINETUNE_THRESHOLD,
    progressPercent: Math.round((pendingCount / FINETUNE_THRESHOLD) * 100),
    activeModelId: ledger.activeModelId,
    lastJobAt: ledger.lastJobAt,
    completedJobs: ledger.completedJobs.filter(j => j.status === "succeeded").length,
    isFineTuningAvailable: isAvailable,
  };
}

/**
 * Initialize the continuous fine-tuner daemon.
 * Resumes polling any in-progress jobs from previous sessions.
 */
export function initContinuousFineTuner(): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.info("[continuousFineTuner] OPENAI_API_KEY not set — fine-tuning disabled (examples will still be collected)");
    return;
  }

  const ledger = _loadLedger();
  const status = getFineTunerStatus();

  log.info(
    `[continuousFineTuner] Initialized — ${status.pendingExamples}/${FINETUNE_THRESHOLD} examples collected ` +
    `(${status.progressPercent}% toward next fine-tune). ` +
    `Active model: ${ledger.activeModelId ?? "base model"}`
  );

  // Resume polling any in-progress jobs
  const runningJobs = ledger.completedJobs.filter(j => j.status === "pending" || j.status === "running");
  for (const job of runningJobs) {
    log.info(`[continuousFineTuner] Resuming polling for job ${job.jobId}`);
    _pollJobCompletion(job.jobId, apiKey).catch(() => { /* non-fatal */ });
  }
}
