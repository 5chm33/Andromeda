/**
 * v91.test.ts — Cognitive Architecture & Memory Systems
 * Comprehensive tests for all 6 v91 modules.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createWorkingMemory, store, retrieve, rehearse, decay, getStore, getActiveChunks, _resetWorkingMemoryForTest } from "./workingMemory";
import { createSemanticMemory, addConcept, addRelation, queryConcept, getRelatedConcepts, getStore as getSemanticStore, _resetSemanticMemoryForTest } from "./semanticMemory";
import { defineSkill, executeSkill, getSkillsByDomain, getSkillsByStatus, getSkill, getSuccessRate, _resetProceduralMemoryForTest } from "./proceduralMemory";
import { createAttentionController, addStimulus, computeAttention, getController, clearBuffer, _resetAttentionMechanismForTest } from "./attentionMechanism";
import { createCognitiveArchitecture, startCycle, updateCycleState, completeCycle, getArchitecture, _resetCognitiveControllerForTest } from "./cognitiveController";
import { createMemoryIndex, indexMemory, searchMemory, getImportantMemories, getIndex, _resetMemoryIndexerForTest } from "./memoryIndexer";

// ─── workingMemory ───────────────────────────────────────────────────────────
describe("workingMemory", () => {
  beforeEach(() => _resetWorkingMemoryForTest());

  it("creates a working memory store", () => {
    const wm = createWorkingMemory("agent-1");
    expect(wm.storeId).toMatch(/^wm-/);
    expect(wm.capacity).toBe(7);
  });

  it("stores and retrieves chunks", () => {
    const wm = createWorkingMemory("agent-2");
    store(wm.storeId, { data: "hello" }, "greeting");
    const chunk = retrieve(wm.storeId, "greeting");
    expect(chunk).not.toBeNull();
    expect(chunk!.label).toBe("greeting");
  });

  it("evicts lowest activation at capacity", () => {
    const wm = createWorkingMemory("agent-3", 3);
    store(wm.storeId, "a", "item-a");
    store(wm.storeId, "b", "item-b");
    store(wm.storeId, "c", "item-c");
    store(wm.storeId, "d", "item-d"); // should evict one
    expect(getStore(wm.storeId)!.chunks.length).toBe(3);
    expect(getStore(wm.storeId)!.evictionCount).toBe(1);
  });

  it("rehearsal increases activation", () => {
    const wm = createWorkingMemory("agent-4");
    const chunk = store(wm.storeId, "x", "item-x")!;
    // Decay activation first so rehearsal has room to increase it
    chunk.activationLevel = 0.5;
    const before = chunk.activationLevel;
    rehearse(wm.storeId, chunk.chunkId);
    expect(chunk.activationLevel).toBeGreaterThan(before);
  });

  it("decay reduces activation", () => {
    const wm = createWorkingMemory("agent-5");
    const chunk = store(wm.storeId, "y", "item-y", 10)!; // high decay rate
    chunk.lastAccessedAt = Date.now() - 5000; // simulate 5s ago
    decay(wm.storeId);
    // chunk should be removed due to high decay
    expect(getActiveChunks(wm.storeId).length).toBe(0);
  });

  it("resets cleanly", () => {
    createWorkingMemory("a");
    _resetWorkingMemoryForTest();
    expect(getStore("wm-1")).toBeUndefined();
  });
});

// ─── semanticMemory ──────────────────────────────────────────────────────────
describe("semanticMemory", () => {
  beforeEach(() => _resetSemanticMemoryForTest());

  it("creates semantic memory", () => {
    const sm = createSemanticMemory();
    expect(sm.storeId).toMatch(/^sm-/);
  });

  it("adds and queries concepts", () => {
    const sm = createSemanticMemory();
    addConcept(sm.storeId, "Dog", "animal", { legs: 4 });
    const concept = queryConcept(sm.storeId, "Dog");
    expect(concept).not.toBeNull();
    expect(concept!.category).toBe("animal");
  });

  it("adds relations between concepts", () => {
    const sm = createSemanticMemory();
    const dog = addConcept(sm.storeId, "Dog", "animal")!;
    const mammal = addConcept(sm.storeId, "Mammal", "category")!;
    addRelation(sm.storeId, dog.conceptId, mammal.conceptId, "is_a");
    const related = getRelatedConcepts(sm.storeId, dog.conceptId, "is_a");
    expect(related.length).toBe(1);
    expect(related[0].name).toBe("Mammal");
  });

  it("bidirectional relations work both ways", () => {
    const sm = createSemanticMemory();
    const a = addConcept(sm.storeId, "A", "cat")!;
    const b = addConcept(sm.storeId, "B", "cat")!;
    addRelation(sm.storeId, a.conceptId, b.conceptId, "related_to", 1.0, true);
    expect(getRelatedConcepts(sm.storeId, b.conceptId).length).toBe(1);
  });

  it("returns null for unknown concept", () => {
    const sm = createSemanticMemory();
    expect(queryConcept(sm.storeId, "NonExistent")).toBeNull();
  });
});

// ─── proceduralMemory ────────────────────────────────────────────────────────
describe("proceduralMemory", () => {
  beforeEach(() => _resetProceduralMemoryForTest());

  it("defines a skill", () => {
    const skill = defineSkill("Drive", "transport", [{ action: "start_engine", parameters: {}, expectedOutcome: "engine_running" }]);
    expect(skill.skillId).toMatch(/^sk-/);
    expect(skill.status).toBe("novice");
  });

  it("executes skill and tracks stats", () => {
    const skill = defineSkill("Type", "computer", []);
    executeSkill(skill.skillId, true, 100);
    expect(getSkill(skill.skillId)!.executionCount).toBe(1);
    expect(getSuccessRate(skill.skillId)).toBe(1.0);
  });

  it("advances skill status with practice", () => {
    const skill = defineSkill("Code", "programming", []);
    for (let i = 0; i < 55; i++) executeSkill(skill.skillId, true, 50);
    expect(["proficient", "expert", "automatic"]).toContain(getSkill(skill.skillId)!.status);
  });

  it("filters skills by domain", () => {
    defineSkill("Swim", "sports", []);
    defineSkill("Run", "sports", []);
    defineSkill("Code", "tech", []);
    expect(getSkillsByDomain("sports").length).toBe(2);
  });

  it("resets cleanly", () => {
    defineSkill("X", "y", []);
    _resetProceduralMemoryForTest();
    expect(getSkill("sk-1")).toBeUndefined();
  });
});

// ─── attentionMechanism ──────────────────────────────────────────────────────
describe("attentionMechanism", () => {
  beforeEach(() => _resetAttentionMechanismForTest());

  it("creates attention controller", () => {
    const ac = createAttentionController("agent-1");
    expect(ac.controllerId).toMatch(/^ac-/);
  });

  it("adds stimuli above threshold", () => {
    const ac = createAttentionController("agent-2", 0.3);
    addStimulus(ac.controllerId, "visual", "red light", 0.9, 0.8, 0.7);
    expect(getController(ac.controllerId)!.stimulusBuffer.length).toBe(1);
  });

  it("filters stimuli below threshold", () => {
    const ac = createAttentionController("agent-3", 0.5);
    addStimulus(ac.controllerId, "noise", "background", 0.1, 0.1, 0.1);
    expect(getController(ac.controllerId)!.stimulusBuffer.length).toBe(0);
  });

  it("computes attention focus", () => {
    const ac = createAttentionController("agent-4");
    addStimulus(ac.controllerId, "visual", "alert", 0.9, 0.8, 0.7);
    addStimulus(ac.controllerId, "audio", "beep", 0.6, 0.5, 0.4);
    const focus = computeAttention(ac.controllerId, 2);
    expect(focus).not.toBeNull();
    expect(focus!.topStimuli.length).toBeLessThanOrEqual(2);
  });

  it("attention weights sum to ~1", () => {
    const ac = createAttentionController("agent-5");
    addStimulus(ac.controllerId, "t1", "s1", 0.8, 0.7, 0.6);
    addStimulus(ac.controllerId, "t2", "s2", 0.6, 0.5, 0.4);
    const focus = computeAttention(ac.controllerId, 2);
    const sum = Object.values(focus!.attentionWeights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("clears buffer", () => {
    const ac = createAttentionController("agent-6");
    addStimulus(ac.controllerId, "t", "s", 0.9, 0.9, 0.9);
    clearBuffer(ac.controllerId);
    expect(getController(ac.controllerId)!.stimulusBuffer.length).toBe(0);
  });
});

// ─── cognitiveController ─────────────────────────────────────────────────────
describe("cognitiveController", () => {
  beforeEach(() => _resetCognitiveControllerForTest());

  it("creates cognitive architecture", () => {
    const arch = createCognitiveArchitecture("agent-1");
    expect(arch.architectureId).toMatch(/^ca-/);
    expect(arch.currentState).toBe("idle");
  });

  it("starts and completes a cycle", () => {
    const arch = createCognitiveArchitecture("agent-2");
    const cycle = startCycle(arch.architectureId)!;
    expect(cycle.cycleId).toMatch(/^cyc-/);
    completeCycle(arch.architectureId, cycle.cycleId);
    expect(getArchitecture(arch.architectureId)!.currentState).toBe("idle");
    expect(getArchitecture(arch.architectureId)!.totalCycles).toBe(1);
  });

  it("updates cycle state", () => {
    const arch = createCognitiveArchitecture("agent-3");
    const cycle = startCycle(arch.architectureId)!;
    updateCycleState(arch.architectureId, cycle.cycleId, "reasoning", 5, 2, 1, { wm: 0.4, att: 0.3, proc: 0.5 });
    expect(arch.currentState).toBe("reasoning");
  });

  it("detects cognitive overload", () => {
    const arch = createCognitiveArchitecture("agent-4");
    const cycle = startCycle(arch.architectureId)!;
    updateCycleState(arch.architectureId, cycle.cycleId, "executing", 10, 5, 3, { wm: 0.95, att: 0.9, proc: 0.92 });
    expect(cycle.cognitiveLoad.overloaded).toBe(true);
  });

  it("tracks average cycle time", () => {
    const arch = createCognitiveArchitecture("agent-5");
    const c1 = startCycle(arch.architectureId)!;
    completeCycle(arch.architectureId, c1.cycleId);
    expect(getArchitecture(arch.architectureId)!.avgCycleTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── memoryIndexer ───────────────────────────────────────────────────────────
describe("memoryIndexer", () => {
  beforeEach(() => _resetMemoryIndexerForTest());

  it("creates a memory index", () => {
    const idx = createMemoryIndex("agent-1");
    expect(idx.indexId).toMatch(/^mi-/);
  });

  it("indexes and searches memories", () => {
    const idx = createMemoryIndex("agent-2");
    indexMemory(idx.indexId, "Paris meeting", ["meeting", "travel"], "episodic", "store-1", "item-1", 0.8);
    const results = searchMemory(idx.indexId, "Paris meeting");
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("exact");
  });

  it("partial match search", () => {
    const idx = createMemoryIndex("agent-3");
    indexMemory(idx.indexId, "Paris conference 2024", ["conference"], "episodic", "s1", "i1", 0.7);
    const results = searchMemory(idx.indexId, "Paris");
    expect(results.length).toBe(1);
    expect(results[0].matchType).toBe("partial");
  });

  it("returns important memories", () => {
    const idx = createMemoryIndex("agent-4");
    indexMemory(idx.indexId, "Critical event", ["important"], "episodic", "s1", "i1", 0.95);
    indexMemory(idx.indexId, "Minor note", [], "working", "s2", "i2", 0.2);
    const important = getImportantMemories(idx.indexId, 0.7);
    expect(important.length).toBe(1);
    expect(important[0].label).toBe("Critical event");
  });

  it("resets cleanly", () => {
    createMemoryIndex("a");
    _resetMemoryIndexerForTest();
    expect(getIndex("mi-1")).toBeUndefined();
  });
});
