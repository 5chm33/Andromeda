/**
 * dynamicTestGen.ts — v12.10.0 — Dynamic Test Generation
 *
 * After a proposal is applied and passes TypeScript compilation, this module
 * generates a targeted Vitest unit test specifically for the modified function
 * or logic block, runs it, and reports the result.
 *
 * How it works:
 *  1. Extracts the modified function name(s) from the proposal's originalSnippet
 *     using a lightweight AST parse (TypeScript compiler API).
 *  2. Asks an LLM to write a focused Vitest test that:
 *     - Imports the modified function from the target file
 *     - Tests the happy path with at least 2 input/output pairs
 *     - Tests at least one edge case (null, empty, boundary)
 *  3. Writes the test to a temp file in workspace/_dynamic_tests/
 *  4. Runs `vitest run <testFile>` with a 30s timeout
 *  5. Returns pass/fail + any failure output
 *
 * If the dynamic test fails, the proposal is flagged with _dynamicTestFailed
 * metadata and the failure is recorded in the RLAIF feedback loop.
 * The proposal is NOT automatically rolled back (too aggressive for edge cases
 * where the test itself may be wrong), but the metadata is surfaced in the UI.
 *
 * Expected impact: +3-4% commit success rate by catching logical regressions
 * that pass tsc but produce wrong outputs.
 *
 * Integration: called from selfImprove.ts after tsc passes, before git commit.
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { spawnSync } from "child_process";
import { createLogger } from "./logger.js";

const log = createLogger("dynamicTestGen");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DynamicTestResult {
  ran: boolean;
  passed: boolean;
  testFile?: string;
  failureOutput?: string;
  functionsTested: string[];
  durationMs: number;
  skippedReason?: string;
}

// ─── Function Name Extraction ─────────────────────────────────────────────────

/**
 * Extract exported function/method names from a code snippet using the TS AST.
 */
export function extractFunctionNames(snippet: string): string[] {
  const names: string[] = [];
  try {
    const sourceFile = ts.createSourceFile(
      "_snippet.ts",
      snippet,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)
      ) {
        const name = (node as ts.FunctionDeclaration).name?.getText(sourceFile);
        if (name) names.push(name);
      }
      // Also catch: const myFn = (...) => ...
      if (ts.isVariableDeclaration(node)) {
        const init = node.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const name = node.name.getText(sourceFile);
          if (name) names.push(name);
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  } catch { /* non-fatal */ }

  return [...new Set(names)].filter(n => n.length > 0 && n !== "anonymous");
}

// ─── Test Skipping Heuristics ─────────────────────────────────────────────────

/**
 * Determine if a file is testable (skip UI, config, type-only files).
 */
