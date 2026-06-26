/**
 * parallelProposalOrchestrator.ts — v19.0.0
 *
 * Fan-out generation with semaphore concurrency control.
 *
 * Instead of generating proposals sequentially, this module orchestrates
 * parallel generation across multiple files or targets, bounded by a
 * concurrency limit to avoid rate-limiting from LLM providers.
 */

import { createLogger } from "./logger.js";
import { generateWithCritiqueLoop, CritiqueResult } from "./selfCritiqueAgent.js";

const log = createLogger("parallelOrchestrator");

export interface OrchestrationTask {
  targetId: string; // e.g., file path
  intent: string;
  originalSnippet: string;
  fileContext: string;
  generatorFn: (previousFeedback?: string[]) => Promise<string>;
}

export interface OrchestrationResult {
  targetId: string;
  success: boolean;
  finalSnippet: string | null;
  attempts: number;
  critique: CritiqueResult | null;
  error?: string;
}

/**
 * A simple async semaphore to limit concurrency.
 */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.permits = concurrency;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      if (resolve) resolve();
    } else {
      this.permits++;
    }
  }
}

/**
 * Orchestrates multiple proposal generation tasks in parallel, up to a concurrency limit.
 *
 * @param tasks Array of generation tasks to execute.
 * @param concurrencyLimit Maximum number of concurrent LLM calls (default: 8).
 * @param maxRetriesPerTask Max retries for the self-critique loop within each task.
 * @returns Array of orchestration results.
 */
export async function runParallelProposals(
  tasks: OrchestrationTask[],
  concurrencyLimit: number = 8,
  maxRetriesPerTask: number = 3
): Promise<OrchestrationResult[]> {
  const semaphore = new Semaphore(concurrencyLimit);
  const results: OrchestrationResult[] = [];

  log.info(`Starting parallel orchestration for ${tasks.length} tasks with concurrency limit ${concurrencyLimit}`);

  const promises = tasks.map(async (task) => {
    await semaphore.acquire();
    try {
      log.debug(`[Orchestrator] Starting task for ${task.targetId}`);
      const start = Date.now();
      
      const { finalSnippet, attempts, finalCritique } = await generateWithCritiqueLoop(
        task.generatorFn,
        maxRetriesPerTask,
        task.originalSnippet,
        task.intent,
        task.fileContext
      );

      const duration = Date.now() - start;
      log.debug(`[Orchestrator] Finished task for ${task.targetId} in ${duration}ms (attempts: ${attempts}, passed: ${finalCritique.passed})`);

      const result: OrchestrationResult = {
        targetId: task.targetId,
        success: finalCritique.passed,
        finalSnippet,
        attempts,
        critique: finalCritique,
      };
      
      results.push(result);
      return result;
    } catch (error) {
      log.error(`[Orchestrator] Task failed for ${task.targetId}: ${(error as Error).message}`);
      const result: OrchestrationResult = {
        targetId: task.targetId,
        success: false,
        finalSnippet: null,
        attempts: 0,
        critique: null,
        error: (error as Error).message,
      };
      results.push(result);
      return result;
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(promises);
  
  const successful = results.filter(r => r.success).length;
  log.info(`Parallel orchestration complete. ${successful}/${tasks.length} tasks passed critique.`);
  
  return results;
}
