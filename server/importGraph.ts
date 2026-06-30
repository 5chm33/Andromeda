/**
 * importGraph.ts — v6.30: Cross-file refactoring awareness
 *
 * Builds a static import graph of the server/ TypeScript codebase using the
 * TypeScript Compiler API. When an RSI proposal changes a function signature
 * or type definition, this module:
 *
 *   1. Finds all files that import the changed symbol
 *   2. Returns the list of affected files so the proposal generator can
 *      include secondary changes for each caller
 *   3. Validates that a proposed multi-file change is internally consistent
 *      (no dangling references after the change)
 *
 * The graph is rebuilt lazily on first access and invalidated when any
 * server/*.ts file changes (watched via fs.watch).
 *
 * Exports:
 *   buildImportGraph()     — force rebuild the graph
 *   getImporters(file)     — get all files that import from `file`
 *   getImportees(file)     — get all files that `file` imports from
 *   findSymbolUsages(file, symbol) — find all files using a named export
 *   validateRefactoring(changes)   — check a multi-file change for consistency
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { createLogger } from "./logger.js";

const log = createLogger("importGraph");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportEdge = {
  from: string;   // absolute path of importing file
  to: string;     // absolute path of imported file
  symbols: string[]; // named exports imported (empty = namespace/side-effect import)
};

export type ImportGraph = {
  edges: ImportEdge[];
  /** file → set of files that import it */
  importers: Map<string, Set<string>>;
  /** file → set of files it imports */
  importees: Map<string, Set<string>>;
  /** "file::symbol" → set of files that use that symbol */
  symbolUsages: Map<string, Set<string>>;
  builtAt: number;
};

export type RefactoringChange = {
  file: string;
  changedSymbols: string[]; // exported symbols being renamed/removed/changed
};

export type RefactoringValidation = {
  valid: boolean;
  affectedFiles: string[];
  uncoveredFiles: string[]; // files that use the symbol but are NOT in the change set
  warnings: string[];
};

// ─── State ────────────────────────────────────────────────────────────────────

let _graph: ImportGraph | null = null;
let _building = false;
let _watcherStarted = false;

// ─── Path helpers ─────────────────────────────────────────────────────────────

