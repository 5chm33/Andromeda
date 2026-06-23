/**
 * selfIntrospect.ts — Self-Awareness & Introspection Module
 * v5.23: Allows Andromeda to analyze its own architecture, find dead code,
 * detect circular dependencies, and generate optimization suggestions.
 *
 * Uses regex-based static analysis (no external AST parser dependency needed).
 */

import * as fs from "fs";
import * as path from "path";
// Simple logger (no external dependency)
function log(level: string, module: string, message: string): void {
  const prefix = `[${module}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModuleInfo {
  filePath: string;
  exports: string[];
  imports: Array<{ from: string; names: string[] }>;
  functions: string[];
  lineCount: number;
  complexity: number; // Rough cyclomatic complexity estimate
  sizeBytes: number;
}

export interface ArchitectureReport {
  totalModules: number;
  totalLines: number;
  totalFunctions: number;
  modules: ModuleInfo[];
  dependencies: Array<{ from: string; to: string }>;
  circularDependencies: string[][];
  orphanedExports: Array<{ file: string; export: string }>;
  largestModules: Array<{ file: string; lines: number }>;
  mostImported: Array<{ file: string; importedBy: number }>;
  suggestions: Suggestion[];
  healthScore: number;
}

export interface Suggestion {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  file?: string;
  description: string;
  effort: number; // 1-10
  impact: number; // 1-10
}

// ─── Configuration ───────────────────────────────────────────────────────────

const SERVER_DIR = path.join(process.cwd(), "server");
const CLIENT_DIR = path.join(process.cwd(), "client", "src");
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  /dist\//,
  /\.test\./,
  /\.spec\./,
];

// ─── Core Analysis Functions ─────────────────────────────────────────────────

/**
 * Scan a directory for TypeScript files.
 */
function scanDirectory(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) {
    log("warn", "selfIntrospect", `Directory not found: ${dir}`);
    return files;
  }

  function walk(currentDir: string): void {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (IGNORE_PATTERNS.some(p => p.test(fullPath))) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      log("error", "selfIntrospect", `Failed to read directory ${currentDir}: ${error}`);
    }
  }

  walk(dir);
  return files;
}

/**
 * Parse a TypeScript file for exports, imports, and functions.
 */
function analyzeModule(filePath: string): ModuleInfo {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    log("error", "selfIntrospect", `Failed to read file ${filePath}: ${error}`);
    return {
      filePath,
      exports: [],
      imports: [],
      functions: [],
      lineCount: 0,
      complexity: 0,
      sizeBytes: 0,
    };
  }
  const lines = content.split("\n");

  // Extract exports
  const exports: string[] = [];
  const exportRegex = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  // Also catch `export default`
  if (/export\s+default/.test(content)) {
    exports.push("default");
  }

  // Extract imports
  const imports: Array<{ from: string; names: string[] }> = [];
  const importRegex = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+["']([^"']+)["']/g;
  while ((match = importRegex.exec(content)) !== null) {
    const names = match[1]
      ? match[1].split(",").map(n => n.trim().split(" as ")[0].trim())
      : [match[2]];
    imports.push({ from: match[3], names });
  }
  // Dynamic imports
  const dynImportRegex = /(?:await\s+)?import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynImportRegex.exec(content)) !== null) {
    imports.push({ from: match[1], names: ["*dynamic*"] });
  }

  // Extract function names
  const functions: string[] = [];
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  while ((match = funcRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }
  // Arrow function assignments
  const arrowRegex = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    functions.push(match[1]);
  }

  // Estimate complexity (branches, loops, ternaries)
  const complexityIndicators = [
    /\bif\s*\(/g,
    /\belse\b/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bswitch\s*\(/g,
    /\bcase\b/g,
    /\?\s*[^:]+\s*:/g, // ternary
    /\bcatch\s*\(/g,
  ];
  let complexity = 1; // Base complexity
  for (const pattern of complexityIndicators) {
    const matches = content.match(pattern);
    if (matches) complexity += matches.length;
  }

  return {
    filePath,
    exports,
    imports,
    functions,
    lineCount: lines.length,
    complexity,
    sizeBytes: Buffer.byteLength(content),
  };
}

/**
 * Find circular dependencies in the module graph.
 */
function findCircularDeps(modules: ModuleInfo[]): string[][] {
  const graph = new Map<string, Set<string>>();

  // Build adjacency list
  for (const mod of modules) {
    const key = mod.filePath;
    if (!graph.has(key)) graph.set(key, new Set());

    for (const imp of mod.imports) {
      // Resolve relative imports, including dynamic ones
      if (imp.from.startsWith(".") || imp.names.includes("*dynamic*")) {
        const resolved = resolveImport(mod.filePath, imp.from);
        if (resolved) {
          graph.get(key)!.add(resolved);
        }
      }
    }
  }

  // DFS cycle detection
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart >= 0) {
        cycles.push(path.slice(cycleStart).map(p => getRelativePath(p)));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || new Set();
    for (const neighbor of Array.from(neighbors)) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, path);
      }
    }

    inStack.delete(node);
    path.pop();
  }

  for (const node of Array.from(graph.keys())) {
    dfs(node, []);
  }

  // Deduplicate cycles
  const seen = new Set<string>();
  return cycles.filter(cycle => {
    const key = [...cycle].sort().join("→");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Find exports that are never imported by any other module.
 */
function findOrphanedExports(modules: ModuleInfo[]): Array<{ file: string; export: string }> {
  // Collect all imported names per source file
  const importedNames = new Map<string, Set<string>>();

  for (const mod of modules) {
    for (const imp of mod.imports) {
      if (imp.from.startsWith(".")) {
        const resolved = resolveImport(mod.filePath, imp.from);
        if (resolved) {
          if (!importedNames.has(resolved)) importedNames.set(resolved, new Set());
          for (const name of imp.names) {
            importedNames.get(resolved)!.add(name);
          }
        }
      }
    }
  }

  const orphans: Array<{ file: string; export: string }> = [];
  for (const mod of modules) {
    const imported = importedNames.get(mod.filePath) || new Set();
    // If the module has dynamic imports pointing to it, skip
    if (imported.has("*dynamic*")) continue;

    for (const exp of mod.exports) {
      if (exp === "default") continue; // Skip default exports (often entry points)
      if (!imported.has(exp) && !imported.has("*dynamic*")) {
        orphans.push({ file: getRelativePath(mod.filePath), export: exp });
      }
    }
  }

  return orphans;
}

/**
 * Generate optimization suggestions based on analysis.
 */
function generateSuggestions(
  modules: ModuleInfo[],
  circularDeps: string[][],
  orphans: Array<{ file: string; export: string }>
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Large file suggestions
  for (const mod of modules) {
    if (mod.lineCount > 1000) {
      suggestions.push({
        title: `Split large module: ${getRelativePath(mod.filePath)}`,
        severity: mod.lineCount > 2000 ? "high" : "medium",
        file: getRelativePath(mod.filePath),
        description: `${mod.lineCount} lines with ${mod.functions.length} functions. Consider splitting into smaller, focused modules.`,
        effort: 6,
        impact: 7,
      });
    }
  }

  // High complexity suggestions
  for (const mod of modules) {
    if (mod.complexity > 50) {
      suggestions.push({
        title: `Reduce complexity: ${getRelativePath(mod.filePath)}`,
        severity: mod.complexity > 100 ? "high" : "medium",
        file: getRelativePath(mod.filePath),
        description: `Cyclomatic complexity estimate: ${mod.complexity}. Extract helper functions and simplify branching.`,
        effort: 5,
        impact: 6,
      });
    }
  }

  // Circular dependency suggestions
  for (const cycle of circularDeps) {
    suggestions.push({
      title: `Break circular dependency: ${cycle.join(" → ")}`,
      severity: "high",
      description: `Circular import chain detected. Extract shared types/interfaces into a separate module.`,
      effort: 4,
      impact: 8,
    });
  }

  // Orphaned exports (potential dead code)
  if (orphans.length > 10) {
    suggestions.push({
      title: `Remove dead code: ${orphans.length} unused exports`,
      severity: "low",
      description: `${orphans.length} exported functions/constants are never imported. Consider removing or marking as internal.`,
      effort: 2,
      impact: 3,
    });
  }

  // Sort by impact * (11 - effort) descending
  suggestions.sort((a, b) => (b.impact * (11 - b.effort)) - (a.impact * (11 - a.effort)));

  return suggestions;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

function resolveImport(fromFile: string, importPath: string): string | null {
  const dir = path.dirname(fromFile);
  const extensions = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"];

  // Remove .js extension if present (TypeScript convention)
  const cleanPath = importPath.replace(/\.js$/, "");

  for (const ext of extensions) {
    const candidate = path.resolve(dir, cleanPath + ext);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try without extension (might be exact match)
  const exact = path.resolve(dir, cleanPath);
  if (fs.existsSync(exact)) return exact;

  return null;
}

function getRelativePath(absPath: string): string {
  return path.relative(process.cwd(), absPath);
}

function calculateHealthScore(
  modules: ModuleInfo[],
  circularDeps: string[][],
  orphans: Array<{ file: string; export: string }>,
  suggestions: Suggestion[]
): number {
  let score = 100;

  // Deduct for circular dependencies
  score -= circularDeps.length * 5;

  // Deduct for very large modules
  const largeModules = modules.filter(m => m.lineCount > 1000);
  score -= largeModules.length * 3;

  // Deduct for high complexity
  const complexModules = modules.filter(m => m.complexity > 50);
  score -= complexModules.length * 2;

  // Deduct for critical suggestions
  const criticalCount = suggestions.filter(s => s.severity === "critical").length;
  score -= criticalCount * 10;

  // Deduct for high-severity suggestions
  const highCount = suggestions.filter(s => s.severity === "high").length;
  score -= highCount * 3;

  return Math.max(0, Math.min(100, score));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run full introspection on the Andromeda codebase.
 */
export async function introspectSelf(): Promise<ArchitectureReport> {
  log("info", "selfIntrospect", "Starting self-introspection...");

  // Scan all TypeScript files
  const serverFiles = scanDirectory(SERVER_DIR);
  const clientFiles = scanDirectory(CLIENT_DIR);
  const allFiles = [...serverFiles, ...clientFiles];

  // Analyze each module
  const modules = allFiles.map(f => analyzeModule(f));

  // Find circular dependencies
  const circularDeps = findCircularDeps(modules);

  // Find orphaned exports
  const orphans = findOrphanedExports(modules);

  // Generate suggestions
  const suggestions = generateSuggestions(modules, circularDeps, orphans);

  // Calculate health score
  const healthScore = calculateHealthScore(modules, circularDeps, orphans, suggestions);

  // Build dependency edges
  const dependencies: Array<{ from: string; to: string }> = [];
  for (const mod of modules) {
    for (const imp of mod.imports) {
      if (imp.from.startsWith(".")) {
        const resolved = resolveImport(mod.filePath, imp.from);
        if (resolved) {
          dependencies.push({
            from: getRelativePath(mod.filePath),
            to: getRelativePath(resolved),
          });
        }
      }
    }
  }

  // Find most imported files
  const importCounts = new Map<string, number>();
  for (const dep of dependencies) {
    importCounts.set(dep.to, (importCounts.get(dep.to) || 0) + 1);
  }
  const mostImported = Array.from(importCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, importedBy: count }));

  // Find largest modules
  const largestModules = [...modules]
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 10)
    .map(m => ({ file: getRelativePath(m.filePath), lines: m.lineCount }));

  const report: ArchitectureReport = {
    totalModules: modules.length,
    totalLines: modules.reduce((sum, m) => sum + m.lineCount, 0),
    totalFunctions: modules.reduce((sum, m) => sum + m.functions.length, 0),
    modules,
    dependencies,
    circularDependencies: circularDeps,
    orphanedExports: orphans.slice(0, 50), // Limit for readability
    largestModules,
    mostImported,
    suggestions,
    healthScore,
  };

  log("info", "selfIntrospect", `Introspection complete: ${report.totalModules} modules, ${report.totalLines} lines, health: ${report.healthScore}/100`);

  return report;
}

/**
 * Get a quick summary without full analysis (faster).
 */
export function getQuickStats(): {
  serverModules: number;
  clientModules: number;
  totalLines: number;
  largestFile: { path: string; lines: number };
} {
  const serverFiles = scanDirectory(SERVER_DIR);
  const clientFiles = scanDirectory(CLIENT_DIR);

  let totalLines = 0;
  let largestFile = { path: "", lines: 0 };

  for (const f of [...serverFiles, ...clientFiles]) {
    try {
      const lines = fs.readFileSync(f, "utf-8").split("\n").length;
      totalLines += lines;
      if (lines > largestFile.lines) {
        largestFile = { path: getRelativePath(f), lines };
      }
    } catch (error) {
      log("error", "selfIntrospect", `Failed to read file for quick stats ${f}: ${error}`);
    }
  }

  return {
    serverModules: serverFiles.length,
    clientModules: clientFiles.length,
    totalLines,
    largestFile,
  };
}

// ─── Initialization ──────────────────────────────────────────────────────────

export function initSelfIntrospect(): void {
  const stats = getQuickStats();
  log("info", "selfIntrospect", `[SelfIntrospect] Initialized. ${stats.serverModules + stats.clientModules} modules, ${stats.totalLines} lines`);
}

// v5.26: Alias for diagnostics endpoint
export const getIntrospectionStats = getQuickStats;
