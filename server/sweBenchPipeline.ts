/**
 * sweBenchPipeline.ts — Unified SWE-bench Pipeline Orchestrator (v2.0.0)
 *
 * v2.0.0 upgrades:
 *   - fileContents (Record<string, string>) replaces relevantCode string
 *   - testPatch and failToPassTests passed through to consensus + traceback loop
 *   - Multi-file patch support throughout
 *   - Conda activation and repo-specific test commands
 *
 * Pipeline phases:
 *   Phase 1 — Localization (runner script)
 *     Extract files from Docker image at exact base_commit.
 *     Identify relevant files using LLM + issue description.
 *
 *   Phase 2 — Multi-Agent Consensus (sweBenchConsensus.ts)
 *     4 agents generate candidate patches in parallel with diverse temperatures.
 *     Each agent outputs complete file content; difflib generates exact diffs.
 *
 *   Phase 3 — Traceback Loop (sweBenchTracebackLoop.ts)
 *     Best candidate fed into iterative test-feedback loop.
 *     Up to 5 rounds of sandbox execution + LLM revision.
 *
 * Expected performance:
 *   Baseline (zero-shot agentless):  19.2%
 *   v2.0.0 target:                   40-50%
 *   With RAG context optimizer:      50-60%
 */

export { runTracebackLoop, MAX_ATTEMPTS, TEST_TIMEOUT_SECONDS } from './sweBenchTracebackLoop.js';
export {
  runConsensus,
  createDefaultAgents,
  selectWinningPatch,
  DEFAULT_AGENT_COUNT,
} from './sweBenchConsensus.js';
export {
  runRobustEvaluation,
  ensureDiskSpace,
  getFreeDiskGb,
  pullImageSafely,
  removeImage,
  DEFAULT_INFRA_CONFIG,
} from './sweBenchInfra.js';

import { runTracebackLoop, TracebackLoopInput } from './sweBenchTracebackLoop.js';
import { runConsensus, createDefaultAgents, AgentConfig } from './sweBenchConsensus.js';
import { runRobustEvaluation, DEFAULT_INFRA_CONFIG, InfraConfig } from './sweBenchInfra.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineConfig {
  /** LLM provider for patch generation and revision */
  llmProvider: (prompt: string, temperature?: number) => Promise<string>;
  /** Number of parallel agents for consensus. Default: 4. */
  agentCount?: number;
  /** Max traceback loop attempts. Default: 5. */
  maxTracebackAttempts?: number;
  /** Infrastructure configuration */
  infraConfig?: Partial<InfraConfig>;
  /** Whether to run consensus (Phase 2) before traceback loop. Default: true. */
  useConsensus?: boolean;
  /** Whether to run traceback loop (Phase 3). Default: true. */
  useTracebackLoop?: boolean;
  /** Optional escalating LLM provider for traceback loop.
   *  Given an attempt number (1-based), returns the LLM provider to use for that revision.
   *  Allows using stronger models on later attempts (e.g., Fable on attempt 3+). */
  escalatingLLMProvider?: (attempt: number) => (prompt: string) => Promise<string>;
  /**
   * Evaluation mode controlling what information is visible to the model.
   *
   * 'scored_strict' (default for SWEBENCH_SCORED=1):
   *   The model sees only the issue text and repository state.
   *   test_patch and FAIL_TO_PASS names are NEVER inserted into any
   *   model-visible prompt (initial generation, consensus, smart-context
   *   retrieval, revision prompts). The evaluator still applies test_patch
   *   after prediction — that is correct and expected.
   *   Results are comparable with published SWE-bench strict scores.
   *
   * 'test_aware' (default for development runs):
   *   test_patch code and FAIL_TO_PASS names are inserted into prompts as
   *   hints. Useful for development iteration but NOT comparable with
   *   published SWE-bench scores. Label results separately.
   */
  evalMode?: 'scored_strict' | 'test_aware';
}

