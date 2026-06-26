/**
 * v58.test.ts — The Memory Palace
 */
import { describe, it, expect, beforeEach } from "vitest";
import { storeEpisode, recallEpisode, searchEpisodes, getMostImportantMemories, _resetEpisodicMemoryStoreForTest } from "./episodicMemoryStore";
import { indexFact, queryFacts, getFactCount, _resetSemanticMemoryIndexForTest } from "./semanticMemoryIndex";
import { pushToWorkingMemory, getWorkingMemory, focusAttention, setCapacity, clearWorkingMemory, _resetWorkingMemoryBufferForTest } from "./workingMemoryBuffer";
import { consolidateMemories, getConsolidationLog, _resetMemoryConsolidatorForTest } from "./memoryConsolidator";
import { indexMemory, retrieveByAssociation, getQueryCount, _resetMemoryRetrievalOptimizerForTest } from "./memoryRetrievalOptimizer";
import { createTrace, reviewTrace, getDueForReview, updateRetrievability, _resetForgettingCurveManagerForTest } from "./forgettingCurveManager";

beforeEach(() => {
  _resetEpisodicMemoryStoreForTest();
  _resetSemanticMemoryIndexForTest();
  _resetWorkingMemoryBufferForTest();
  _resetMemoryConsolidatorForTest();
  _resetMemoryRetrievalOptimizerForTest();
  _resetForgettingCurveManagerForTest();
});

describe("episodicMemoryStore", () => {
  it("stores and recalls an episode", () => {
    const mem = storeEpisode("First login", { user: "alice" }, 0.8, 0.9);
    const recalled = recallEpisode(mem.memoryId)!;
    expect(recalled.event).toBe("First login");
    expect(recalled.accessCount).toBe(1);
  });

  it("returns null for unknown memory", () => {
    expect(recallEpisode("nonexistent")).toBeNull();
  });

  it("searches episodes by keyword", () => {
    storeEpisode("User logged in", {}, 0.5, 0.7);
    storeEpisode("System error occurred", {}, -0.8, 0.9);
    const results = searchEpisodes("logged");
    expect(results).toHaveLength(1);
    expect(results[0].event).toContain("logged");
  });

  it("returns most important memories", () => {
    storeEpisode("Low importance", {}, 0, 0.1);
    storeEpisode("High importance", {}, 0.9, 0.95);
    const top = getMostImportantMemories(1);
    expect(top[0].event).toBe("High importance");
  });
});

describe("semanticMemoryIndex", () => {
  it("indexes and queries facts", () => {
    indexFact("Paris", "is_capital_of", "France", 1.0, "geography");
    indexFact("Berlin", "is_capital_of", "Germany", 1.0, "geography");
    const results = queryFacts("Paris");
    expect(results).toHaveLength(1);
    expect(results[0].object).toBe("France");
  });

  it("queries by relation", () => {
    indexFact("Water", "boils_at", "100C", 1.0, "chemistry");
    indexFact("Ice", "melts_at", "0C", 1.0, "chemistry");
    const results = queryFacts(undefined, "boils");
    expect(results).toHaveLength(1);
  });

  it("tracks fact count", () => {
    expect(getFactCount()).toBe(0);
    indexFact("A", "rel", "B", 0.9, "test");
    expect(getFactCount()).toBe(1);
  });
});

describe("workingMemoryBuffer", () => {
  it("stores items in working memory", () => {
    pushToWorkingMemory("Task A", 0.8);
    pushToWorkingMemory("Task B", 0.6);
    expect(getWorkingMemory()).toHaveLength(2);
  });

  it("evicts lowest attention item when capacity exceeded", () => {
    setCapacity(3);
    pushToWorkingMemory("High", 0.9);
    pushToWorkingMemory("Medium", 0.5);
    pushToWorkingMemory("Low", 0.1);
    pushToWorkingMemory("New", 0.7);
    const mem = getWorkingMemory();
    expect(mem).toHaveLength(3);
    expect(mem.find(i => i.content === "Low")).toBeUndefined();
  });

  it("boosts attention weight on focus", () => {
    const item = pushToWorkingMemory("Focus target", 0.3);
    focusAttention(item.itemId, 0.4);
    const updated = getWorkingMemory().find(i => i.itemId === item.itemId)!;
    expect(updated.attentionWeight).toBeCloseTo(0.7, 1);
  });

  it("clears working memory", () => {
    pushToWorkingMemory("A", 0.5);
    clearWorkingMemory();
    expect(getWorkingMemory()).toHaveLength(0);
  });
});

describe("memoryConsolidator", () => {
  it("consolidates items above threshold", () => {
    const items = [
      { content: "Important", attentionWeight: 0.8 },
      { content: "Trivial", attentionWeight: 0.2 },
      { content: "Moderate", attentionWeight: 0.5 },
    ];
    const record = consolidateMemories(items, 0.4);
    expect(record.itemsConsolidated).toBe(2);
    expect(record.strengthGained).toBeGreaterThan(0);
  });

  it("records consolidation log", () => {
    consolidateMemories([{ content: "A", attentionWeight: 0.9 }]);
    expect(getConsolidationLog()).toHaveLength(1);
  });
});

describe("memoryRetrievalOptimizer", () => {
  it("retrieves memories by association", () => {
    indexMemory("m1", "The quick brown fox", ["fox", "quick", "animal"]);
    indexMemory("m2", "A lazy dog", ["dog", "lazy", "animal"]);
    const results = retrieveByAssociation([{ cue: "animal", strength: 1.0 }]);
    expect(results.length).toBe(2);
  });

  it("ranks by relevance score", () => {
    indexMemory("m3", "Highly relevant", ["topic", "important", "key"]);
    indexMemory("m4", "Less relevant", ["topic"]);
    const results = retrieveByAssociation([
      { cue: "topic", strength: 0.5 },
      { cue: "important", strength: 0.8 },
      { cue: "key", strength: 0.9 },
    ]);
    expect(results[0].memoryId).toBe("m3");
  });

  it("tracks query count", () => {
    retrieveByAssociation([{ cue: "test", strength: 0.5 }]);
    expect(getQueryCount()).toBe(1);
  });
});

describe("forgettingCurveManager", () => {
  it("creates a memory trace", () => {
    const trace = createTrace("Learn TypeScript", 2.0);
    expect(trace.retrievability).toBe(1.0);
    expect(trace.stability).toBe(2.0);
  });

  it("increases stability on successful review", () => {
    const trace = createTrace("Vocabulary word", 1.0);
    const updated = reviewTrace(trace.traceId, true)!;
    expect(updated.stability).toBeGreaterThan(1.0);
    expect(updated.retrievability).toBe(1.0);
  });

  it("decreases stability on failed recall", () => {
    const trace = createTrace("Hard concept", 2.0);
    const updated = reviewTrace(trace.traceId, false)!;
    expect(updated.stability).toBeLessThan(2.0);
  });

  it("updates retrievability based on elapsed time", () => {
    const trace = createTrace("Old memory", 1.0);
    const updated = updateRetrievability(trace.traceId)!;
    expect(updated.retrievability).toBeGreaterThanOrEqual(0);
    expect(updated.retrievability).toBeLessThanOrEqual(1);
  });

  it("returns null for unknown trace", () => {
    expect(reviewTrace("nonexistent", true)).toBeNull();
  });
});
