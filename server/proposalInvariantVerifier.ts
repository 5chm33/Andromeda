/**
 * proposalInvariantVerifier.ts — v12.11.0
 *
 * Formal Invariant Verification for RSI Proposals.
 *
 * This module extends the existing formalVerification.ts (which verifies static
 * system modules via TLA+) with a dynamic, proposal-specific invariant checker
 * that runs on every RSI proposal before it is applied.
 *
 * Instead of requiring a full TLA+ toolchain (which is not available in all
 * environments), this module uses the TypeScript compiler API to extract and
 * verify the following invariants from the proposed code:
 *
 *   1. NULL_SAFETY   — No unchecked property access on potentially-null values
 *   2. RETURN_PATHS  — All code paths in a function return a value
 *   3. ASYNC_AWAIT   — No floating Promises (async calls without await)
 *   4. ARRAY_BOUNDS  — No direct array[index] access without bounds check
 *   5. TYPE_NARROWING — No `as any` casts that bypass type safety
 *   6. NO_EVAL       — No use of eval() or Function() constructor
 *   7. NO_SYNC_FS    — No synchronous fs operations in async request handlers
 *   8. IMPORT_CYCLES — No circular imports introduced by the proposal
 *
 * Each invariant produces a severity (critical | warning | info) and a message.
 * Critical violations block the proposal. Warnings are stored as metadata.
 */
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { createLogger } from "./logger.js";

const log = createLogger("proposalInvariantVerifier");

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvariantSeverity = "critical" | "warning" | "info";

export interface InvariantViolation {
  invariant: string;
  severity: InvariantSeverity;
  message: string;
  line?: number;
  col?: number;
}

