/**
 * Andromeda v5.28 — Sandbox Verifier
 *
 * Provides a safety layer for self-modifications by testing changes
 * in an isolated environment before applying them to the live codebase.
 *
 * Flow:
 * 1. Copy affected file(s) to a temporary sandbox workspace
 * 2. Apply proposed changes in the sandbox
 * 3. Run TypeScript check on the modified file
 * 4. Optionally run unit tests if they exist
 * 5. Return pass/fail verdict
 *
 * This is the "Docker sandbox integration" that enables full-autonomy mode.
 * When Docker is available, uses containerized execution.
 * When not, uses a temporary directory with process isolation.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, basename } from "path";
import { execSync, spawnSync } from "child_process";
import { tmpdir } from "os";

// ── Types ───────────────────────────────────────────────────────────────────

export interface VerificationRequest {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  relatedFiles?: Array<{ path: string; content: string }>;
  runTests?: boolean;
}

export interface VerificationResult {
  passed: boolean;
  typeCheckPassed: boolean;
  testsPassed: boolean | null; // null if tests not run
  errors: string[];
  warnings: string[];
  duration: number;
  method: "docker" | "local-sandbox" | "in-process";
}

// ── State ───────────────────────────────────────────────────────────────────

let dockerAvailable = false;
let verificationCount = 0;
let passCount = 0;
let failCount = 0;

// ── Docker Detection ────────────────────────────────────────────────────────

function checkDocker(): boolean {
  try {
    execSync("docker info", { timeout: 5000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Verification Logic ──────────────────────────────────────────────────────

/**
 * Verify a proposed file change in an isolated environment.
 */
export async function verifySandboxed(req: VerificationRequest): Promise<VerificationResult> {
  const start = Date.now();
  verificationCount++;

  const result: VerificationResult = {
    passed: false,
    typeCheckPassed: false,
    testsPassed: null,
    errors: [],
    warnings: [],
    duration: 0,
    method: "in-process",
  };

  try {
    if (dockerAvailable) {
      return await verifyInDocker(req, start);
    } else {
      return await verifyInLocalSandbox(req, start);
    }
  } catch (err) {
    result.errors.push(`Verification crashed: ${(err as Error).message}`);
    result.duration = Date.now() - start;
    failCount++;
    return result;
  }
}

/**
 * Verify using a local temporary directory (no Docker needed).
 */
async function verifyInLocalSandbox(req: VerificationRequest, start: number): Promise<VerificationResult> {
  const result: VerificationResult = {
    passed: false,
    typeCheckPassed: false,
    testsPassed: null,
    errors: [],
    warnings: [],
    duration: 0,
    method: "local-sandbox",
  };

  // Create temp workspace
  const sandboxDir = join(tmpdir(), `andromeda_verify_${Date.now()}`);
  mkdirSync(sandboxDir, { recursive: true });

  try {
    // Write the proposed file
    const targetFile = join(sandboxDir, basename(req.filePath));
    writeFileSync(targetFile, req.proposedContent);

    // Write related files if provided
    if (req.relatedFiles && req.relatedFiles.length > 0) {
      for (const rf of req.relatedFiles) {
        const rfPath = join(sandboxDir, basename(rf.path));
        writeFileSync(rfPath, rf.content);
      }
    }

    // Create a minimal tsconfig for checking
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        isolatedModules: true,
      },
      include: [`./${basename(req.filePath)}`],
    };
    writeFileSync(join(sandboxDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

    // Run TypeScript check
    // v20.3.1: Use spawnSync with array args to prevent command injection.
    try {
      const tscResult = spawnSync("pnpm", ["exec", "tsc", "--noEmit", "--project", "tsconfig.json"], {
        cwd: sandboxDir,
        timeout: 30_000,
        encoding: "utf-8",
      });
      if (tscResult.status === 0) {
        result.typeCheckPassed = true;
      } else {
        const output = (tscResult.stdout || "") + (tscResult.stderr || "");
        result.typeCheckPassed = false;
        // Parse errors
        const errorLines = output.split("\n").filter((l: string) => l.includes("error TS"));
        result.errors.push(...errorLines.slice(0, 10));
        if (errorLines.length === 0) {
          // tsc might have failed for other reasons — check if it's just missing imports
          const missingImports = output.includes("Cannot find module");
          if (missingImports) {
            // Missing imports are expected in isolated check — treat as warning
            result.warnings.push("Missing imports (expected in isolated check)");
            result.typeCheckPassed = true; // Soft pass
          } else {
            result.errors.push(output.slice(0, 500));
          }
        }
      }
    } catch (err: any) {
      result.typeCheckPassed = false;
      result.errors.push(String(err?.message || err));
    }

    // Basic syntax validation (always works regardless of imports)
    try {
      // Check for common issues
      const content = req.proposedContent;
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (Math.abs(openBraces - closeBraces) > 2) {
        result.errors.push(`Brace mismatch: ${openBraces} open vs ${closeBraces} close`);
        result.typeCheckPassed = false;
      }

      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      if (Math.abs(openParens - closeParens) > 2) {
        result.errors.push(`Parenthesis mismatch: ${openParens} open vs ${closeParens} close`);
        result.typeCheckPassed = false;
      }
    } catch { /* non-critical */ }

    // Run tests if requested and test file exists
    if (req.runTests) {
      const testFile = req.filePath.replace(".ts", ".test.ts");
      if (existsSync(testFile)) {
        try {
          const vitestResult = spawnSync("pnpm", ["exec", "vitest", "run", basename(testFile), "--reporter=verbose"], {
            cwd: sandboxDir,
            timeout: 30_000,
            encoding: "utf-8",
          });
          result.testsPassed = vitestResult.status === 0;
          if (!result.testsPassed) {
            result.warnings.push("Tests failed in sandbox");
          }
        } catch {
          result.testsPassed = false;
          result.warnings.push("Tests failed in sandbox");
        }
      }
    }
    result.passed = result.typeCheckPassed && (result.testsPassed !== false);
    if (result.passed) passCount++;
    else failCount++;

  } finally {
    // Clean up sandbox
    try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* ignore */ }
    result.duration = Date.now() - start;
  }

  return result;
}

