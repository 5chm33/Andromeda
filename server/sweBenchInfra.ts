/**
 * sweBenchInfra.ts — Robust Evaluation Infrastructure (v1.0.0)
 *
 * Addresses the three infrastructure bottlenecks that caused the original
 * evaluation run to take 24+ hours instead of the expected 2-3 hours:
 *
 * Problem 1: DISK EXHAUSTION
 *   Root cause: Pulling 10 large Docker images (1.5GB each) simultaneously
 *   filled the disk before images could be evaluated and removed.
 *   Fix: Sequential image pulls with disk space checks before each pull.
 *
 * Problem 2: CONTAINER HANGS (30-minute timeouts)
 *   Root cause: AI-generated patches sometimes introduce infinite loops.
 *   The SWE-bench harness default timeout is 1800s (30 min) per instance.
 *   Fix: Aggressive 300s (5 min) timeout with automatic container kill.
 *
 * Problem 3: BATCH SIZE TOO LARGE
 *   Root cause: Pulling 10 images simultaneously saturated network + disk I/O.
 *   Fix: Configurable batch size (default: 3) with sequential pull + eval.
 *
 * This module provides a robust wrapper around the SWE-bench harness that
 * handles all three problems automatically.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

export interface InfraConfig {
  /** Number of instances to pull and evaluate in each batch. Default: 3. */
  batchSize: number;
  /** Per-instance test timeout in seconds. Default: 300 (5 minutes). */
  testTimeoutSeconds: number;
  /** Minimum free disk space (GB) required before pulling a new image. Default: 20. */
  minFreeDiskGb: number;
  /** Whether to remove Docker images immediately after evaluation. Default: true. */
  removeImagesAfterEval: boolean;
  /** Whether to prune Docker build cache when disk is low. Default: true. */
  autoPruneBuildCache: boolean;
  /** Path to the SWE-bench predictions JSONL file. */
  predictionsPath: string;
  /** Path to write results JSONL. */
  resultsPath: string;
  /** Path to the SWE-bench Python harness. */
  harnessPath: string;
  /** Dataset name for the harness. Default: "SWE-bench/SWE-bench_Verified". */
  datasetName: string;
}

export const DEFAULT_INFRA_CONFIG: InfraConfig = {
  batchSize: 3,
  testTimeoutSeconds: 300,
  minFreeDiskGb: 20,
  removeImagesAfterEval: true,
  autoPruneBuildCache: true,
  predictionsPath: '/home/ubuntu/andromeda_sota_v3_fixed_predictions.jsonl',
  resultsPath: '/home/ubuntu/andromeda_infra_results.jsonl',
  harnessPath: '/home/ubuntu/SWE-bench',
  datasetName: 'SWE-bench/SWE-bench_Verified',
};

// ─── Disk Management ──────────────────────────────────────────────────────────

/**
 * Returns the current free disk space in GB for the root filesystem.
 */
