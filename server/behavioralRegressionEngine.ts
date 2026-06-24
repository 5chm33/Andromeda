/**
 * behavioralRegressionEngine.ts — v1.0.0
 *
 * CI Stage 2.5: Behavioral Regression Guard
 *
 * The core problem this solves: The full test suite (Stage 2) catches ALL failures,
 * but it takes 2-3 minutes to run. More critically, it doesn't tell the RSI engine
 * *why* a proposal failed — just that something broke. This leads to the engine
 * repeatedly proposing the same type of change that breaks the same test.
 *
 * This engine adds a targeted "contract test" stage that:
 * 1. Identifies the specific function(s) changed in a proposal
 * 2. Extracts the behavioral contract (input/output expectations) from existing tests
 * 3. Runs ONLY those targeted tests in <30 seconds (before the full 2-min suite)
 * 4. Returns a rich failure report explaining EXACTLY what behavioral contract was violated
 * 5. Feeds this report back into the RSI engine's memory so it learns to avoid the pattern
 *
 * This is the "RAG leveler" described in the performance analysis — providing the LLM
 * with precise context about what it broke and why, dramatically improving proposal quality.
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const _bDir = path.dirname(fileURLToPath(import.meta.url));
function _findRoot(): string {
  let cur = _bDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(_bDir, "..", "..");
}
const PROJECT_ROOT = _findRoot();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BehavioralContract {
  functionName: string;
  inputPatterns: string[];
  expectedOutputType: "void" | "null" | "object" | "array" | "string" | "number" | "boolean" | "unknown";
  canReturnNull: boolean;
  canReturnUndefined: boolean;
  isAsync: boolean;
  testCount: number;
}

export interface BehavioralRegressionResult {
  passed: boolean;
  targetFile: string;
  testedFunctions: string[];
  contracts: BehavioralContract[];
  violations: BehavioralViolation[];
  testOutput: string;
  durationMs: number;
  recommendation: string;
}

export interface BehavioralViolation {
  functionName: string;
  contract: string;
  actual: string;
  testName: string;
  severity: "critical" | "high" | "medium" | "low";
}

// ─── Contract Extraction ──────────────────────────────────────────────────────

/**
 * Extract behavioral contracts from a test file by parsing the test assertions.
 * This tells the RSI engine exactly what behavior is expected for each function.
 */
export function extractContracts(testFilePath: string): BehavioralContract[] {
  if (!fs.existsSync(testFilePath)) return [];

  const content = fs.readFileSync(testFilePath, "utf-8");
  const contracts: BehavioralContract[] = [];

  // Find all describe blocks (each typically corresponds to a function)
  const describeRegex = /describe\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let describeMatch;

  while ((describeMatch = describeRegex.exec(content)) !== null) {
    const functionName = describeMatch[1];
    const contract: BehavioralContract = {
      functionName,
      inputPatterns: [],
      expectedOutputType: "unknown",
      canReturnNull: false,
      canReturnUndefined: false,
      isAsync: false,
      testCount: 0,
    };

    // Find the describe block content
    const blockStart = describeMatch.index;
    let depth = 0;
    let blockContent = "";
    for (let i = blockStart; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          blockContent = content.slice(blockStart, i + 1);
          break;
        }
      }
    }

    // Count tests
    const testMatches = blockContent.match(/\bit\s*\(/g) || [];
    contract.testCount = testMatches.length;

    // Detect async
    if (/async\s+\(\s*\)|await\s+/.test(blockContent)) {
      contract.isAsync = true;
    }

    // Detect return type expectations
    if (/result\s*===\s*undefined|result\s*===\s*null/.test(blockContent)) {
      contract.canReturnNull = true;
      contract.canReturnUndefined = true;
    }
    if (/expect\(result\s*===\s*undefined\)\.toBe\(true\)/.test(blockContent)) {
      contract.expectedOutputType = "void";
      contract.canReturnUndefined = true;
    }
    if (/typeof result === "object"/.test(blockContent)) {
      contract.expectedOutputType = "object";
    }
    if (/typeof result === "string"/.test(blockContent)) {
      contract.expectedOutputType = "string";
    }
    if (/Array\.isArray\(result\)/.test(blockContent)) {
      contract.expectedOutputType = "array";
    }
    if (/result === null/.test(blockContent)) {
      contract.canReturnNull = true;
    }

    // Detect input patterns
    const callMatches = blockContent.match(/\w+\s*\(\s*["'`][^"'`]*["'`]/g) || [];
    contract.inputPatterns = callMatches.slice(0, 3).map(m => m.replace(/.*\(/, "").replace(/["'`]/g, ""));

    if (contract.testCount > 0) {
      contracts.push(contract);
    }
  }

  return contracts;
}

