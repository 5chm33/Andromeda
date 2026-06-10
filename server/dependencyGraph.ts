/**
 * dependencyGraph.ts — v5.22
 *
 * Dependency Graph Analysis for Safe Self-Modification.
 *
 * Builds and maintains a dependency graph of all TypeScript modules in the project.
 * Used to:
 * 1. Determine which files are affected by a proposed change
 * 2. Identify which tests need to run after a modification
 * 3. Validate that changes won't break downstream consumers
 * 4. Provide impact analysis before applying self-improvements
 *
 * This is a READ-ONLY analysis module — it never modifies code.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DependencyNode {
  path: string;             // Relative path from project root
  absolutePath: string;
  imports: string[];        // Files this module imports
  importedBy: string[];     // Files that import this module (reverse deps)
  exports: string[];        // Exported symbols
  testFiles: string[];      // Associated test files
  size: number;             // File size in bytes
  lastModified: number;     // Last modification timestamp
  complexity: number;       // Simple complexity metric (line count)
}

export interface ImpactAnalysis {
  targetFile: string;
  directDependents: string[];       // Files that directly import the target
  transitiveDependents: string[];   // All files transitively affected
  affectedTests: string[];          // Test files that should be run
  riskLevel: "low" | "medium" | "high" | "critical";
  riskReason: string;
  totalAffectedFiles: number;
}

export interface GraphStats {
  totalFiles: number;
  totalEdges: number;
  avgDependencies: number;
  mostImported: Array<{ path: string; importedByCount: number }>;
  orphanFiles: string[];    // Files with no imports and no importers
  circularDeps: string[][]; // Groups of files with circular dependencies
}

// ─── State ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In production the built file lives at dist/_core/dependencyGraph.js so
// path.resolve(__dirname, '..') = dist/, not the project root.
// Walk up until we find a directory containing package.json.
function _findDepGraphProjectRoot(): string {
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return path.resolve(__dirname, "..", ".."); // fallback: two levels up
}
const PROJECT_DIR = _findDepGraphProjectRoot();

const graph: Map<string, DependencyNode> = new Map();
let lastBuildTime = 0;
let buildInProgress = false;

// ─── Graph Building ───────────────────────────────────────────────────────────

/**
 * Extract import paths from a TypeScript/JavaScript file.
 */
function extractImports(content: string, filePath: string): string[] {
  const imports: string[] = [];
  const importRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\(['"]([^'"]+)['"]\)/g;
  const requireRegex = /require\(['"]([^'"]+)['"]\)/g;

  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = resolveImportPath(match[1], filePath);
    if (importPath) imports.push(importPath);
  }

  while ((match = dynamicImportRegex.exec(content)) !== null) {
    const importPath = resolveImportPath(match[1], filePath);
    if (importPath) imports.push(importPath);
  }

  while ((match = requireRegex.exec(content)) !== null) {
    const importPath = resolveImportPath(match[1], filePath);
    if (importPath) imports.push(importPath);
  }

  return Array.from(new Set(imports)); // Deduplicate
}

/**
 * Resolve a relative import path to an absolute project-relative path.
 */
function resolveImportPath(importStr: string, fromFile: string): string | null {
  // Skip external packages
  if (!importStr.startsWith(".") && !importStr.startsWith("/")) return null;

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(PROJECT_DIR, fromDir, importStr);

  // Try common extensions
  const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) {
      return path.relative(PROJECT_DIR, candidate);
    }
  }

  // Check if it already has an extension
  if (fs.existsSync(resolved)) {
    return path.relative(PROJECT_DIR, resolved);
  }

  return null;
}

/**
 * Extract exported symbols from a TypeScript file.
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return exports;
}

/**
 * Find test files associated with a source file.
 */
function findTestFiles(filePath: string): string[] {
  const tests: string[] = [];
  const baseName = path.basename(filePath, path.extname(filePath));
  const dir = path.dirname(filePath);

  // Common test file patterns
  const patterns = [
    path.join(dir, `${baseName}.test.ts`),
    path.join(dir, `${baseName}.test.tsx`),
    path.join(dir, `${baseName}.spec.ts`),
    path.join(dir, `${baseName}.spec.tsx`),
    path.join(dir, "__tests__", `${baseName}.test.ts`),
    path.join(dir, "__tests__", `${baseName}.test.tsx`),
  ];

  for (const pattern of patterns) {
    const fullPath = path.resolve(PROJECT_DIR, pattern);
    if (fs.existsSync(fullPath)) {
      tests.push(pattern);
    }
  }

  return tests;
}

/**
 * Recursively find all TypeScript files in the project.
 */
