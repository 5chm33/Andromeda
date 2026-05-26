/**
 * codeQualityMonitor.ts — Andromeda v5.68
 *
 * Continuous code quality monitoring daemon that:
 *  1. Computes cyclomatic complexity per function
 *  2. Tracks coupling between modules (import graph density)
 *  3. Monitors code churn (frequency of modifications per file)
 *  4. Triggers refactoring proposals when metrics exceed thresholds
 *  5. Maintains a quality trend over time (improving/degrading)
 *
 * Runs every 4 hours (configurable via CODE_QUALITY_INTERVAL env var).
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdirSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QualityReport {
  timestamp: number;
  overallScore: number;        // 0-100
  totalModules: number;
  complexityMetrics: ComplexityMetric[];
  couplingMetrics: CouplingMetric[];
  refactoringProposals: RefactoringProposal[];
  trend: "improving" | "stable" | "degrading";
}

export interface ComplexityMetric {
  filePath: string;
  functions: FunctionComplexity[];
  averageComplexity: number;
  maxComplexity: number;
  linesOfCode: number;
}

export interface FunctionComplexity {
  name: string;
  line: number;
  complexity: number;  // Cyclomatic complexity
  linesOfCode: number;
  parameters: number;
  nestingDepth: number;
}

export interface CouplingMetric {
  filePath: string;
  imports: string[];       // Files this module imports from
  importedBy: string[];    // Files that import this module
  afferentCoupling: number;  // How many modules depend on this
  efferentCoupling: number;  // How many modules this depends on
  instability: number;       // efferent / (afferent + efferent)
}

export interface RefactoringProposal {
  id: string;
  type: "extract_function" | "split_module" | "reduce_coupling" | "simplify_logic";
  filePath: string;
  functionName?: string;
  severity: "low" | "medium" | "high";
  reason: string;
  suggestion: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const QUALITY_INTERVAL_MS = parseInt(process.env.CODE_QUALITY_INTERVAL || "14400000", 10); // 4 hours
const COMPLEXITY_THRESHOLD = 10;     // Cyclomatic complexity above this triggers proposal
const COUPLING_THRESHOLD = 8;        // More than 8 imports triggers review
const NESTING_THRESHOLD = 4;         // Nesting depth above this triggers proposal
const SERVER_DIR = path.join(process.cwd(), "server");
const REPORT_PATH = path.join(process.cwd(), ".data", "code_quality.json");
const HISTORY_PATH = path.join(process.cwd(), ".data", "quality_history.json");

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastReport: QualityReport | null = null;

// ─── Complexity Analysis ────────────────────────────────────────────────────

function calculateCyclomaticComplexity(functionBody: string): number {
  // Count decision points: if, else if, for, while, do, switch case, &&, ||, ternary ?
  let complexity = 1; // Base complexity

  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bdo\s*\{/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /&&/g,
    /\|\|/g,
    /\?\s*[^:]/g,  // Ternary operator
  ];

  for (const pattern of patterns) {
    const matches = functionBody.match(pattern);
    if (matches) complexity += matches.length;
  }

  return complexity;
}

function extractFunctions(content: string): Array<{ name: string; line: number; body: string; params: number }> {
  const functions: Array<{ name: string; line: number; body: string; params: number }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    const arrowMatch = line.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\w+)?\s*=>/);

    const match = funcMatch || arrowMatch;
    if (!match) continue;

    const name = match[1];
    const params = match[2] ? match[2].split(",").filter(p => p.trim()).length : 0;

    // Extract function body by tracking braces
    let braceDepth = 0;
    let bodyStart = i;
    let bodyEnd = i;
    let foundOpen = false;

    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === "{") { braceDepth++; foundOpen = true; }
        if (ch === "}") braceDepth--;
      }
      if (foundOpen && braceDepth <= 0) {
        bodyEnd = j;
        break;
      }
    }

    const body = lines.slice(bodyStart, bodyEnd + 1).join("\n");
    functions.push({ name, line: i + 1, body, params });
  }

  return functions;
}

function calculateNestingDepth(body: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of body) {
    if (char === "{") {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === "}") {
      currentDepth--;
    }
  }

  return maxDepth - 1; // Subtract 1 for the function's own braces
}

function analyzeComplexity(filePath: string): ComplexityMetric {
  const content = readFileSync(filePath, "utf8");
  const functions = extractFunctions(content);
  const functionMetrics: FunctionComplexity[] = [];

  for (const func of functions) {
    const complexity = calculateCyclomaticComplexity(func.body);
    const nestingDepth = calculateNestingDepth(func.body);
    const linesOfCode = func.body.split("\n").length;

    functionMetrics.push({
      name: func.name,
      line: func.line,
      complexity,
      linesOfCode,
      parameters: func.params,
      nestingDepth,
    });
  }

  const avgComplexity = functionMetrics.length > 0
    ? Math.round((functionMetrics.reduce((sum, f) => sum + f.complexity, 0) / functionMetrics.length) * 10) / 10
    : 0;
  const maxComplexity = functionMetrics.length > 0
    ? Math.max(...functionMetrics.map(f => f.complexity))
    : 0;

  return {
    filePath: path.relative(process.cwd(), filePath),
    functions: functionMetrics,
    averageComplexity: avgComplexity,
    maxComplexity,
    linesOfCode: content.split("\n").length,
  };
}

// ─── Coupling Analysis ──────────────────────────────────────────────────────

function analyzeCoupling(files: string[]): CouplingMetric[] {
  const importGraph: Map<string, Set<string>> = new Map();

  // Build import graph
  for (const file of files) {
    const relPath = path.relative(process.cwd(), file);
    const imports = new Set<string>();

    try {
      const content = readFileSync(file, "utf8");
      const importMatches = content.matchAll(/from\s+["']\.?\/?([^"']+)["']/g);
      for (const match of importMatches) {
        const importedFile = match[1].replace(/\.js$/, ".ts");
        imports.add(importedFile);
      }
    } catch { /* skip */ }

    importGraph.set(relPath, imports);
  }

  // Calculate coupling metrics
  const metrics: CouplingMetric[] = [];
  for (const [filePath, imports] of importGraph.entries()) {
    const importedBy: string[] = [];
    for (const [otherFile, otherImports] of importGraph.entries()) {
      if (otherFile === filePath) continue;
      const baseName = path.basename(filePath, ".ts");
      if ([...otherImports].some(i => i.includes(baseName))) {
        importedBy.push(otherFile);
      }
    }

    const afferent = importedBy.length;
    const efferent = imports.size;
    const instability = (afferent + efferent) > 0 ? efferent / (afferent + efferent) : 0;

    metrics.push({
      filePath,
      imports: [...imports],
      importedBy,
      afferentCoupling: afferent,
      efferentCoupling: efferent,
      instability: Math.round(instability * 100) / 100,
    });
  }

  return metrics;
}

