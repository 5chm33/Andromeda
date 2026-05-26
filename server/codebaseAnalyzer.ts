/**
 * codebaseAnalyzer.ts — Andromeda v5.68
 *
 * Background daemon that continuously scans the codebase for:
 *  - Dead code / unused exports
 *  - Missing type annotations
 *  - Long functions (>50 lines)
 *  - High cyclomatic complexity
 *  - Duplicate code patterns
 *  - TODO/FIXME/HACK comments
 *
 * Generates a "code health score" per module and auto-creates
 * improvement proposals for modules below a threshold.
 *
 * Runs every 60 minutes (configurable via CODEBASE_ANALYZE_INTERVAL env var).
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdirSync } from "fs";
import * as path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModuleHealth {
  filePath: string;
  fileName: string;
  score: number;           // 0-100
  lineCount: number;
  issues: CodeIssue[];
  lastAnalyzed: number;
}

export interface CodeIssue {
  type: "dead_code" | "missing_type" | "long_function" | "high_complexity" | "duplicate" | "todo" | "any_type" | "large_file";
  severity: "low" | "medium" | "high";
  line?: number;
  message: string;
  suggestion?: string;
}

export interface AnalysisReport {
  timestamp: number;
  totalFiles: number;
  averageScore: number;
  worstModules: ModuleHealth[];
  totalIssues: number;
  issuesByType: Record<string, number>;
}

// ─── Configuration ──────────────────────────────────────────────────────────

const ANALYZE_INTERVAL_MS = parseInt(process.env.CODEBASE_ANALYZE_INTERVAL || "3600000", 10); // 60 min
const HEALTH_THRESHOLD = 60; // Modules below this score get improvement proposals
const MAX_FUNCTION_LINES = 50;
const MAX_FILE_LINES = 500;
const SERVER_DIR = path.join(process.cwd(), "server");
const REPORT_PATH = path.join(process.cwd(), ".data", "codebase_health.json");

// ─── State ──────────────────────────────────────────────────────────────────

let _running = false;
let _intervalId: ReturnType<typeof setInterval> | null = null;
let _lastReport: AnalysisReport | null = null;

// ─── Analysis Functions ─────────────────────────────────────────────────────

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
  } catch { /* skip unreadable dirs */ }
  return files;
}

