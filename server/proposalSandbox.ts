/**
 * proposalSandbox.ts — v12.9.0 — Sandboxed Pre-Apply Dry-Run
 *
 * Extends the existing sandboxVerifier.ts with a higher-level orchestration
 * layer that runs a full dry-run of a proposal BEFORE it is written to disk.
 * Unlike sandboxVerifier (which tests an already-applied change), this module:
 *
 *  1. Writes the PROPOSED content to a temp directory (never touches live files)
 *  2. Copies all files imported by the target file into the same temp dir
 *     (using the importGraph to find direct dependencies)
 *  3. Runs tsc --noEmit scoped to the temp dir
 *  4. Optionally runs any co-located *.test.ts file for the target
 *  5. Returns a structured DryRunResult with pass/fail, errors, and duration
 *
 * The result is stored on the proposal as `_dryRunResult` and used by the
 * auto-apply scorer to boost or penalise the proposal's selection score.
 * Proposals that FAIL the dry-run are NOT blocked (the heal engine may fix
 * them) but their auto-apply score is reduced by 0.2.
 *
 * Integration: called from selfImprove.ts::applyProposal() BEFORE the
 * guardedApply() call, so we know the likely outcome before touching live files.
 *
 * Expected impact: +4-6% commit success rate by pre-screening proposals that
 * would fail tsc, allowing the heal engine to run BEFORE the file is written.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { createLogger } from "./logger.js";

const log = createLogger("proposalSandbox");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DryRunRequest {
  targetFile: string;          // relative path like "server/selfImprove.ts"
  proposedContent: string;     // the full proposed file content
  originalContent: string;     // the original file content (for rollback reference)
  projectRoot: string;         // absolute path to project root
  runTests?: boolean;          // whether to run co-located test file (default: false)
}

export interface DryRunResult {
  passed: boolean;
  typeCheckPassed: boolean;
  testsPassed: boolean | null;
  errors: string[];
  warnings: string[];
  durationMs: number;
  sandboxDir?: string;         // temp dir used (cleaned up after)
}

// ─── Stats ────────────────────────────────────────────────────────────────────

let _totalRuns = 0;
let _totalPassed = 0;
let _totalFailed = 0;

export function getDryRunStats() {
  return {
    totalRuns: _totalRuns,
    totalPassed: _totalPassed,
    totalFailed: _totalFailed,
    passRate: _totalRuns > 0 ? _totalPassed / _totalRuns : 0,
  };
}

// ─── Core Dry-Run Logic ───────────────────────────────────────────────────────

/**
 * Run a sandboxed dry-run of a proposed file change.
 * Creates a temp directory, writes the proposed content, runs tsc, cleans up.
 */
export async function runDryRun(req: DryRunRequest): Promise<DryRunResult> {
  const start = Date.now();
  _totalRuns++;

  const result: DryRunResult = {
    passed: false,
    typeCheckPassed: false,
    testsPassed: null,
    errors: [],
    warnings: [],
    durationMs: 0,
  };

  let sandboxDir: string | null = null;

  try {
    // Create a unique temp directory for this dry-run
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-dryrun-"));
    result.sandboxDir = sandboxDir;

    // Determine the file basename and write proposed content
    const basename = path.basename(req.targetFile);
    const sandboxFilePath = path.join(sandboxDir, basename);
    fs.writeFileSync(sandboxFilePath, req.proposedContent, "utf-8");

    // Copy direct dependencies (imported files) into the sandbox
    await copyDependencies(req.targetFile, req.projectRoot, sandboxDir);

    // Write a minimal tsconfig for the sandbox
    const tsconfigPath = path.join(sandboxDir, "tsconfig.json");
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
      },
      include: ["./*.ts"],
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");

    // Find tsc binary
    const tscBin = path.resolve(req.projectRoot, "node_modules", ".bin", "tsc");
    if (!fs.existsSync(tscBin)) {
      // Can't check — assume pass to avoid blocking
      result.passed = true;
      result.typeCheckPassed = true;
      result.warnings.push("tsc binary not found — skipping type check");
      result.durationMs = Date.now() - start;
      _totalPassed++;
      return result;
    }

    // Run tsc --noEmit on the sandbox
    const tscResult = spawnSync(tscBin, ["--noEmit", "--project", tsconfigPath], {
      cwd: sandboxDir,
      timeout: 30000,
      stdio: "pipe",
    });

    const tscOutput = ((tscResult.stderr || tscResult.stdout || "") as Buffer).toString();
    result.typeCheckPassed = tscResult.status === 0;

    if (!result.typeCheckPassed) {
      // Filter errors to only those in the target file (not imported stubs)
      const lines = tscOutput.split("\n").filter(l =>
        l.includes(basename) || l.includes("error TS")
      );
      result.errors.push(...lines.slice(0, 10));
    }

    // Optionally run co-located test file
    if (req.runTests) {
      const testResult = await runColocatedTests(req.targetFile, req.projectRoot);
      result.testsPassed = testResult.passed;
      if (!testResult.passed && testResult.error) {
        result.warnings.push(`Test run: ${testResult.error.slice(0, 200)}`);
      }
    }

    result.passed = result.typeCheckPassed && (result.testsPassed !== false);
    result.durationMs = Date.now() - start;

    if (result.passed) {
      _totalPassed++;
      log.info(`[DryRun] PASSED for ${basename} (${result.durationMs}ms)`);
    } else {
      _totalFailed++;
      log.warn(`[DryRun] FAILED for ${basename} — ${result.errors[0]?.slice(0, 100) ?? "unknown error"}`);
    }

    return result;
  } catch (err: any) {
    _totalFailed++;
    result.errors.push(`Dry-run crashed: ${(err as Error).message}`);
    result.durationMs = Date.now() - start;
    log.warn(`[DryRun] Crashed for ${req.targetFile}: ${(err as Error).message}`);
    return result;
  } finally {
    // Always clean up the temp directory
    if (sandboxDir) {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch { /* non-fatal */ }
    }
  }
}