function findAllTsFiles(dir: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip directories we don't want to analyze
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".git", ".vite", "workspace"].includes(entry.name)) continue;
      findAllTsFiles(fullPath, results);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      results.push(path.relative(PROJECT_DIR, fullPath));
    }
  }

  return results;
}

/**
 * Build the complete dependency graph.
 */
export async function buildGraph(): Promise<GraphStats> {
  if (buildInProgress) {
    return getGraphStats();
  }

  buildInProgress = true;
  graph.clear();

  try {
    const files = findAllTsFiles(PROJECT_DIR);

    // First pass: build nodes
    for (const filePath of files) {
      const absolutePath = path.resolve(PROJECT_DIR, filePath);
      const content = fs.readFileSync(absolutePath, "utf-8");
      const stats = fs.statSync(absolutePath);

      const node: DependencyNode = {
        path: filePath,
        absolutePath,
        imports: extractImports(content, filePath),
        importedBy: [], // Filled in second pass
        exports: extractExports(content),
        testFiles: findTestFiles(filePath),
        size: stats.size,
        lastModified: stats.mtimeMs,
        complexity: content.split("\n").length,
      };

      graph.set(filePath, node);
    }

    // Second pass: build reverse dependencies
    for (const [filePath, node] of Array.from(graph.entries())) {
      for (const importPath of node.imports) {
        const importedNode = graph.get(importPath);
        if (importedNode) {
          importedNode.importedBy.push(filePath);
        }
      }
    }

    lastBuildTime = Date.now();
    console.log(`[DependencyGraph] Built graph: ${graph.size} files, ${Array.from(graph.values()).reduce((sum, n) => sum + n.imports.length, 0)} edges`);

    return getGraphStats();
  } finally {
    buildInProgress = false;
  }
}

// ─── Impact Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze the impact of changing a specific file.
 * Returns all files that would be affected (directly and transitively).
 */
export function analyzeImpact(targetFile: string): ImpactAnalysis {
  const node = graph.get(targetFile);

  if (!node) {
    return {
      targetFile,
      directDependents: [],
      transitiveDependents: [],
      affectedTests: [],
      riskLevel: "low",
      riskReason: "File not found in graph",
      totalAffectedFiles: 0,
    };
  }

  // BFS to find all transitive dependents
  const visited = new Set<string>();
  const queue = [...node.importedBy];
  const directDependents = [...node.importedBy];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const depNode = graph.get(current);
    if (depNode) {
      for (const dependent of depNode.importedBy) {
        if (!visited.has(dependent)) {
          queue.push(dependent);
        }
      }
    }
  }

  const transitiveDependents = Array.from(visited);

  // Collect all affected test files
  const affectedTests = new Set<string>();
  for (const t of node.testFiles) affectedTests.add(t);
  for (const dep of transitiveDependents) {
    const depNode = graph.get(dep);
    if (depNode) {
      for (const test of depNode.testFiles) {
        affectedTests.add(test);
      }
    }
  }

  // Determine risk level
  const totalAffected = transitiveDependents.length;
  let riskLevel: "low" | "medium" | "high" | "critical";
  let riskReason: string;

  if (totalAffected === 0) {
    riskLevel = "low";
    riskReason = "No downstream dependents";
  } else if (totalAffected <= 3) {
    riskLevel = "medium";
    riskReason = `${totalAffected} files depend on this module`;
  } else if (totalAffected <= 10) {
    riskLevel = "high";
    riskReason = `${totalAffected} files transitively affected — thorough testing required`;
  } else {
    riskLevel = "critical";
    riskReason = `${totalAffected} files affected — this is a core module, changes require extreme caution`;
  }

  return {
    targetFile,
    directDependents,
    transitiveDependents,
    affectedTests: Array.from(affectedTests),
    riskLevel,
    riskReason,
    totalAffectedFiles: totalAffected,
  };
}

/**
 * Find circular dependencies in the graph.
 */