// ─── Refactoring Proposals ──────────────────────────────────────────────────

function generateProposals(
  complexityMetrics: ComplexityMetric[],
  couplingMetrics: CouplingMetric[]
): RefactoringProposal[] {
  const proposals: RefactoringProposal[] = [];

  // High complexity functions
  for (const module of complexityMetrics) {
    for (const func of module.functions) {
      if (func.complexity > COMPLEXITY_THRESHOLD) {
        proposals.push({
          id: `refactor_${module.filePath}_${func.name}_${Date.now()}`,
          type: func.complexity > 15 ? "split_module" : "extract_function",
          filePath: module.filePath,
          functionName: func.name,
          severity: func.complexity > 20 ? "high" : "medium",
          reason: `Cyclomatic complexity of ${func.complexity} exceeds threshold of ${COMPLEXITY_THRESHOLD}`,
          suggestion: `Extract sub-routines from '${func.name}' to reduce decision paths`,
        });
      }
      if (func.nestingDepth > NESTING_THRESHOLD) {
        proposals.push({
          id: `nesting_${module.filePath}_${func.name}_${Date.now()}`,
          type: "simplify_logic",
          filePath: module.filePath,
          functionName: func.name,
          severity: func.nestingDepth > 6 ? "high" : "medium",
          reason: `Nesting depth of ${func.nestingDepth} exceeds threshold of ${NESTING_THRESHOLD}`,
          suggestion: `Use early returns, guard clauses, or extract nested logic into helper functions`,
        });
      }
    }
  }

  // High coupling modules
  for (const module of couplingMetrics) {
    if (module.efferentCoupling > COUPLING_THRESHOLD) {
      proposals.push({
        id: `coupling_${module.filePath}_${Date.now()}`,
        type: "reduce_coupling",
        filePath: module.filePath,
        severity: module.efferentCoupling > 12 ? "high" : "medium",
        reason: `Module imports from ${module.efferentCoupling} other modules (threshold: ${COUPLING_THRESHOLD})`,
        suggestion: `Consider dependency injection or splitting this module into focused sub-modules`,
      });
    }
  }

  return proposals;
}

