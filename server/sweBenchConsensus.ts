/**
 * sweBenchConsensus.ts — Parallel Multi-Agent Consensus Engine (v1.0.0)
 *
 * Implements the "Ensemble + Judge" architecture used by top-scoring SWE-bench
 * systems (Zencoder 70%, Auggie 75%+).
 *
 * Architecture:
 *   1. Spawn N parallel agents, each generating a candidate patch independently.
 *   2. Each agent uses a different LLM or temperature to maximize patch diversity.
 *   3. A "Judge" agent runs each candidate in the sandbox and selects the winner:
 *      - First priority: patches that pass ALL tests.
 *      - Second priority: patches that pass the MOST tests (partial credit).
 *      - Tiebreaker: shortest patch (minimal invasiveness principle).
 *   4. The winning patch is submitted as the final answer.
 *
 * This pattern reliably improves resolve rates by 15-25 percentage points over
 * single-agent approaches, at the cost of N× the LLM API spend.
 *
 * Reference: "Zencoder: Resolving 70% of SWE-bench Verified with Multi-Agent
 * Consensus" — https://arxiv.org/html/2506.17208v2
 */

import crypto from 'crypto';
import { applyAndTest, extractTracebackSummary, TEST_TIMEOUT_SECONDS } from './sweBenchTracebackLoop.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of parallel agents to run per instance. 4 is the sweet spot for cost/quality. */
export const DEFAULT_AGENT_COUNT = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Unique name for this agent (used in logging) */
  name: string;
  /** LLM provider function for this agent */
  llmProvider: (prompt: string) => Promise<string>;
  /** Temperature hint to embed in the prompt (0.0 = deterministic, 0.8 = creative) */
  temperature: number;
}

export interface CandidatePatch {
  agentName: string;
  patch: string;
  testsPassed: boolean;
  testsPassedCount: number;
  testsFailedCount: number;
  testOutput: string;
  generationDurationMs: number;
  evaluationDurationMs: number;
}

export interface ConsensusResult {
  instanceId: string;
  resolved: boolean;
  winningPatch: string;
  winningAgent: string;
  candidates: CandidatePatch[];
  totalDurationMs: number;
  selectionReason: string;
}

// ─── Patch Generation ─────────────────────────────────────────────────────────

/**
 * Builds a patch generation prompt for a given agent.
 * Each agent gets a slightly different framing to encourage diverse solutions.
 */
export function buildAgentPrompt(
  instanceId: string,
  issueDescription: string,
  relevantCode: string,
  agentConfig: AgentConfig
): string {
  const styleHints: Record<string, string> = {
    conservative: 'Make the MINIMAL possible change. Prefer fixing the bug with the fewest lines changed.',
    creative: 'Think creatively. Consider multiple approaches and choose the most elegant solution.',
    defensive: 'Focus on edge cases and defensive programming. Ensure the fix handles all error conditions.',
    refactor: 'Consider whether a small refactor would make the fix cleaner and more maintainable.',
  };
  
  const styleHint = styleHints[agentConfig.name] || styleHints.conservative;
  
  return `You are an expert Python software engineer solving a GitHub issue.

## Instance: ${instanceId}
## Agent Role: ${agentConfig.name} (temperature: ${agentConfig.temperature})

## Issue Description
${issueDescription}

## Relevant Code
\`\`\`python
${relevantCode}
\`\`\`

## Your Task
${styleHint}

Generate a unified diff patch that fixes this issue. Requirements:
- Standard \`git diff\` format (--- a/path +++ b/path @@ ... @@)
- Do NOT include index lines (lines starting with "index")
- Make the patch apply cleanly with \`git apply\`
- Fix the root cause, not just the symptom

Output ONLY the diff. No explanation.

\`\`\`diff
`;
}

/**
 * Counts the number of passing and failing tests from pytest output.
 */
export function parseTestCounts(output: string): { passed: number; failed: number } {
  // Match patterns like "5 passed, 2 failed" or "3 passed" or "1 failed"
  const passedMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+(?:failed|error)/);
  
  return {
    passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
  };
}

// ─── Judge Logic ──────────────────────────────────────────────────────────────

/**
 * Selects the best candidate patch from the ensemble results.
 *
 * Selection priority:
 * 1. Patches that pass ALL tests (fully resolved).
 * 2. Patches that pass the MOST tests (partial credit, best effort).
 * 3. Shortest patch (minimal invasiveness tiebreaker).
 */