export interface PipelineResult {
  instanceId: string;
  resolved: boolean;
  finalPatch: string;
  phases: {
    consensus?: { agentsRun: number; candidatesGenerated: number; anyPassed: boolean };
    tracebackLoop?: { attemptsUsed: number; resolvedOnAttempt: number | null };
  };
  totalDurationMs: number;
  /** SHA-256 of the final patch text (hex, 64 chars). Populated when the
   * traceback loop ran; undefined if consensus resolved before the loop. */
  patchHash?: string;
  /** True if the final patch applied exactly (no fuzzy recovery). Undefined
   * when the traceback loop did not run (consensus resolved). */
  exactApply?: boolean;
  /** True if the last attempt was cut short by the timeout. */
  timedOut?: boolean;
  /** Immutable digest of the Docker image that ran (sha256:...). */
  resolvedImageDigest?: string;
  /**
   * True in scored_strict mode when the patch applied cleanly and the loop
   * stopped without running hidden tests. The patch is ready for the external
   * evaluator. Must be recorded as 'prediction_ready' in the run bundle,
   * not as 'test_failure'.
   */
  predictionReady?: boolean;
}

// ─── Pipeline Orchestrator ────────────────────────────────────────────────────

/**
 * Runs the full SOTA pipeline for a single SWE-bench instance.
 *
 * v2.0.0: Takes fileContents (extracted from Docker) instead of relevantCode string.
 * Passes testPatch and failToPassTests through all phases.
 */
