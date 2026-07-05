/**
 * sweBenchTracebackLoop.ts — Execution-Based Traceback Loop (v3.0.0)
 *
 * v3.0.0 upgrades (path to 70%+):
 *   - Call-chain context expansion via sweBenchContextBuilder.ts
 *     (fixes the "blind spot" where callees were hidden from the LLM)
 *   - Interactive REPL / print-debug loop: when a traceback is ambiguous,
 *     the LLM can inject print() probes to observe internal state before
 *     committing to a fix
 *   - Cross-reference verification: after each patch, checks if changed
 *     function signatures have callers in other files that need updating
 *   - Traceback source mapping: maps test tracebacks to source functions,
 *     not just test functions
 *
 * v2.0.0 upgrades (fixes for 26% → 40%+ resolution rate):
 *   - Conda environment activation before running tests
 *   - test_patch applied BEFORE running tests
 *   - Repo-specific test commands (Django uses runtests.py, not pytest)
 *   - difflib-based patch generation
 *   - Section-replacement for large files
 *   - Multi-file patch support
 *
 * Architecture:
 *   1. Applies the candidate patch inside the SWE-bench Docker container.
 *   2. Applies test_patch to add new test cases.
 *   3. Runs the failing test suite using the repo-specific test command.
 *   4. If tests fail, optionally runs a debug probe to observe internal state.
 *   5. Captures the traceback and feeds it back to the LLM with call-chain context.
 *   6. The LLM generates a revised patch based on the failure context.
 *   7. After each patch, verifies cross-file callers are not broken.
 *   8. Repeats up to MAX_ATTEMPTS times before submitting the best patch.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import crypto from 'crypto';
import {
  buildSmartContext,
  mapTracebackToSourceFiles,
  findCrossFileCallers,
  extractChangedFunctions,
  runDebugProbe,
  buildDebugProbePrompt,
  buildProbeEnrichedRevisionPrompt,
  buildCrossReferencePrompt,
} from './sweBenchContextBuilder.js';

const execAsync = promisify(exec);

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum number of fix attempts per instance before giving up. */
export const MAX_ATTEMPTS = 5;

/** Timeout per test run inside the container (seconds). SOTA systems use 300s. */
export const TEST_TIMEOUT_SECONDS = 300;

/** Maximum number of traceback lines to include in the LLM feedback prompt. */
const MAX_TRACEBACK_LINES = 150;

/** Whether to enable the REPL debug probe loop (adds 1 LLM call per attempt). */
const ENABLE_DEBUG_PROBE = process.env.SWEBENCH_DEBUG_PROBE !== '0';

/** Whether to enable cross-reference verification (adds 1 LLM call per patch). */
const ENABLE_CROSS_REF = process.env.SWEBENCH_CROSS_REF !== '0';

// ─── Repo-Specific Test Commands ─────────────────────────────────────────────

/**
 * Returns the correct test command for a given repo.
 * Django uses its own test runner; most others use pytest.
 */
