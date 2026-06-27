/**
 * v85.test.ts — Knowledge Graph & Reasoning
 * Comprehensive tests for all 6 v85 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { addNode, addEdge, getNeighbors, bfsTraversal, findPath, getNodeCount, getEdgeCount, _resetKnowledgeGraphForTest } from "./knowledgeGraph";
import { defineClass, defineProperty, validateInstance, getAncestors, isSubclassOf, getAllClasses, _resetOntologyManagerForTest } from "./ontologyManager";
import { assertFact, addRule, runInference, queryFacts, getFactCount, _resetInferenceEngineForTest } from "./inferenceEngine";
import { insertTriple, queryPattern, queryChain, aggregateByPredicate, getTripleCount, _resetGraphQueryEngineForTest } from "./graphQueryEngine";
import { registerEntity, linkEntities, getEntityCount, _resetEntityLinkerForTest } from "./entityLinker";
import { addArticle, queryKnowledgeBase, getTopArticles, getArticlesByCategory, getArticleCount, _resetKnowledgeBaseManagerForTest } from "./knowledgeBaseManager";

// ─── knowledgeGraph ──────────────────────────────────────────────────────────
describe("knowledgeGraph", () => {
  beforeEach(() => _resetKnowledgeGraphForTest());

  it("adds nodes and edges", () => {
    const a = addNode("Alice", "entity", { age: 30 });
    const b = addNode("Bob", "entity");
    const edge = addEdge(a.nodeId, b.nodeId, "related_to");
    expect(edge).not.toBeNull();
    expect(getNodeCount()).toBe(2);
    expect(getEdgeCount()).toBe(1);
  });

  it("rejects edge for unknown nodes", () => {
    const result = addEdge("unknown-1", "unknown-2", "related_to");
    expect(result).toBeNull();
  });

  it("gets neighbors", () => {
    const a = addNode("A", "entity");
    const b = addNode("B", "entity");
    const c = addNode("C", "entity");
    addEdge(a.nodeId, b.nodeId, "related_to");
    addEdge(a.nodeId, c.nodeId, "related_to");
    const neighbors = getNeighbors(a.nodeId, "outgoing");
    expect(neighbors.length).toBe(2);
  });

  it("performs BFS traversal", () => {
    const a = addNode("A", "entity");
    const b = addNode("B", "entity");
    const c = addNode("C", "entity");
    addEdge(a.nodeId, b.nodeId, "related_to");
    addEdge(b.nodeId, c.nodeId, "related_to");
    const result = bfsTraversal(a.nodeId, 2);
    expect(result.visited).toContain(a.nodeId);
    expect(result.visited).toContain(b.nodeId);
    expect(result.visited).toContain(c.nodeId);
  });

  it("finds path between nodes", () => {
    const a = addNode("A", "entity");
    const b = addNode("B", "entity");
    const c = addNode("C", "entity");
    addEdge(a.nodeId, b.nodeId, "related_to");
    addEdge(b.nodeId, c.nodeId, "related_to");
    const path = findPath(a.nodeId, c.nodeId);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(a.nodeId);
    expect(path![path!.length - 1]).toBe(c.nodeId);
  });

  it("returns null for unreachable path", () => {
    const a = addNode("A", "entity");
    const b = addNode("B", "entity");
    expect(findPath(a.nodeId, b.nodeId)).toBeNull();
  });
});

// ─── ontologyManager ─────────────────────────────────────────────────────────
describe("ontologyManager", () => {
  beforeEach(() => _resetOntologyManagerForTest());

  it("defines class hierarchy", () => {
    const animal = defineClass("Animal", null, ["name", "weight"]);
    const dog = defineClass("Dog", animal.classId, ["name", "weight", "breed"]);
    expect(isSubclassOf(dog.classId, animal.classId)).toBe(true);
  });

  it("gets ancestors", () => {
    const a = defineClass("A", null, []);
    const b = defineClass("B", a.classId, []);
    const c = defineClass("C", b.classId, []);
    const ancestors = getAncestors(c.classId);
    expect(ancestors.map(x => x.classId)).toContain(a.classId);
  });

  it("validates a valid instance", () => {
    const cls = defineClass("Person", null, ["name", "age"]);
    defineProperty("name", "Person", "string", true);
    const result = validateInstance(cls.classId, { name: "Alice", age: 30 });
    expect(result.valid).toBe(true);
  });

  it("reports missing required properties", () => {
    const cls = defineClass("Product", null, ["sku", "price"]);
    defineProperty("sku", "Product", "string", true);
    const result = validateInstance(cls.classId, { price: 9.99 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("sku"))).toBe(true);
  });

  it("warns about unknown properties", () => {
    const cls = defineClass("Item", null, ["name"]);
    const result = validateInstance(cls.classId, { name: "x", unknownProp: "y" });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("resets cleanly", () => {
    defineClass("X", null, []);
    _resetOntologyManagerForTest();
    expect(getAllClasses().length).toBe(0);
  });
});

// ─── inferenceEngine ─────────────────────────────────────────────────────────
describe("inferenceEngine", () => {
  beforeEach(() => _resetInferenceEngineForTest());

  it("asserts and queries facts", () => {
    assertFact("Alice", "is_a", "Person");
    assertFact("Alice", "has_age", "30");
    const facts = queryFacts("is_a");
    expect(facts.length).toBe(1);
    expect(facts[0].subject).toBe("Alice");
  });

  it("derives new facts via inference rules", () => {
    assertFact("Alice", "is_a", "Person");
    addRule("Person is Mortal", [{ predicate: "is_a", subjectVar: "X", objectVar: "Person" }], { predicate: "is_mortal", subjectVar: "X", objectVar: "true" });
    const result = runInference();
    expect(result.newFacts.length).toBeGreaterThan(0);
    expect(queryFacts("is_mortal").length).toBeGreaterThan(0);
  });

  it("does not duplicate existing facts", () => {
    assertFact("Bob", "is_a", "Human");
    assertFact("Bob", "is_a", "Human");
    expect(getFactCount()).toBe(1);
  });

  it("tracks which rules were applied", () => {
    assertFact("Cat", "is_a", "Animal");
    addRule("Animal has life", [{ predicate: "is_a", subjectVar: "X", objectVar: "Animal" }], { predicate: "has_property", subjectVar: "X", objectVar: "life" });
    const result = runInference();
    expect(result.appliedRules.length).toBeGreaterThan(0);
  });

  it("respects confidence propagation", () => {
    assertFact("X", "is_a", "Y", 0.8);
    addRule("test", [{ predicate: "is_a", subjectVar: "A", objectVar: "B" }], { predicate: "derived", subjectVar: "A", objectVar: "B" }, 0.9);
    runInference();
    const derived = queryFacts("derived");
    expect(derived[0].confidence).toBeCloseTo(0.72, 1);
  });
});

// ─── graphQueryEngine ────────────────────────────────────────────────────────
describe("graphQueryEngine", () => {
  beforeEach(() => _resetGraphQueryEngineForTest());

  it("inserts and queries triples", () => {
    insertTriple("Alice", "knows", "Bob");
    insertTriple("Bob", "knows", "Carol");
    const result = queryPattern({ predicate: "knows" });
    expect(result.count).toBe(2);
  });

  it("queries by subject", () => {
    insertTriple("Alice", "likes", "Coffee");
    insertTriple("Alice", "likes", "Tea");
    insertTriple("Bob", "likes", "Coffee");
    const result = queryPattern({ subject: "Alice" });
    expect(result.count).toBe(2);
  });

  it("performs chain queries", () => {
    insertTriple("Alice", "knows", "Bob");
    insertTriple("Bob", "knows", "Carol");
    const result = queryChain("Alice", ["knows", "knows"]);
    expect(result).toContain("Carol");
  });

  it("aggregates by predicate", () => {
    insertTriple("A", "is_a", "X");
    insertTriple("B", "is_a", "Y");
    insertTriple("C", "knows", "D");
    const agg = aggregateByPredicate();
    expect(agg.groups["is_a"]).toBe(2);
    expect(agg.groups["knows"]).toBe(1);
  });

  it("returns empty for no matches", () => {
    insertTriple("A", "is_a", "B");
    const result = queryPattern({ predicate: "unknown" });
    expect(result.count).toBe(0);
  });

  it("resets cleanly", () => {
    insertTriple("X", "y", "Z");
    _resetGraphQueryEngineForTest();
    expect(getTripleCount()).toBe(0);
  });
});

// ─── entityLinker ────────────────────────────────────────────────────────────
describe("entityLinker", () => {
  beforeEach(() => _resetEntityLinkerForTest());

  it("registers entities and links mentions", () => {
    registerEntity("Barack Obama", ["Obama", "President Obama"], "person", 10);
    const result = linkEntities("Obama visited the White House.", [{ text: "Obama", start: 0, end: 5, type: "person" }]);
    expect(result.linkedCount).toBe(1);
    expect(result.mentions[0].linkedNodeId).not.toBeNull();
  });

  it("returns no link for unknown entity", () => {
    const result = linkEntities("xyz visited somewhere.", [{ text: "xyz", start: 0, end: 3, type: "person" }]);
    expect(result.mentions[0].linkedNodeId).toBeNull();
  });

  it("finds candidates for partial matches", () => {
    registerEntity("New York City", ["NYC", "New York"], "location", 5);
    const result = linkEntities("NYC is great.", [{ text: "NYC", start: 0, end: 3, type: "location" }]);
    expect(result.mentions[0].candidates.length).toBeGreaterThan(0);
  });

  it("counts registered entities", () => {
    registerEntity("A", [], "entity");
    registerEntity("B", [], "entity");
    expect(getEntityCount()).toBe(2);
  });

  it("resets cleanly", () => {
    registerEntity("X", [], "entity");
    _resetEntityLinkerForTest();
    expect(getEntityCount()).toBe(0);
  });
});

// ─── knowledgeBaseManager ────────────────────────────────────────────────────
describe("knowledgeBaseManager", () => {
  beforeEach(() => _resetKnowledgeBaseManagerForTest());

  it("adds and queries articles", () => {
    addArticle("How to reset password", "To reset your password, click the forgot password link.", "support", ["password", "account"]);
    const answers = queryKnowledgeBase({ question: "how to reset password" });
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0].title).toContain("password");
  });

  it("filters by category", () => {
    addArticle("Tech Guide", "Software installation instructions.", "tech", ["software"]);
    addArticle("HR Policy", "Leave policy details.", "hr", ["leave"]);
    const answers = queryKnowledgeBase({ question: "software", category: "tech" });
    expect(answers.every(a => a.articleId.startsWith("kb-"))).toBe(true);
  });

  it("returns empty for no matches", () => {
    addArticle("Article", "Some content here.", "general", []);
    const answers = queryKnowledgeBase({ question: "zzzyyyxxx" });
    expect(answers.length).toBe(0);
  });

  it("tracks view counts and returns top articles", () => {
    const a1 = addArticle("Popular", "Popular content.", "general", []);
    queryKnowledgeBase({ question: "popular" });
    queryKnowledgeBase({ question: "popular" });
    const top = getTopArticles(1);
    expect(top[0].articleId).toBe(a1.articleId);
  });

  it("filters by category", () => {
    addArticle("Cat1", "content", "tech", []);
    addArticle("Cat2", "content", "hr", []);
    expect(getArticlesByCategory("tech").length).toBe(1);
  });

  it("resets cleanly", () => {
    addArticle("X", "x", "g", []);
    _resetKnowledgeBaseManagerForTest();
    expect(getArticleCount()).toBe(0);
  });
});