function getServerDir(): string {
  // In production the built file lives at dist/_core/ so import.meta.url points
  // there. Walk up to find the project root (contains package.json), then return
  // the server/ subdirectory so we scan actual TypeScript source files.
  try {
    let cur = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const serverSubdir = path.join(cur, "server");
      if (fs.existsSync(serverSubdir) && fs.statSync(serverSubdir).isDirectory()) {
        return serverSubdir;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // Fallback: two levels up from dist/_core is project root
    return path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."), "server");
  } catch {
    return path.join(process.cwd(), "server");
  }
}

function resolveImportPath(fromFile: string, importSpecifier: string): string | null {
  if (!importSpecifier.startsWith(".")) return null; // skip node_modules

  const dir = path.dirname(fromFile);
  const candidates = [
    path.resolve(dir, importSpecifier),
    path.resolve(dir, importSpecifier + ".ts"),
    path.resolve(dir, importSpecifier + ".tsx"),
    path.resolve(dir, importSpecifier, "index.ts"),
  ];

  // Also strip .js extension (ESM imports often use .js but the file is .ts)
  if (importSpecifier.endsWith(".js")) {
    const withoutJs = importSpecifier.slice(0, -3);
    candidates.push(
      path.resolve(dir, withoutJs + ".ts"),
      path.resolve(dir, withoutJs + ".tsx"),
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// ─── Graph builder ────────────────────────────────────────────────────────────

/**
 * Build the full import graph for server/*.ts.
 * This is O(N) in the number of server files and typically takes < 500ms.
 */
export async function buildImportGraph(): Promise<ImportGraph> {
  if (_building) {
    // Wait for the in-progress build
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (!_building) { clearInterval(check); resolve(); }
      }, 100);
    });
    return _graph!;
  }

  _building = true;
  const start = Date.now();

  try {
    const serverDir = getServerDir();
    const tsFiles = fs
      .readdirSync(serverDir, { recursive: true })
      .filter((f): f is string => typeof f === "string" && f.endsWith(".ts") && !f.includes("node_modules"))
      .map(f => path.join(serverDir, f));

    const edges: ImportEdge[] = [];
    const importers = new Map<string, Set<string>>();
    const importees = new Map<string, Set<string>>();
    const symbolUsages = new Map<string, Set<string>>();

    for (const file of tsFiles) {
      let source: string;
      try {
        source = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }

      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);

      for (const stmt of sf.statements) {
        // import { A, B } from "./foo"
        // import * as X from "./foo"
        // import "./foo"
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
          const spec = stmt.moduleSpecifier.text;
          const resolved = resolveImportPath(file, spec);
          if (!resolved) continue;

          const symbols: string[] = [];
          if (stmt.importClause) {
            const { namedBindings, name } = stmt.importClause;
            if (name) symbols.push(name.text); // default import
            if (namedBindings) {
              if (ts.isNamedImports(namedBindings)) {
                for (const el of namedBindings.elements) {
                  symbols.push((el.propertyName ?? el.name).text);
                }
              }
              // namespace import: import * as X — symbols stays empty
            }
          }

          edges.push({ from: file, to: resolved, symbols });

          if (!importers.has(resolved)) importers.set(resolved, new Set());
          importers.get(resolved)!.add(file);

          if (!importees.has(file)) importees.set(file, new Set());
          importees.get(file)!.add(resolved);

          for (const sym of symbols) {
            const key = `${resolved}::${sym}`;
            if (!symbolUsages.has(key)) symbolUsages.set(key, new Set());
            symbolUsages.get(key)!.add(file);
          }
        }
      }
    }

    _graph = { edges, importers, importees, symbolUsages, builtAt: Date.now() };
    log.info(`[importGraph] Built graph: ${tsFiles.length} files, ${edges.length} edges in ${Date.now() - start}ms`);

    // Start file watcher to invalidate graph on changes
    if (!_watcherStarted) {
      _startWatcher(serverDir);
    }

    return _graph;
  } finally {
    _building = false;
  }
}

function _startWatcher(serverDir: string): void {
  try {
    fs.watch(serverDir, { recursive: true }, (event, filename) => {
      if (filename && filename.endsWith(".ts")) {
        _graph = null; // invalidate on any .ts change
      }
    });
    _watcherStarted = true;
  } catch {
    // fs.watch may not be available in all environments
  }
}

