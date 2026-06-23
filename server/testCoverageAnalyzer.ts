/**
 * testCoverageAnalyzer.ts — Andromeda v5.68
 *
 * Analyzes test coverage across the codebase and auto-generates
 * test stubs for untested modules.
 *
 * Features:
 *  1. Maps test files to source files (convention: foo.ts → foo.test.ts)
 *  2. Identifies modules with no test coverage
 *  3. Computes a coverage score per module based on export coverage
 *  4. Auto-generates test skeletons for untested exports
 *  5. Runs after every self-modification to ensure coverage doesn't regress
 *
 * Runs every 2 hours or on-demand after self-modification.
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdirSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CoverageReport {
  timestamp: number;
  totalModules: number;
  testedModules: number;
  untestedModules: number;
  coveragePercent: number;
  moduleDetails: ModuleCoverage[];
  generatedTests: GeneratedTest[];
}

export interface ModuleCoverage {
  filePath: string;
  fileName: string;
  hasTestFile: boolean;
  testFilePath?: string;
  exportedFunctions: string[];
  testedFunctions: string[];
  untestedFunctions: string[];
  coveragePercent: number;
}

export interface GeneratedTest {
  testFilePath: string;
  sourceFilePath: string;
  functions: string[];
  content: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const ANALYZE_INTERVAL_MS = parseInt(process.env.TEST_COVERAGE_INTERVAL || "7200000", 10); // 2 hours
const SERVER_DIR = path.join(process.cwd(), "server");
const REPORT_PATH = path.join(process.cwd(), ".data", "test_coverage.json");

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastReport: CoverageReport | null = null;

// ─── Analysis Functions ─────────────────────────────────────────────────────

function getSourceFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getSourceFiles(fullPath));
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  } catch { /* skip */ }
  return files;
}

function extractExports(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf8");
    const exports: string[] = [];

    // Match exported functions
    const funcMatches = content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g);
    for (const match of funcMatches) exports.push(match[1]);

    // Match exported const/let (arrow functions or values)
    const constMatches = content.matchAll(/export\s+(?:const|let)\s+(\w+)/g);
    for (const match of constMatches) exports.push(match[1]);

    // Match exported classes
    const classMatches = content.matchAll(/export\s+class\s+(\w+)/g);
    for (const match of classMatches) exports.push(match[1]);

    // Match default export
    if (content.includes("export default")) exports.push("default");

    return [...new Set(exports)];
  } catch { return []; }
}

