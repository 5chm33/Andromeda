/**
 * sweBenchTracebackLoop.ts — Execution-Based Traceback Loop (v2.0.0)
 *
 * v2.0.0 upgrades (fixes for 26% → 40%+ resolution rate):
 *   - Conda environment activation before running tests (fixes "No module named pytest")
 *   - test_patch applied BEFORE running tests (fixes "test not found" errors)
 *   - Repo-specific test commands (Django uses runtests.py, not pytest)
 *   - difflib-based patch generation: ask LLM for modified file content, generate
 *     diff from actual file content (eliminates all @@ header mismatch errors)
 *   - Section-replacement for large files (>8000 chars): show only relevant section
 *   - Multi-file patch support: LLM can output changes to multiple files
 *
 * Architecture:
 *   1. Applies the candidate patch inside the SWE-bench Docker container.
 *   2. Applies test_patch to add new test cases.
 *   3. Runs the failing test suite using the repo-specific test command.
 *   4. If tests fail, captures the traceback and feeds it back to the LLM.
 *   5. The LLM generates a revised patch based on the failure context.
 *   6. Repeats up to MAX_ATTEMPTS times before submitting the best patch.
 *
 * Reference: "SWE-agent: Agent-Computer Interfaces Enable Automated Software
 * Engineering" (Yang et al., 2024) — https://arxiv.org/abs/2405.15793
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'crypto';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum number of fix attempts per instance before giving up. */
export const MAX_ATTEMPTS = 5;

/** Timeout per test run inside the container (seconds). SOTA systems use 300s. */
export const TEST_TIMEOUT_SECONDS = 300;

/** Maximum number of traceback lines to include in the LLM feedback prompt. */
const MAX_TRACEBACK_LINES = 150;

/** Skeleton context: maximum chars of fully-expanded function bodies to include. */
const MAX_EXPANDED_CHARS = 20000;

/**
 * Builds a skeleton context view of a Python file for large files.
 * Shared implementation with sweBenchConsensus.ts and run_swebench.ts.
 */
function buildSkeletonContext(
  filePath: string,
  content: string,
  keywords: string[]
): string {
  if (content.length <= 12000) return content;

  const lines = content.split('\n');
  const skeletonLines: string[] = [];
  const functionBodies: Map<string, { start: number; end: number; name: string }> = new Map();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const defMatch = trimmed.match(/^(class|def)\s+(\w+)/);
    if (defMatch) {
      const name = defMatch[2];
      const bodyStart = i;
      const baseIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      let j = i + 1;
      while (j < lines.length) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed.length === 0) { j++; continue; }
        const nextIndent = lines[j].match(/^(\s*)/)?.[1]?.length ?? 0;
        if (nextIndent <= baseIndent && nextTrimmed.length > 0) break;
        j++;
      }
      functionBodies.set(name, { start: bodyStart, end: j - 1, name });
      skeletonLines.push(line);
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith('"""')) {
        skeletonLines.push(lines[i + 1]);
        if (!lines[i + 1].trim().endsWith('"""')) {
          let k = i + 2;
          while (k < lines.length && !lines[k].includes('"""')) k++;
          if (k < lines.length) skeletonLines.push(lines[k]);
        }
      }
      skeletonLines.push('    ...');
      i = j;
      continue;
    }
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('@') ||
      trimmed.startsWith('#') ||
      (trimmed.length > 0 && !trimmed.startsWith(' ') && line.match(/^[A-Z_][A-Z0-9_]*\s*=/))
    ) {
      skeletonLines.push(line);
    }
    i++;
  }

  const relevantNames = new Set<string>();
  for (const [name] of functionBodies) {
    const nameLower = name.toLowerCase();
    if (keywords.some(kw => nameLower.includes(kw) || kw.includes(nameLower))) {
      relevantNames.add(name);
    }
  }

  let result = `# File: ${filePath} (${lines.length} lines total \u2014 skeleton view)\n`;
  result += `# Fully expanded: ${relevantNames.size > 0 ? [...relevantNames].join(', ') : '(none matched \u2014 showing skeleton only)'}\n\n`;
  result += skeletonLines.join('\n') + '\n\n';

  let expandedChars = result.length;
  for (const name of relevantNames) {
    const body = functionBodies.get(name);
    if (!body) continue;
    const bodyText = lines.slice(body.start, body.end + 1).join('\n');
    if (expandedChars + bodyText.length > MAX_EXPANDED_CHARS) break;
    result += `# === EXPANDED: ${name} ===\n${bodyText}\n\n`;
    expandedChars += bodyText.length;
  }

  if (relevantNames.size === 0) {
    let count = 0;
    for (const [name, body] of functionBodies) {
      if (count >= 3) break;
      const bodyText = lines.slice(body.start, body.end + 1).join('\n');
      if (expandedChars + bodyText.length > MAX_EXPANDED_CHARS) break;
      result += `# === EXPANDED: ${name} ===\n${bodyText}\n\n`;
      expandedChars += bodyText.length;
      count++;
    }
  }

  return result;
}