// ─── Trend Analysis ─────────────────────────────────────────────────────────

function calculateTrend(currentScore: number): "improving" | "stable" | "degrading" {
  try {
    if (existsSync(HISTORY_PATH)) {
      const history: Array<{ timestamp: number; score: number }> = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
      if (history.length >= 3) {
        const recent = history.slice(-3);
        const avgRecent = recent.reduce((s, h) => s + h.score, 0) / recent.length;
        if (currentScore > avgRecent + 3) return "improving";
        if (currentScore < avgRecent - 3) return "degrading";
        return "stable";
      }
    }
  } catch { /* ignore */ }
  return "stable";
}

function recordHistory(score: number): void {
  try {
    let history: Array<{ timestamp: number; score: number }> = [];
    if (existsSync(HISTORY_PATH)) {
      history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
    }
    history.push({ timestamp: Date.now(), score });
    if (history.length > 100) history = history.slice(-100);
    const dir = path.dirname(HISTORY_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  } catch { /* non-fatal */ }
}

// ─── Full Analysis ──────────────────────────────────────────────────────────

function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getTypeScriptFiles(fullPath));
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  } catch { /* skip */ }
  return files;
}

export function runQualityAnalysis(): QualityReport {
  console.log("[CodeQualityMonitor] Running quality analysis...");

  const files = getTypeScriptFiles(SERVER_DIR);
  const complexityMetrics: ComplexityMetric[] = [];

  for (const file of files) {
    try {
      complexityMetrics.push(analyzeComplexity(file));
    } catch { /* skip */ }
  }

  const couplingMetrics = analyzeCoupling(files);
  const proposals = generateProposals(complexityMetrics, couplingMetrics);

  // Calculate overall score (v6.01 — weighted average, not flat penalties)
  // Complexity score: what % of files are within threshold?
  const totalFiles = complexityMetrics.length || 1;
  const filesAboveThreshold = complexityMetrics.filter(m => m.maxComplexity > COMPLEXITY_THRESHOLD).length;
  const filesAbove20 = complexityMetrics.filter(m => m.maxComplexity > 20).length;
  const complexityRatio = 1 - (filesAboveThreshold / totalFiles);
  const severityPenalty = Math.min(15, filesAbove20 * 3); // cap severity penalty at 15
  const complexityScore = Math.round(complexityRatio * 50) - severityPenalty; // 0-50 range

  // Coupling score: what % of modules are within threshold?
  const totalModules = couplingMetrics.length || 1;
  const modulesAboveCoupling = couplingMetrics.filter(m => m.efferentCoupling > COUPLING_THRESHOLD).length;
  const couplingRatio = 1 - (modulesAboveCoupling / totalModules);
  const couplingScore = Math.round(couplingRatio * 30); // 0-30 range

  // Base score: 20 points for having a working codebase with analysis
  let score = 20 + complexityScore + couplingScore;
  score = Math.max(0, Math.min(100, score));

  const trend = calculateTrend(score);
  recordHistory(score);

  const report: QualityReport = {
    timestamp: Date.now(),
    overallScore: score,
    totalModules: files.length,
    complexityMetrics,
    couplingMetrics,
    refactoringProposals: proposals,
    trend,
  };

  // Save report
  try {
    const dir = path.dirname(REPORT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch { /* non-fatal */ }

  _lastReport = report;
  console.log(`[CodeQualityMonitor] Score: ${score}/100, trend: ${trend}, ${proposals.length} refactoring proposals`);

  return report;
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

export function startCodeQualityMonitor(): void {
  if (_running) return;
  _running = true;

  setTimeout(() => {
    try { runQualityAnalysis(); } catch (err) { console.warn("[CodeQualityMonitor] Initial run failed:", err); }
  }, 20_000);

  _intervalId = setInterval(() => {
    try { runQualityAnalysis(); } catch (err) { console.warn("[CodeQualityMonitor] Run failed:", err); }
  }, QUALITY_INTERVAL_MS);

  console.log(`[CodeQualityMonitor] Started — analyzing every ${QUALITY_INTERVAL_MS / 3600000} hours`);
}

export function stopCodeQualityMonitor(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
}

export function getLastQualityReport(): QualityReport | null {
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
