/**
 * sweBenchTracebackLoop.ts — Execution-Based Traceback Loop (v1.0.0)
 *
 * Implements the "Sandbox-in-the-Loop" architecture for SWE-bench evaluation.
 * Instead of generating a single patch and submitting it blindly, this module:
 *
 *   1. Applies the candidate patch inside the SWE-bench Docker container.
 *   2. Runs the failing test suite (pytest) inside that container.
 *   3. If tests fail, captures the traceback and feeds it back to the LLM.
 *   4. The LLM generates a revised patch based on the failure context.
 *   5. Repeats up to MAX_ATTEMPTS times before submitting the best patch.
 *
 * This is the single most impactful architectural change for improving the
 * SWE-bench resolve rate. Systems using this pattern score 40-50% vs ~20%
 * for zero-shot agentless pipelines.
 *
 * Reference: "SWE-agent: Agent-Computer Interfaces Enable Automated Software
 * Engineering" (Yang et al., 2024) — https://arxiv.org/abs/2405.15793
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum number of fix attempts per instance before giving up. */
export const MAX_ATTEMPTS = 5;

/** Timeout per test run inside the container (seconds). SOTA systems use 300s. */
export const TEST_TIMEOUT_SECONDS = 300;

/** Maximum number of traceback lines to include in the LLM feedback prompt. */
const MAX_TRACEBACK_LINES = 100;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TracebackLoopInput {
  /** The SWE-bench instance ID, e.g. "django__django-12308" */
  instanceId: string;
  /** The Docker image for this instance, e.g. "swebench/sweb.eval.x86_64.django__django-12308:latest" */
  dockerImage: string;
  /** The initial candidate patch (unified diff format) */
  initialPatch: string;
  /** The repository root path inside the container (default: /testbed) */
  repoPath?: string;
  /** LLM provider function: given a prompt, returns a revised patch */
  llmProvider: (prompt: string) => Promise<string>;
}

export interface AttemptResult {
  attemptNumber: number;
  patch: string;
  testsPassed: boolean;
  testOutput: string;
  tracebackSummary: string;
  durationMs: number;
}

export interface TracebackLoopResult {
  instanceId: string;
  resolved: boolean;
  totalAttempts: number;
  finalPatch: string;
  attempts: AttemptResult[];
  totalDurationMs: number;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

/**
 * Extracts the most relevant portion of a pytest traceback for LLM feedback.
 * Truncates to MAX_TRACEBACK_LINES to stay within token budgets.
 */
export function extractTracebackSummary(testOutput: string): string {
  const lines = testOutput.split('\n');
  
  // Find the FAILED / ERROR section
  const failureStart = lines.findIndex(l =>
    l.includes('FAILED') || l.includes('ERROR') || l.includes('AssertionError') ||
    l.includes('Traceback (most recent call last)')
  );
  
  if (failureStart === -1) {
    // Return the last N lines as a fallback
    return lines.slice(-MAX_TRACEBACK_LINES).join('\n');
  }
  
  // Return from the first failure marker, capped at MAX_TRACEBACK_LINES
  const relevantLines = lines.slice(failureStart, failureStart + MAX_TRACEBACK_LINES);
  return relevantLines.join('\n');
}

/**
 * Applies a patch to a running Docker container and runs the test suite.
 * Returns the test output and whether all tests passed.
 */
export async function applyAndTest(
  containerName: string,
  patch: string,
  repoPath: string,
  timeoutSeconds: number
): Promise<{ passed: boolean; output: string }> {
  const patchId = crypto.randomBytes(4).toString('hex');
  const hostPatchPath = `/tmp/andromeda_patch_${patchId}.diff`;
  
  try {
    // Write patch to host temp file
    fs.writeFileSync(hostPatchPath, patch, 'utf-8');
    
    // Copy patch into container
    await execAsync(`docker cp ${hostPatchPath} ${containerName}:/tmp/candidate.diff`);
    
    // Apply patch inside container (with --ignore-whitespace for robustness)
    const applyResult = await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/candidate.diff 2>&1"`
    ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));
    
    if (applyResult.stderr && applyResult.stderr.includes('error:')) {
      return {
        passed: false,
        output: `PATCH_APPLY_FAILED:\n${applyResult.stderr}`
      };
    }
    
    // Run the test suite with timeout
    const testResult = await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && timeout ${timeoutSeconds} python -m pytest --tb=short -q 2>&1 || true"`
    ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
    
    const output = testResult.stdout + testResult.stderr;
    
    // Check if all tests passed
    const passed = (
      output.includes(' passed') &&
      !output.includes(' failed') &&
      !output.includes(' error') &&
      !output.includes('FAILED') &&
      !output.includes('ERROR')
    );
    