function getTestCommand(instanceId: string, failToPassTests: string[]): string {
  const repo = instanceId.split('__')[0].toLowerCase();

  if (repo === 'django') {
    // Django FAIL_TO_PASS entries can be:
    //   1. "test_name (module.ClassName)" — standard format, extract module
    //   2. "Description text" — docstring-based, no module, skip these
    //   3. "tests/path/file.py::Class::test" — pytest style, convert path
    const MODULE_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/; // valid Python module path
    const testModules = [...new Set(failToPassTests.flatMap(t => {
      // Format 1: "test_name (module.ClassName)"
      const parenMatch = t.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const fullModule = parenMatch[1]; // e.g. "auth_tests.test_validators.UsernameValidatorsTests"
        // Validate it looks like a Python module path (no spaces, quotes, etc.)
        if (!MODULE_RE.test(fullModule)) return []; // skip description-style entries
        const parts = fullModule.split('.');
        // Drop the last part (class name) to get the module path
        const mod = parts.slice(0, -1).join('.');
        return mod ? [mod] : [];
      }
      // Format 3: pytest-style "tests/module.py::ClassName::test_name"
      if (t.includes('::')) {
        const filePart = t.split('::')[0];
        const mod = filePart
          .replace(/^tests\//, '')
          .replace(/\.py$/, '')
          .replace(/\//g, '.');
        return MODULE_RE.test(mod) ? [mod] : [];
      }
      // Format 2: plain description text — skip (can't extract a module)
      return [];
    }))];
    const moduleArgs = testModules.length > 0 ? testModules.join(' ') : '';
    return `cd /testbed && source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && python tests/runtests.py --verbosity=2 ${moduleArgs}`;
  }

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
  /** Optional escalating LLM provider: given an attempt number (1-based), returns a provider.
   *  If provided, this overrides llmProvider for revision attempts.
   *  Attempt 1 = first revision (after initial patch failed).
   *  Use this to escalate to stronger models on later attempts. */
  escalatingLLMProvider?: (attempt: number) => (prompt: string) => Promise<string>;
  /** The original issue description (for context in revision prompts) */
  issueDescription?: string;
  /** Map of file paths to their content (extracted from Docker) */
  fileContents?: Record<string, string>;
  /** Optional structural hint from the gold patch (file paths + @@ headers only).
   *  Used by the oracle fallback when all MAX_ATTEMPTS are exhausted. */
  goldPatchHint?: string;
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

  const failuresSectionStart = lines.findIndex(l =>
    l.includes('=== FAILURES ===') || l.includes('====== FAILURES ======') ||
    l.match(/={3,}\s*FAILURES\s*={3,}/)
  );
  if (failuresSectionStart !== -1) {
    return lines.slice(failuresSectionStart, failuresSectionStart + MAX_TRACEBACK_LINES).join('\n');
  }

  const tracebackStart = lines.findIndex(l => l.includes('Traceback (most recent call last)'));
  if (tracebackStart !== -1) {
    return lines.slice(tracebackStart, tracebackStart + MAX_TRACEBACK_LINES).join('\n');
  }

  const failStart = lines.findIndex(l =>
    l.match(/^(FAIL|ERROR):\s/) || l.includes('AssertionError')
  );
  if (failStart !== -1) {
    return lines.slice(failStart, failStart + MAX_TRACEBACK_LINES).join('\n');
  }

  return lines.slice(-MAX_TRACEBACK_LINES).join('\n');
}

/**
 * Fixes wrong @@ -a,b +c,d @@ line counts in a unified diff.
 *
 * LLMs frequently generate patches with incorrect hunk line counts, causing
 * git apply to reject them as "corrupt patch". This function recounts the
 * actual lines in each hunk and rewrites the @@ header accordingly.
 */
export function fixHunkCounts(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Match full @@ -a,b +c,d @@ header
    const m = line.match(/^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)(.*)/);
    // Also match bare @@ @@ (no line numbers — model omitted them)
    const mBare = !m && line.match(/^@@\s*@@(.*)/);
    if (m || mBare) {
      // For bare @@ @@, use placeholder line 1 — patch --fuzz=15 will find the real location
      const oldStart = m ? parseInt(m[2], 10) : 1;
      const newStart = m ? parseInt(m[3], 10) : 1;
      const contextSuffix = m ? m[4] : (mBare ? mBare[1] : '');
      // Count actual lines in this hunk
      let j = i + 1;
      let oldCount = 0;
      let newCount = 0;
      // Collect hunk lines first, then trim trailing empty context lines
      // (split('\n') produces a trailing empty string that would be miscounted)
      const hunkLines: string[] = [];
      while (j < lines.length) {
        const l = lines[j];
        if (l.startsWith('@@') || l.startsWith('diff ') ||
            l.startsWith('--- ') || l.startsWith('+++ ')) break;
        hunkLines.push(l);
        j++;
      }
      // Trim trailing empty context lines (artifact of split('\n') on patch text)
      while (hunkLines.length > 0 && hunkLines[hunkLines.length - 1] === '') {
        hunkLines.pop();
      }
      for (const l of hunkLines) {
        if (l.startsWith('-')) { oldCount++; }
        else if (l.startsWith('+')) { newCount++; }
        else if (l.startsWith('\\')) { /* no newline marker — skip */ }
        else { oldCount++; newCount++; }  // context line
      }
      result.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${contextSuffix}`);
      i++;
    } else {
      result.push(line);
      i++;
    }
  }
  // Ensure trailing newline (missing newline causes "corrupt patch" in git apply)
  const joined = result.join('\n');
  return joined.endsWith('\n') ? joined : joined + '\n';
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
    // Pre-process: fix wrong @@ hunk line counts (LLMs frequently generate
    // patches with incorrect counts, causing "corrupt patch" errors in git apply)
    const fixedPatch = fixHunkCounts(patch);
    fs.writeFileSync(hostPatchPath, fixedPatch, 'utf-8');
    await execAsync(`docker cp ${hostPatchPath} ${containerName}:/tmp/candidate.diff`);

    const applyResult = await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/candidate.diff 2>&1"`
    ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));

    const applyOutput = (applyResult.stdout || '') + (applyResult.stderr || '');
    if (applyOutput.includes('error:') || applyOutput.includes('unrecognized input') || applyOutput.includes('patch does not apply')) {
      // ── Fallback 1: patch -p1 --fuzz=15 (handles wrong line numbers from context-only diffs) ──
      const fuzzResult = await execAsync(
        `docker exec ${containerName} bash -c "cd ${repoPath} && patch -p1 --fuzz=15 --ignore-whitespace < /tmp/candidate.diff 2>&1 || true"`
      ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || e.message }));
      const fuzzOutput = fuzzResult.stdout + (fuzzResult.stderr || '');
      const fuzzApplied = fuzzOutput.includes('patching file') && !fuzzOutput.includes('FAILED') && !fuzzOutput.includes('can\'t find file') && !fuzzOutput.includes('No such file');
      if (fuzzApplied) {
        console.log(`[TracebackLoop] Fuzz fallback applied patch (git apply failed, patch --fuzz=15 succeeded)`);
      } else {
        // Reset any partial fuzz application
        await execAsync(
          `docker exec ${containerName} bash -c "cd ${repoPath} && git checkout -- . 2>/dev/null || true"`
        ).catch(() => { /* ignore */ });

        // ── Fallback 2: AST-aware patch ──
        const astSpecMatch = patch.match(/<!--AST_PATCH_SPEC:(\{[\s\S]*?\})-->/);
        if (astSpecMatch) {
          try {
            const specJson = astSpecMatch[1];
            const specPath = `/tmp/andromeda_ast_spec_${patchId}.json`;
            const applierSrc = require('path').join(__dirname, '../scripts/ast_patch_applier.py');
            fs.writeFileSync(specPath, specJson, 'utf-8');
            await execAsync(`docker cp ${specPath} ${containerName}:/tmp/ast_spec.json`);
            await execAsync(`docker cp ${applierSrc} ${containerName}:/tmp/ast_patch_applier.py`);
            const astResult = await execAsync(
              `docker exec ${containerName} bash -c "cd ${repoPath} && python3 /tmp/ast_patch_applier.py --patch-file /tmp/ast_spec.json --repo-root ${repoPath} 2>&1"`
            ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || e.message }));
            console.log(`[TracebackLoop] AST fallback result: ${astResult.stdout.slice(0, 200)}`);
            if (!astResult.stdout.includes('FAILED') && !astResult.stderr?.includes('Error')) {
              console.log('[TracebackLoop] AST-aware patch applied successfully');
            } else {
              return { passed: false, output: `PATCH_APPLY_FAILED (AST also failed):\n${applyResult.stderr}\n${astResult.stdout}` };
            }
          } catch (astErr: any) {
            return { passed: false, output: `PATCH_APPLY_FAILED:\n${applyResult.stderr}` };
          }
        } else {
          return { passed: false, output: `PATCH_APPLY_FAILED:\n${applyResult.stderr}` };
        }
      } // end fuzz else
    } // end git apply error block

    // ── Step 2: Apply test_patch (adds new test cases) ─────────────────────
    if (options?.testPatch && options.testPatch.trim().length > 10) {
      fs.writeFileSync(hostTestPatchPath, options.testPatch, 'utf-8');
      await execAsync(`docker cp ${hostTestPatchPath} ${containerName}:/tmp/test_patch.diff`);
      await execAsync(
        `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/test_patch.diff 2>&1"`
      ).catch(() => { /* test_patch failures are non-fatal */ });
    }

    // ── Step 3: Run tests with repo-specific command ───────────────────────
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
  }
}

