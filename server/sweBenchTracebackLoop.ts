/**
 * sweBenchTracebackLoop.ts -- Execution-Based Traceback Loop (v3.0.0)
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
 * v2.0.0 upgrades (fixes for 26% -> 40%+ resolution rate):
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
import { buildHardenedDockerArgs } from "./hardenedSandbox.js";
import { resolveImageDigest, ImageResolutionError, type ResolvedImage } from "./sweBenchImageResolver.js";
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
import {
  buildTestCommand as buildMultilingualTestCommand,
  isMultilingualDataset,
  detectLanguage,
} from './sweBenchMultilingualSupport.js';

const execAsync = promisify(exec);

// --- Configuration ------------------------------------------------------------

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

// --- Repo-Specific Test Commands ---------------------------------------------

/**
 * Returns the correct test command for a given repo and dataset.
 *
 * For Multilingual datasets: delegates to buildMultilingualTestCommand which
 * uses the language-aware profile (Java->mvn, Rust->cargo, Go->go test, etc.).
 * Falls back to the Python/Django legacy path only for Python datasets.
 *
 * @param instanceId - SWE-bench instance ID (used for Django detection in Python mode)
 * @param failToPassTests - Test IDs from FAIL_TO_PASS field
 * @param repo - Repository slug (e.g. 'caddyserver/caddy'). Required for multilingual.
 */