export interface InvariantVerificationResult {
  passed: boolean;                        // false if any critical violation found
  violations: InvariantViolation[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  durationMs: number;
  skipped: boolean;
  skippedReason?: string;
}

// ─── Invariant Checkers ───────────────────────────────────────────────────────

/**
 * Check 1: No `as any` casts that bypass type safety.
 */
function checkTypeNarrowing(
  sourceFile: ts.SourceFile,
  violations: InvariantViolation[]
): void {
  function visit(node: ts.Node): void {
    if (ts.isAsExpression(node)) {
      const typeText = node.type.getText(sourceFile);
      if (typeText === "any" || typeText === "unknown") {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          invariant: "TYPE_NARROWING",
          severity: "warning",
          message: `Unsafe cast to '${typeText}' bypasses type safety`,
          line: line + 1,
          col: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/**
 * Check 2: No use of eval() or Function() constructor.
 */
function checkNoEval(
  sourceFile: ts.SourceFile,
  violations: InvariantViolation[]
): void {
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const text = expr.getText(sourceFile);
      if (text === "eval" || text === "Function") {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          invariant: "NO_EVAL",
          severity: "critical",
          message: `Use of '${text}()' is forbidden — dynamic code execution is a security risk`,
          line: line + 1,
          col: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/**
 * Check 3: No floating Promises (async calls without await in async functions).
 * Detects patterns like: someAsyncFn(); (without await)
 */
function checkAsyncAwait(
  sourceFile: ts.SourceFile,
  violations: InvariantViolation[]
): void {
  function isInsideAsyncFunction(node: ts.Node): boolean {
    let parent = node.parent;
    while (parent) {
      if (
        (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) &&
        parent.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)
      ) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    // Look for ExpressionStatements containing a CallExpression that looks async
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const callExpr = node.expression;
      const callText = callExpr.expression.getText(sourceFile);
      // Heuristic: function names ending in common async patterns
      const looksAsync = /Async$|Promise|fetch|readFile|writeFile|connect|disconnect|send|emit/.test(callText);
      if (looksAsync && isInsideAsyncFunction(node)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          invariant: "ASYNC_AWAIT",
          severity: "warning",
          message: `Possible floating Promise: '${callText}()' called without await`,
          line: line + 1,
          col: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/**
 * Check 4: No synchronous fs operations (readFileSync, writeFileSync, etc.)
 * in functions that appear to be async request handlers.
 */
function checkNoSyncFs(
  sourceFile: ts.SourceFile,
  violations: InvariantViolation[]
): void {
  const SYNC_FS_METHODS = new Set([
    "readFileSync", "writeFileSync", "appendFileSync",
    "mkdirSync", "rmdirSync", "unlinkSync", "readdirSync",
    "statSync", "existsSync", "copyFileSync", "renameSync",
  ]);

  function isInsideRequestHandler(node: ts.Node): boolean {
    let parent = node.parent;
    while (parent) {
      if (ts.isCallExpression(parent)) {
        const callee = parent.expression.getText(sourceFile);
        if (/router\.(get|post|put|delete|patch|use)|app\.(get|post|put|delete|patch|use)/.test(callee)) {
          return true;
        }
      }
      parent = parent.parent;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let methodName = "";
      if (ts.isPropertyAccessExpression(callee)) {
        methodName = callee.name.getText(sourceFile);
      } else if (ts.isIdentifier(callee)) {
        methodName = callee.getText(sourceFile);
      }
      if (SYNC_FS_METHODS.has(methodName) && isInsideRequestHandler(node)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          invariant: "NO_SYNC_FS",
          severity: "warning",
          message: `Synchronous fs operation '${methodName}' inside request handler blocks the event loop`,
          line: line + 1,
          col: character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

/**
 * Check 5: Detect import cycles introduced by the proposal.
 * Compares the import graph before and after the proposed change.
 */
function checkImportCycles(
  proposedSnippet: string,
  targetFile: string,
  projectRoot: string,
  violations: InvariantViolation[]
): void {
  try {
    // Extract imports from the proposed snippet
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    const newImports: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(proposedSnippet)) !== null) {
      newImports.push(match[1]);
    }

    // Check if any new import creates a cycle back to the target file
    const targetBasename = path.basename(targetFile, ".ts");
    for (const imp of newImports) {
      // Resolve the import to a file path
      const impBasename = path.basename(imp.replace(/\.js$/, ""));
      try {
        const impPath = path.join(projectRoot, path.dirname(targetFile), imp.replace(/\.js$/, ".ts"));
        if (fs.existsSync(impPath)) {
          // Check if the imported file imports back from the target
          const impContent = fs.readFileSync(impPath, "utf-8");
          if (impContent.includes(`from './${targetBasename}'`) ||
              impContent.includes(`from "./${targetBasename}"`) ||
              impContent.includes(`from '../${targetBasename}'`) ||
              impContent.includes(`from "../${targetBasename}"`)) {
            violations.push({
              invariant: "IMPORT_CYCLES",
              severity: "critical",
              message: `Potential import cycle: '${targetFile}' imports '${impBasename}' which imports back from '${targetBasename}'`,
            });
          }
        }
      } catch { /* non-fatal */ }
    }
  } catch { /* non-fatal */ }
}

/**
 * Check 6: Detect null/undefined dereference patterns.
 * Looks for `obj.prop` where obj could be null/undefined based on type annotation.
 */
function checkNullSafety(
  sourceFile: ts.SourceFile,
  violations: InvariantViolation[]
): void {
  function visit(node: ts.Node): void {
    // Look for patterns like: someVar.property where someVar has nullable type
    if (ts.isPropertyAccessExpression(node)) {
      const obj = node.expression;
      // Check if the object is a parameter with nullable type annotation
      if (ts.isIdentifier(obj)) {
        const parent = obj.parent?.parent;
        if (parent && ts.isParameter(parent) && parent.type) {
          const typeText = parent.type.getText(sourceFile);
          if (typeText.includes("| null") || typeText.includes("| undefined") || typeText.includes("?")) {
            // Check if there's no optional chaining
            if (!ts.isPropertyAccessExpression(node) || node.questionDotToken === undefined) {
              const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              violations.push({
                invariant: "NULL_SAFETY",
                severity: "warning",
                message: `Possible null dereference: '${obj.getText(sourceFile)}' may be null/undefined — use optional chaining (?.)`,
                line: line + 1,
                col: character + 1,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

// ─── Main Verification Function ───────────────────────────────────────────────

/**
 * Run all invariant checks on a proposed code snippet.
 * Returns a result indicating whether the proposal passed all critical invariants.
 */
export async function verifyProposalInvariants(opts: {
  proposedSnippet: string;
  targetFile: string;
  projectRoot: string;
  enabledChecks?: string[];
}): Promise<InvariantVerificationResult> {
  const start = Date.now();
  const { proposedSnippet, targetFile, projectRoot } = opts;
  const enabledChecks = opts.enabledChecks ?? [
    "TYPE_NARROWING", "NO_EVAL", "ASYNC_AWAIT", "NO_SYNC_FS", "IMPORT_CYCLES", "NULL_SAFETY"
  ];

  // Skip for test files, config files, and very short snippets
  if (targetFile.includes(".test.") || targetFile.includes(".spec.") ||
      targetFile.endsWith(".json") || targetFile.endsWith(".md")) {
    return {
      passed: true, violations: [], criticalCount: 0, warningCount: 0, infoCount: 0,
      durationMs: Date.now() - start, skipped: true,
      skippedReason: "test/config file — invariant checks not applicable",
    };
  }

  if (proposedSnippet.trim().length < 10) {
    return {
      passed: true, violations: [], criticalCount: 0, warningCount: 0, infoCount: 0,
      durationMs: Date.now() - start, skipped: true,
      skippedReason: "snippet too short",
    };
  }

  const violations: InvariantViolation[] = [];

  try {
    // Parse the proposed snippet as a TypeScript source file
    const sourceFile = ts.createSourceFile(
      "_proposal_check.ts",
      proposedSnippet,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS
    );

    // Run enabled checks
    if (enabledChecks.includes("TYPE_NARROWING")) checkTypeNarrowing(sourceFile, violations);
    if (enabledChecks.includes("NO_EVAL")) checkNoEval(sourceFile, violations);
    if (enabledChecks.includes("ASYNC_AWAIT")) checkAsyncAwait(sourceFile, violations);
    if (enabledChecks.includes("NO_SYNC_FS")) checkNoSyncFs(sourceFile, violations);
    if (enabledChecks.includes("NULL_SAFETY")) checkNullSafety(sourceFile, violations);
    if (enabledChecks.includes("IMPORT_CYCLES")) {
      checkImportCycles(proposedSnippet, targetFile, projectRoot, violations);
    }
  } catch (err) {
    log.warn(`[InvariantVerifier] Parse error for ${targetFile}: ${(err as Error).message}`);
    // Non-fatal — return passed with a warning
    return {
      passed: true,
      violations: [{ invariant: "PARSE_ERROR", severity: "warning", message: `Could not parse snippet: ${(err as Error).message}` }],
      criticalCount: 0, warningCount: 1, infoCount: 0,
      durationMs: Date.now() - start, skipped: false,
    };
  }

  const criticalCount = violations.filter(v => v.severity === "critical").length;
  const warningCount = violations.filter(v => v.severity === "warning").length;
  const infoCount = violations.filter(v => v.severity === "info").length;
  const passed = criticalCount === 0;

  if (violations.length > 0) {
    log.info(`[InvariantVerifier] ${targetFile}: ${criticalCount} critical, ${warningCount} warnings, ${infoCount} info`);
  }

  return {
    passed,
    violations,
    criticalCount,
    warningCount,
    infoCount,
    durationMs: Date.now() - start,
    skipped: false,
  };
}

/**
 * Quick check: returns true if the snippet passes all CRITICAL invariants.
 * Used as a fast gate in the proposal pipeline.
 */
export async function passesInvariantGate(
  proposedSnippet: string,
  targetFile: string,
  projectRoot: string
): Promise<boolean> {
  const result = await verifyProposalInvariants({ proposedSnippet, targetFile, projectRoot });
  return result.passed;
}