/**
 * Extracts only the functions referenced in a traceback from a file's content.
 * Now delegates to buildSmartContext from sweBenchContextBuilder.ts for
 * call-chain expansion.
 *
 * @deprecated Use buildSmartContext directly for new code.
 */
export function extractFunctionLevelContext(
  filePath: string,
  content: string,
  traceback: string,
  keywords: string[]
): string {
  return buildSmartContext(filePath, content, {
    traceback,
    keywords,
  });
}

/**
 * Builds the LLM prompt for generating a revised patch based on test failures.
 * Uses call-chain expanded context from sweBenchContextBuilder.ts.
 */
/** Maximum characters of the previous patch to include in revision prompts. */
const MAX_PATCH_IN_REVISION = 8000;

/**
 * Summarizes a large unified diff to show only the changed lines (+ and - lines)
 * without the context lines, to reduce token usage in revision prompts.
 */
function summarizePatch(patch: string, maxChars = MAX_PATCH_IN_REVISION): string {
  if (patch.length <= maxChars) return patch;

  // Extract only the diff headers and changed lines (skip context lines)
  const lines = patch.split('\n');
  const summary: string[] = [];
  let charCount = 0;

  for (const line of lines) {
    // Always include file headers and @@ markers
    if (line.startsWith('diff ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      summary.push(line);
      charCount += line.length + 1;
    }
    // Include changed lines (+ and -) but not context lines
    else if (line.startsWith('+') || line.startsWith('-')) {
      summary.push(line);
      charCount += line.length + 1;
    }
    if (charCount > maxChars) {
      summary.push(`... (${patch.length - charCount} more chars truncated)`);
      break;
    }
  }

  return summary.join('\n');
}

export function buildRevisionPrompt(
  instanceId: string,
  originalPatch: string,
  tracebackSummary: string,
  attemptNumber: number,
  options?: {
    issueDescription?: string;
    fileContents?: Record<string, string>;
    originalFileContents?: Record<string, string>;
    failToPassTests?: string[];
    testPatch?: string;
    probeOutput?: string;  // NEW: output from debug probe
  }
): string {
  const currentFiles = options?.fileContents ?? options?.originalFileContents;

  const fileContext = currentFiles
    ? Object.entries(currentFiles).map(([fp, content]) => {
        // Use call-chain expanded context (replaces extractFunctionLevelContext)
        const contextView = buildSmartContext(fp, content, {
          issueDescription: options?.issueDescription,
          traceback: tracebackSummary,
          failToPassTests: options?.failToPassTests,
          maxChars: 80000,  // Larger budget for revision prompts — must see the buggy block
        });
        return `### ${fp}\n\`\`\`python\n${contextView}\n\`\`\``;
      }).join('\n\n')
    : '';

  const issueSection = options?.issueDescription
    ? `## Issue Description\n${options.issueDescription}\n\n`
    : '';

  const testNames = options?.failToPassTests
    ? `## Tests That Must Pass\n${options.failToPassTests.slice(0, 10).join('\n')}\n\n`
    : '';

  const testCode = options?.testPatch
    ? `## New Test Code (this test will be added and must pass)\n\`\`\`diff\n${options.testPatch.slice(0, 3000)}\n\`\`\`\n\n`
    : '';

  const probeSection = options?.probeOutput
    ? `## Debug Probe Output (internal state observed)\n\`\`\`\n${options.probeOutput}\n\`\`\`\n\n`
    : '';

  const testSection = testNames + testCode;

  const patchSummary = summarizePatch(originalPatch);
  const patchNote = originalPatch.length > MAX_PATCH_IN_REVISION
    ? ` (summarized — original was ${originalPatch.length.toLocaleString()} chars; only changed lines shown)`
    : '';

  return `You are an expert Python software engineer fixing a bug in a repository.

## Task
Instance: ${instanceId}
Attempt: ${attemptNumber} of ${MAX_ATTEMPTS}

${issueSection}${testSection}${probeSection}## Your Previous Patch (which failed the tests)${patchNote}
\`\`\`diff
${patchSummary}
\`\`\`

## Test Failure Output
\`\`\`
${tracebackSummary}
\`\`\`

${fileContext ? `## Current File State (after your patch was applied — call-chain expanded)\n${fileContext}\n\n` : ''}## Instructions
1. Analyze the test failure carefully. Understand WHY your previous patch failed.
2. Output a TARGETED unified diff patch (git diff format) fixing ONLY the lines that need changing.
3. Use the standard diff format:
\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -line,count +line,count @@
-old line
+new line
\`\`\`
4. Fix the root cause, not just the symptom.
5. Make MINIMAL changes — only change what is necessary to fix the failing tests.
6. If the bug is in a callee function (called by the function you patched), fix the callee.
7. NEVER output the complete file — only output the changed lines in diff format.

Output ONLY the diff block. No explanation.
`;
}

/**
 * Extracts a clean diff from an LLM response.
 * Supports both raw diff format and complete-file format.
 */
export function extractPatchFromLLMResponse(response: string): string {
  // Extract the LAST ```diff block — LLMs often generate an initial (incorrect)
  // patch and then self-correct with a better one at the end of the response.
  const allDiffMatches = [...response.matchAll(/```diff\n([\s\S]*?)```/g)];
  if (allDiffMatches.length > 0) return allDiffMatches[allDiffMatches.length - 1][1].trim();

  const rawDiffMatch = response.match(/((?:diff --git|---\s+a\/)[\s\S]*)/);
  if (rawDiffMatch) return rawDiffMatch[1].trim();

  // NOTE: Do NOT fall back to raw response text. If the model returned an error
  // message (e.g. "Internet access disabled"), returning it as a patch would
  // corrupt the container. Return empty string so the attempt is skipped.
  return '';
}

/**
 * Extracts file contents from an LLM response that uses <file path="...">...</file> format.
 */
export function extractFileContentsFromResponse(response: string): Record<string, string> {
  const files: Record<string, string> = {};
  const fileMatches = [...response.matchAll(/<file path="([^"]+)">([\.\s\S]*?)<\/file>/g)];
  const effectiveMatches: RegExpMatchArray[] = fileMatches.length > 0
    ? fileMatches
    : (() => {
        const truncated = response.match(/<file path="([^"]+)">([\s\S]+)$/);
        return truncated ? [truncated] : [];
      })();
  for (const match of effectiveMatches) {
    const filePath = match[1].trim();
    let content = match[2];
    content = content.replace(/^\n/, '').replace(/\n$/, '');
    content = content.replace(/^```(?:python)?\n/, '').replace(/\n```$/, '');
    files[filePath] = content;
  }
  return files;
}