function findTestedFunctions(testFilePath: string): string[] {
  try {
    const content = readFileSync(testFilePath, "utf8");
    const tested: string[] = [];

    // Match describe/it/test blocks that reference function names
    const matches = content.matchAll(/(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)["'`]/g);
    for (const match of matches) {
      // Extract function name from test description
      const desc = match[1];
      const funcMatch = desc.match(/(\w+)/);
      if (funcMatch) tested.push(funcMatch[1]);
    }

    // Match direct imports (these are likely tested)
    const importMatches = content.matchAll(/import\s*\{([^}]+)\}/g);
    for (const match of importMatches) {
      const imports = match[1].split(",").map((s: string) => s.trim().split(" as ")[0].trim());
      tested.push(...imports);
    }

    return [...new Set(tested)];
  } catch { return []; }
}

function analyzeModule(filePath: string): ModuleCoverage {
  const fileName = path.basename(filePath);
  const testFilePath = filePath.replace(/\.ts$/, ".test.ts");
  const hasTestFile = existsSync(testFilePath);

  const exportedFunctions = extractExports(filePath);
  const testedFunctions = hasTestFile ? findTestedFunctions(testFilePath) : [];

  // Cross-reference: which exports are actually tested?
  const tested = exportedFunctions.filter(f => testedFunctions.includes(f));
  const untested = exportedFunctions.filter(f => !testedFunctions.includes(f));

  const coveragePercent = exportedFunctions.length > 0
    ? Math.round((tested.length / exportedFunctions.length) * 100)
    : (hasTestFile ? 50 : 0); // Give partial credit if test file exists

  return {
    filePath: path.relative(process.cwd(), filePath),
    fileName,
    hasTestFile,
    testFilePath: hasTestFile ? path.relative(process.cwd(), testFilePath) : undefined,
    exportedFunctions,
    testedFunctions: tested,
    untestedFunctions: untested,
    coveragePercent,
  };
}

function generateTestSkeleton(module: ModuleCoverage): GeneratedTest | null {
  if (module.untestedFunctions.length === 0) return null;

  const relativePath = module.filePath.replace(/\.ts$/, "");
  const importPath = `./${path.basename(relativePath)}`;

  const testContent = [
    `/**`,
    ` * Auto-generated test skeleton for ${module.fileName}`,
    ` * Generated by TestCoverageAnalyzer — Andromeda v5.68`,
    ` * TODO: Implement actual test logic for each function`,
    ` */`,
    ``,
    `import { ${module.untestedFunctions.join(", ")} } from "${importPath}";`,
    `import { describe, it, expect } from "vitest";`,
    ``,
    `describe("${module.fileName}", () => {`,
    ...module.untestedFunctions.map(fn => [
      `  describe("${fn}", () => {`,
      `    it("should be defined", () => {`,
      `      expect(${fn}).toBeDefined();`,
      `    });`,
      ``,
      `    it.todo("should handle normal input correctly");`,
      `    it.todo("should handle edge cases");`,
      `    it.todo("should handle errors gracefully");`,
      `  });`,
      ``,
    ].join("\n")),
    `});`,
    ``,
  ].join("\n");

  return {
    testFilePath: module.filePath.replace(/\.ts$/, ".test.ts"),
    sourceFilePath: module.filePath,
    functions: module.untestedFunctions,
    content: testContent,
  };
}

// ─── Full Analysis ──────────────────────────────────────────────────────────

export function runCoverageAnalysis(autoGenerateTests: boolean = false): CoverageReport {
  console.log("[TestCoverageAnalyzer] Running coverage analysis...");

  const files = getSourceFiles(SERVER_DIR);
  const moduleDetails: ModuleCoverage[] = [];
  const generatedTests: GeneratedTest[] = [];

  for (const file of files) {
    try {
      const coverage = analyzeModule(file);
      moduleDetails.push(coverage);

      // Auto-generate test skeletons for untested modules
      if (autoGenerateTests && coverage.coveragePercent === 0 && coverage.exportedFunctions.length > 0) {
        const skeleton = generateTestSkeleton(coverage);
        if (skeleton) {
          generatedTests.push(skeleton);
          // Write the test file
          const testPath = path.join(process.cwd(), skeleton.testFilePath);
          if (!existsSync(testPath)) {
            try { writeFileSync(testPath, skeleton.content); } catch { /* skip */ }
          }
        }
      }
    } catch { /* skip */ }
  }

  const testedModules = moduleDetails.filter(m => m.hasTestFile).length;
  const untestedModules = moduleDetails.filter(m => !m.hasTestFile).length;
  const coveragePercent = moduleDetails.length > 0
    ? Math.round(moduleDetails.reduce((sum, m) => sum + m.coveragePercent, 0) / moduleDetails.length)
    : 0;

  const report: CoverageReport = {
    timestamp: Date.now(),
    totalModules: moduleDetails.length,
    testedModules,
    untestedModules,
    coveragePercent,
    moduleDetails: moduleDetails.sort((a, b) => a.coveragePercent - b.coveragePercent),
    generatedTests,
  };

  // Save report
  try {
    const dir = path.dirname(REPORT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch { /* non-fatal */ }

  _lastReport = report;
  console.log(`[TestCoverageAnalyzer] Coverage: ${coveragePercent}% (${testedModules}/${moduleDetails.length} modules tested)`);

  return report;
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

export function startTestCoverageAnalyzer(): void {
  if (_running) return;
  _running = true;

  // Run initial analysis after 15 seconds
  setTimeout(() => {
    try { runCoverageAnalysis(false); } catch (err) { console.warn("[TestCoverageAnalyzer] Initial analysis failed:", err); }
  }, 15_000);

  _intervalId = setInterval(() => {
    try { runCoverageAnalysis(false); } catch (err) { console.warn("[TestCoverageAnalyzer] Analysis failed:", err); }
  }, ANALYZE_INTERVAL_MS);

  console.log(`[TestCoverageAnalyzer] Started — analyzing every ${ANALYZE_INTERVAL_MS / 3600000} hours`);
}

export function stopTestCoverageAnalyzer(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
}

export function getLastCoverageReport(): CoverageReport | null {
  if (_lastReport) return _lastReport;
  try {
    if (existsSync(REPORT_PATH)) {
      return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function isRunning(): boolean {
  return _running;
}
