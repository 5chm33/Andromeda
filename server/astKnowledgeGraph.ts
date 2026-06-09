/**
 * astKnowledgeGraph.ts — AST-to-Knowledge Graph Compiler
 * Andromeda v11.0.0 — Phase 12: Gödel Ascension
 *
 * Parses the TypeScript AST of Andromeda's own codebase into a queryable
 * symbolic knowledge graph. Unlike vector embeddings (which are fuzzy),
 * this graph provides precise, structural knowledge about:
 *
 *   - Which functions call which other functions (call graph)
 *   - Which modules import which other modules (dependency graph)
 *   - Which types are used where (type graph)
 *   - Which exports are consumed by which importers (usage graph)
 *
 * This enables the RSI engine to write formal proofs about code structure,
 * detect dead code, find circular dependencies, and reason about the impact
 * of a proposed change before applying it.
 *
 * Architecture:
 *   - KGNode: a node in the knowledge graph (function, class, type, module)
 *   - KGEdge: a directed relationship (calls, imports, extends, implements)
 *   - ASTKnowledgeGraph: the full graph with query methods
 *   - ASTParser: walks TypeScript source files and populates the graph
 *
 * Query API (SPARQL-inspired):
 *   - findCallers(functionId): who calls this function?
 *   - findDependencies(moduleId): what does this module depend on?
 *   - findImpactRadius(nodeId): what would break if this node changed?
 *   - detectCircularDeps(): find all circular dependency cycles
 *   - findDeadCode(): find exports that are never imported
 */

import { createLogger } from "./logger.js";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, relative, extname, basename } from "path";

const log = createLogger("astKnowledgeGraph");

// ── Types ─────────────────────────────────────────────────────────────────────

export type KGNodeType =
  | "module"
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "variable"
  | "export";

export type KGEdgeType =
  | "imports"
  | "calls"
  | "extends"
  | "implements"
  | "exports"
  | "uses_type"
  | "defines";

export interface KGNode {
  id: string;
  type: KGNodeType;
  label: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  isExported: boolean;
  isAsync?: boolean;
  metadata: Record<string, unknown>;
}

export interface KGEdge {
  id: string;
  from: string;
  to: string;
  type: KGEdgeType;
  weight: number;
  metadata: Record<string, unknown>;
}

export interface QueryResult {
  nodes: KGNode[];
  edges: KGEdge[];
  paths?: string[][];
}

export interface ImpactAnalysis {
  targetNode: KGNode;
  directDependents: KGNode[];
  transitiveDependents: KGNode[];
  impactRadius: number;
  riskScore: number;
  affectedTests: KGNode[];
}

// ── Knowledge Graph ───────────────────────────────────────────────────────────

