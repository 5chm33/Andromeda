/**
 * externalBenchmarkGate.ts — v19.0.0
 *
 * HumanEval subset runner and rollback gate.
 *
 * This module runs a lightweight subset of external benchmarks (like HumanEval)
 * periodically to ensure the system is actually improving its general capabilities,
 * rather than just overfitting to its own internal metrics and test suite.
 * If the external benchmark score drops, it triggers a rollback.
 */

import { createLogger } from "./logger.js";
import { getActiveModel, getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";
import { rollbackToLastHealthy } from "./selfRollback.js";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const log = createLogger("externalBenchmark");

export interface BenchmarkResult {
  passed: number;
  total: number;
  score: number; // passed / total
  details: Array<{ id: string; success: boolean; error?: string }>;
}

// A tiny, hardcoded subset of HumanEval-like problems for fast gating.
// In a real production setup, this would load from a JSONL file.
const HUMANEVAL_SUBSET = [
  {
    id: "HE-0",
    prompt: "function hasCloseElements(numbers: number[], threshold: number): boolean {\n  // Check if in given list of numbers, are any two numbers closer to each other than given threshold.\n",
    test: "expect(hasCloseElements([1.0, 2.0, 3.0], 0.5)).toBe(false);\nexpect(hasCloseElements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)).toBe(true);",
  },
  {
    id: "HE-1",
    prompt: "function separateParenGroups(parenString: string): string[] {\n  // Input to this function is a string containing multiple groups of nested parentheses. Your goal is to separate those group into separate strings and return the list of those.\n",
    test: "expect(separateParenGroups('( ) (( )) (( )( ))')).toEqual(['()', '(())', '(()())']);",
  },
  {
    id: "HE-2",
    prompt: "function truncateNumber(number: number): number {\n  // Given a positive floating point number, it can be decomposed into integer part (largest integer smaller than given number) and decimals (leftover part always smaller than 1). Return the decimal part.\n",
    test: "expect(truncateNumber(3.5)).toBeCloseTo(0.5);",
  }
];

let baselineScore: number | null = null;
let proposalCountSinceLastRun = 0;
const RUN_INTERVAL = 10; // Run every 10 applied proposals

/**
 * Uses the LLM to solve a benchmark problem.
 */
async function solveProblem(prompt: string): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const systemPrompt = `You are an expert TypeScript developer. Complete the given function.
Return ONLY the completed TypeScript code. Do not include markdown formatting, explanations, or tests. Just the raw code.`;

  try {
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...getProviderHeaders(),
      },
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    let content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    // Strip markdown blocks if the LLM ignored instructions
    content = content.replace(/^```(typescript|ts)?\n?/im, "").replace(/\n?```$/m, "").trim();
    return content;

  } catch (error) {
    log.error(`Error solving benchmark problem: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Runs the generated solution against the test cases in a temporary sandbox.
 */
function evaluateSolution(solution: string, testCode: string): boolean {
  const tmpDir = path.join(process.cwd(), "workspace", ".benchmark_tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const testFile = path.join(tmpDir, `test_${Date.now()}_${Math.random().toString(36).slice(2,8)}.ts`);
  
  // Wrap in a simple vitest-like structure for execution via ts-node or similar.
  // For this lightweight gate, we'll just use basic assert.
  const executableCode = `
import * as assert from "assert";

// Simple expect wrapper
function expect(actual: any) {
  return {
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
    toBeCloseTo: (expected: any, precision = 2) => {
      const pass = Math.abs(expected - actual) < Math.pow(10, -precision) / 2;
      assert.ok(pass, \`Expected \${actual} to be close to \${expected}\`);
    }
  };
}

${solution}

try {
  ${testCode}
  process.exit(0);
} catch (e: any) {
  console.error(e.message);
  process.exit(1);
}
`;

  try {
    fs.writeFileSync(testFile, executableCode);
    
    // We assume ts-node is available in the environment.
    // In a real secure setup, this MUST run in an isolated Docker container.
    // For this RSI daemon, we use spawnSync with a timeout.
    const result = spawnSync("npx", ["ts-node", testFile], {
      timeout: 5000, // 5s max execution
      encoding: "utf-8"
    });

    return result.status === 0;
  } catch (error) {
    log.warn(`Evaluation failed to execute: ${(error as Error).message}`);
    return false;
  } finally {
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Runs the full external benchmark suite.
 */
export async function runExternalBenchmark(): Promise<BenchmarkResult> {
  log.info(`Running external benchmark gate (${HUMANEVAL_SUBSET.length} problems)...`);
  
  let passed = 0;
  const details: BenchmarkResult["details"] = [];

  for (const problem of HUMANEVAL_SUBSET) {
    const solution = await solveProblem(problem.prompt);
    if (!solution) {
      details.push({ id: problem.id, success: false, error: "Failed to generate solution" });
      continue;
    }

    const success = evaluateSolution(solution, problem.test);
    if (success) passed++;
    
    details.push({ id: problem.id, success });
  }

  const score = passed / HUMANEVAL_SUBSET.length;
  log.info(`External benchmark complete. Score: ${score.toFixed(2)} (${passed}/${HUMANEVAL_SUBSET.length})`);

  return { passed, total: HUMANEVAL_SUBSET.length, score, details };
}

/**
 * Checks if the benchmark should be run, runs it, and triggers rollback if necessary.
 * Call this after a proposal is successfully applied.
 */
export async function checkBenchmarkGate(): Promise<void> {
  proposalCountSinceLastRun++;

  if (proposalCountSinceLastRun >= RUN_INTERVAL) {
    proposalCountSinceLastRun = 0;
    
    const result = await runExternalBenchmark();

    if (baselineScore === null) {
      // First run establishes baseline
      baselineScore = result.score;
      log.info(`Established external benchmark baseline: ${baselineScore.toFixed(2)}`);
      return;
    }

    // Check for regression. Allow a small margin of error (e.g., 1 problem failing randomly).
    // In this tiny 3-problem subset, any drop is significant, but in a 100-problem set we'd use a threshold.
    if (result.score < baselineScore) {
      log.error(`🚨 External benchmark regression detected! Dropped from ${baselineScore.toFixed(2)} to ${result.score.toFixed(2)}.`);
      log.error(`This indicates the last ${RUN_INTERVAL} RSI modifications overfit internal metrics and degraded general capability.`);
      
      log.info("Triggering automatic rollback to last healthy state...");
      await rollbackToLastHealthy();
      
      // We do NOT update the baseline here, as we rolled back.
      // Next run will compare against the original baseline.
    } else {
      log.info(`External benchmark passed (Score: ${result.score.toFixed(2)}, Baseline: ${baselineScore.toFixed(2)}). Capability maintained or improved.`);
      // Update baseline to the new high-water mark if it improved
      if (result.score > baselineScore) {
         log.info(`New benchmark high-water mark: ${result.score.toFixed(2)}`);
         baselineScore = result.score;
      }
    }
  }
}

/**
 * Forces a baseline reset (useful for testing).
 */
export function resetBenchmarkBaseline(): void {
    baselineScore = null;
    proposalCountSinceLastRun = 0;
}
