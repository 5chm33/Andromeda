/**
 * v82.test.ts — Document Intelligence
 * Comprehensive tests for all 6 v82 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { indexDocument, updateDocument, getDocument, getAllDocuments, getDocumentsByTag, getDocumentsByAuthor, _resetDocumentIndexerForTest } from "./documentIndexer";
import { summarize } from "./documentSummarizer";
import { addClassificationRule, classifyDocument, getRules, _resetDocumentClassifierForTest } from "./documentClassifier";
import { createVersion, getVersion, getLatestVersion, diffVersions, getVersionHistory, getVersionCount, _resetDocumentVersionManagerForTest } from "./documentVersionManager";
import { registerTemplate, renderTemplate, getTemplate, getAllTemplates, _resetDocumentTemplateEngineForTest } from "./documentTemplateEngine";
import { addToSearchIndex, searchDocuments, getIndexedDocumentCount, _resetDocumentSearchEngineForTest } from "./documentSearchEngine";

// ─── documentIndexer ─────────────────────────────────────────────────────────
describe("documentIndexer", () => {
  beforeEach(() => _resetDocumentIndexerForTest());

  it("indexes a document and retrieves it", () => {
    const doc = indexDocument({ title: "Guide", content: "This is a guide.", format: "markdown", author: "alice", tags: ["guide"], metadata: {} });
    expect(doc.docId).toMatch(/^doc-/);
    expect(getDocument(doc.docId)?.title).toBe("Guide");
  });

  it("counts words correctly", () => {
    const doc = indexDocument({ title: "T", content: "one two three four five", format: "txt", author: "bob", tags: [], metadata: {} });
    expect(doc.wordCount).toBe(5);
  });

  it("updates a document", () => {
    const doc = indexDocument({ title: "Old", content: "old content", format: "txt", author: "alice", tags: [], metadata: {} });
    const updated = updateDocument(doc.docId, { title: "New" });
    expect(updated?.title).toBe("New");
  });

  it("filters by tag", () => {
    indexDocument({ title: "A", content: "x", format: "txt", author: "alice", tags: ["tech"], metadata: {} });
    indexDocument({ title: "B", content: "y", format: "txt", author: "bob", tags: ["finance"], metadata: {} });
    expect(getDocumentsByTag("tech").length).toBe(1);
  });

  it("filters by author", () => {
    indexDocument({ title: "A", content: "x", format: "txt", author: "alice", tags: [], metadata: {} });
    indexDocument({ title: "B", content: "y", format: "txt", author: "alice", tags: [], metadata: {} });
    expect(getDocumentsByAuthor("alice").length).toBe(2);
  });

  it("resets cleanly", () => {
    indexDocument({ title: "X", content: "x", format: "txt", author: "a", tags: [], metadata: {} });
    _resetDocumentIndexerForTest();
    expect(getAllDocuments().length).toBe(0);
  });
});

// ─── documentSummarizer ──────────────────────────────────────────────────────
describe("documentSummarizer", () => {
  const longContent = "The quick brown fox jumps over the lazy dog. This sentence is about animals and nature. The fox is a clever animal that lives in forests. Dogs are domesticated animals kept as pets. Nature provides many resources for humans. Animals play important roles in ecosystems. The forest ecosystem is complex and diverse. Many species depend on forests for survival.";

  it("generates a summary shorter than original", () => {
    const result = summarize("doc-1", longContent, "short");
    expect(result.originalWordCount).toBeGreaterThan(result.summaryWordCount);
    expect(result.compressionRatio).toBeLessThan(1);
  });

  it("extracts key phrases", () => {
    const result = summarize("doc-2", longContent);
    expect(result.keyPhrases.length).toBeGreaterThan(0);
  });

  it("handles short content gracefully", () => {
    const result = summarize("doc-3", "Short text.");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("respects length parameter", () => {
    const short = summarize("doc-4", longContent, "short");
    const long = summarize("doc-5", longContent, "long");
    expect(long.summaryWordCount).toBeGreaterThanOrEqual(short.summaryWordCount);
  });

  it("returns correct docId", () => {
    const result = summarize("my-doc", longContent);
    expect(result.docId).toBe("my-doc");
  });
});

// ─── documentClassifier ──────────────────────────────────────────────────────
describe("documentClassifier", () => {
  beforeEach(() => _resetDocumentClassifierForTest());

  it("classifies a document based on keywords", () => {
    addClassificationRule("technology", ["software", "algorithm", "computer", "code"], 1);
    addClassificationRule("finance", ["revenue", "profit", "investment", "market"], 1);
    const result = classifyDocument("doc-1", "The software algorithm processes computer code efficiently.");
    expect(result.topCategory).toBe("technology");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns uncategorized for no matches", () => {
    addClassificationRule("tech", ["software"], 1);
    const result = classifyDocument("doc-2", "The weather is nice today.");
    expect(result.topCategory).toBe("uncategorized");
  });

  it("applies rule weights", () => {
    addClassificationRule("high-priority", ["important"], 10);
    addClassificationRule("low-priority", ["minor"], 1);
    const result = classifyDocument("doc-3", "This is an important document about minor details.");
    expect(result.topCategory).toBe("high-priority");
  });

  it("lists applied rules", () => {
    addClassificationRule("tech", ["software"], 1);
    const result = classifyDocument("doc-4", "The software is great.");
    expect(result.appliedRules.length).toBeGreaterThan(0);
  });

  it("resets cleanly", () => {
    addClassificationRule("tech", ["software"], 1);
    _resetDocumentClassifierForTest();
    expect(getRules().length).toBe(0);
  });
});

// ─── documentVersionManager ──────────────────────────────────────────────────
describe("documentVersionManager", () => {
  beforeEach(() => _resetDocumentVersionManagerForTest());

  it("creates and retrieves versions", () => {
    createVersion("doc-1", "Version 1 content", "alice", "Initial draft");
    const v1 = getVersion("doc-1", 1);
    expect(v1?.content).toBe("Version 1 content");
    expect(v1?.versionNumber).toBe(1);
  });

  it("increments version numbers", () => {
    createVersion("doc-2", "v1", "alice", "Draft");
    createVersion("doc-2", "v2", "bob", "Revision");
    expect(getVersionCount("doc-2")).toBe(2);
    expect(getLatestVersion("doc-2")?.versionNumber).toBe(2);
  });

  it("diffs two versions", () => {
    createVersion("doc-3", "The quick brown fox.", "alice", "v1");
    createVersion("doc-3", "The quick brown fox jumps over the lazy dog.", "alice", "v2");
    const diff = diffVersions("doc-3", 1, 2);
    expect(diff?.changedWords).toBeGreaterThan(0);
  });

  it("returns null for unknown version", () => {
    expect(getVersion("unknown-doc", 1)).toBeNull();
  });

  it("returns version history", () => {
    createVersion("doc-4", "v1", "a", "m1");
    createVersion("doc-4", "v2", "a", "m2");
    expect(getVersionHistory("doc-4").length).toBe(2);
  });

  it("resets cleanly", () => {
    createVersion("doc-5", "content", "a", "m");
    _resetDocumentVersionManagerForTest();
    expect(getVersionCount("doc-5")).toBe(0);
  });
});

// ─── documentTemplateEngine ──────────────────────────────────────────────────
describe("documentTemplateEngine", () => {
  beforeEach(() => _resetDocumentTemplateEngineForTest());

  it("renders a template with variable substitution", () => {
    const tmpl = registerTemplate("Greeting", "Hello, {{name}}! Welcome to {{place}}.");
    const result = renderTemplate(tmpl.templateId, { name: "Alice", place: "Andromeda" });
    expect(result.rendered).toBe("Hello, Alice! Welcome to Andromeda.");
    expect(result.missingVariables.length).toBe(0);
  });

  it("reports missing variables", () => {
    const tmpl = registerTemplate("Report", "Dear {{name}}, your score is {{score}}.");
    const result = renderTemplate(tmpl.templateId, { name: "Bob" });
    expect(result.missingVariables).toContain("score");
  });

  it("processes conditionals", () => {
    const tmpl = registerTemplate("Cond", "Hello{{#if premium}} Premium{{/if}} User!");
    const result = renderTemplate(tmpl.templateId, { premium: true });
    expect(result.rendered).toContain("Premium");
  });

  it("processes loops", () => {
    const tmpl = registerTemplate("List", "Items: {{#each items}}{{item}}, {{/each}}");
    const result = renderTemplate(tmpl.templateId, { items: "apple,banana,cherry" });
    expect(result.rendered).toContain("apple");
    expect(result.rendered).toContain("banana");
  });

  it("returns empty for unknown template", () => {
    const result = renderTemplate("unknown-tmpl", {});
    expect(result.rendered).toBe("");
  });

  it("resets cleanly", () => {
    registerTemplate("X", "{{x}}");
    _resetDocumentTemplateEngineForTest();
    expect(getAllTemplates().length).toBe(0);
  });
});

// ─── documentSearchEngine ────────────────────────────────────────────────────
describe("documentSearchEngine", () => {
  beforeEach(() => _resetDocumentSearchEngineForTest());

  it("indexes and searches documents", () => {
    addToSearchIndex({ docId: "d1", title: "Machine Learning Guide", content: "Machine learning algorithms process data to make predictions.", author: "alice", tags: ["ml"], format: "markdown" });
    const results = searchDocuments({ text: "machine learning" });
    expect(results.length).toBe(1);
    expect(results[0].docId).toBe("d1");
  });

  it("ranks by relevance score", () => {
    addToSearchIndex({ docId: "d2", title: "AI Overview", content: "Artificial intelligence machine learning deep learning neural networks.", author: "bob", tags: ["ai"], format: "txt" });
    addToSearchIndex({ docId: "d3", title: "Finance Report", content: "Revenue profit investment market trends.", author: "carol", tags: ["finance"], format: "txt" });
    const results = searchDocuments({ text: "machine learning" });
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("filters by author", () => {
    addToSearchIndex({ docId: "d4", title: "Tech Article", content: "Software development best practices.", author: "alice", tags: [], format: "txt" });
    addToSearchIndex({ docId: "d5", title: "Tech Article 2", content: "Software architecture patterns.", author: "bob", tags: [], format: "txt" });
    const results = searchDocuments({ text: "software", author: "alice" });
    expect(results.every(r => r.author === "alice")).toBe(true);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) addToSearchIndex({ docId: `d${i+10}`, title: `Doc ${i}`, content: "common keyword appears here", author: "a", tags: [], format: "txt" });
    const results = searchDocuments({ text: "common keyword", limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for no matches", () => {
    addToSearchIndex({ docId: "d20", title: "X", content: "unrelated content", author: "a", tags: [], format: "txt" });
    const results = searchDocuments({ text: "zzzyyyxxx" });
    expect(results.length).toBe(0);
  });

  it("resets cleanly", () => {
    addToSearchIndex({ docId: "d99", title: "X", content: "x", author: "a", tags: [], format: "txt" });
    _resetDocumentSearchEngineForTest();
    expect(getIndexedDocumentCount()).toBe(0);
  });
});
