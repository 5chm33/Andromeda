/**
 * astKnowledgeGraph.test.ts
 * Tests for the AST-to-Knowledge Graph compiler and query engine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import {
  ASTKnowledgeGraph,
  ASTParser,
  getKnowledgeGraph,
  resetKnowledgeGraph,
  buildKnowledgeGraph,
  type KGNode,
  type KGEdge,
} from "./astKnowledgeGraph.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let testDir: string;
let counter = 0;

function freshGraph(): ASTKnowledgeGraph {
  return new ASTKnowledgeGraph(`/tmp/test_ast_kg_${Date.now()}_${counter++}`);
}

function makeNode(id: string, type: KGNode["type"] = "function", isExported = true): KGNode {
  return {
    id,
    type,
    label: id,
    filePath: `/project/server/${id}.ts`,
    isExported,
    metadata: {},
  };
}

function makeEdge(from: string, to: string, type: KGEdge["type"] = "imports"): KGEdge {
  return {
    id: `${from}->${to}`,
    from,
    to,
    type,
    weight: 1.0,
    metadata: {},
  };
}

// ── ASTKnowledgeGraph ─────────────────────────────────────────────────────────

describe("ASTKnowledgeGraph", () => {
  let graph: ASTKnowledgeGraph;

  beforeEach(() => {
    graph = freshGraph();
  });

  it("adds and retrieves nodes", () => {
    const node = makeNode("funcA");
    graph.addNode(node);
    expect(graph.getNode("funcA")).toEqual(node);
  });

  it("returns undefined for missing node", () => {
    expect(graph.getNode("nonexistent")).toBeUndefined();
  });

  it("adds and retrieves edges", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    const edge = makeEdge("A", "B");
    graph.addEdge(edge);
    const out = graph.getOutEdges("A");
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe("B");
  });

  it("getInEdges returns correct edges", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addEdge(makeEdge("A", "B"));
    const inEdges = graph.getInEdges("B");
    expect(inEdges).toHaveLength(1);
    expect(inEdges[0].from).toBe("A");
  });

  it("getNodesByType filters correctly", () => {
    graph.addNode(makeNode("fn1", "function"));
    graph.addNode(makeNode("fn2", "function"));
    graph.addNode(makeNode("mod1", "module"));
    expect(graph.getNodesByType("function")).toHaveLength(2);
    expect(graph.getNodesByType("module")).toHaveLength(1);
  });

  it("getNodesByFile filters correctly", () => {
    const node = { ...makeNode("fn1"), filePath: "/project/server/foo.ts" };
    graph.addNode(node);
    graph.addNode(makeNode("fn2"));
    expect(graph.getNodesByFile("/project/server/foo.ts")).toHaveLength(1);
  });

  it("findCallers returns nodes that import or call a node", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addEdge(makeEdge("A", "B", "imports"));
    const callers = graph.findCallers("B");
    expect(callers.map(n => n.id)).toContain("A");
  });

  it("findDependencies returns imported modules", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addEdge(makeEdge("A", "B", "imports"));
    const deps = graph.findDependencies("A");
    expect(deps.map(n => n.id)).toContain("B");
  });

  it("findImpactRadius returns correct impact for a chain", () => {
    graph.addNode(makeNode("root", "function"));
    graph.addNode(makeNode("mid", "function"));
    graph.addNode(makeNode("leaf", "function"));
    // findCallers looks at IN-edges (edges pointing TO a node)
    // So to make "mid" a caller of "root", the edge must go mid->root
    // meaning mid imports root
    graph.addEdge(makeEdge("mid", "root", "imports"));
    graph.addEdge(makeEdge("leaf", "mid", "imports"));

    const impact = graph.findImpactRadius("root");
    expect(impact.targetNode.id).toBe("root");
    // directDependents = nodes that import root
    expect(impact.directDependents.map(n => n.id)).toContain("mid");
    expect(impact.impactRadius).toBeGreaterThan(0);
  });

  it("findImpactRadius identifies affected tests", () => {
    graph.addNode(makeNode("fn", "function"));
    const testNode: KGNode = {
      id: "test_fn",
      type: "function" as KGNode["type"],
      label: "test_fn",
      // filePath contains .test. so it will be counted as a test
      filePath: "/project/server/fn.test.ts",
      isExported: false,
      metadata: {},
    };
    graph.addNode(testNode);
    // test_fn imports fn — edge goes FROM test_fn TO fn
    graph.addEdge(makeEdge("test_fn", "fn", "imports"));

    const impact = graph.findImpactRadius("fn");
    expect(impact.affectedTests).toHaveLength(1);
  });

  it("detectCircularDeps finds a simple cycle", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addEdge(makeEdge("A", "B", "imports"));
    graph.addEdge(makeEdge("B", "A", "imports"));

    const cycles = graph.detectCircularDeps();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("detectCircularDeps returns empty for acyclic graph", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addNode(makeNode("C", "module"));
    graph.addEdge(makeEdge("A", "B", "imports"));
    graph.addEdge(makeEdge("B", "C", "imports"));

    const cycles = graph.detectCircularDeps();
    expect(cycles).toHaveLength(0);
  });

  it("findDeadCode returns exported nodes with no importers", () => {
    graph.addNode(makeNode("used", "function", true));
    graph.addNode(makeNode("unused", "function", true));
    graph.addNode(makeNode("caller", "module", false));
    graph.addEdge(makeEdge("caller", "used", "imports"));

    const dead = graph.findDeadCode();
    expect(dead.map(n => n.id)).toContain("unused");
    expect(dead.map(n => n.id)).not.toContain("used");
  });

  it("findPath returns shortest path between two nodes", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    graph.addNode(makeNode("C", "module"));
    graph.addEdge(makeEdge("A", "B", "imports"));
    graph.addEdge(makeEdge("B", "C", "imports"));

    const path = graph.findPath("A", "C");
    expect(path).toEqual(["A", "B", "C"]);
  });

  it("findPath returns null when no path exists", () => {
    graph.addNode(makeNode("A", "module"));
    graph.addNode(makeNode("B", "module"));
    expect(graph.findPath("A", "B")).toBeNull();
  });

  it("getStats returns correct counts", () => {
    graph.addNode(makeNode("fn1", "function"));
    graph.addNode(makeNode("mod1", "module"));
    graph.addEdge(makeEdge("mod1", "fn1", "defines"));

    const stats = graph.getStats();
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.functionCount).toBe(1);
    expect(stats.moduleCount).toBe(1);
  });

  it("reset clears all nodes and edges", () => {
    graph.addNode(makeNode("A"));
    graph.addNode(makeNode("B"));
    graph.addEdge(makeEdge("A", "B"));
    graph.reset();
    expect(graph.getNodes()).toHaveLength(0);
    expect(graph.getEdges()).toHaveLength(0);
  });

  it("saveToDisk and loadFromDisk round-trip", () => {
    const g = freshGraph();
    g.addNode(makeNode("fn1", "function"));
    g.addNode(makeNode("mod1", "module"));
    g.addEdge(makeEdge("mod1", "fn1", "defines"));
    g.saveToDisk();

    const g2 = new ASTKnowledgeGraph((g as any).dataDir);
    const loaded = g2.loadFromDisk();
    expect(loaded).toBe(true);
    expect(g2.getNode("fn1")).toBeDefined();
    expect(g2.getEdges()).toHaveLength(1);
  });
});

// ── ASTParser ─────────────────────────────────────────────────────────────────

describe("ASTParser", () => {
  beforeEach(() => {
    testDir = `/tmp/test_ast_parser_${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("parses exported functions from a TypeScript file", () => {
    writeFileSync(join(testDir, "foo.ts"), `
export function doSomething(): void {}
export async function fetchData(): Promise<void> {}
function privateHelper(): void {}
`);
    const graph = freshGraph();
    const parser = new ASTParser(graph);
    parser.parseFile(join(testDir, "foo.ts"));

    const nodes = graph.getNodes();
    const fnNames = nodes.map(n => n.label);
    expect(fnNames).toContain("doSomething");
    expect(fnNames).toContain("fetchData");
    expect(fnNames).not.toContain("privateHelper");
  });

  it("parses exported classes", () => {
    writeFileSync(join(testDir, "bar.ts"), `
export class MyService {}
export abstract class BaseClass {}
`);
    const graph = freshGraph();
    const parser = new ASTParser(graph);
    parser.parseFile(join(testDir, "bar.ts"));

    const classNodes = graph.getNodesByType("class");
    expect(classNodes.map(n => n.label)).toContain("MyService");
    expect(classNodes.map(n => n.label)).toContain("BaseClass");
  });

  it("parses import statements and creates edges", () => {
    writeFileSync(join(testDir, "importer.ts"), `
import { doSomething } from "./foo";
import type { MyType } from "./types";
`);
    const graph = freshGraph();
    const parser = new ASTParser(graph);
    parser.parseFile(join(testDir, "importer.ts"));

    const edges = graph.getEdges().filter(e => e.type === "imports");
    expect(edges.length).toBeGreaterThan(0);
  });

  it("parses a directory of TypeScript files", () => {
    writeFileSync(join(testDir, "a.ts"), `export function a() {}`);
    writeFileSync(join(testDir, "b.ts"), `export function b() {}`);
    writeFileSync(join(testDir, "c.ts"), `export interface IC {}`);

    const graph = freshGraph();
    const parser = new ASTParser(graph);
    parser.parseDirectory(testDir, false);

    expect(graph.getNodes().length).toBeGreaterThanOrEqual(3);
  });

  it("handles non-existent directory gracefully", () => {
    const graph = freshGraph();
    const parser = new ASTParser(graph);
    expect(() => parser.parseDirectory("/nonexistent/path", false)).not.toThrow();
  });
});

// ── Singleton ─────────────────────────────────────────────────────────────────

describe("getKnowledgeGraph singleton", () => {
  beforeEach(() => {
    resetKnowledgeGraph();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getKnowledgeGraph(`/tmp/test_kg_singleton_${Date.now()}`);
    const b = getKnowledgeGraph();
    expect(a).toBe(b);
  });

  it("returns a new instance after reset", () => {
    const a = getKnowledgeGraph(`/tmp/test_kg_s1_${Date.now()}`);
    resetKnowledgeGraph();
    const b = getKnowledgeGraph(`/tmp/test_kg_s2_${Date.now()}`);
    expect(a).not.toBe(b);
  });
});