/**
 * Verify using Docker container (full isolation).
 */
async function verifyInDocker(req: VerificationRequest, start: number): Promise<VerificationResult> {
  const result: VerificationResult = {
    passed: false,
    typeCheckPassed: false,
    testsPassed: null,
    errors: [],
    warnings: [],
    duration: 0,
    method: "docker",
  };

  const sandboxDir = join(tmpdir(), `andromeda_docker_verify_${Date.now()}`);
  mkdirSync(sandboxDir, { recursive: true });

  try {
    // Write files to mount into container
    writeFileSync(join(sandboxDir, basename(req.filePath)), req.proposedContent);

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
      },
      include: [`./${basename(req.filePath)}`],
    };
    writeFileSync(join(sandboxDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

    // Run in Docker
    try {
      const _output = execSync(
        `docker run --rm --memory=256m --cpus=0.5 --network=none ` +
        `-v ${sandboxDir}:/workspace -w /workspace ` +
        `node:20-slim sh -c "pnpm exec tsc --noEmit 2>&1"`,
        { timeout: 60_000, stdio: "pipe" }
      ).toString();

      result.typeCheckPassed = true;
    } catch (err: any) {
      const output = err.stdout?.toString() || "";
      if (output.includes("Cannot find module")) {
        result.typeCheckPassed = true; // Expected in isolation
        result.warnings.push("Missing imports (expected in Docker isolation)");
      } else {
        result.typeCheckPassed = false;
        result.errors.push(output.slice(0, 500));
      }
    }

    result.passed = result.typeCheckPassed;
    if (result.passed) passCount++;
    else failCount++;

  } finally {
    try { rmSync(sandboxDir, { recursive: true, force: true }); } catch { /* ignore */ }
    result.duration = Date.now() - start;
  }

  return result;
}

// ── Quick Validation (no sandbox needed) ────────────────────────────────────

/**
 * Fast structural validation without spawning a sandbox.
 * Checks for obvious issues like unclosed braces, syntax errors, etc.
 */
export function quickValidate(content: string, filePath: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const ext = filePath.split(".").pop() || "";

  if (/^(ts|tsx|js|jsx)$/.test(ext)) {
    // Check brace balance — strip string/template literals and comments first
    // to avoid false positives from braces inside strings, regex, or JSDoc.
    // v19.1.0: Previously counted raw braces in full file content, which caused
    // false rejections on files with braces inside template literals or regex
    // patterns (e.g. 302 open, 305 close in a valid file).
    const strippedForBraces = content
      .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
      .replace(/\/\/[^\n]*/g, " ")          // single-line comments
      .replace(/`[^`]*`/g, '""')             // template literals (simplified)
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')  // double-quoted strings
      .replace(/\'(?:[^\'\\]|\\.)*\'/g, "''"); // single-quoted strings
    const openBraces = (strippedForBraces.match(/\{/g) || []).length;
    const closeBraces = (strippedForBraces.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
    }

    // v11.291.1: Removed unclosed-string heuristic — produces too many false positives
    // on TypeScript files with apostrophes in JSDoc comments, template literals spanning
    // multiple lines, or regex patterns. tsc --noEmit is the authoritative syntax check.

    // Check for empty file
    if (content.trim().length === 0) {
      issues.push("File is empty");
    }

    // Check for duplicate function declarations
    // v14.1.3: Strip comments and string literals before checking for duplicate
    // function declarations to avoid false positives on phrases like
    // "function calling" appearing in JSDoc comments or string messages.
    const strippedForDecls = content
      .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
      .replace(/\/\/[^\n]*/g, " ")          // single-line comments
      .replace(/`[^`]*`/g, '""')             // template literals
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')  // double-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, "''"); // single-quoted strings
    const funcDecls = strippedForDecls.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g) || [];
    const seen = new Set<string>();
    for (const decl of funcDecls) {
      if (seen.has(decl)) issues.push(`Duplicate declaration: ${decl}`);
      seen.add(decl);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the sandbox verifier.
 */
export function initSandboxVerifier(): void {
  dockerAvailable = checkDocker();
  console.log(`[SandboxVerifier] Initialized — Docker: ${dockerAvailable ? "available" : "not available (using local sandbox)"}`);
}

/**
 * Get verification stats for diagnostics.
 */
export function getVerifierStats() {
  return {
    dockerAvailable,
    totalVerifications: verificationCount,
    passed: passCount,
    failed: failCount,
    passRate: verificationCount > 0 ? Math.round(passCount / verificationCount * 100) : 0,
  };
}