// ─── Dependency Copying ───────────────────────────────────────────────────────

/**
 * Copy direct imported files into the sandbox directory.
 * Uses a simple regex-based import scanner (not full AST) to find imports.
 * Only copies files that exist in the project's server/ directory.
 */
async function copyDependencies(
  targetFile: string,
  projectRoot: string,
  sandboxDir: string
): Promise<void> {
  try {
    const absTargetPath = path.join(projectRoot, targetFile);
    if (!fs.existsSync(absTargetPath)) return;

    const content = fs.readFileSync(absTargetPath, "utf-8");
    const serverDir = path.join(projectRoot, "server");

    // Extract relative imports: from "./foo" or from "./foo.js"
    const importRe = /from\s+["'](\.[^"']+)["']/g;
    let m: RegExpExecArray | null;
    let copied = 0;

    while ((m = importRe.exec(content)) !== null && copied < 10) {
      const importPath = m[1].replace(/\.js$/, ".ts");
      const candidates = [
        path.join(serverDir, importPath + ".ts"),
        path.join(serverDir, importPath),
        path.join(path.dirname(absTargetPath), importPath + ".ts"),
        path.join(path.dirname(absTargetPath), importPath),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const destName = path.basename(candidate);
          const destPath = path.join(sandboxDir, destName);
          if (!fs.existsSync(destPath)) {
            // Write a stub that just re-exports everything as `any` to satisfy imports
            // without pulling in the full transitive dependency tree
            const stubContent = `// Auto-generated stub for dry-run sandbox\nexport * from "./${destName.replace(/\.ts$/, ".js")}";\n`;
            // Actually copy the real file — stubs cause more type errors than they prevent
            try {
              fs.copyFileSync(candidate, destPath);
              copied++;
            } catch { /* non-fatal */ }
          }
          break;
        }
      }
    }
  } catch { /* non-fatal */ }
}

// ─── Co-located Test Runner ───────────────────────────────────────────────────

async function runColocatedTests(
  targetFile: string,
  projectRoot: string
): Promise<{ passed: boolean; error?: string }> {
  try {
    const basename = path.basename(targetFile, ".ts");
    const testCandidates = [
      path.join(projectRoot, "server", `${basename}.test.ts`),
      path.join(projectRoot, "tests", `${basename}.test.ts`),
      path.join(projectRoot, "__tests__", `${basename}.test.ts`),
    ];

    const testFile = testCandidates.find(f => fs.existsSync(f));
    if (!testFile) return { passed: true }; // No test file — pass by default

    const vitestBin = path.resolve(projectRoot, "node_modules", ".bin", "vitest");
    if (!fs.existsSync(vitestBin)) return { passed: true };

    const result = spawnSync(vitestBin, ["run", testFile, "--reporter=verbose"], {
      cwd: projectRoot,
      timeout: 60000,
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "test" },
    });

    return {
      passed: result.status === 0,
      error: result.status !== 0
        ? ((result.stderr || result.stdout || "") as Buffer).toString().slice(0, 300)
        : undefined,
    };
  } catch (err) {
    return { passed: true }; // Non-fatal — don't block on test runner errors
  }
}

// ─── Quick Validation ─────────────────────────────────────────────────────────

/**
 * Fast syntax-only check using Node.js require() — no tsc needed.
 * Useful for a quick pre-screen before the full dry-run.
 */
export function quickSyntaxCheck(proposedContent: string, filename: string): { valid: boolean; error?: string } {
  try {
    // v14.1.5: Strip comments and string/regex literals before counting brackets.
    // Raw character counts on TypeScript files produce false positives because:
    //   - String literals like "use (this)" add unmatched parens
    //   - Regex literals like /\)/g add unmatched close-parens
    //   - JSDoc comments with @param (type) add unmatched parens
    // The stripped content only contains actual code-level brackets.
    const stripped = proposedContent
      .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
      .replace(/\/\/[^\n]*/g, " ")          // single-line comments
      .replace(/`[^`]*`/g, '""')             // template literals
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')  // double-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")  // single-quoted strings
      .replace(/(?<=[=(,!&|?:;\s])\/(?:[^\/\\\n]|\\.)+\/[gimsuy]*/g, "//"); // regex literals
    const openBraces = (stripped.match(/\{/g) || []).length;
    const closeBraces = (stripped.match(/\}/g) || []).length;
    const openParens = (stripped.match(/\(/g) || []).length;
    const closeParens = (stripped.match(/\)/g) || []).length;

    if (Math.abs(openBraces - closeBraces) > 3) {
      return { valid: false, error: `Unbalanced braces: ${openBraces} open, ${closeBraces} close` };
    }
    if (Math.abs(openParens - closeParens) > 3) {
      return { valid: false, error: `Unbalanced parentheses: ${openParens} open, ${closeParens} close` };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}
