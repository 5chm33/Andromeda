/**
 * continuousFineTuning.ts — Phase 5c: Unsupervised Fine-Tuning Scheduler
 * Andromeda v9.16.2
 *
 * Orchestrates the nightly self-improvement cycle:
 * 1. Runs RLAIF Judge to generate synthetic DPO pairs from the day's logs
 * 2. Extracts the full DPO dataset (human + synthetic)
 * 3. Triggers the local LoRA training pipeline
 * 4. Loads the newly fine-tuned weights for the next day
 */
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { generateRlaifPairs } from "./rlaifJudge.js";
import { exportDpoDataset } from "./selfDistillation.js";
import { runLocalLoraTraining, LoraConfig } from "./localLora.js";

const log = createLogger("continuousFineTuning");

export interface FineTuningCycleResult {
  success: boolean;
  rlaifPairsGenerated: number;
  totalDatasetSize: number;
  outputDir?: string;
  error?: string;
}

/**
 * Executes a complete unsupervised fine-tuning cycle.
 * Designed to be run nightly via cron or daemon schedule.
 */
export async function runNightlyFineTuningCycle(modelId = "mistralai/Mistral-7B-Instruct-v0.2"): Promise<FineTuningCycleResult> {
  log.info(`[NightlyCycle] Starting continuous fine-tuning cycle for ${modelId}`);

  try {
    // 1. Generate synthetic feedback (RLAIF)
    log.info(`[NightlyCycle] Step 1: Running RLAIF Judge...`);
    const newPairs = await generateRlaifPairs(50); // Judge up to 50 recent unrated queries
    log.info(`[NightlyCycle] RLAIF generated ${newPairs.length} new DPO pairs.`);

    // 2. Export dataset
    log.info(`[NightlyCycle] Step 2: Exporting combined DPO dataset...`);
    const exportResult = exportDpoDataset();
    
    if (!exportResult.success || !exportResult.path) {
      throw new Error(`Dataset export failed: ${exportResult.error || "Unknown error"}`);
    }
    
    if (exportResult.count == null || exportResult.count < 10) {
      log.warn(`[NightlyCycle] Insufficient data (${exportResult.count} pairs). Aborting training.`);
      return {
        success: false,
        rlaifPairsGenerated: newPairs.length,
        totalDatasetSize: exportResult.count,
        error: "Insufficient data"
      };
    }

    // 3. Trigger LoRA Training
    log.info(`[NightlyCycle] Step 3: Starting local LoRA training...`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.join(process.cwd(), "models", `lora-${timestamp}`);
    
    const trainingConfig: LoraConfig = {
      modelId,
      datasetPath: exportResult.path,
      outputDir,
      epochs: 3,
      batchSize: 4
    };
    const trainingResult = await runLocalLoraTraining(trainingConfig);

    if (!trainingResult.success) {
      throw new Error(`Training failed: ${trainingResult.error}`);
    }

    log.info(`[NightlyCycle] 🎉 Cycle complete! New weights available at ${outputDir}`);
    
    // 4. In a full implementation, we would update a config file here to tell 
    // the local inference engine (e.g. Ollama/vLLM) to load the new LoRA adapter.
    
    return {
      success: true,
      rlaifPairsGenerated: newPairs.length,
      totalDatasetSize: exportResult.count,
      outputDir
    };

  } catch (err) {
    log.error(`[NightlyCycle] Cycle failed: ${(err as Error).message}`);
    return {
      success: false,
      rlaifPairsGenerated: 0,
      totalDatasetSize: 0,
      error: (err as Error).message
    };
  }
}