export async function runSOTAPipeline(
  instanceId: string,
  dockerImage: string,
  issueDescription: string,
  fileContents: Record<string, string>,
  initialPatch: string,
  config: PipelineConfig,
  options?: {
    testPatch?: string;
    failToPassTests?: string[];
    /** Repository slug (e.g. 'caddyserver/caddy'). Required for multilingual test-command selection. */
    repo?: string;
  }
): Promise<PipelineResult> {
  const startTime = Date.now();
  const {
    llmProvider,
    agentCount = 4,
    maxTracebackAttempts = 5,
    useConsensus = true,
    useTracebackLoop = true,
    evalMode = 'test_aware',
  } = config;
  // In scored_strict mode the model must not see test_patch or FAIL_TO_PASS.
  // The evaluator still applies test_patch after prediction — that is correct.
  const isStrict = evalMode === 'scored_strict';
  const promptTestPatch = isStrict ? undefined : options?.testPatch;
  const promptFailToPass = isStrict ? undefined : options?.failToPassTests;

  let bestPatch = initialPatch;
  const phases: PipelineResult['phases'] = {};

  // ── Phase 2: Multi-Agent Consensus ──────────────────────────────────────────
  if (useConsensus) {
    const agents: AgentConfig[] = createDefaultAgents(llmProvider).slice(0, agentCount);

    const consensusResult = await runConsensus(
      instanceId,
      dockerImage,
      issueDescription,
      fileContents,
      agents,
      {
        testPatch: promptTestPatch,
        failToPassTests: promptFailToPass,
        // scored_strict: generation-only, no sandbox evaluation
        evalMode,
      }
    );

    phases.consensus = {
      agentsRun: agents.length,
      candidatesGenerated: consensusResult.candidates.length,
      anyPassed: consensusResult.resolved,
    };

    // Log consensus test output for debugging
    for (const c of consensusResult.candidates) {
      console.log(`[Consensus] Agent ${c.agentName}: passed=${c.testsPassed}, output=${c.testOutput?.slice(0, 400)}`);
    }
    // Only use the consensus patch if it resolved OR if it's a targeted diff
    // (shorter than the original initialPatch * 10 as a heuristic for full-file rewrites)
    // This prevents a failed full-file-rewrite consensus patch from poisoning the traceback loop
    if (consensusResult.winningPatch) {
      const isTargetedDiff = consensusResult.winningPatch.length < Math.max(initialPatch.length * 10, 50000);
      if (consensusResult.resolved || isTargetedDiff) {
        bestPatch = consensusResult.winningPatch;
      } else {
        console.log(`[Pipeline] Consensus patch rejected (${consensusResult.winningPatch.length} chars — likely full-file rewrite). Keeping original initialPatch (${initialPatch.length} chars) for traceback loop.`);
      }
    }

    // If consensus already resolved it, skip the traceback loop
    if (consensusResult.resolved) {
      return {
        instanceId,
        resolved: true,
        finalPatch: bestPatch,
        phases,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  // ── Phase 3: Traceback Loop ──────────────────────────────────────────────────
  if (useTracebackLoop) {
    const tracebackInput: TracebackLoopInput = {
      instanceId,
      dockerImage,
      initialPatch: bestPatch,
      // testPatch is always passed for evaluation (the evaluator applies it);
      // promptTestPatch is undefined in scored_strict so it never enters prompts.
      testPatch: options?.testPatch,
      failToPassTests: options?.failToPassTests,
      // These two are the prompt-visible variants — undefined in scored_strict.
      promptTestPatch,
      promptFailToPassTests: promptFailToPass,
      evalMode,
      repoPath: '/testbed',
      llmProvider: (prompt) => llmProvider(prompt, 0.2),
      escalatingLLMProvider: config.escalatingLLMProvider,
      issueDescription,
      fileContents,
      // repo: required for multilingual test-command selection
      repo: options?.repo,
    };

    const tracebackResult = await runTracebackLoop(tracebackInput);

    const resolvedOnAttempt = tracebackResult.attempts.findIndex(a => a.testsPassed);

    phases.tracebackLoop = {
      attemptsUsed: tracebackResult.totalAttempts,
      resolvedOnAttempt: resolvedOnAttempt >= 0 ? resolvedOnAttempt + 1 : null,
    };

    if (tracebackResult.finalPatch) {
      bestPatch = tracebackResult.finalPatch;
    }

    // Always propagate structured runtime fields from the traceback result,
    // regardless of whether the run resolved.
    const tracebackFields = {
      patchHash: tracebackResult.patchHash,
      exactApply: tracebackResult.exactApply,
      timedOut: tracebackResult.timedOut,
      resolvedImageDigest: tracebackResult.resolvedImageDigest,
      predictionReady: tracebackResult.predictionReady,
    };
    if (tracebackResult.resolved) {
      return {
        instanceId,
        resolved: true,
        finalPatch: bestPatch,
        phases,
        totalDurationMs: Date.now() - startTime,
        ...tracebackFields,
      };
    }
    return {
      instanceId,
      resolved: false,
      finalPatch: bestPatch,
      phases,
      totalDurationMs: Date.now() - startTime,
      ...tracebackFields,
    };
  }

  return {
    instanceId,
    resolved: false,
    finalPatch: bestPatch,
    phases,
    totalDurationMs: Date.now() - startTime,
  };
}

// ─── Batch Pipeline Runner ────────────────────────────────────────────────────

/**
 * Runs the SOTA pipeline across multiple instances with robust infrastructure.
 */
export async function runBatchSOTAPipeline(
  instances: Array<{
    instanceId: string;
    dockerImage: string;
    issueDescription: string;
    fileContents: Record<string, string>;
    initialPatch: string;
    testPatch?: string;
    failToPassTests?: string[];
  }>,
  config: PipelineConfig
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  for (const inst of instances) {
    try {
      const result = await runSOTAPipeline(
        inst.instanceId,
        inst.dockerImage,
        inst.issueDescription,
        inst.fileContents,
        inst.initialPatch,
        config,
        {
          testPatch: inst.testPatch,
          failToPassTests: inst.failToPassTests,
        }
      );
      results.push(result);
    } catch (err: any) {
      console.error(`[Pipeline] Instance ${inst.instanceId} failed:`, err.message);
      results.push({
        instanceId: inst.instanceId,
        resolved: false,
        finalPatch: inst.initialPatch,
        phases: {},
        totalDurationMs: 0,
      });
    }
  }

  const resolved = results.filter(r => r.resolved).length;
  console.log(
    `[Pipeline] Complete: ${resolved}/${results.length} resolved ` +
    `(${(resolved / results.length * 100).toFixed(1)}%)`
  );

  return results;
}