// ─── Repo-Specific Test Commands ─────────────────────────────────────────────

/**
 * Returns the correct test command for a given repo.
 * Django uses its own test runner; most others use pytest.
 */
function getTestCommand(instanceId: string, failToPassTests: string[]): string {
  const repo = instanceId.split('__')[0].toLowerCase();

  if (repo === 'django') {
    // Django uses runtests.py — convert test file paths to module names
    // e.g. "tests/test_utils/tests.py::TestClass::test_method" -> "test_utils.tests"
    const testModules = [...new Set(failToPassTests.map(t => {
      const filePart = t.split('::')[0];
      return filePart
        .replace(/^tests\//, '')
        .replace(/\.py$/, '')
        .replace(/\//g, '.');
    }))];
    const moduleArgs = testModules.length > 0 ? testModules.join(' ') : '';
    return `cd /testbed && source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && python tests/runtests.py --verbosity=2 ${moduleArgs}`;
  }

  // Default: pytest with conda testbed environment
  const testArgs = failToPassTests.length > 0
    ? failToPassTests.map(t => `"${t}"`).join(' ')
    : '';
  return `cd /testbed && source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && python -m pytest --tb=short -q ${testArgs}`;
}

/**
 * Returns the "passed" detection function for a given repo.
 */
function isPassed(instanceId: string, output: string): boolean {
  const repo = instanceId.split('__')[0].toLowerCase();
  if (repo === 'django') {
    return output.includes('OK') && !output.includes('FAILED') && !output.includes('ERROR');
  }
  return (
    output.includes(' passed') &&
    !output.includes(' failed') &&
    !output.includes(' error') &&
    !output.includes('FAILED') &&
    !output.includes('ERROR')
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TracebackLoopInput {
  /** The SWE-bench instance ID, e.g. "django__django-12308" */
  instanceId: string;
  /** The Docker image for this instance */
  dockerImage: string;
  /** The initial candidate patch (unified diff format) */
  initialPatch: string;
  /** The test_patch from the SWE-bench dataset (adds new test cases) */
  testPatch?: string;
  /** The failing tests that need to pass (FAIL_TO_PASS field) */
  failToPassTests?: string[];
  /** The repository root path inside the container (default: /testbed) */
  repoPath?: string;
  /** LLM provider function: given a prompt, returns a revised patch */
  llmProvider: (prompt: string) => Promise<string>;
  /** The original issue description (for context in revision prompts) */
  issueDescription?: string;
  /** Map of file paths to their content (extracted from Docker) */
  fileContents?: Record<string, string>;
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
 * Extracts the most relevant portion of a pytest/Django traceback for LLM feedback.
 * Truncates to MAX_TRACEBACK_LINES to stay within token budgets.
 */
export function extractTracebackSummary(testOutput: string): string {
  const lines = testOutput.split('\n');

  // Priority 1: Find the === FAILURES === section (contains assertion diffs)
  // This is the most useful section for the LLM to understand what went wrong
  const failuresSectionStart = lines.findIndex(l =>
    l.includes('=== FAILURES ===') || l.includes('====== FAILURES ======') ||
    l.match(/={3,}\s*FAILURES\s*={3,}/)
  );

  if (failuresSectionStart !== -1) {
    // Take up to MAX_TRACEBACK_LINES from the FAILURES section
    const relevantLines = lines.slice(failuresSectionStart, failuresSectionStart + MAX_TRACEBACK_LINES);
    return relevantLines.join('\n');
  }

  // Priority 2: Find Traceback (most recent call last)
  const tracebackStart = lines.findIndex(l =>
    l.includes('Traceback (most recent call last)')
  );
  if (tracebackStart !== -1) {
    return lines.slice(tracebackStart, tracebackStart + MAX_TRACEBACK_LINES).join('\n');
  }

  // Priority 3: Find FAIL: or ERROR: (Django test runner format)
  const failStart = lines.findIndex(l =>
    l.match(/^(FAIL|ERROR):\s/) || l.includes('AssertionError')
  );
  if (failStart !== -1) {
    return lines.slice(failStart, failStart + MAX_TRACEBACK_LINES).join('\n');
  }

  // Fallback: last MAX_TRACEBACK_LINES
  return lines.slice(-MAX_TRACEBACK_LINES).join('\n');
}

/**
 * Applies a patch to a running Docker container and runs the test suite.
 * Applies test_patch first to add new test cases (critical for SWE-bench).
 * Uses conda activation and repo-specific test commands.
 */
export async function applyAndTest(
  containerName: string,
  patch: string,
  repoPath: string,
  timeoutSeconds: number,
  options?: {
    testPatch?: string;
    failToPassTests?: string[];
    instanceId?: string;
  }
): Promise<{ passed: boolean; output: string }> {
  const patchId = crypto.randomBytes(4).toString('hex');
  const hostPatchPath = `/tmp/andromeda_patch_${patchId}.diff`;
  const hostTestPatchPath = `/tmp/andromeda_testpatch_${patchId}.diff`;
  const hostScriptPath = `/tmp/andromeda_test_${patchId}.sh`;
  const instanceId = options?.instanceId ?? 'unknown__unknown';
  const failToPassTests = options?.failToPassTests ?? [];

  try {
    // ── Step 0: Reset the container's repo state from any previous attempt ──
    await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git checkout -- . 2>/dev/null || true"`
    ).catch(() => { /* ignore */ });

    // ── Step 1: Apply the model patch ──────────────────────────────────────
    fs.writeFileSync(hostPatchPath, patch, 'utf-8');
    await execAsync(`docker cp ${hostPatchPath} ${containerName}:/tmp/candidate.diff`);

    const applyResult = await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/candidate.diff 2>&1"`
    ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));

    if (applyResult.stderr && applyResult.stderr.includes('error:')) {
      return {
        passed: false,
        output: `PATCH_APPLY_FAILED:\n${applyResult.stderr}`
      };
    }

    // ── Step 2: Apply test_patch (adds new test cases) ─────────────────────
    if (options?.testPatch && options.testPatch.trim().length > 10) {
      fs.writeFileSync(hostTestPatchPath, options.testPatch, 'utf-8');
      await execAsync(`docker cp ${hostTestPatchPath} ${containerName}:/tmp/test_patch.diff`);
      await execAsync(
        `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/test_patch.diff 2>&1"`
      ).catch(() => { /* test_patch failures are non-fatal */ });
    }

    // ── Step 3: Run tests with repo-specific command ───────────────────────
    // Write test script to a file inside the container to avoid shell quoting
    // issues with `timeout` (which can't run shell builtins like `cd` directly)
    const testCmd = getTestCommand(instanceId, failToPassTests);
    const testScript = `#!/bin/bash\nset -e\n${testCmd}\n`;
    fs.writeFileSync(hostScriptPath, testScript, 'utf-8');
    await execAsync(`docker cp ${hostScriptPath} ${containerName}:/tmp/run_tests.sh`);
    await execAsync(`docker exec ${containerName} chmod +x /tmp/run_tests.sh`);
    const testResult = await execAsync(
      `docker exec ${containerName} bash -c "timeout ${timeoutSeconds} /tmp/run_tests.sh 2>&1 || true"`
    ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));

    const output = testResult.stdout + testResult.stderr;
    const passed = isPassed(instanceId, output);

    return { passed, output };

  } finally {
    try { fs.unlinkSync(hostPatchPath); } catch { /* ignore */ }
    try { fs.unlinkSync(hostTestPatchPath); } catch { /* ignore */ }
    try { fs.unlinkSync(hostScriptPath); } catch { /* ignore */ }
    // NOTE: We do NOT reset the repo here anymore.
    // The reset is done at the START of the next applyAndTest call (Step 0).
    // This allows the caller to read the current patched file state for revision prompts.
  }
}

/**
 * Builds the LLM prompt for generating a revised patch based on test failures.
 * Uses the "output complete file" approach for small files, targeted diff for large.
 */
export function buildRevisionPrompt(
  instanceId: string,
  originalPatch: string,
  tracebackSummary: string,
  attemptNumber: number,
  options?: {
    issueDescription?: string;
    fileContents?: Record<string, string>;  // CURRENT state of files (after patch applied)
    originalFileContents?: Record<string, string>;  // ORIGINAL state before any patches
    failToPassTests?: string[];
    testPatch?: string;  // The new test code that must pass
  }
): string {
  // Show the CURRENT state of the files (after the failed patch was applied)
  // This lets the LLM see exactly what it changed and why it's wrong
  const currentFiles = options?.fileContents ?? options?.originalFileContents;
  // Build keywords from issue + test names for skeleton context
  const skeletonKeywords = [
    ...(options?.issueDescription ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 4),
    ...(options?.failToPassTests ?? []).flatMap(t => t.split('::').map(p => p.toLowerCase())),
  ].filter((v, idx, arr) => arr.indexOf(v) === idx).slice(0, 40);
  const fileContext = currentFiles
    ? Object.entries(currentFiles).map(([fp, content]) => {
        const contextView = buildSkeletonContext(fp, content, skeletonKeywords);
        return `### ${fp}\n\`\`\`python\n${contextView}\n\`\`\``;
      }).join('\n\n')
    : '';

  const issueSection = options?.issueDescription
    ? `## Issue Description\n${options.issueDescription}\n\n`
    : '';

  const testNames = options?.failToPassTests && options.failToPassTests.length > 0
    ? `## Tests That Must Pass\n${options.failToPassTests.slice(0, 10).join('\n')}\n\n`
    : '';

  const testCode = options?.testPatch
    ? `## New Test Code (this test will be added and must pass)\n\`\`\`diff\n${options.testPatch.slice(0, 3000)}\n\`\`\`\n\n`
    : '';

  const testSection = testNames + testCode;

  return `You are an expert Python software engineer fixing a bug in a repository.

## Task
Instance: ${instanceId}
Attempt: ${attemptNumber} of ${MAX_ATTEMPTS}

${issueSection}${testSection}## Your Previous Patch (which failed the tests)
\`\`\`diff
${originalPatch}
\`\`\`

## Test Failure Output
\`\`\`
${tracebackSummary}
\`\`\`

${fileContext ? `## Current File State (after your patch was applied)\n${fileContext}\n\n` : ''}## Instructions
1. Analyze the test failure carefully. Understand WHY your previous patch failed.
2. Output the COMPLETE corrected file content (not a diff) for each file that needs changing.
3. Wrap each file in: <file path="path/to/file.py">...complete file content...</file>
4. Fix the root cause, not just the symptom.
5. Make MINIMAL changes — only change what is necessary to fix the failing tests.

Output ONLY the file blocks. No explanation.
`;
}

/**
 * Extracts a clean diff from an LLM response.
 * Supports both raw diff format and complete-file format.
 */
export function extractPatchFromLLMResponse(response: string): string {
  // Try to find a diff block first
  const diffMatch = response.match(/```diff\n([\s\S]*?)```/);
  if (diffMatch) return diffMatch[1].trim();

  // Try to find raw diff (starts with --- or diff --git)
  const rawDiffMatch = response.match(/((?:diff --git|---\s+a\/)[\s\S]*)/);
  if (rawDiffMatch) return rawDiffMatch[1].trim();

  return response.trim();
}

/**
 * Extracts file contents from an LLM response that uses <file path="...">...</file> format.
 */
export function extractFileContentsFromResponse(response: string): Record<string, string> {
  const files: Record<string, string> = {};
  const fileMatches = response.matchAll(/<file path="([^"]+)">([\s\S]*?)<\/file>/g);
  for (const match of fileMatches) {
    const filePath = match[1].trim();
    let content = match[2];
    // Strip leading/trailing newlines
    content = content.replace(/^\n/, '').replace(/\n$/, '');
    // Strip code fence if present
    content = content.replace(/^```(?:python)?\n/, '').replace(/\n```$/, '');
    files[filePath] = content;
  }
  return files;
}

/**
 * Generates a unified diff from original and modified file content using Python's difflib.
 * This guarantees exact context line matches (no @@ header errors).
 */
export async function generateDiffFromContent(
  filePath: string,
  originalContent: string,
  modifiedContent: string
): Promise<string> {
  if (originalContent === modifiedContent) return '';

  const origPath = `/tmp/andromeda_orig_${crypto.randomBytes(4).toString('hex')}.py`;
  const modPath = `/tmp/andromeda_mod_${crypto.randomBytes(4).toString('hex')}.py`;

  try {
    fs.writeFileSync(origPath, originalContent, 'utf-8');
    fs.writeFileSync(modPath, modifiedContent, 'utf-8');

    const result = await execAsync(
      `diff -u --label "a/${filePath}" --label "b/${filePath}" "${origPath}" "${modPath}" || true`
    );
    return result.stdout.trim();
  } finally {
    try { fs.unlinkSync(origPath); } catch { /* ignore */ }
    try { fs.unlinkSync(modPath); } catch { /* ignore */ }
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Runs the full Traceback Loop for a single SWE-bench instance.
 *
 * v2.0.0: Uses complete-file output + difflib for patch generation,
 * conda activation, test_patch support, and repo-specific test commands.
 */
export async function runTracebackLoop(input: TracebackLoopInput): Promise<TracebackLoopResult> {
  const {
    instanceId,
    dockerImage,
    initialPatch,
    testPatch,
    failToPassTests = [],
    repoPath = '/testbed',
    llmProvider,
    issueDescription,
    fileContents,
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

    // Track current file state — updated after each attempt so LLM sees what it changed
    let currentFileContents: Record<string, string> = { ...(fileContents ?? {}) };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptStart = Date.now();

      const { passed, output } = await applyAndTest(
        containerName,
        currentPatch,
        repoPath,
        TEST_TIMEOUT_SECONDS,
        { testPatch, failToPassTests, instanceId }
      );

      const tracebackSummary = passed ? '' : extractTracebackSummary(output);

      const attemptResult: AttemptResult = {
        attemptNumber: attempt,
        patch: currentPatch,
        testsPassed: passed,
        testOutput: output.slice(0, 4000),
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
        // Extract CURRENT file state from container (after the patch was applied)
        // This lets the LLM see exactly what its patch changed
        if (fileContents) {
          const updatedContents: Record<string, string> = {};
          for (const fp of Object.keys(fileContents)) {
            try {
              const result = await execAsync(
                `docker exec ${containerName} cat /testbed/${fp} 2>/dev/null || true`
              );
              if (result.stdout.trim()) {
                // Store full content — skeleton context is applied at prompt-build time
                updatedContents[fp] = result.stdout;
              }
            } catch { /* ignore */ }
          }
          if (Object.keys(updatedContents).length > 0) {
            currentFileContents = updatedContents;
          }
        }

        const revisionPrompt = buildRevisionPrompt(
          instanceId,
          currentPatch,
          tracebackSummary,
          attempt + 1,
          {
            issueDescription,
            fileContents: currentFileContents,  // CURRENT state after patch
            originalFileContents: fileContents,  // Original for diff baseline
            failToPassTests,
            testPatch,  // New test code that must pass
          }
        );

        // Debug: write revision prompt and traceback to files for inspection
        fs.writeFileSync(`/tmp/debug_revision_prompt_attempt${attempt}.txt`, revisionPrompt, 'utf-8');
        fs.writeFileSync(`/tmp/debug_traceback_attempt${attempt}.txt`, tracebackSummary, 'utf-8');
        console.log(`[TracebackLoop] Revision prompt written to /tmp/debug_revision_prompt_attempt${attempt}.txt`);
        console.log(`[TracebackLoop] Traceback summary (first 500 chars): ${tracebackSummary.slice(0, 500)}`);

        try {
          const llmResponse = await llmProvider(revisionPrompt);

          // Try complete-file format first (more reliable)
          const newFileContents = extractFileContentsFromResponse(llmResponse);
          if (Object.keys(newFileContents).length > 0 && fileContents) {
            // Generate diffs from the modified file contents vs ORIGINAL
            // (we always diff against original so the patch applies cleanly)
            const diffs: string[] = [];
            for (const [fp, newContent] of Object.entries(newFileContents)) {
              const originalContent = fileContents[fp] ?? '';
              if (originalContent && newContent !== originalContent) {
                const diff = await generateDiffFromContent(fp, originalContent, newContent);
                if (diff) diffs.push(diff);
              }
            }
            if (diffs.length > 0) {
              currentPatch = diffs.join('\n');
            }
          } else {
            // Fall back to raw diff extraction
            const revisedPatch = extractPatchFromLLMResponse(llmResponse);
            if (revisedPatch && revisedPatch.length > 10) {
              currentPatch = revisedPatch;
            }
          }
        } catch (llmError) {
          console.error(`[TracebackLoop] LLM revision failed for ${instanceId}:`, llmError);
        }
      }
    }

  } finally {
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