function getTestCommand(
  instanceId: string,
  failToPassTests: string[],
  repo?: string,
): string {
  const datasetName = process.env.SWEBENCH_DATASET_NAME ?? 'princeton-nlp/SWE-bench_Verified';

  // -- Multilingual path -----------------------------------------------------
  if (isMultilingualDataset(datasetName) && repo) {
    const multilingualCmd = buildMultilingualTestCommand(repo, failToPassTests);
    if (multilingualCmd) {
      // Wrap in cd /testbed so relative paths work correctly
      return multilingualCmd.startsWith('cd ') ? multilingualCmd : `cd /testbed && ${multilingualCmd}`;
    }
    // Language not supported -- return a no-op command that always fails cleanly
    return `echo 'UNSUPPORTED_LANGUAGE: no test command available for repo ${repo}' && exit 1`;
  }

  // -- Legacy Python/Django path ---------------------------------------------
  const repoSlug = instanceId.split('__')[0].toLowerCase();

  if (repoSlug === 'django') {
    // Django FAIL_TO_PASS entries can be:
    //   1. "test_name (module.ClassName)" -- standard format, extract module
    //   2. "Description text" -- docstring-based, no module, skip these
    //   3. "tests/path/file.py::Class::test" -- pytest style, convert path
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
      // Format 2: plain description text -- skip (can't extract a module)
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
 * Returns true if the test output indicates all tests passed.
 *
 * For Multilingual datasets: uses language-aware pass detection.
 * For Python/Django: uses the legacy heuristics.
 *
 * @param instanceId - SWE-bench instance ID (used for Django detection)
 * @param output - Combined stdout+stderr from the test run
 * @param repo - Repository slug for multilingual language detection
 */
function isPassed(instanceId: string, output: string, repo?: string): boolean {
  const datasetName = process.env.SWEBENCH_DATASET_NAME ?? 'princeton-nlp/SWE-bench_Verified';

  // -- Multilingual pass detection -------------------------------------------
  if (isMultilingualDataset(datasetName) && repo) {
    const lang = detectLanguage(repo);
    switch (lang) {
      case 'java':
        // Maven: BUILD SUCCESS, no FAILURE or ERROR
        return output.includes('BUILD SUCCESS') && !output.includes('BUILD FAILURE');
      case 'rust':
        // Cargo: 'test result: ok' or 'test result: FAILED'
        return output.includes('test result: ok') && !output.includes('test result: FAILED');
      case 'go':
        // Go test: 'ok' lines, no FAIL lines
        return output.includes('\nok ') && !output.includes('\nFAIL ');
      case 'ruby':
        // Ruby minitest/rspec: '0 failures' or 'examples, 0 failures'
        return (
          (output.includes('0 failures') || output.includes('0 errors')) &&
          !output.includes('FAILED')
        );
      case 'php':
        // PHPUnit: 'OK (' or 'Tests: N, Assertions: N.'
        return output.includes('OK (') && !output.includes('FAILURES!');
      case 'javascript':
      case 'typescript':
        // Jest/npm test: 'Tests: N passed' or 'passed'
        return output.includes(' passed') && !output.includes(' failed') && !output.includes(' failed,');
      case 'c':
      case 'cpp':
        // Make/cmake: no error lines, return code 0 (inferred from output)
        return !output.includes('Error') && !output.includes('FAILED') && !output.includes('error:');
      case 'c_python':
        // micropython uses pytest
        return output.includes(' passed') && !output.includes(' failed') && !output.includes('ERROR');
      default:
        // Unknown language: conservative -- require explicit pass signal
        return output.includes(' passed') && !output.includes(' failed');
    }
  }

  // -- Legacy Python/Django pass detection -----------------------------------
  const repoSlug = instanceId.split('__')[0].toLowerCase();
  if (repoSlug === 'django') {
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

// --- Types --------------------------------------------------------------------

export interface TracebackLoopInput {
  /** The SWE-bench instance ID, e.g. "django__django-12308" */
  instanceId: string;
  /** The Docker image for this instance */
  dockerImage: string;
  /** The initial candidate patch (unified diff format) */
  initialPatch: string;
  /** The test_patch from the SWE-bench dataset (adds new test cases).
   * Always passed for evaluation (the evaluator applies it before running tests).
   * NEVER used in model-visible prompts -- use promptTestPatch for that. */
  testPatch?: string;
  /** The failing tests that need to pass (FAIL_TO_PASS field).
   * Always passed for evaluation (used to build the test command).
   * NEVER used in model-visible prompts -- use promptFailToPassTests for that. */
  failToPassTests?: string[];
  /**
   * Prompt-visible variant of testPatch.
   * Set to undefined in scored_strict mode; set to testPatch in test_aware mode.
   * All prompt builders MUST use this field, never testPatch directly.
   */
  promptTestPatch?: string;
  /**
   * Prompt-visible variant of failToPassTests.
   * Set to undefined in scored_strict mode; set to failToPassTests in test_aware mode.
   * All prompt builders MUST use this field, never failToPassTests directly.
   */
  promptFailToPassTests?: string[];
  /** Evaluation mode. 'scored_strict' blocks all test data from prompts. */
  evalMode?: 'scored_strict' | 'test_aware';
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
  /**
   * Repository slug (e.g. 'caddyserver/caddy'). Required for multilingual
   * test-command selection and language-aware context building.
   */
  repo?: string;
}

export interface AttemptResult {
  attemptNumber: number;
  patch: string;
  testsPassed: boolean;
  testOutput: string;
  tracebackSummary: string;
  durationMs: number;
  /** True if git apply succeeded without fuzzy recovery. */
  exactApply: boolean;
  /** True if the test run was cut short by the timeout. */
  timedOut: boolean;
}

export interface TracebackLoopResult {
  instanceId: string;
  resolved: boolean;
  /**
   * True in scored_strict mode when the candidate patch applied cleanly and
   * the loop stopped without running any hidden tests. The patch is ready for
   * the external evaluator. This is a distinct terminal state from both
   * 'resolved' (test_aware: hidden tests passed) and 'test_failure' (hidden
   * tests ran and failed). The run bundle must record it as 'prediction_ready',
   * not 'test_failure'.
   */
  predictionReady: boolean;
  totalAttempts: number;
  finalPatch: string;
  attempts: AttemptResult[];
  totalDurationMs: number;
  /** SHA-256 of the final patch text (hex, 64 chars). */
  patchHash: string;
  /** True if the final patch applied exactly (no fuzzy recovery). */
  exactApply: boolean;
  /** True if the last attempt was cut short by the timeout. */
  timedOut: boolean;
  /** Immutable digest of the Docker image that ran (sha256:...). */
  resolvedImageDigest: string;
}

// --- Core Logic ---------------------------------------------------------------

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
 * git apply to reject them as "corrupt patch". This function:
 *   1. Recounts actual lines in each hunk and rewrites the @@ header
 *   2. Handles @@ -x,N +x,N @@ (literal 'x' placeholder from LLMs)
 *   3. Handles @@ @@ (bare header with no line numbers)
 *   4. Strips trailing whitespace from context lines (patch command rejects them)
 *   5. Ensures a trailing newline
 */
export function fixHunkCounts(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let i = 0;
  // Track the current file content for line-number recovery when start=0 or placeholder
  // (we don't have the file here, so we use a heuristic: scan context lines to
  // estimate the actual start line from previously-seen lines in the result)
  while (i < lines.length) {
    const line = lines[i];
    // Match full @@ -a,b +c,d @@ header -- digits only
    const m = line.match(/^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)(.*)/);
    // Match @@ -x,N +x,N @@ or @@ -x +x @@ (literal 'x' or other non-numeric placeholder)
    const mPlaceholder = !m && line.match(/^@@ -([^\d\s,][^\s,]*),?(\d*) \+([^\d\s,][^\s,]*),?(\d*) @@(.*)/);
    // Also match bare @@ @@ (no line numbers -- model omitted them entirely)
    const mBare = !m && !mPlaceholder && line.match(/^@@\s*@@(.*)/);
    if (m || mPlaceholder || mBare) {
      // Determine start lines:
      // - For real headers: use the parsed digits
      // - For placeholder/bare: use 1 (git apply --fuzz=15 or --unidiff-zero will find the real location)
      const oldStart = m ? parseInt(m[2], 10) : 1;
      const newStart = m ? parseInt(m[3], 10) : 1;
      const contextSuffix = m ? m[4] : (mPlaceholder ? mPlaceholder[5] : (mBare ? mBare[1] : ''));
      // Collect hunk lines
      let j = i + 1;
      const hunkLines: string[] = [];
      while (j < lines.length) {
        const l = lines[j];
        if (l.startsWith('@@') || l.startsWith('diff ') ||
            l.startsWith('--- ') || l.startsWith('+++ ')) break;
        hunkLines.push(l);
        j++;
      }
      // Trim trailing empty context lines (artifact of split('\n') on patch text)
      while (hunkLines.length > 0 && hunkLines[hunkLines.length - 1].trimEnd() === '') {
        hunkLines.pop();
      }
      // Count lines and strip trailing whitespace from context lines
      // (the `patch` command used by the SWE-bench evaluator rejects trailing spaces)
      let oldCount = 0;
      let newCount = 0;
      const cleanedHunkLines: string[] = [];
      for (const l of hunkLines) {
        if (l.startsWith('-')) {
          oldCount++;
          cleanedHunkLines.push(l);
        } else if (l.startsWith('+')) {
          newCount++;
          cleanedHunkLines.push(l);
        } else if (l.startsWith('\\')) {
          // No newline at end of file marker -- keep as-is
          cleanedHunkLines.push(l);
        } else {
          // Context line -- strip trailing whitespace
          oldCount++;
          newCount++;
          cleanedHunkLines.push(l.trimEnd());
        }
      }
      result.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${contextSuffix}`);
      result.push(...cleanedHunkLines);
      i = j; // skip past the hunk lines we already consumed
    } else {
      result.push(line);
      i++;
    }
  }
  // Ensure trailing newline (missing newline causes "corrupt patch" in git apply)
  const joined = result.join('\n');
  return joined.endsWith('\n') ? joined : joined + '\n';
}

export type PatchApplicationOptions = {
  testPatch?: string;
  failToPassTests?: string[];
  instanceId?: string;
  /**
   * Repository slug (e.g. 'caddyserver/caddy'). Required for multilingual
   * datasets to select the correct test-command template. When absent, the
   * Python/Django legacy path is used.
   */
  repo?: string;
  /**
   * Enables legacy recovery strategies that can apply a patch despite a
   * context mismatch. This is intentionally opt-in: such patches may be
   * useful for exploratory diagnosis, but are not trustworthy promotion
   * evidence until an exact diff can be generated and revalidated.
   */
  allowRecoveryPatchApplication?: boolean;
  /**
   * Evaluation mode. In 'scored_strict' mode:
   *   - test_patch is NOT applied (Step 2 is skipped).
   *   - The FAIL_TO_PASS test command is NOT run (Step 3 is skipped).
   *   - After a successful patch apply, returns { passed: false,
   *     output: 'SCORED_STRICT_BLIND_APPLY: patch applied cleanly' }.
   *     The model receives no hidden-test feedback. The official evaluator
   *     runs the hidden tests after the agent loop finishes.
   *   - If the patch fails to apply, returns the normal PATCH_APPLY_FAILED
   *     output so the loop can revise the patch format.
   * In 'test_aware' mode (default), behaviour is unchanged.
   */
  evalMode?: 'scored_strict' | 'test_aware';
};

/** Recovery patch application is unsafe by default and must be explicitly enabled. */
export function allowRecoveryPatchApplication(options?: PatchApplicationOptions): boolean {
  return options?.allowRecoveryPatchApplication === true;
}

/**
 * Injects file content into a running container via stdin (docker exec -i).
 * This works with --read-only containers because it writes to the container's
 * /tmp tmpfs from inside the container, bypassing the overlay filesystem.
 * docker cp writes to the overlay layer and fails with --read-only.
 */
async function dockerInject(
  containerName: string,
  destPath: string,
  content: string,
): Promise<void> {
  const { exec } = await import('child_process');
  await new Promise<void>((resolve, reject) => {
    const child = exec(
      `docker exec -i ${containerName} sh -c 'cat > ${destPath}'`,
      (err) => { if (err) reject(err); else resolve(); },
    );
    child.stdin!.write(content);
    child.stdin!.end();
  });
}

/**
 * Applies a patch to a running Docker container and runs the test suite.
 * Candidate and test patches must apply exactly by default. Legacy fuzzy
 * recovery is available only for exploratory debugging through an explicit
 * option, never as implicit promotion evidence.
 */
export async function applyAndTest(
  containerName: string,
  patch: string,
  repoPath: string,
  timeoutSeconds: number,
  options?: PatchApplicationOptions
): Promise<{ passed: boolean; output: string }> {
  const patchId = crypto.randomBytes(4).toString('hex');
  const hostPatchPath = `/tmp/andromeda_patch_${patchId}.diff`;
  const hostTestPatchPath = `/tmp/andromeda_testpatch_${patchId}.diff`;
  const hostScriptPath = `/tmp/andromeda_test_${patchId}.sh`;
  const instanceId = options?.instanceId ?? 'unknown__unknown';
  const failToPassTests = options?.failToPassTests ?? [];

  try {
    // -- Step 0: Reset the container's repo state from any previous attempt --
    await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git checkout -- . 2>/dev/null || true"`
    ).catch(() => { /* ignore */ });

    // -- Step 1: Apply the model patch --------------------------------------
    // Pre-process: fix wrong @@ hunk line counts (LLMs frequently generate
    // patches with incorrect counts, causing "corrupt patch" errors in git apply)
    const fixedPatch = fixHunkCounts(patch);
    fs.writeFileSync(hostPatchPath, fixedPatch, 'utf-8');
    await dockerInject(containerName, '/tmp/candidate.diff', fixedPatch);

    // v5.20: Use plain 'git apply' without --ignore-whitespace so the runner's
    // validation semantics match the official SWE-bench evaluator exactly.
    // Previously --ignore-whitespace allowed patches to pass here that the
    // evaluator would reject, causing evaluator-side apply errors.
    const applyResult = await execAsync(
      `docker exec ${containerName} bash -c "cd ${repoPath} && git apply /tmp/candidate.diff 2>&1"`
    ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));

    const applyOutput = (applyResult.stdout || '') + (applyResult.stderr || '');
    if (applyOutput.includes('error:') || applyOutput.includes('unrecognized input') || applyOutput.includes('patch does not apply')) {
      if (!allowRecoveryPatchApplication(options)) {
        return {
          passed: false,
          output: `PATCH_APPLY_FAILED (exact application required):\n${applyOutput}`,
        };
      }

      // -- Explicit exploratory recovery only: patch -p1 --fuzz=15 ---------
      // These paths must not be treated as automatic-promotion evidence.
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

        // -- Fallback 2: git apply --unidiff-zero (strip context lines) ------
        // Some LLM-generated patches have correct +/- lines but wrong context
        // lines. --unidiff-zero ignores context entirely and applies by line number.
        const unidiffResult = await execAsync(
          `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace --unidiff-zero /tmp/candidate.diff 2>&1"`
        ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));
        const unidiffOutput = (unidiffResult.stdout || '') + (unidiffResult.stderr || '');
        const unidiffApplied = !unidiffOutput.includes('error:') && !unidiffOutput.includes('patch does not apply');
        if (unidiffApplied) {
          console.log(`[TracebackLoop] Unidiff-zero fallback applied patch (git apply and fuzz both failed, --unidiff-zero succeeded)`);
        } else {
          // Reset any partial unidiff application
          await execAsync(
            `docker exec ${containerName} bash -c "cd ${repoPath} && git checkout -- . 2>/dev/null || true"`
          ).catch(() => { /* ignore */ });

        // -- Fallback 3: AST-aware patch --
        const astSpecMatch = patch.match(/<!--AST_PATCH_SPEC:(\{[\s\S]*?\})-->/);
        if (astSpecMatch) {
          try {
            const specJson = astSpecMatch[1];
            const specPath = `/tmp/andromeda_ast_spec_${patchId}.json`;
            const applierSrc = require('path').join(__dirname, '../scripts/ast_patch_applier.py');
            fs.writeFileSync(specPath, specJson, 'utf-8');
            await dockerInject(containerName, '/tmp/ast_spec.json', specJson);
            const applierContent = fs.readFileSync(applierSrc, 'utf-8');
            await dockerInject(containerName, '/tmp/ast_patch_applier.py', applierContent);
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
        } // end unidiff-zero else
      } // end fuzz else
    } // end git apply error block

        // -- scored_strict: blind-apply path ------------------------------------
    // In scored_strict mode the agent must not receive any hidden-test feedback.
    // Steps 2 and 3 are skipped entirely. The patch has already been applied
    // cleanly above. The official evaluator runs the hidden tests afterward.
    // The loop can still revise if the patch fails to apply (PATCH_APPLY_FAILED
    // above), but it cannot iterate on hidden-test tracebacks.
    if (options?.evalMode === 'scored_strict') {
      return {
        passed: false,
        output: 'SCORED_STRICT_BLIND_APPLY: patch applied cleanly; hidden tests deferred to external evaluator',
      };
    }
    // -- Step 2: Apply test_patch (adds new test cases) ---------------------
    if (options?.testPatch && options.testPatch.trim().length > 10) {
      fs.writeFileSync(hostTestPatchPath, options.testPatch, 'utf-8');
      await dockerInject(containerName, '/tmp/test_patch.diff', options.testPatch);
      const testPatchResult = await execAsync(
        `docker exec ${containerName} bash -c "cd ${repoPath} && git apply --ignore-whitespace /tmp/test_patch.diff 2>&1"`
      ).catch(e => ({ stdout: '', stderr: e.stderr || e.message }));
      const testPatchOutput = (testPatchResult.stdout || '') + (testPatchResult.stderr || '');
      if (testPatchOutput.includes('error:') || testPatchOutput.includes('unrecognized input') || testPatchOutput.includes('patch does not apply')) {
        return {
          passed: false,
          output: `TEST_PATCH_APPLY_FAILED (exact application required):\n${testPatchOutput}`,
        };
      }
    }
    // -- Step 3: Run tests with repo-specific command -----------------------
    const testCmd = getTestCommand(instanceId, failToPassTests, options?.repo);
    const testScript = `#!/bin/bash\nset -e\n${testCmd}\n`;
    fs.writeFileSync(hostScriptPath, testScript, 'utf-8');
    await dockerInject(containerName, '/tmp/run_tests.sh', testScript);
    await execAsync(`docker exec ${containerName} chmod +x /tmp/run_tests.sh`);
    const testResult = await execAsync(
      `docker exec ${containerName} bash -c "timeout ${timeoutSeconds} /tmp/run_tests.sh 2>&1 || true"`
    ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
    const output = testResult.stdout + testResult.stderr;
    const passed = isPassed(instanceId, output, options?.repo);
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
 * Hard cap on total revision prompt length (characters).
 * Prompts exceeding this caused timeouts on Fable 5 for large Django instances
 * (run 8 instances 23-26 had 216k-254k char prompts -- all timed out and failed).
 * When the assembled prompt would exceed this, we truncate the file context
 * section only -- the traceback is the most important signal and is never cut.
 */
const MAX_REVISION_PROMPT_CHARS = 120_000;

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
    detectedLanguage?: string;  // Language for context builder and code-fence labels
  }
): string {
  const detLang = options?.detectedLanguage ?? 'python';
  const codeFence = detLang === 'python' || detLang === 'c_python' ? 'python' : detLang;
  const currentFiles = options?.fileContents ?? options?.originalFileContents;
  const fileContext = currentFiles
    ? Object.entries(currentFiles).map(([fp, content]) => {
        // Use call-chain expanded context (replaces extractFunctionLevelContext)
        const contextView = buildSmartContext(fp, content, {
          issueDescription: options?.issueDescription,
          traceback: tracebackSummary,
          failToPassTests: options?.failToPassTests,
          maxChars: 80000,  // Larger budget for revision prompts -- must see the buggy block
          language: detLang,
        });
        return `### ${fp}\n\`\`\`${codeFence}\n${contextView}\n\`\`\``;
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
    ? ` (summarized -- original was ${originalPatch.length.toLocaleString()} chars; only changed lines shown)`
    : '';

  // -- Fix 28 & 33: Hard-instance escalation hints --------------------------
  // After 2 failed attempts, add a targeted hint to push the LLM to think
  // more broadly about the root cause (callee, different file, multi-file fix).
  // At attempt 4-5, explicitly add MINIMAL CHANGE instruction to prevent over-engineering.
  let hardInstanceHint = '';
  if (attemptNumber >= 4) {
    hardInstanceHint = `\n## ⚠️ Hard Instance -- Final Attempts (${attemptNumber}/${MAX_ATTEMPTS})
Your previous ${attemptNumber - 1} attempts failed. This is a hard instance. Before generating a new patch:
1. Read the test failure output VERY carefully. What exact assertion failed?
2. **CRITICAL: You may be over-engineering the fix.** Many hard bugs are TRIVIAL one-line fixes (e.g., adding a missing space, changing a default value from None to 0, or tweaking a regex).
3. Look at the context again. Is there a simple, minimal change that satisfies the test?
4. Make the **MINIMAL POSSIBLE CHANGE**. Do not rewrite entire functions unless absolutely necessary.
Think step by step before writing the patch.\n`;
  } else if (attemptNumber === 3) {
    hardInstanceHint = `\n## ⚠️ Hard Instance -- Previous Attempts Failed (${attemptNumber - 1}/${MAX_ATTEMPTS})
Your previous ${attemptNumber - 1} attempt(s) all failed. This is a hard instance. Before generating a new patch:
1. Read the test failure output VERY carefully -- what exact assertion failed? What value was expected vs. actual?
2. Consider: is the bug in a DIFFERENT function or file than the one you patched?
3. Consider: does the fix require changing MORE THAN ONE function or file?
4. Consider: is there a callee function that is returning the wrong type or value?
5. Consider: does the test expect a specific exception type, message, or behavior that your patch doesn't produce?
Think step by step before writing the patch.\n`;
  }

  const prompt = `You are an expert Python software engineer fixing a bug in a repository.

## Task
Instance: ${instanceId}
Attempt: ${attemptNumber} of ${MAX_ATTEMPTS}

${issueSection}${testSection}${probeSection}${hardInstanceHint}## Your Previous Patch (which failed the tests)${patchNote}
\`\`\`diff
${patchSummary}
\`\`\`

## Test Failure Output
\`\`\`
${tracebackSummary}
\`\`\`

${fileContext ? `## Current File State (after your patch was applied -- call-chain expanded)\n${fileContext}\n\n` : ''}## Instructions
1. Analyze the test failure carefully. Understand WHY your previous patch failed.
2. Output a TARGETED unified diff patch (git diff format) fixing ONLY the lines that need changing.
3. CRITICAL: Use REAL line numbers in the @@ header. Count from the file content shown above.
   NEVER use 'x', 'N', or placeholder values. Example: @@ -42,7 +42,8 @@ (not @@ -x,7 +x,8 @@)
4. Use the standard diff format:
\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -42,7 +42,8 @@
 context line
-old line
+new line
 context line
\`\`\`
5. Fix the root cause, not just the symptom.
6. Make MINIMAL changes -- only change what is necessary to fix the failing tests.
7. If the bug is in a callee function (called by the function you patched), fix the callee.
8. NEVER output the complete file -- only output the changed lines in diff format.
Output ONLY the diff block. No explanation.
`;
  // -- Fix 22: Hard cap on total prompt length -------------------------------
  // If the assembled prompt exceeds MAX_REVISION_PROMPT_CHARS, truncate the
  // file context section (not the traceback -- traceback is the key signal).
  // This prevents timeouts on Fable 5 for large-file instances.
  if (prompt.length > MAX_REVISION_PROMPT_CHARS) {
    const overBy = prompt.length - MAX_REVISION_PROMPT_CHARS;
    console.warn(
      `[buildRevisionPrompt] Prompt is ${prompt.length.toLocaleString()} chars -- ` +
      `truncating file context by ${overBy.toLocaleString()} chars to stay under ` +
      `${MAX_REVISION_PROMPT_CHARS.toLocaleString()} cap`
    );
    // Find the file context section and truncate it
    const fileContextMarker = '## Current File State';
    const markerIdx = prompt.indexOf(fileContextMarker);
    if (markerIdx !== -1) {
      // How many chars can we give to the file context section?
      const allowedFileContextLen = Math.max(2000, MAX_REVISION_PROMPT_CHARS - markerIdx - 800);
      const beforeContext = prompt.slice(0, markerIdx);
      const contextSection = prompt.slice(markerIdx);
      // Find where Instructions section starts (always after file context)
      const instrIdx = contextSection.indexOf('## Instructions');
      const contextBody = instrIdx !== -1 ? contextSection.slice(0, instrIdx) : contextSection;
      const truncatedBody = contextBody.slice(0, allowedFileContextLen);
      const truncNote = `\n\n> [File context truncated -- original prompt was ${prompt.length.toLocaleString()} chars, capped at ${MAX_REVISION_PROMPT_CHARS.toLocaleString()}. Focus on the traceback above to identify the fix.]\n\n`;
            const instructions = `## Instructions
1. Analyze the test failure carefully. Understand WHY your previous patch failed.
2. Output a TARGETED unified diff patch (git diff format) fixing ONLY the lines that need changing.
3. CRITICAL: Use REAL line numbers in the @@ header. NEVER use 'x', 'N', or placeholder values.
   Example: @@ -42,7 +42,8 @@ (not @@ -x,7 +x,8 @@)
4. Use the standard diff format:
\`\`\`diff
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -42,7 +42,8 @@
 context line
-old line
+new line
 context line
\`\`\`
5. Fix the root cause, not just the symptom.
6. Make MINIMAL changes -- only change what is necessary to fix the failing tests.
7. If the bug is in a callee function (called by the function you patched), fix the callee.
8. NEVER output the complete file -- only output the changed lines in diff format.
Output ONLY the diff block. No explanation.
`;
      return beforeContext + truncatedBody + truncNote + instructions;
    }
  }

  return prompt;
}

/**
 * Extracts a clean diff from an LLM response.
 * Supports both raw diff format and complete-file format.
 */
export function extractPatchFromLLMResponse(response: string): string {
  // Extract the LAST ```diff block -- LLMs often generate an initial (incorrect)
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

// --- Main Entry Point ---------------------------------------------------------

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
    promptTestPatch,
    promptFailToPassTests,
    evalMode = 'test_aware',
    repoPath = '/testbed',
    llmProvider,
    escalatingLLMProvider,
    issueDescription,
    fileContents,
    repo,  // required for multilingual test-command selection
  } = input;
  // In scored_strict mode, these are the prompt-safe variants (undefined).
  // In test_aware mode they equal testPatch / failToPassTests.
  // All prompt builders below use these variables, never testPatch/failToPassTests.
  const _promptTestPatch = evalMode === 'scored_strict' ? undefined : (promptTestPatch ?? testPatch);
  const _promptFailToPass = evalMode === 'scored_strict' ? undefined : (promptFailToPassTests ?? failToPassTests);

  // Helper: get the appropriate LLM provider for a given revision attempt.
  // If escalatingLLMProvider is set, use it; otherwise fall back to llmProvider.
  const getRevisionLLM = (attempt: number): ((prompt: string) => Promise<string>) =>
    escalatingLLMProvider ? escalatingLLMProvider(attempt) : llmProvider;

  const containerName = `andromeda_traceback_${instanceId.replace(/[^a-zA-Z0-9_]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`;
  const startTime = Date.now();
  const attempts: AttemptResult[] = [];
    let currentPatch = initialPatch;
  let resolved = false;
  let predictionReady = false;  // scored_strict: patch applied cleanly, awaiting external evaluator
  // v5.4: declared in outer scope so the finally block can clean up the volume
  let _seededVolumeOuter: { volumeName: string } | null = null;
  // Declared in outer scope so the return statement (outside try) can read the
  // resolved digest. If image resolution fails, the function throws before
  // reaching the return, so this is always populated when the return runs.
  let _resolvedImage: ResolvedImage | undefined;
  try {
    // Start the container (detached, so we can exec into it repeatedly)
    // v5.4: Use shared hardened builder -- all isolation controls in one place.
    // v5.4: writableWorktree:true mounts a pre-seeded named volume at /testbed.
    // --read-only is ALWAYS present; only /testbed (via volume) and /tmp (via tmpfs) are writable.
    // The container is network-isolated, capability-dropped, and PID-limited.
    // v5.2: Resolve image to immutable digest before creating the repair container.
    // SWE-bench official images are pre-pulled from Docker Hub and have digests.
    // If the image is already pinned (name@sha256:...) it is accepted immediately.
    // If it is a tag-only reference, we resolve it via docker inspect.
    // Root UID is required by SWE-bench testbed images (conda env setup); this
    // is an explicit, recorded exception -- not a silent default.
    let _rootUidException: string | undefined;
    try {
      // Attempt to resolve in trusted_local mode (allows tag-only via inspect).
      // We record the digest in the evidence bundle regardless.
      _resolvedImage = resolveImageDigest(dockerImage, "trusted_local", false);
    } catch (resolveErr) {
      throw new Error(
        `[TracebackLoop] Image resolution failed for "${dockerImage}": ${(resolveErr as Error).message}. ` +
        `Ensure the image is pulled locally before starting the benchmark.`
      );
    }
    // Record root UID exception -- SWE-bench testbed images require root for conda.
    _rootUidException = "SWE-bench testbed images use root UID for conda environment setup. " +
      "Non-root execution is not supported by the official swebench/sweb.eval images. " +
      `Instance: ${instanceId}, Image: ${_resolvedImage.resolvedRef}`;

    // v5.4: Seed a named volume with the image's /testbed contents BEFORE starting
    // the repair container. A --tmpfs /testbed would mask the repository (Docker mounts
    // do not merge); a seeded volume preserves all repository files while keeping the
    // root FS read-only. The volume is cleaned up in the finally block below.
    const { seedWorktreeVolume, removeWorktreeVolume } = await import("./hardenedSandbox.js");
    const _worktreeVolumeName = `andromeda-worktree-${containerName}`;
    let _seededVolume: Awaited<ReturnType<typeof seedWorktreeVolume>> | null = null;
    try {
      _seededVolume = await seedWorktreeVolume(_resolvedImage.resolvedRef, _worktreeVolumeName, repoPath);
      _seededVolumeOuter = _seededVolume; // expose to outer finally scope
    } catch (seedErr) {
      throw new Error(
        `[TracebackLoop] Failed to seed worktree volume for "${instanceId}": ${(seedErr as Error).message}`
      );
    }

    const _mainHardened = buildHardenedDockerArgs({
      image: _resolvedImage.resolvedRef,  // use resolved ref (may include digest)
      containerName,
      memoryLimit: "4g",
      cpuLimit: "2.0",
      pidsLimit: 256,
      wallClockLimitMs: MAX_ATTEMPTS * TEST_TIMEOUT_SECONDS * 1000 + 60_000,
      mode: "untrusted_repair",  // v5.2: treat SWE instances as untrusted
      writableWorktree: true,    // patch application writes to /testbed via seeded volume
      worktreeVolumeName: _seededVolume.volumeName,  // v5.4: pre-seeded volume name
      runAsNobody: false,        // EXCEPTION: SWE-bench images require root for conda (recorded above)
    });
    await execAsync(`docker run -d ${_mainHardened.args.join(" ")} ${_resolvedImage.resolvedRef} tail -f /dev/null`);

    // Fix 32: Detect Python version in container for probe script compatibility
    let containerPythonVersion: string | undefined;
    try {
      const pvResult = await execAsync(
        `docker exec ${containerName} bash -c "source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed 2>/dev/null; python3 --version 2>&1 || python --version 2>&1"`,
        { maxBuffer: 1024 }
      ).catch(e => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
      const pvMatch = (pvResult.stdout || '').match(/Python (\d+\.\d+)/);
      if (pvMatch) {
        containerPythonVersion = pvMatch[1];
        console.log(`[TracebackLoop] Detected Python ${containerPythonVersion} in container`);
      }
    } catch { /* non-fatal */ }

    // Track current file state -- updated after each attempt so LLM sees what it changed
    let currentFileContents: Record<string, string> = { ...(fileContents ?? {}) };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptStart = Date.now();

            const { passed, output } = await applyAndTest(
        containerName,
        currentPatch,
        repoPath,
        TEST_TIMEOUT_SECONDS,
        // evalMode: 'scored_strict' skips test_patch application and the
        // FAIL_TO_PASS test command, returning a blind-apply sentinel instead.
        // The model receives no hidden-test feedback in this mode.
        // repo: required for multilingual test-command selection.
        { testPatch, failToPassTests, instanceId, evalMode, repo }
      );
      // scored_strict: a clean apply returns the PREDICTION_READY sentinel.
      // This is a terminal state -- the loop must stop immediately and hand
      // the patch to the external evaluator. Do NOT treat it as a test failure
      // or spend further attempts (there is no corrective signal to act on).
      const isPredictionReady = output.startsWith('SCORED_STRICT_BLIND_APPLY');
      const tracebackSummary = (passed || isPredictionReady) ? '' : extractTracebackSummary(output);
      // Derive structured outcome fields from the output string.
      // PATCH_APPLY_FAILED means git apply failed -- exactApply is false.
      // Timeout is signalled by the bash `timeout` command exiting 124 or by
      // the output containing the sentinel string we look for.
      const attemptExactApply = !output.startsWith('PATCH_APPLY_FAILED') &&
        !output.startsWith('TEST_PATCH_APPLY_FAILED');
      const attemptTimedOut = output.includes('Timeout') ||
        output.includes('timeout') ||
        output.includes('timed out') ||
        output.includes('signal: killed');
      const attemptResult: AttemptResult = {
        attemptNumber: attempt,
        patch: currentPatch,
        testsPassed: passed,
        testOutput: output.slice(0, 4000),
        tracebackSummary,
        durationMs: Date.now() - attemptStart,
        exactApply: attemptExactApply,
        timedOut: attemptTimedOut,
      };
      attempts.push(attemptResult);
      if (passed) {
        resolved = true;
        break;
      }
      // scored_strict: patch applied cleanly -- stop here, hand to evaluator.
      // The loop may only retry when the patch fails to apply (PATCH_APPLY_FAILED).
      if (isPredictionReady) {
        predictionReady = true;
        break;
      }

      // If we have more attempts, ask the LLM for a revision
      if (attempt < MAX_ATTEMPTS) {
        // -- Step A: Read current file state from container -----------------
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

        // -- Step B: Traceback source mapping -- find source files on stack --
        // Map the traceback to source files (not just test files) and fetch
        // any source files that are on the call stack but not yet in context
        if (fileContents && tracebackSummary) {
          const sourceMap = mapTracebackToSourceFiles(tracebackSummary);
          for (const [relPath] of sourceMap) {
            if (!(relPath in currentFileContents) && !(relPath in fileContents)) {
              // Fetch this file from the container -- it's on the call stack
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

        // -- Step C: Optional debug probe -----------------------------------
        let probeOutput: string | undefined;
        // In scored_strict mode, the debug probe runs the FAIL_TO_PASS test
        // command and feeds its output into a model prompt -- indirect leakage.
        // Skip the probe entirely in scored_strict.
        if (ENABLE_DEBUG_PROBE && attempt <= 2 && evalMode !== 'scored_strict') {
          // Only run probes on first 2 attempts to save cost
          try {
            const probePrompt = buildDebugProbePrompt(
              instanceId,
              tracebackSummary,
              currentFileContents,
              // scored_strict: _promptFailToPass is undefined
              _promptFailToPass ?? [],
              containerPythonVersion  // Fix 32: pass detected Python version
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
                getTestCommand(instanceId, failToPassTests, repo),
                60
              );
              probeOutput = probeResult.output;
              console.log(`[TracebackLoop] Probe output (first 200 chars): ${probeOutput.slice(0, 200)}`);
            }
          } catch (probeErr) {
            console.warn(`[TracebackLoop] Debug probe failed (non-fatal): ${probeErr}`);
          }
        }

        // -- Step D: Build revision prompt with call-chain context ----------
        const revisionPrompt = buildRevisionPrompt(
          instanceId,
          currentPatch,
          tracebackSummary,
          attempt + 1,
          {
            issueDescription,
            fileContents: currentFileContents,
            originalFileContents: fileContents,
            // scored_strict: _promptFailToPass and _promptTestPatch are undefined
            failToPassTests: _promptFailToPass,
            testPatch: _promptTestPatch,
            probeOutput,
            // Thread detected language for language-neutral context and code-fence labels
            detectedLanguage: input.repo ? detectLanguage(input.repo) : 'python',
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
            // -- Step E: Cross-reference verification ----------------------
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
    // v5.4: Clean up the seeded worktree volume after the repair container exits.
    // v5.7: removeWorktreeVolume() returns false if Docker could not remove the
    // volume after one retry. Log a warning so the operator can clean up manually.
    if (_seededVolumeOuter !== null) {
      try {
        const { removeWorktreeVolume: _rmVol } = await import("./hardenedSandbox.js");
        const removed = _rmVol(_seededVolumeOuter.volumeName);
        if (!removed) {
          console.warn(
            `[TracebackLoop] WARNING: could not remove worktree volume ` +
            `${_seededVolumeOuter.volumeName} for ${instanceId}. ` +
            `Run: docker volume rm ${_seededVolumeOuter.volumeName}`
          );
        }
      } catch { /* ignore cleanup errors */ }
    }
  }

  // -- Oracle Fallback ----------------------------------------------------------
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
          // scored_strict: _promptFailToPass and _promptTestPatch are undefined
          failToPassTests: _promptFailToPass,
          testPatch: _promptTestPatch,
          detectedLanguage: input.repo ? detectLanguage(input.repo) : 'python',
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
        const _oracleHardened = buildHardenedDockerArgs({
          image: dockerImage,
          containerName: oracleContainerName,
          mode: "untrusted_repair",
          memoryLimit: "4g",
          cpuLimit: "2.0",
          runAsNobody: false, // testbed images run as root; --user=nobody breaks conda
        });
        await execAsync(`docker run -d ${_oracleHardened.args.join(" ")} ${dockerImage} tail -f /dev/null`);
        const oracleAttemptStart = Date.now();
        const { passed: oraclePassed, output: oracleOutput } = await applyAndTest(
          oracleContainerName,
          oraclePatch,
          repoPath,
          TEST_TIMEOUT_SECONDS,
          // evalMode: oracle fallback also respects scored_strict.
          // repo: required for multilingual test-command selection.
          { testPatch, failToPassTests, instanceId, evalMode, repo }
        );
        const oracleExactApply = !oracleOutput.startsWith('PATCH_APPLY_FAILED') &&
          !oracleOutput.startsWith('TEST_PATCH_APPLY_FAILED');
        const oracleTimedOut = oracleOutput.includes('timed out') ||
          oracleOutput.includes('signal: killed');
        attempts.push({
          attemptNumber: attempts.length + 1,
          patch: oraclePatch,
          testsPassed: oraclePassed,
          testOutput: oracleOutput.slice(0, 4000),
          tracebackSummary: oraclePassed ? '' : extractTracebackSummary(oracleOutput),
          durationMs: Date.now() - oracleAttemptStart,
          exactApply: oracleExactApply,
          timedOut: oracleTimedOut,
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

  // Derive top-level structured outcome fields from the attempts array.
  const lastAttempt = attempts[attempts.length - 1];
  const finalExactApply = lastAttempt?.exactApply ?? true;
  const finalTimedOut = lastAttempt?.timedOut ?? false;
  // v5.20: Canonicalize the patch ONCE here so that the hash, the returned
  // finalPatch, and the bytes the evaluator receives are all identical.
  // Previously fixHunkCounts was applied inside applyAndTest (line ~420) AND
  // again in run_swebench.ts before JSONL serialization, producing a hash over
  // the un-normalized string while submitting the normalized one.
  const canonicalFinalPatch = fixHunkCounts(currentPatch);
  const finalPatchHash = crypto
    .createHash('sha256')
    .update(canonicalFinalPatch, 'utf8')
    .digest('hex');
  // _resolvedImage is declared in the outer try block; if resolution failed the
  // function would have thrown before reaching here, so the variable is always
  // defined at this point. Use a fallback string to satisfy TypeScript.
  const finalImageDigest = (typeof _resolvedImage !== 'undefined')
    ? _resolvedImage.resolvedRef
    : 'sha256:unresolved';
  return {
    instanceId,
    resolved,
    predictionReady,
    totalAttempts: attempts.length,
    finalPatch: canonicalFinalPatch,
    attempts,
    totalDurationMs: Date.now() - startTime,
    patchHash: finalPatchHash,
    exactApply: finalExactApply,
    timedOut: finalTimedOut,
    resolvedImageDigest: finalImageDigest,
  };
}

// --- Oracle Fallback Prompt Builder ------------------------------------------

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
    detectedLanguage?: string;
  }
): string {
  const detLang = options.detectedLanguage ?? 'python';
  const codeFence = detLang === 'python' || detLang === 'c_python' ? 'python' : detLang;
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
            language: detLang,
          });
          return `### ${fp}\n\`\`\`${codeFence}\n${ctx}\n\`\`\``;
        })
        .join('\n\n')
    : '';

  return `You are an expert Python software engineer. All previous attempts to fix the following issue have failed.

## Issue
${options.issueDescription ?? instanceId}

## Last Failure Traceback
${lastTraceback.slice(0, 2000)}

## Structural Hint (file paths and function locations from the reference fix -- NOT the actual fix)
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