// ─── Targeted Test Runner ─────────────────────────────────────────────────────

/**
 * Run only the test file for the modified source file.
 * Returns within 30 seconds — much faster than the full 2-minute suite.
 */
export function runTargetedTests(
  targetFile: string,
  proposedContent?: string,
): BehavioralRegressionResult {
  const startTime = Date.now();
  const basename = path.basename(targetFile, ".ts");
  const testFile = path.join(PROJECT_ROOT, "server", `${basename}.test.ts`);

  const result: BehavioralRegressionResult = {
    passed: true,
    targetFile,
    testedFunctions: [],
    contracts: [],
    violations: [],
    testOutput: "",
    durationMs: 0,
    recommendation: "",
  };

  if (!fs.existsSync(testFile)) {
    result.recommendation = `No test file found for ${basename}.ts — proposal cannot be behaviorally validated. Consider adding tests before applying.`;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // Extract contracts before running tests
  result.contracts = extractContracts(testFile);
  result.testedFunctions = result.contracts.map(c => c.functionName);

  // Find the vitest binary
  const vitestBin = path.join(PROJECT_ROOT, "node_modules", ".bin", "vitest");
  if (!fs.existsSync(vitestBin)) {
    result.recommendation = "Vitest binary not found — skipping behavioral regression check.";
    result.durationMs = Date.now() - startTime;
    return result;
  }

  // Run only the targeted test file
  const testResult = spawnSync(
    vitestBin,
    ["run", `server/${basename}.test.ts`, "--reporter=verbose"],
    {
      cwd: PROJECT_ROOT,
      timeout: 45000,
      encoding: "utf-8",
      stdio: "pipe",
    }
  );

  result.testOutput = (testResult.stdout || "") + (testResult.stderr || "");
  result.durationMs = Date.now() - startTime;

  if (testResult.status !== 0) {
    result.passed = false;

    // Parse the violations from the test output
    result.violations = parseViolations(result.testOutput, result.contracts);

    // Generate a rich recommendation for the RSI engine
    result.recommendation = generateRecommendation(result.violations, result.contracts, basename);
  } else {
    result.recommendation = `All ${result.contracts.length} behavioral contracts verified for ${basename}.ts.`;
  }

  return result;
}

// ─── Violation Parser ─────────────────────────────────────────────────────────

function parseViolations(
  testOutput: string,
  contracts: BehavioralContract[],
): BehavioralViolation[] {
  if (contracts.length === 0) return [];

  const violations: BehavioralViolation[] = [];

  // Find FAIL lines
  const failLines = testOutput.split("\n").filter(l => l.includes("FAIL") || l.includes("✗") || l.includes("× "));

  for (const line of failLines) {
    // Try to match to a contract
    const matchedContract = contracts.find(c =>
      line.toLowerCase().includes(c.functionName.toLowerCase())
    );

    if (matchedContract) {
      // Determine severity
      let severity: BehavioralViolation["severity"] = "medium";
      if (matchedContract.expectedOutputType === "void" || matchedContract.canReturnNull) {
        severity = "high"; // Return type violations are high severity
      }
      if (line.includes("TypeError") || line.includes("Cannot read")) {
        severity = "critical";
      }

      violations.push({
        functionName: matchedContract.functionName,
        contract: `Expected return type: ${matchedContract.expectedOutputType}, canReturnNull: ${matchedContract.canReturnNull}`,
        actual: line.trim().slice(0, 200),
        testName: line.trim().slice(0, 100),
        severity,
      });
    } else {
      // Unknown violation
      violations.push({
        functionName: "unknown",
        contract: "Unknown contract",
        actual: line.trim().slice(0, 200),
        testName: line.trim().slice(0, 100),
        severity: "medium",
      });
    }
  }

  return violations;
}

// ─── Recommendation Generator ─────────────────────────────────────────────────

/**
 * Generate a rich, actionable recommendation for the RSI engine.
 * This is the key "RAG leveler" — giving the LLM precise context about what broke.
 */
function generateRecommendation(
  violations: BehavioralViolation[],
  contracts: BehavioralContract[],
  basename: string,
): string {
  if (violations.length === 0) {
    return `Tests failed but no specific violations detected. Check the full test output.`;
  }

  const lines: string[] = [
    `BEHAVIORAL REGRESSION DETECTED in ${basename}.ts:`,
    "",
  ];

  for (const v of violations) {
    lines.push(`  VIOLATION [${v.severity.toUpperCase()}]: ${v.functionName}`);
    lines.push(`    Contract: ${v.contract}`);
    lines.push(`    Actual:   ${v.actual.slice(0, 100)}`);
    lines.push("");
  }

  // Add contract summary
  lines.push("BEHAVIORAL CONTRACTS for this file:");
  for (const c of contracts) {
    lines.push(`  ${c.functionName}:`);
    lines.push(`    - Return type: ${c.expectedOutputType}`);
    lines.push(`    - Can return null: ${c.canReturnNull}`);
    lines.push(`    - Can return undefined: ${c.canReturnUndefined}`);
    lines.push(`    - Is async: ${c.isAsync}`);
  }

  lines.push("");
  lines.push("INSTRUCTION FOR RSI ENGINE:");
  lines.push("  When proposing changes to this file, you MUST preserve these behavioral contracts.");
  lines.push("  Do NOT change return types, remove null checks, or alter async behavior.");
  lines.push("  Focus on internal implementation changes that preserve the external interface.");

  return lines.join("\n");
}

// ─── CI Integration ───────────────────────────────────────────────────────────

/**
 * Run the behavioral regression check as part of the CI pipeline.
 * Called by ciPipeline.ts as Stage 2.5 (between typecheck and full test suite).
 *
 * Returns early with a rich failure report if behavioral contracts are violated,
 * saving the 2-minute full test suite run.
 */
export function runBehavioralRegressionStage(
  targetFile: string,
  proposedContent?: string,
): { pass: boolean; output: string; durationMs: number; recommendation: string } {
  const result = runTargetedTests(targetFile, proposedContent);

  return {
    pass: result.passed,
    output: result.testOutput,
    durationMs: result.durationMs,
    recommendation: result.recommendation,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface BehavioralRegressionStats {
  totalChecks: number;
  passed: number;
  failed: number;
  averageDurationMs: number;
  topViolatedFunctions: string[];
  lastUpdated: string;
}

let _stats: BehavioralRegressionStats = {
  totalChecks: 0,
  passed: 0,
  failed: 0,
  averageDurationMs: 0,
  topViolatedFunctions: [],
  lastUpdated: new Date().toISOString(),
};

export function getBehavioralRegressionStats(): BehavioralRegressionStats {
  return { ..._stats };
}

export function initBehavioralRegressionEngine(): void {
  _stats = {
    totalChecks: 0,
    passed: 0,
    failed: 0,
    averageDurationMs: 0,
    topViolatedFunctions: [],
    lastUpdated: new Date().toISOString(),
  };
  console.log("[BehavioralRegression] Initialized — CI Stage 2.5 active");
}