    return { passed, output };
    
  } finally {
    // Clean up host temp file
    try { fs.unlinkSync(hostPatchPath); } catch { /* ignore */ }
    
    // Reset the container's repo state for the next attempt
    await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git checkout -- . 2>/dev/null || true"`
    ).catch(() => { /* ignore */ });
  }
}

/**
 * Builds the LLM prompt for generating a revised patch based on test failures.
 */
export function buildRevisionPrompt(
  instanceId: string,
  originalPatch: string,
  tracebackSummary: string,
  attemptNumber: number
): string {
  return `You are an expert software engineer fixing a bug in a Python repository.

## Task
Instance: ${instanceId}
Attempt: ${attemptNumber} of ${MAX_ATTEMPTS}

## Your Previous Patch (which failed the tests)
\`\`\`diff
${originalPatch}
\`\`\`

## Test Failure Output
\`\`\`
${tracebackSummary}
\`\`\`

## Instructions
1. Analyze the test failure carefully. Understand WHY your previous patch failed.
2. Generate a REVISED unified diff patch that fixes the root cause.
3. The patch must be in standard \`git diff\` format (--- a/... +++ b/... @@ ... @@).
4. Do NOT include fake git hashes in index lines. Omit index lines entirely.
5. Make the minimal change necessary to fix the failing tests.
6. Output ONLY the diff, with no explanation before or after.

## Revised Patch
`;
}

/**
 * Extracts a clean diff from an LLM response that may contain surrounding text.
 */
export function extractPatchFromLLMResponse(response: string): string {
  // Try to find a diff block
  const diffMatch = response.match(/```diff\n([\s\S]*?)```/);
  if (diffMatch) return diffMatch[1].trim();
  
  // Try to find raw diff (starts with --- or diff --git)
  const rawDiffMatch = response.match(/((?:diff --git|---\s+a\/)[\s\S]*)/);
  if (rawDiffMatch) return rawDiffMatch[1].trim();
  
  // Return the full response as a fallback
  return response.trim();
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Runs the full Traceback Loop for a single SWE-bench instance.
 *
 * This function:
 * 1. Starts the SWE-bench Docker container for this instance.
 * 2. Iteratively applies patches and runs tests.
 * 3. On failure, feeds the traceback to the LLM for a revised patch.
 * 4. Returns the best result after MAX_ATTEMPTS attempts.
 */
export async function runTracebackLoop(input: TracebackLoopInput): Promise<TracebackLoopResult> {
  const {
    instanceId,
    dockerImage,
    initialPatch,
    repoPath = '/testbed',
    llmProvider,
  } = input;
  
  const containerName = `andromeda_traceback_${instanceId.replace(/[^a-zA-Z0-9_]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
  const startTime = Date.now();
  const attempts: AttemptResult[] = [];
  let currentPatch = initialPatch;
  let resolved = false;
  
  try {
    // Start the container (detached, so we can exec into it repeatedly)
    await execAsync(
      `docker run -d --name ${containerName} --memory=4g --cpus=2.0 ${dockerImage} tail -f /dev/null`
    );
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptStart = Date.now();
      
      const { passed, output } = await applyAndTest(
        containerName,
        currentPatch,
        repoPath,
        TEST_TIMEOUT_SECONDS
      );
      
      const tracebackSummary = passed ? '' : extractTracebackSummary(output);
      
      const attemptResult: AttemptResult = {
        attemptNumber: attempt,
        patch: currentPatch,
        testsPassed: passed,
        testOutput: output.slice(0, 4000), // cap stored output
        tracebackSummary,
        durationMs: Date.now() - attemptStart,
      };
      
      attempts.push(attemptResult);
      
      if (passed) {
        resolved = true;
        break;
      }
      
      // If we have more attempts, ask the LLM for a revision
      if (attempt < MAX_ATTEMPTS) {
        const revisionPrompt = buildRevisionPrompt(
          instanceId,
          currentPatch,
          tracebackSummary,
          attempt + 1
        );
        
        try {
          const llmResponse = await llmProvider(revisionPrompt);
          const revisedPatch = extractPatchFromLLMResponse(llmResponse);
          if (revisedPatch && revisedPatch.length > 10) {
            currentPatch = revisedPatch;
          }
        } catch (llmError) {
          // If LLM call fails, keep the current patch and try again
          console.error(`[TracebackLoop] LLM revision failed for ${instanceId}:`, llmError);
        }
      }
    }
    
  } finally {
    // Always clean up the container
    await execAsync(`docker rm -f ${containerName}`).catch(() => { /* ignore */ });
  }
  
  return {
    instanceId,
    resolved,
    totalAttempts: attempts.length,
    finalPatch: currentPatch,
    attempts,
    totalDurationMs: Date.now() - startTime,
  };
}