export async function getFreeDiskGb(): Promise<number> {
  try {
    const { stdout } = await execAsync("df -BG / | tail -1 | awk '{print $4}' | tr -d 'G'");
    return parseInt(stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Prunes Docker build cache to free disk space.
 * Returns the amount of space freed in GB.
 */
export async function pruneBuildCache(): Promise<number> {
  try {
    const beforeGb = await getFreeDiskGb();
    await execAsync('docker builder prune -f 2>/dev/null || true');
    const afterGb = await getFreeDiskGb();
    return Math.max(0, afterGb - beforeGb);
  } catch {
    return 0;
  }
}

/**
 * Ensures there is enough free disk space before pulling a Docker image.
 * If disk is low, prunes build cache. If still low, throws an error.
 */
export async function ensureDiskSpace(
  requiredGb: number,
  autoPrune: boolean
): Promise<void> {
  const freeGb = await getFreeDiskGb();
  
  if (freeGb >= requiredGb) return;
  
  if (autoPrune) {
    console.log(`[Infra] Disk low (${freeGb}GB free). Pruning Docker build cache...`);
    const freed = await pruneBuildCache();
    console.log(`[Infra] Freed ${freed}GB. Checking again...`);
    
    const freeAfterPrune = await getFreeDiskGb();
    if (freeAfterPrune >= requiredGb) return;
    
    throw new Error(
      `Insufficient disk space: ${freeAfterPrune}GB free, ${requiredGb}GB required. ` +
      `Manual cleanup needed.`
    );
  }
  
  throw new Error(
    `Insufficient disk space: ${freeGb}GB free, ${requiredGb}GB required.`
  );
}

// ─── Image Management ─────────────────────────────────────────────────────────

/**
 * Pulls a Docker image with a timeout and disk space check.
 * Returns true if the pull succeeded, false otherwise.
 */
export async function pullImageSafely(
  image: string,
  config: InfraConfig
): Promise<boolean> {
  try {
    // Check disk space before pulling
    await ensureDiskSpace(config.minFreeDiskGb, config.autoPruneBuildCache);
    
    // Pull with a 10-minute timeout (large images can take a while)
    await Promise.race([
      execAsync(`docker pull ${image} 2>&1`),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PULL_TIMEOUT')), 10 * 60 * 1000)
      ),
    ]);
    
    return true;
  } catch (error: any) {
    console.error(`[Infra] Failed to pull ${image}: ${error.message}`);
    return false;
  }
}

/**
 * Removes a Docker image to free disk space.
 */
export async function removeImage(image: string): Promise<void> {
  try {
    await execAsync(`docker rmi -f ${image} 2>/dev/null || true`);
  } catch {
    // ignore
  }
}

// ─── Batch Evaluation ─────────────────────────────────────────────────────────

export interface BatchEvalResult {
  instanceId: string;
  resolved: boolean;
  error?: string;
  durationMs: number;
}

/**
 * Evaluates a single instance using the SWE-bench harness with an aggressive timeout.
 * Wraps the harness call with a process-level timeout to prevent hangs.
 */
export async function evaluateInstance(
  instanceId: string,
  predictionsPath: string,
  config: InfraConfig
): Promise<BatchEvalResult> {
  const start = Date.now();
  const runId = `infra_${instanceId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const logDir = path.join('/tmp', 'swebench_infra_logs', runId);
  
  try {
    const cmd = [
      `cd ${config.harnessPath}`,
      `source ~/swebench-env/bin/activate`,
      `python -m swebench.harness.run_evaluation`,
      `--dataset_name ${config.datasetName}`,
      `--predictions_path ${predictionsPath}`,
      `--max_workers 1`,
      `--instance_ids ${instanceId}`,
      `--run_id ${runId}`,
      `--cache_level instance`,
      `--timeout ${config.testTimeoutSeconds}`,
      `--log_dir ${logDir}`,
    ].join(' ');
    
    // Wrap with a hard process timeout (timeout + 60s buffer for startup/teardown)
    const hardTimeoutMs = (config.testTimeoutSeconds + 60) * 1000;
    
    await Promise.race([
      execAsync(`bash -c "${cmd}" 2>&1`, { maxBuffer: 10 * 1024 * 1024 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('HARD_TIMEOUT')), hardTimeoutMs)
      ),
    ]);
    
    // Parse result from log directory
    const resultFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.json'));
    if (resultFiles.length > 0) {
      const result = JSON.parse(
        fs.readFileSync(path.join(logDir, resultFiles[0]), 'utf-8')
      );
      const resolved = result.resolved === true ||
        (Array.isArray(result.resolved_ids) && result.resolved_ids.includes(instanceId));
      
      return { instanceId, resolved, durationMs: Date.now() - start };
    }
    
    return { instanceId, resolved: false, durationMs: Date.now() - start };
    
  } catch (error: any) {
    if (error.message === 'HARD_TIMEOUT') {
      // Kill any lingering containers for this instance
      await execAsync(
        `docker ps -q --filter "name=${instanceId}" | xargs -r docker rm -f 2>/dev/null || true`
      ).catch(() => { /* ignore */ });
    }
    
    return {
      instanceId,
      resolved: false,
      error: error.message,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Runs a full evaluation pass with robust infrastructure management.
 *
 * Key improvements over the naive approach:
 * - Sequential image pulls (not parallel) to prevent disk exhaustion
 * - Disk space checks before each pull
 * - Aggressive per-instance timeouts (300s vs 1800s default)
 * - Automatic image removal after evaluation
 * - Configurable batch size (default: 3)
 */
export async function runRobustEvaluation(
  instanceIds: string[],
  imageMap: Record<string, string>, // instanceId -> dockerImage
  config: Partial<InfraConfig> = {}
): Promise<BatchEvalResult[]> {
  const cfg = { ...DEFAULT_INFRA_CONFIG, ...config };
  const results: BatchEvalResult[] = [];
  
  console.log(`[Infra] Starting robust evaluation of ${instanceIds.length} instances`);
  console.log(`[Infra] Config: batchSize=${cfg.batchSize}, timeout=${cfg.testTimeoutSeconds}s, minDisk=${cfg.minFreeDiskGb}GB`);
  
  // Process in batches
  for (let i = 0; i < instanceIds.length; i += cfg.batchSize) {
    const batch = instanceIds.slice(i, i + cfg.batchSize);
    const batchNum = Math.floor(i / cfg.batchSize) + 1;
    const totalBatches = Math.ceil(instanceIds.length / cfg.batchSize);
    
    console.log(`[Infra] Batch ${batchNum}/${totalBatches}: ${batch.join(', ')}`);
    
    // Pull images sequentially (not in parallel) to prevent disk exhaustion
    const pulledImages: string[] = [];
    for (const instanceId of batch) {
      const image = imageMap[instanceId];
      if (!image) {
        console.warn(`[Infra] No image found for ${instanceId}, skipping`);
        continue;
      }
      
      const pulled = await pullImageSafely(image, cfg);
      if (pulled) {
        pulledImages.push(image);
      } else {
        results.push({
          instanceId,
          resolved: false,
          error: 'Image pull failed',
          durationMs: 0,
        });
      }
    }
    
    // Evaluate each instance in the batch
    for (const instanceId of batch) {
      const image = imageMap[instanceId];
      if (!image || !pulledImages.includes(image)) continue;
      
      const result = await evaluateInstance(instanceId, cfg.predictionsPath, cfg);
      results.push(result);
      
      console.log(
        `[Infra] ${instanceId}: ${result.resolved ? 'RESOLVED' : 'unresolved'} ` +
        `(${(result.durationMs / 1000).toFixed(1)}s)${result.error ? ` [${result.error}]` : ''}`
      );
      
      // Write result to output file immediately (don't lose progress)
      fs.appendFileSync(
        cfg.resultsPath,
        JSON.stringify(result) + '\n',
        'utf-8'
      );
    }
    
    // Remove images after evaluating the batch
    if (cfg.removeImagesAfterEval) {
      for (const image of pulledImages) {
        await removeImage(image);
      }
      console.log(`[Infra] Removed ${pulledImages.length} images after batch ${batchNum}`);
    }
    
    // Log disk space after each batch
    const freeGb = await getFreeDiskGb();
    console.log(`[Infra] Disk: ${freeGb}GB free after batch ${batchNum}`);
  }
  
  const resolved = results.filter(r => r.resolved).length;
  console.log(`[Infra] Complete: ${resolved}/${results.length} resolved (${(resolved / results.length * 100).toFixed(1)}%)`);
  
  return results;
}
