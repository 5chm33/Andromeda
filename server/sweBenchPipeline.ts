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
  }
): Promise<PipelineResult> {
  const startTime = Date.now();
  const {
    llmProvider,
    agentCount = 4,
    maxTracebackAttempts = 5,
    useConsensus = true,
    useTracebackLoop = true,
  } = config;

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
        testPatch: options?.testPatch,
        failToPassTests: options?.failToPassTests,
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
    if (consensusResult.winningPatch) {
      bestPatch = consensusResult.winningPatch;
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
      testPatch: options?.testPatch,
      failToPassTests: options?.failToPassTests,
      repoPath: '/testbed',
      llmProvider: (prompt) => llmProvider(prompt, 0.2),
      issueDescription,
      fileContents,
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

    if (tracebackResult.resolved) {
      return {
        instanceId,
        resolved: true,
        finalPatch: bestPatch,
        phases,
        totalDurationMs: Date.now() - startTime,
      };
    }
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