export function findCircularDeps(): string[][] {
  const circles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, pathArr: string[]): void {
    if (inStack.has(node)) {
      // Found a cycle
      const cycleStart = pathArr.indexOf(node);
      if (cycleStart >= 0) {
        circles.push(pathArr.slice(cycleStart));
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const graphNode = graph.get(node);
    if (graphNode) {
      for (const imp of graphNode.imports) {
        if (graph.has(imp)) {
          dfs(imp, [...pathArr, node]);
        }
      }
    }

    inStack.delete(node);
  }

  for (const [filePath] of Array.from(graph.entries())) {
    if (!visited.has(filePath)) {
      dfs(filePath, []);
    }
  }

  return circles;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get graph statistics.
 */
export function getGraphStats(): GraphStats {
  const nodes = Array.from(graph.values());
  const totalEdges = nodes.reduce((sum, n) => sum + n.imports.length, 0);

  const mostImported = nodes
    .filter(n => n.importedBy.length > 0)
    .sort((a, b) => b.importedBy.length - a.importedBy.length)
    .slice(0, 10)
    .map(n => ({ path: n.path, importedByCount: n.importedBy.length }));

  const orphanFiles = nodes
    .filter(n => n.imports.length === 0 && n.importedBy.length === 0)
    .map(n => n.path);

  return {
    totalFiles: graph.size,
    totalEdges,
    avgDependencies: graph.size > 0 ? Math.round(totalEdges / graph.size * 10) / 10 : 0,
    mostImported,
    orphanFiles,
    circularDeps: findCircularDeps(),
  };
}

/**
 * Get the full dependency tree for a file (what it imports, recursively).
 */
export function getDependencyTree(filePath: string, maxDepth: number = 5): Record<string, string[]> {
  const tree: Record<string, string[]> = {};
  const visited = new Set<string>();

  function traverse(node: string, depth: number): void {
    if (depth > maxDepth || visited.has(node)) return;
    visited.add(node);

    const graphNode = graph.get(node);
    if (!graphNode) return;

    tree[node] = graphNode.imports.filter(imp => graph.has(imp));

    for (const imp of tree[node]) {
      traverse(imp, depth + 1);
    }
  }

  traverse(filePath, 0);
  return tree;
}

/**
 * Get a specific node from the graph.
 */
export function getNode(filePath: string): DependencyNode | undefined {
  return graph.get(filePath);
}

/**
 * Check if the graph needs rebuilding (files changed since last build).
 * v6.16 FIX: Use node.lastModified (captured at build time) instead of re-statting.
 * Re-statting caused every cycle to appear stale on Windows (NTFS mtime precision
 * means newly-written files can have mtime slightly > lastBuildTime even when
 * nothing actually changed). We also add a 2s grace period to absorb clock skew.
 */
export function isStale(): boolean {
  if (lastBuildTime === 0) return true;
  if (graph.size === 0) return true;

  // Use the mtime captured at build time — avoids re-statting 264 files every 60s
  // and eliminates false positives from NTFS timestamp precision on Windows.
  // Grace period: 2000ms to absorb minor clock skew between stat() and Date.now().
  const GRACE_MS = 2000;
  for (const [, node] of Array.from(graph.entries())) {
    if (node.lastModified > lastBuildTime + GRACE_MS) return true;
  }

  return false;
}

/**
 * Get files sorted by their "importance" (how many other files depend on them).
 */
export function getFilesByImportance(): Array<{ path: string; importance: number; dependents: number }> {
  return Array.from(graph.values())
    .map(node => ({
      path: node.path,
      importance: node.importedBy.length * 2 + node.exports.length,
      dependents: node.importedBy.length,
    }))
    .sort((a, b) => b.importance - a.importance);
}

// v5.31: Auto-rebuild interval — periodically check if graph is stale and rebuild
let autoRebuildInterval: ReturnType<typeof setInterval> | null = null;
const AUTO_REBUILD_INTERVAL_MS = 60_000; // Check every 60 seconds

async function autoRebuildIfStale(): Promise<void> {
  try {
    if (isStale()) {
      console.log("[DependencyGraph] Graph is stale, rebuilding...");
      const stats = await buildGraph();
      console.log(`[DependencyGraph] Rebuilt: ${stats.totalFiles} files, ${stats.totalEdges} edges`);
    }
  } catch (err) {
    console.warn("[DependencyGraph] Auto-rebuild failed:", (err as Error).message);
  }
}

/**
 * Initialize the dependency graph on startup.
 * v5.31: Also starts auto-rebuild interval.
 */
export async function initDependencyGraph(): Promise<void> {
  console.log("[DependencyGraph] Building initial graph...");
  const stats = await buildGraph();
  console.log(`[DependencyGraph] Ready: ${stats.totalFiles} files, ${stats.totalEdges} edges, ${stats.circularDeps.length} circular deps`);

  // Start auto-rebuild interval
  if (autoRebuildInterval) clearInterval(autoRebuildInterval);
  autoRebuildInterval = setInterval(autoRebuildIfStale, AUTO_REBUILD_INTERVAL_MS);
  console.log("[DependencyGraph] Auto-rebuild enabled (every 60s)");
}

/**
 * Force rebuild the dependency graph (callable from other modules).
 */
export async function forceRebuild(): Promise<GraphStats> {
  console.log("[DependencyGraph] Force rebuild requested");
  return buildGraph();
}