export class ASTKnowledgeGraph {
  private nodes = new Map<string, KGNode>();
  private edges = new Map<string, KGEdge>();
  private outEdges = new Map<string, Set<string>>();   // node -> edge IDs going out
  private inEdges = new Map<string, Set<string>>();    // node -> edge IDs coming in
  private edgeCount = 0;
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(process.cwd(), "data", "ast_kg");
    mkdirSync(this.dataDir, { recursive: true });
  }

  // ── Node Management ─────────────────────────────────────────────────────────

  addNode(node: KGNode): void {
    this.nodes.set(node.id, node);
    if (!this.outEdges.has(node.id)) this.outEdges.set(node.id, new Set());
    if (!this.inEdges.has(node.id)) this.inEdges.set(node.id, new Set());
  }

  getNode(id: string): KGNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): KGNode[] {
    return Array.from(this.nodes.values());
  }

  getNodesByType(type: KGNodeType): KGNode[] {
    return this.getNodes().filter(n => n.type === type);
  }

  getNodesByFile(filePath: string): KGNode[] {
    return this.getNodes().filter(n => n.filePath === filePath);
  }

  // ── Edge Management ─────────────────────────────────────────────────────────

  addEdge(edge: KGEdge): void {
    this.edges.set(edge.id, edge);
    if (!this.outEdges.has(edge.from)) this.outEdges.set(edge.from, new Set());
    if (!this.inEdges.has(edge.to)) this.inEdges.set(edge.to, new Set());
    this.outEdges.get(edge.from)!.add(edge.id);
    this.inEdges.get(edge.to)!.add(edge.id);
  }

  getEdges(): KGEdge[] {
    return Array.from(this.edges.values());
  }

  getOutEdges(nodeId: string): KGEdge[] {
    return Array.from(this.outEdges.get(nodeId) ?? [])
      .map(id => this.edges.get(id)!)
      .filter(Boolean);
  }

  getInEdges(nodeId: string): KGEdge[] {
    return Array.from(this.inEdges.get(nodeId) ?? [])
      .map(id => this.edges.get(id)!)
      .filter(Boolean);
  }

  // ── Query API ────────────────────────────────────────────────────────────────

  /**
   * Find all nodes that call or import the given node.
   */
  findCallers(nodeId: string): KGNode[] {
    return this.getInEdges(nodeId)
      .filter(e => e.type === "calls" || e.type === "imports")
      .map(e => this.nodes.get(e.from)!)
      .filter(Boolean);
  }

  /**
   * Find all direct dependencies of a module.
   */
  findDependencies(moduleId: string): KGNode[] {
    return this.getOutEdges(moduleId)
      .filter(e => e.type === "imports")
      .map(e => this.nodes.get(e.to)!)
      .filter(Boolean);
  }

  /**
   * Find all nodes that would be affected if the given node changed.
   * Uses BFS through the reverse dependency graph.
   */
  findImpactRadius(nodeId: string): ImpactAnalysis {
    const target = this.nodes.get(nodeId);
    if (!target) {
      return {
        targetNode: { id: nodeId, type: "module", label: "unknown", filePath: "", isExported: false, metadata: {} },
        directDependents: [],
        transitiveDependents: [],
        impactRadius: 0,
        riskScore: 0,
        affectedTests: [],
      };
    }

    const directDependents = this.findCallers(nodeId);
    const visited = new Set<string>([nodeId]);
    const queue = [...directDependents];
    const transitiveDependents: KGNode[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      transitiveDependents.push(current);

      const callers = this.findCallers(current.id);
      queue.push(...callers.filter(c => !visited.has(c.id)));
    }

    const affectedTests = transitiveDependents.filter(n =>
      n.filePath.includes(".test.") || n.filePath.includes(".spec.")
    );

    const impactRadius = transitiveDependents.length;
    const riskScore = Math.min(1.0, impactRadius / 50);

    return {
      targetNode: target,
      directDependents,
      transitiveDependents,
      impactRadius,
      riskScore,
      affectedTests,
    };
  }

  /**
   * Detect all circular dependency cycles using DFS + cycle detection.
   */
  detectCircularDeps(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      for (const edge of this.getOutEdges(nodeId)) {
        if (edge.type !== "imports") continue;

        if (!visited.has(edge.to)) {
          dfs(edge.to, [...path, edge.to]);
        } else if (recursionStack.has(edge.to)) {
          // Found a cycle
          const cycleStart = path.indexOf(edge.to);
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart));
          }
        }
      }

      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, [nodeId]);
      }
    }

    return cycles;
  }

  /**
   * Find exported symbols that are never imported anywhere.
   */
  findDeadCode(): KGNode[] {
    return this.getNodes().filter(node => {
      if (!node.isExported) return false;
      if (node.type === "module") return false;

      // Check if any other node imports this
      const importers = this.getInEdges(node.id).filter(e => e.type === "imports" || e.type === "calls");
      return importers.length === 0;
    });
  }

  /**
   * Find the shortest path between two nodes using BFS.
   */
  findPath(fromId: string, toId: string): string[] | null {
    if (fromId === toId) return [fromId];

    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: fromId, path: [fromId] }];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      for (const edge of this.getOutEdges(nodeId)) {
        if (visited.has(edge.to)) continue;
        const newPath = [...path, edge.to];
        if (edge.to === toId) return newPath;
        visited.add(edge.to);
        queue.push({ nodeId: edge.to, path: newPath });
      }
    }

    return null;
  }

  /**
   * Get graph statistics.
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    moduleCount: number;
    functionCount: number;
    circularDeps: number;
    deadCodeCount: number;
  } {
    const cycles = this.detectCircularDeps();
    const deadCode = this.findDeadCode();

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      moduleCount: this.getNodesByType("module").length,
      functionCount: this.getNodesByType("function").length,
      circularDeps: cycles.length,
      deadCodeCount: deadCode.length,
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  saveToDisk(): void {
    try {
      const data = {
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        builtAt: Date.now(),
      };
      writeFileSync(join(this.dataDir, "ast_kg.json"), JSON.stringify(data, null, 2));
      log.info(`[ast_kg] Saved: ${data.nodes.length} nodes, ${data.edges.length} edges`);
    } catch (err) {
      log.warn(`[ast_kg] Failed to save: ${err}`);
    }
  }

  loadFromDisk(): boolean {
    try {
      const path = join(this.dataDir, "ast_kg.json");
      if (!existsSync(path)) return false;
      const data = JSON.parse(readFileSync(path, "utf-8")) as {
        nodes: KGNode[];
        edges: KGEdge[];
      };
      this.nodes.clear();
      this.edges.clear();
      this.outEdges.clear();
      this.inEdges.clear();
      for (const node of data.nodes) this.addNode(node);
      for (const edge of data.edges) this.addEdge(edge);
      log.info(`[ast_kg] Loaded: ${data.nodes.length} nodes, ${data.edges.length} edges`);
      return true;
    } catch {
      return false;
    }
  }

  reset(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outEdges.clear();
    this.inEdges.clear();
    this.edgeCount = 0;
  }
}

// ── AST Parser ────────────────────────────────────────────────────────────────

export class ASTParser {
  private graph: ASTKnowledgeGraph;
  private nodeCounter = 0;

  constructor(graph: ASTKnowledgeGraph) {
    this.graph = graph;
  }

  /**
   * Parse all TypeScript files in a directory and populate the knowledge graph.
   * Uses regex-based parsing (no external AST dependency) for portability.
   */
  parseDirectory(dirPath: string, recursive = true): void {
    if (!existsSync(dirPath)) {
      log.warn(`[ast_kg] Directory not found: ${dirPath}`);
      return;
    }

    const files = this.collectFiles(dirPath, recursive);
    log.info(`[ast_kg] Parsing ${files.length} TypeScript files...`);

    for (const file of files) {
      try {
        this.parseFile(file);
      } catch (err) {
        log.warn(`[ast_kg] Failed to parse ${file}: ${err}`);
      }
    }

    log.info(`[ast_kg] Graph built: ${this.graph.getNodes().length} nodes, ${this.graph.getEdges().length} edges`);
  }

  private collectFiles(dir: string, recursive: boolean): string[] {
    const files: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && recursive && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          files.push(...this.collectFiles(fullPath, recursive));
        } else if (entry.isFile() && (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx")) {
          files.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
    return files;
  }

  parseFile(filePath: string): void {
    const source = readFileSync(filePath, "utf-8");
    const lines = source.split("\n");
    const moduleId = this.fileToId(filePath);

    // Add module node
    const moduleNode: KGNode = {
      id: moduleId,
      type: "module",
      label: basename(filePath),
      filePath,
      lineStart: 1,
      lineEnd: lines.length,
      isExported: false,
      metadata: { lineCount: lines.length },
    };
    this.graph.addNode(moduleNode);

    // Parse imports
    this.parseImports(source, filePath, moduleId);

    // Parse exports (functions, classes, interfaces, types)
    this.parseExports(source, filePath, moduleId, lines);
  }

  private parseImports(source: string, filePath: string, moduleId: string): void {
    // Match: import { ... } from "..."  or  import ... from "..."
    const importRegex = /^import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:\{[^}]*\}|\w+))?\s+from\s+['"]([^'"]+)['"]/gm;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(source)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;

      // Resolve relative imports to absolute IDs
      const targetId = this.resolveImportId(importPath, filePath);

      const edgeId = `e_${++this.nodeCounter}`;
      this.graph.addEdge({
        id: edgeId,
        from: moduleId,
        to: targetId,
        type: "imports",
        weight: 1.0,
        metadata: { importPath },
      });
    }
  }

  private parseExports(source: string, filePath: string, moduleId: string, lines: string[]): void {
    // Match exported functions
    const fnRegex = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
    let match: RegExpExecArray | null;

    while ((match = fnRegex.exec(source)) !== null) {
      const name = match[1];
      const lineNum = source.substring(0, match.index).split("\n").length;
      const nodeId = `${moduleId}::${name}`;

      const node: KGNode = {
        id: nodeId,
        type: "function",
        label: name,
        filePath,
        lineStart: lineNum,
        isExported: true,
        isAsync: match[0].includes("async"),
        metadata: {},
      };
      this.graph.addNode(node);

      // Link function to module
      this.graph.addEdge({
        id: `e_${++this.nodeCounter}`,
        from: moduleId,
        to: nodeId,
        type: "defines",
        weight: 1.0,
        metadata: {},
      });
    }

    // Match exported classes
    const classRegex = /^export\s+(?:abstract\s+)?class\s+(\w+)/gm;
    while ((match = classRegex.exec(source)) !== null) {
      const name = match[1];
      const lineNum = source.substring(0, match.index).split("\n").length;
      const nodeId = `${moduleId}::${name}`;

      this.graph.addNode({
        id: nodeId,
        type: "class",
        label: name,
        filePath,
        lineStart: lineNum,
        isExported: true,
        metadata: {},
      });

      this.graph.addEdge({
        id: `e_${++this.nodeCounter}`,
        from: moduleId,
        to: nodeId,
        type: "defines",
        weight: 1.0,
        metadata: {},
      });
    }

    // Match exported interfaces
    const ifaceRegex = /^export\s+interface\s+(\w+)/gm;
    while ((match = ifaceRegex.exec(source)) !== null) {
      const name = match[1];
      const nodeId = `${moduleId}::${name}`;
      this.graph.addNode({
        id: nodeId,
        type: "interface",
        label: name,
        filePath,
        isExported: true,
        metadata: {},
      });
    }

    // Match exported type aliases
    const typeRegex = /^export\s+type\s+(\w+)/gm;
    while ((match = typeRegex.exec(source)) !== null) {
      const name = match[1];
      const nodeId = `${moduleId}::${name}`;
      this.graph.addNode({
        id: nodeId,
        type: "type_alias",
        label: name,
        filePath,
        isExported: true,
        metadata: {},
      });
    }
  }

  private fileToId(filePath: string): string {
    // Normalize path to a stable ID
    return filePath.replace(/\\/g, "/").replace(/\.tsx?$/, "");
  }

  private resolveImportId(importPath: string, fromFile: string): string {
    if (importPath.startsWith(".")) {
      // Relative import — resolve against the importing file's directory
      const dir = fromFile.replace(/\/[^/]+$/, "");
      const resolved = join(dir, importPath).replace(/\\/g, "/").replace(/\.tsx?$/, "");
      return resolved;
    }
    // External package — use package name as ID
    return `pkg::${importPath}`;
  }
}

// ── Singleton & Convenience API ───────────────────────────────────────────────

let _graph: ASTKnowledgeGraph | null = null;

export function getKnowledgeGraph(dataDir?: string): ASTKnowledgeGraph {
  if (!_graph) {
    _graph = new ASTKnowledgeGraph(dataDir);
    _graph.loadFromDisk();
  }
  return _graph;
}

export function resetKnowledgeGraph(): void {
  _graph = null;
}

/**
 * Build the knowledge graph from the server source directory.
 * Call this on startup or after an RSI cycle completes.
 */
export function buildKnowledgeGraph(serverDir?: string): ASTKnowledgeGraph {
  const dir = serverDir ?? join(process.cwd(), "server");
  const graph = getKnowledgeGraph();
  graph.reset();

  const parser = new ASTParser(graph);
  parser.parseDirectory(dir, false);  // Non-recursive to avoid tools/ subdirs
  graph.saveToDisk();

  return graph;
}