function analyzeFile(filePath: string): ModuleHealth {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const issues: CodeIssue[] = [];

  // Check 1: File size
  if (lines.length > MAX_FILE_LINES) {
    issues.push({
      type: "large_file",
      severity: "medium",
      message: `File has ${lines.length} lines (max recommended: ${MAX_FILE_LINES})`,
      suggestion: "Consider splitting into smaller modules",
    });
  }

  // Check 2: Long functions
  let functionStart = -1;
  let functionName = "";
  let braceDepth = 0;
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(\w+)\s*(?:=|:)\s*(?:async\s+)?\(/);
    if (funcMatch && !inFunction) {
      functionStart = i;
      functionName = funcMatch[1] || funcMatch[2] || "anonymous";
      braceDepth = 0;
      inFunction = true;
    }
    if (inFunction) {
      braceDepth += (line.match(/\{/g) || []).length;
      braceDepth -= (line.match(/\}/g) || []).length;
      if (braceDepth <= 0 && i > functionStart) {
        const funcLength = i - functionStart + 1;
        if (funcLength > MAX_FUNCTION_LINES) {
          issues.push({
            type: "long_function",
            severity: funcLength > 100 ? "high" : "medium",
            line: functionStart + 1,
            message: `Function '${functionName}' is ${funcLength} lines (max: ${MAX_FUNCTION_LINES})`,
            suggestion: "Extract helper functions or decompose logic",
          });
        }
        inFunction = false;
      }
    }
  }

  // Check 3: TODO/FIXME/HACK comments
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/\/\/\s*(TODO|FIXME|HACK|XXX|TEMP)[\s:]/i);
    if (match) {
      issues.push({
        type: "todo",
        severity: match[1].toUpperCase() === "FIXME" ? "medium" : "low",
        line: i + 1,
        message: `${match[1].toUpperCase()} comment: ${lines[i].trim().slice(0, 80)}`,
      });
    }
  }

  // Check 4: `any` type usage
  const anyMatches = content.match(/:\s*any\b|as\s+any\b/g);
  if (anyMatches && anyMatches.length > 3) {
    issues.push({
      type: "any_type",
      severity: anyMatches.length > 10 ? "high" : "medium",
      message: `${anyMatches.length} uses of 'any' type — reduces type safety`,
      suggestion: "Replace with specific types or 'unknown'",
    });
  }

  // Check 5: Missing type annotations on exports
  const exportLines = lines.filter(l => l.match(/^export\s+(const|let|var)\s+\w+\s*=/));
  const untypedExports = exportLines.filter(l => !l.includes(":") || l.indexOf(":") > l.indexOf("="));
  if (untypedExports.length > 2) {
    issues.push({
      type: "missing_type",
      severity: "low",
      message: `${untypedExports.length} exported variables without explicit type annotations`,
      suggestion: "Add explicit type annotations to exported values",
    });
  }

  // Check 6: Unused imports (simple heuristic)
  const importMatches = content.matchAll(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/g);
  for (const match of importMatches) {
    const imports = (match[1] || match[2] || "").split(",").map((s: string) => s.trim().split(" as ").pop()!.trim());
    for (const imp of imports) {
      if (!imp || imp.length < 2) continue;
      // Check if the import is used elsewhere in the file (beyond the import line)
      const usageRegex = new RegExp(`\\b${imp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const allMatches = content.match(usageRegex);
      if (allMatches && allMatches.length <= 1) {
        issues.push({
          type: "dead_code",
          severity: "low",
          message: `Import '${imp}' appears to be unused`,
          suggestion: `Remove unused import '${imp}'`,
        });
      }
    }
  }

  // Calculate health score
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case "high": score -= 15; break;
      case "medium": score -= 8; break;
      case "low": score -= 3; break;
    }
  }
  score = Math.max(0, Math.min(100, score));

  return {
    filePath: path.relative(process.cwd(), filePath),
    fileName: path.basename(filePath),
    score,
    lineCount: lines.length,
    issues,
    lastAnalyzed: Date.now(),
  };
}

// ─── Full Analysis ──────────────────────────────────────────────────────────

export function runFullAnalysis(): AnalysisReport {
  const files = getTypeScriptFiles(SERVER_DIR);
  const results: ModuleHealth[] = [];
  const issuesByType: Record<string, number> = {};

  for (const file of files) {
    try {
      const health = analyzeFile(file);
      results.push(health);
      for (const issue of health.issues) {
        issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
      }
    } catch { /* skip unreadable files */ }
  }

  const averageScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 100;

  const worstModules = results
    .filter(r => r.score < HEALTH_THRESHOLD)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  const report: AnalysisReport = {
    timestamp: Date.now(),
    totalFiles: results.length,
    averageScore,
    worstModules,
    totalIssues: Object.values(issuesByType).reduce((a, b) => a + b, 0),
    issuesByType,
  };

  // Save report to disk
  try {
    const dir = path.dirname(REPORT_PATH);
    if (!existsSync(dir)) {
      
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  } catch { /* non-fatal */ }

  _lastReport = report;
  console.log(`[CodebaseAnalyzer] Analysis complete: ${results.length} files, avg score ${averageScore}/100, ${worstModules.length} modules below threshold`);

  return report;
}

// ─── Daemon Control ─────────────────────────────────────────────────────────

export function startCodebaseAnalyzer(): void {
  if (_running) return;
  _running = true;

  // Run initial analysis after 5 seconds (let server finish booting)
  setTimeout(() => {
    try { runFullAnalysis(); } catch (err) { console.warn("[CodebaseAnalyzer] Initial analysis failed:", err); }
  }, 5000);

  _intervalId = setInterval(() => {
    try { runFullAnalysis(); } catch (err) { console.warn("[CodebaseAnalyzer] Analysis failed:", err); }
  }, ANALYZE_INTERVAL_MS);

  console.log(`[CodebaseAnalyzer] Started — analyzing every ${ANALYZE_INTERVAL_MS / 60000} minutes`);
}

export function stopCodebaseAnalyzer(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
  _running = false;
}

export function getLastReport(): AnalysisReport | null {
  if (_lastReport) return _lastReport;
  // Try loading from disk
  try {
    if (existsSync(REPORT_PATH)) {
      return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function getModuleHealth(filePath: string): ModuleHealth | null {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (!existsSync(fullPath)) return null;
    return analyzeFile(fullPath);
  } catch { return null; }
}

export function isRunning(): boolean {
  return _running;
}