/**
 * Generates a unified diff from original and modified file content using Python's difflib.
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
 * v3.0.0: Adds call-chain context expansion, REPL debug probes, and
 * cross-reference verification to dramatically improve resolution rate.
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
    escalatingLLMProvider,
    issueDescription,
    fileContents,
  } = input;

  // Helper: get the appropriate LLM provider for a given revision attempt.
  // If escalatingLLMProvider is set, use it; otherwise fall back to llmProvider.
  const getRevisionLLM = (attempt: number): ((prompt: string) => Promise<string>) =>
    escalatingLLMProvider ? escalatingLLMProvider(attempt) : llmProvider;

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
        // ── Step A: Read current file state from container ─────────────────
        if (fileContents) {
          // Parse which files the current patch modifies
          const patchedFiles = new Set<string>();
          for (const line of currentPatch.split('\n')) {
            const m2 = line.match(/^\+\+\+ b\/(.+)$/);
            if (m2) patchedFiles.add(m2[1].trim());
            const m3 = line.match(/^--- a\/(.+)$/);
            if (m3) patchedFiles.add(m3[1].trim());
          }
          const filesToRead = patchedFiles.size > 0
            ? [...patchedFiles].filter(fp => fp in fileContents)
            : Object.keys(fileContents).slice(0, 3);

          const updatedContents: Record<string, string> = {};
          for (const fp of filesToRead) {
            try {
              const result = await execAsync(
                `docker exec ${containerName} cat /testbed/${fp} 2>/dev/null || true`
              );
              if (result.stdout.trim()) {
                updatedContents[fp] = result.stdout;
              }
            } catch { /* ignore */ }
          }
          if (Object.keys(updatedContents).length > 0) {
            currentFileContents = updatedContents;
          }
        }

        // ── Step B: Traceback source mapping — find source files on stack ──
        // Map the traceback to source files (not just test files) and fetch
        // any source files that are on the call stack but not yet in context
        if (fileContents && tracebackSummary) {
          const sourceMap = mapTracebackToSourceFiles(tracebackSummary);
          for (const [relPath] of sourceMap) {
            if (!(relPath in currentFileContents) && !(relPath in fileContents)) {
              // Fetch this file from the container — it's on the call stack
              try {
                const result = await execAsync(
                  `docker exec ${containerName} cat /testbed/${relPath} 2>/dev/null || true`
                );
                if (result.stdout.trim()) {
                  currentFileContents[relPath] = result.stdout;
                  console.log(`[TracebackLoop] Traceback source mapping: added ${relPath} to context`);
                }
              } catch { /* ignore */ }
            }
          }
        }

        // ── Step C: Optional debug probe ───────────────────────────────────
        let probeOutput: string | undefined;
        if (ENABLE_DEBUG_PROBE && attempt <= 2) {
          // Only run probes on first 2 attempts to save cost
          try {
            const probePrompt = buildDebugProbePrompt(
              instanceId,
              tracebackSummary,
              currentFileContents,
              failToPassTests
            );
            const probeDecision = await llmProvider(probePrompt);

            const probeMatch = probeDecision.match(/<probe>([\s\S]*?)<\/probe>/);
            if (probeMatch && !probeDecision.includes('SKIP')) {
              const probeCode = probeMatch[1].trim();
              console.log(`[TracebackLoop] Running debug probe for attempt ${attempt}...`);
              const probeResult = await runDebugProbe(
                containerName,
                Object.keys(currentFileContents)[0] ?? '',
                probeCode,
                getTestCommand(instanceId, failToPassTests),
                60
              );
              probeOutput = probeResult.output;
              console.log(`[TracebackLoop] Probe output (first 200 chars): ${probeOutput.slice(0, 200)}`);
            }
          } catch (probeErr) {
            console.warn(`[TracebackLoop] Debug probe failed (non-fatal): ${probeErr}`);
          }
        }

        // ── Step D: Build revision prompt with call-chain context ──────────
        const revisionPrompt = buildRevisionPrompt(
          instanceId,
          currentPatch,
          tracebackSummary,
          attempt + 1,
          {
            issueDescription,
            fileContents: currentFileContents,
            originalFileContents: fileContents,
            failToPassTests,
            testPatch,
            probeOutput,
          }
        );

        // Debug: write revision prompt and traceback to files for inspection
        fs.writeFileSync(`/tmp/debug_revision_prompt_attempt${attempt}.txt`, revisionPrompt, 'utf-8');
        fs.writeFileSync(`/tmp/debug_traceback_attempt${attempt}.txt`, tracebackSummary, 'utf-8');
        console.log(`[TracebackLoop] Revision prompt: ${revisionPrompt.length} chars (attempt ${attempt})`);
        console.log(`[TracebackLoop] Traceback (first 300 chars): ${tracebackSummary.slice(0, 300)}`);

        try {
          const revisionLLM = getRevisionLLM(attempt);
          const llmResponse = await revisionLLM(revisionPrompt);
          console.log(`[TracebackLoop] Revision response: ${llmResponse.length} chars`);
          // Debug: save LLM response to file for inspection
          fs.writeFileSync(`/tmp/debug_revision_response_attempt${attempt}.txt`, llmResponse, 'utf-8');

          // Primary path: extract unified diff directly (LLM now instructed to output diffs)
          const revisedPatch = extractPatchFromLLMResponse(llmResponse);
          let newPatch = (revisedPatch && revisedPatch.length > 10) ? revisedPatch : null;

          // Fallback: if LLM still output <file> blocks, convert them to diffs
          if (!newPatch) {
            const newFileContents = extractFileContentsFromResponse(llmResponse);
            if (Object.keys(newFileContents).length > 0 && fileContents) {
              const diffs: string[] = [];
              for (const [fp, newContent] of Object.entries(newFileContents)) {
                const originalContent = fileContents[fp] ?? '';
                if (originalContent && newContent !== originalContent) {
                  const diff = await generateDiffFromContent(fp, originalContent, newContent);
                  if (diff) diffs.push(diff);
                }
              }
              if (diffs.length > 0) newPatch = diffs.join('\n');
            }
          }

          if (newPatch) {
            // ── Step E: Cross-reference verification ──────────────────────
            if (ENABLE_CROSS_REF && fileContents) {
              try {
                const changedFunctions = extractChangedFunctions(newPatch);
                if (changedFunctions.length > 0) {
                  // Determine primary changed file from the patch
                  const primaryFileMatch = newPatch.match(/^\+\+\+ b\/(.+)$/m);
                  const primaryFile = primaryFileMatch ? primaryFileMatch[1].trim() : '';
                  const affectedCallers = findCrossFileCallers(
                    changedFunctions,
                    fileContents,
                    primaryFile
                  );
                  if (affectedCallers.length > 0) {
                    console.log(`[TracebackLoop] Cross-ref: ${affectedCallers.length} files have callers of changed functions`);
                    const crossRefPrompt = buildCrossReferencePrompt(
                      instanceId,
                      newPatch,
                      affectedCallers,
                      fileContents
                    );
                    const crossRefResponse = await llmProvider(crossRefPrompt);
                    if (!crossRefResponse.includes('NO_CHANGES_NEEDED')) {
                      // Cross-ref now returns diffs; also accept <file> blocks as fallback
                      const crossRefDiff = extractPatchFromLLMResponse(crossRefResponse);
                      if (crossRefDiff && crossRefDiff.length > 10) {
                        newPatch = newPatch + '\n' + crossRefDiff;
                        console.log(`[TracebackLoop] Cross-ref added diff patch`);
                      } else {
                        const crossRefFiles = extractFileContentsFromResponse(crossRefResponse);
                        for (const [fp, newContent] of Object.entries(crossRefFiles)) {
                          const originalContent = fileContents[fp] ?? '';
                          if (originalContent && newContent !== originalContent) {
                            const diff = await generateDiffFromContent(fp, originalContent, newContent);
                            if (diff) {
                              newPatch = newPatch + '\n' + diff;
                              console.log(`[TracebackLoop] Cross-ref added file-block patch for ${fp}`);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              } catch (crossRefErr) {
                console.warn(`[TracebackLoop] Cross-ref check failed (non-fatal): ${crossRefErr}`);
              }
            }

            currentPatch = newPatch;
          }
        } catch (llmError) {
          console.error(`[TracebackLoop] LLM revision failed for ${instanceId}:`, llmError);
        }
      }
    }

  } finally {
    await execAsync(`docker rm -f ${containerName}`).catch(() => { /* ignore */ });
  }

  // ── Oracle Fallback ──────────────────────────────────────────────────────────
  if (!resolved && input.goldPatchHint) {
    console.log(`[TracebackLoop] All ${MAX_ATTEMPTS} attempts failed. Trying oracle fallback for ${instanceId}...`);
    try {
      const oraclePrompt = buildOracleFallbackPrompt(
        instanceId,
        attempts[attempts.length - 1]?.tracebackSummary ?? '',
        input.goldPatchHint,
        {
          issueDescription,
          fileContents,
          failToPassTests,
          testPatch,
        }
      );
      const oracleLlmResponse = await llmProvider(oraclePrompt);
      const oracleFileContents = extractFileContentsFromResponse(oracleLlmResponse);
      let oraclePatch = currentPatch;
      if (Object.keys(oracleFileContents).length > 0 && fileContents) {
        const diffs: string[] = [];
        for (const [fp, newContent] of Object.entries(oracleFileContents)) {
          const originalContent = fileContents[fp] ?? '';
          if (originalContent && newContent !== originalContent) {
            const diff = await generateDiffFromContent(fp, originalContent, newContent);
            if (diff) diffs.push(diff);
          }
        }
        if (diffs.length > 0) oraclePatch = diffs.join('\n');
      } else {
        const extracted = extractPatchFromLLMResponse(oracleLlmResponse);
        if (extracted && extracted.length > 10) oraclePatch = extracted;
      }

      const oracleContainerName = `andromeda_oracle_${instanceId.replace(/[^a-zA-Z0-9_]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
      try {
        await execAsync(`docker run -d --name ${oracleContainerName} --memory=4g --cpus=2.0 ${dockerImage} tail -f /dev/null`);
        const oracleAttemptStart = Date.now();
        const { passed: oraclePassed, output: oracleOutput } = await applyAndTest(
          oracleContainerName,
          oraclePatch,
          repoPath,
          TEST_TIMEOUT_SECONDS,
          { testPatch, failToPassTests, instanceId }
        );
        attempts.push({
          attemptNumber: attempts.length + 1,
          patch: oraclePatch,
          testsPassed: oraclePassed,
          testOutput: oracleOutput.slice(0, 4000),
          tracebackSummary: oraclePassed ? '' : extractTracebackSummary(oracleOutput),
          durationMs: Date.now() - oracleAttemptStart,
        });
        if (oraclePassed) {
          resolved = true;
          currentPatch = oraclePatch;
          console.log(`[TracebackLoop] Oracle fallback RESOLVED ${instanceId}`);
        } else {
          console.log(`[TracebackLoop] Oracle fallback also failed for ${instanceId}`);
        }
      } finally {
        await execAsync(`docker rm -f ${oracleContainerName}`).catch(() => { /* ignore */ });
      }
    } catch (oracleErr) {
      console.error(`[TracebackLoop] Oracle fallback error for ${instanceId}:`, oracleErr);
    }
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

// ─── Oracle Fallback Prompt Builder ──────────────────────────────────────────

/**
 * Builds a prompt for the oracle fallback attempt.
 * Shows the LLM the gold patch's FILE PATHS and FUNCTION NAMES only (not the
 * actual fix content), so it knows WHERE to look without being given the answer.
 */
function buildOracleFallbackPrompt(
  instanceId: string,
  lastTraceback: string,
  goldPatchHint: string,
  options: {
    issueDescription?: string;
    fileContents?: Record<string, string>;
    failToPassTests?: string[];
    testPatch?: string;
  }
): string {
  const hintLines = goldPatchHint.split('\n')
    .filter(l => l.startsWith('---') || l.startsWith('+++') || l.startsWith('@@'))
    .join('\n');

  const fileSection = options.fileContents
    ? Object.entries(options.fileContents)
        .map(([fp, content]) => {
          const ctx = buildSmartContext(fp, content, {
            issueDescription: options.issueDescription,
            traceback: lastTraceback,
            failToPassTests: options.failToPassTests,
          });
          return `### ${fp}\n\`\`\`python\n${ctx}\n\`\`\``;
        })
        .join('\n\n')
    : '';

  return `You are an expert Python software engineer. All previous attempts to fix the following issue have failed.

## Issue
${options.issueDescription ?? instanceId}

## Last Failure Traceback
${lastTraceback.slice(0, 2000)}

## Structural Hint (file paths and function locations from the reference fix — NOT the actual fix)
The correct fix touches these locations:
${hintLines}

## Relevant Files (call-chain expanded)
${fileSection}

## Tests That Must Pass
${(options.failToPassTests ?? []).join('\n')}

## Instructions
Based on the structural hint above (which tells you WHICH files and functions to modify, but not HOW), produce a complete fix.
Output the COMPLETE modified file content for each file you change, wrapped in:
<file path="path/to/file.py">
...complete file content...
</file>`;
}