async function getGraph(): Promise<ImportGraph> {
  if (!_graph) return buildImportGraph();
  return _graph;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all files that import from `file`.
 */
export async function getImporters(file: string): Promise<string[]> {
  try {
    const g = await getGraph();
    return Array.from(g.importers.get(path.resolve(file)) ?? []);
  } catch (err) {
    log.error(`[importGraph] getImporters failed for ${file}: ${err}`);
    throw err;
  }
}

/**
 * Get all files that `file` imports from.
 */
export async function getImportees(file: string): Promise<string[]> {
  try {
    const g = await getGraph();
    return Array.from(g.importees.get(path.resolve(file)) ?? []);
  } catch (err) {
    log.error(`[importGraph] getImportees failed for ${file}: ${err}`);
    throw err;
  }
}

/**
 * Find all files that use a specific named export from `file`.
 *
 * @param file    Absolute path to the file that exports the symbol
 * @param symbol  Name of the exported symbol (function, type, const, etc.)
 */
export async function findSymbolUsages(file: string, symbol: string): Promise<string[]> {
  try {
    const g = await getGraph();
    const key = `${path.resolve(file)}::${symbol}`;
    return Array.from(g.symbolUsages.get(key) ?? []);
  } catch (err) {
    log.error(`[importGraph] findSymbolUsages failed for ${file}::${symbol}: ${err}`);
    throw err;
  }
}

/**
 * Get the full transitive impact of changing a file.
 * Returns all files that transitively depend on `file`.
 */
export async function getTransitiveImporters(
  file: string,
  maxDepth = 5
): Promise<{ file: string; depth: number }[]> {
  const g = await getGraph();
  const visited = new Set<string>();
  const result: { file: string; depth: number }[] = [];
  const queue: { file: string; depth: number }[] = [{ file: path.resolve(file), depth: 0 }];

  while (queue.length > 0) {
    const { file: current, depth } = queue.shift()!;
    if (visited.has(current) || depth >= maxDepth) continue;
    visited.add(current);

    const directImporters = Array.from(g.importers.get(current) ?? []);
    for (const importer of directImporters) {
      if (!visited.has(importer)) {
        result.push({ file: importer, depth: depth + 1 });
        queue.push({ file: importer, depth: depth + 1 });
      }
    }
  }

  return result;
}

/**
 * Validate a proposed multi-file refactoring change.
 *
 * Checks that every file using a changed symbol is included in the change set.
 * Returns warnings for any files that will break after the change.
 *
 * @param changes  Array of { file, changedSymbols } describing the refactoring
 */
export async function validateRefactoring(
  changes: RefactoringChange[]
): Promise<RefactoringValidation> {
  const g = await getGraph();
  const changedFiles = new Set(changes.map(c => path.resolve(c.file)));
  const affectedFiles = new Set<string>();
  const uncoveredFiles = new Set<string>();
  const warnings: string[] = [];

  for (const change of changes) {
    const resolvedFile = path.resolve(change.file);
    for (const symbol of change.changedSymbols) {
      const key = `${resolvedFile}::${symbol}`;
      const users = g.symbolUsages.get(key) ?? new Set();
      for (const user of users) {
        affectedFiles.add(user);
        if (!changedFiles.has(user)) {
          uncoveredFiles.add(user);
          warnings.push(
            `Symbol "${symbol}" from ${path.basename(change.file)} is used in ${path.basename(user)} but that file is not included in the change set`
          );
        }
      }
    }
  }

  return {
    valid: uncoveredFiles.size === 0,
    affectedFiles: Array.from(affectedFiles),
    uncoveredFiles: Array.from(uncoveredFiles),
    warnings,
  };
}

/**
 * Get a summary of the import graph for the /api/system/import-graph endpoint.
 */
export async function getGraphSummary(): Promise<{
  fileCount: number;
  edgeCount: number;
  symbolCount: number;
  builtAt: number;
  mostImported: { file: string; importerCount: number }[];
}> {
  const g = await getGraph();
  const mostImported = Array.from(g.importers.entries())
    .map(([file, importers]) => ({ file: path.basename(file), importerCount: importers.size }))
    .sort((a, b) => b.importerCount - a.importerCount)
    .slice(0, 10);

  return {
    fileCount: new Set([...g.edges.map(e => e.from), ...g.edges.map(e => e.to)]).size,
    edgeCount: g.edges.length,
    symbolCount: g.symbolUsages.size,
    builtAt: g.builtAt,
    mostImported,
  };
}

/**
 * v6.31: Get all exported symbol names from a file.
 * Used by selfImprove.ts to build the import graph context for the LLM prompt
 * so the generator knows which symbols have callers and can propose secondaryChanges.
 */
export async function getExportedSymbols(file: string): Promise<string[]> {
  const g = await getGraph();
  const absFile = path.resolve(file);
  const symbols: string[] = [];
  for (const key of g.symbolUsages.keys()) {
    const colonIdx = key.indexOf("::");
    if (colonIdx === -1) continue;
    const keyFile = key.slice(0, colonIdx);
    const symbol = key.slice(colonIdx + 2);
    if (keyFile === absFile && symbol) {
      symbols.push(symbol);
    }
  }
  // Deduplicate and sort
  return [...new Set(symbols)].sort();
}