function isTestableFile(targetFile: string): boolean {
  const skip = [
    /\.css$/, /\.scss$/, /\.svg$/, /\.png$/, /\.json$/,
    /client\//, /\.d\.ts$/, /vitest\.setup/, /index\.ts$/,
    /types\.ts$/, /constants\.ts$/,
  ];
  return !skip.some(p => p.test(targetFile));
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Generate and run a dynamic test for the modified function.
 *
 * @param proposal - The applied proposal
 * @param projectRoot - Absolute path to project root
 * @param simpleChatCompletion - LLM call function
 * @param providerId - Which provider to use for test generation
 */
export async function generateAndRunTest(opts: {
  proposal: {
    id: string;
    targetFile: string;
    originalSnippet: string;
    proposedSnippet: string;
    title: string;
  };
  projectRoot: string;
  simpleChatCompletion: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { maxTokens: number; temperature: number; providerId?: string }
  ) => Promise<string | null>;
  providerId?: string;
}): Promise<DynamicTestResult> {
  const start = Date.now();
  const { proposal, projectRoot, simpleChatCompletion, providerId } = opts;

  // Skip non-testable files
  if (!isTestableFile(proposal.targetFile)) {
    return {
      ran: false,
      passed: true,
      functionsTested: [],
      durationMs: Date.now() - start,
      skippedReason: `Non-testable file type: ${proposal.targetFile}`,
    };
  }

  // Extract function names from the proposed snippet
  const functionNames = extractFunctionNames(proposal.proposedSnippet);
  if (functionNames.length === 0) {
    return {
      ran: false,
      passed: true,
      functionsTested: [],
      durationMs: Date.now() - start,
      skippedReason: "No named functions found in proposed snippet",
    };
  }

  // Read the current file content for context
  let fileContent = "";
  try {
    fileContent = fs.readFileSync(path.join(projectRoot, proposal.targetFile), "utf-8");
  } catch {
    return {
      ran: false,
      passed: true,
      functionsTested: [],
      durationMs: Date.now() - start,
      skippedReason: "Could not read target file",
    };
  }

  // Determine import path (relative from workspace/_dynamic_tests/ to server/)
  const relImportPath = path.relative(
    path.join(projectRoot, "workspace", "_dynamic_tests"),
    path.join(projectRoot, proposal.targetFile.replace(/\.ts$/, ".js"))
  ).replace(/\\/g, "/");

  // Ask LLM to generate the test
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are an expert TypeScript test engineer using Vitest.
Write a focused unit test for the modified function(s). Requirements:
- Use \`import { ${functionNames.join(", ")} } from "${relImportPath}";\`
- Use \`describe\` and \`it\` blocks
- Test at least 2 happy-path cases with concrete inputs/outputs
- Test at least 1 edge case (null, empty string, zero, boundary value)
- Use \`expect(...).toBe(...)\` or \`expect(...).toEqual(...)\`
- Do NOT mock the function itself — test it directly
- Keep the test under 60 lines
Return ONLY the TypeScript test code, no markdown fences.`,
    },
    {
      role: "user",
      content: `File: ${proposal.targetFile}
Functions to test: ${functionNames.join(", ")}

Modified code:
\`\`\`typescript
${proposal.proposedSnippet.slice(0, 1500)}
\`\`\`

File context (first 40 lines):
\`\`\`typescript
${fileContent.split("\n").slice(0, 40).join("\n")}
\`\`\`

Write the Vitest test now.`,
    },
  ];

  let testCode: string | null = null;
  try {
    testCode = await simpleChatCompletion(messages, {
      maxTokens: 1500,
      temperature: 0.1,
      providerId,
    });
  } catch (err) {
    return {
      ran: false,
      passed: true,
      functionsTested: functionNames,
      durationMs: Date.now() - start,
      skippedReason: `LLM call failed: ${(err as Error).message?.slice(0, 100)}`,
    };
  }

  if (!testCode || testCode.trim().length < 50) {
    return {
      ran: false,
      passed: true,
      functionsTested: functionNames,
      durationMs: Date.now() - start,
      skippedReason: "LLM returned empty or too-short test",
    };
  }

  // Clean up any markdown fences the LLM may have added
  testCode = testCode
    .replace(/^```(?:typescript|ts)?\s*/im, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  // Write the test file
  const testDir = path.join(projectRoot, "workspace", "_dynamic_tests");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFileName = `${proposal.id}_${path.basename(proposal.targetFile, ".ts")}_dynamic.test.ts`;
  const testFilePath = path.join(testDir, testFileName);

  try {
    fs.writeFileSync(testFilePath, testCode, "utf-8");
  } catch (err) {
    return {
      ran: false,
      passed: true,
      functionsTested: functionNames,
      durationMs: Date.now() - start,
      skippedReason: `Could not write test file: ${(err as Error).message?.slice(0, 100)}`,
    };
  }

  // Run the test with vitest
  const vitestBin = path.resolve(projectRoot, "node_modules", ".bin", "vitest");
  if (!fs.existsSync(vitestBin)) {
    try { fs.unlinkSync(testFilePath); } catch { /* non-fatal */ }
    return {
      ran: false,
      passed: true,
      functionsTested: functionNames,
      durationMs: Date.now() - start,
      skippedReason: "Vitest binary not found",
    };
  }

  log.info(`[DynamicTestGen] Running dynamic test for ${proposal.targetFile} (functions: ${functionNames.join(", ")})`);

  const testResult = spawnSync(vitestBin, ["run", testFilePath, "--reporter=verbose"], {
    cwd: projectRoot,
    timeout: 30000,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });

  const stdout = testResult.stdout?.toString() ?? "";
  const stderr = testResult.stderr?.toString() ?? "";
  const passed = testResult.status === 0;

  // Clean up test file after run
  try { fs.unlinkSync(testFilePath); } catch { /* non-fatal */ }

  if (!passed) {
    const failureOutput = [stdout, stderr]
      .join("\n")
      .split("\n")
      .filter(l => l.includes("FAIL") || l.includes("Error") || l.includes("expect") || l.includes("✗") || l.includes("×"))
      .slice(0, 20)
      .join("\n");
    log.warn(`[DynamicTestGen] Dynamic test FAILED for ${proposal.targetFile}: ${failureOutput.slice(0, 300)}`);
    return {
      ran: true,
      passed: false,
      testFile: testFilePath,
      failureOutput: failureOutput.slice(0, 500),
      functionsTested: functionNames,
      durationMs: Date.now() - start,
    };
  }

  log.info(`[DynamicTestGen] Dynamic test PASSED for ${proposal.targetFile}`);
  return {
    ran: true,
    passed: true,
    testFile: testFilePath,
    functionsTested: functionNames,
    durationMs: Date.now() - start,
  };
}

// ─── Prune Old Dynamic Test Files ────────────────────────────────────────────

/**
 * Remove any leftover dynamic test files (in case a previous run crashed).
 */
export function pruneOldDynamicTests(projectRoot: string): void {
  const testDir = path.join(projectRoot, "workspace", "_dynamic_tests");
  if (!fs.existsSync(testDir)) return;
  try {
    const files = fs.readdirSync(testDir).filter(f => f.endsWith(".test.ts"));
    for (const f of files) {
      try { fs.unlinkSync(path.join(testDir, f)); } catch { /* non-fatal */ }
    }
  } catch { /* non-fatal */ }
}