export function selectWinningPatch(candidates: CandidatePatch[]): {
  winner: CandidatePatch;
  reason: string;
} {
  // Priority 1: fully passing patches
  const fullyPassing = candidates.filter(c => c.testsPassed);
  if (fullyPassing.length > 0) {
    // Among fully passing, pick the shortest patch
    const winner = fullyPassing.reduce((a, b) =>
      a.patch.length <= b.patch.length ? a : b
    );
    return {
      winner,
      reason: `Selected from ${fullyPassing.length} fully-passing candidate(s) — shortest patch wins.`,
    };
  }
  
  // Priority 2: most tests passing
  const bestPassCount = Math.max(...candidates.map(c => c.testsPassedCount));
  if (bestPassCount > 0) {
    const bestCandidates = candidates.filter(c => c.testsPassedCount === bestPassCount);
    const winner = bestCandidates.reduce((a, b) =>
      a.patch.length <= b.patch.length ? a : b
    );
    return {
      winner,
      reason: `No fully-passing patch. Selected best partial: ${bestPassCount} tests passed.`,
    };
  }
  
  // Priority 3: all failed — return the shortest patch as the "least bad" option
  const winner = candidates.reduce((a, b) =>
    a.patch.length <= b.patch.length ? a : b
  );
  return {
    winner,
    reason: 'All candidates failed. Returning shortest patch as best-effort submission.',
  };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Runs the full Parallel Consensus pipeline for a single SWE-bench instance.
 *
 * @param instanceId - The SWE-bench instance ID
 * @param dockerImage - The Docker image for this instance
 * @param issueDescription - The GitHub issue text
 * @param relevantCode - The relevant code snippets (from localization phase)
 * @param agents - Array of agent configurations (LLM providers + temperatures)
 */
export async function runConsensus(
  instanceId: string,
  dockerImage: string,
  issueDescription: string,
  relevantCode: string,
  agents: AgentConfig[]
): Promise<ConsensusResult> {
  const startTime = Date.now();
  
  // ── Phase 1: Parallel Patch Generation ──────────────────────────────────────
  const patchGenerationPromises = agents.map(async (agent): Promise<{ agent: AgentConfig; patch: string; durationMs: number }> => {
    const genStart = Date.now();
    const prompt = buildAgentPrompt(instanceId, issueDescription, relevantCode, agent);
    
    try {
      const response = await agent.llmProvider(prompt);
      // Extract the diff from the response
      const diffMatch = response.match(/```diff\n?([\s\S]*?)(?:```|$)/);
      const patch = diffMatch ? diffMatch[1].trim() : response.trim();
      return { agent, patch, durationMs: Date.now() - genStart };
    } catch (error) {
      console.error(`[Consensus] Agent ${agent.name} failed for ${instanceId}:`, error);
      return { agent, patch: '', durationMs: Date.now() - genStart };
    }
  });
  
  const generatedPatches = await Promise.all(patchGenerationPromises);
  
  // Filter out empty patches
  const validPatches = generatedPatches.filter(p => p.patch.length > 10);
  
  if (validPatches.length === 0) {
    return {
      instanceId,
      resolved: false,
      winningPatch: '',
      winningAgent: 'none',
      candidates: [],
      totalDurationMs: Date.now() - startTime,
      selectionReason: 'All agents failed to generate valid patches.',
    };
  }
  
  // ── Phase 2: Parallel Sandbox Evaluation ────────────────────────────────────
  // Start one container per candidate for parallel evaluation
  const evaluationPromises = validPatches.map(async ({ agent, patch, durationMs: genDuration }): Promise<CandidatePatch> => {
    const containerName = `andromeda_consensus_${instanceId.replace(/[^a-zA-Z0-9_]/g, '_')}_${agent.name}_${crypto.randomBytes(4).toString('hex')}`;
    const evalStart = Date.now();
    
    try {
      // Start container
      await execAsync(
        `docker run -d --name ${containerName} --memory=4g --cpus=1.5 ${dockerImage} tail -f /dev/null`
      );
      
      const { passed, output } = await applyAndTest(
        containerName,
        patch,
        '/testbed',
        TEST_TIMEOUT_SECONDS
      );
      
      const { passed: passedCount, failed: failedCount } = parseTestCounts(output);
      
      return {
        agentName: agent.name,
        patch,
        testsPassed: passed,
        testsPassedCount: passedCount,
        testsFailedCount: failedCount,
        testOutput: output.slice(0, 2000),
        generationDurationMs: genDuration,
        evaluationDurationMs: Date.now() - evalStart,
      };
      
    } catch (error: any) {
      return {
        agentName: agent.name,
        patch,
        testsPassed: false,
        testsPassedCount: 0,
        testsFailedCount: -1,
        testOutput: `Evaluation error: ${error.message}`,
        generationDurationMs: genDuration,
        evaluationDurationMs: Date.now() - evalStart,
      };
    } finally {
      await execAsync(`docker rm -f ${containerName}`).catch(() => { /* ignore */ });
    }
  });
  
  const candidates = await Promise.all(evaluationPromises);
  
  // ── Phase 3: Judge Selection ─────────────────────────────────────────────────
  const { winner, reason } = selectWinningPatch(candidates);
  
  return {
    instanceId,
    resolved: winner.testsPassed,
    winningPatch: winner.patch,
    winningAgent: winner.agentName,
    candidates,
    totalDurationMs: Date.now() - startTime,
    selectionReason: reason,
  };
}

// ─── Default Agent Configurations ────────────────────────────────────────────

/**
 * Creates a set of 4 default agent configurations for the consensus pipeline.
 * Each agent has a different name/temperature to encourage diverse solutions.
 *
 * @param llmProvider - A single LLM provider function (same model, different temps)
 */
export function createDefaultAgents(
  llmProvider: (prompt: string, temperature?: number) => Promise<string>
): AgentConfig[] {
  return [
    {
      name: 'conservative',
      temperature: 0.0,
      llmProvider: (prompt) => llmProvider(prompt, 0.0),
    },
    {
      name: 'creative',
      temperature: 0.4,
      llmProvider: (prompt) => llmProvider(prompt, 0.4),
    },
    {
      name: 'defensive',
      temperature: 0.2,
      llmProvider: (prompt) => llmProvider(prompt, 0.2),
    },
    {
      name: 'refactor',
      temperature: 0.6,
      llmProvider: (prompt) => llmProvider(prompt, 0.6),
    },
  ];
}
