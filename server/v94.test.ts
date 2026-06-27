/**
 * v94.test.ts — Emergent Communication & Language Grounding
 */
import { describe, it, expect, beforeEach } from "vitest";

import { groundSymbol, groundText, getSymbol, getAllSymbols, _resetLanguageGrounderForTest } from "./languageGrounder";
import { addMapping, storeEmbedding, findSimilarSymbols, getMappings, getEmbedding, _resetSymbolMapperForTest } from "./symbolMapper";
import { analyzeUtterance, getAnalyses, _resetPragmaticReasonerForTest } from "./pragmaticReasoner";
import { createDiscourse, addTurn, getDiscourse, getUnits, _resetDiscourseManagerForTest } from "./discourseManager";
import { startConversation, sendMessage, acknowledgeMessage, closeConversation, getThread, getMessages, _resetCommunicationProtocolForTest } from "./communicationProtocol";
import { createDialogContext, processDialogTurn, getContext, getTurns, addSharedBelief, _resetGroundedDialogManagerForTest } from "./groundedDialogManager";

// ─── languageGrounder ─────────────────────────────────────────────────────────
describe("languageGrounder", () => {
  beforeEach(() => _resetLanguageGrounderForTest());

  it("grounds a symbol", () => {
    const sym = groundSymbol("red", { hue: 0, saturation: 1 }, { category: "color" });
    expect(sym.symbolId).toMatch(/^gs-/);
    expect(sym.word).toBe("red");
  });

  it("grounds text and returns grounded symbols", () => {
    groundSymbol("cat", { size: 0.3 }, { animal: true });
    groundSymbol("big", { scale: 2 }, { modifier: true });
    const result = groundText("big cat");
    expect(result.groundedSymbols.length).toBe(2);
    expect(result.overallGroundingScore).toBe(1.0);
  });

  it("tracks ungrounded tokens", () => {
    groundSymbol("known", {}, {});
    const result = groundText("known unknown word");
    expect(result.ungroundedTokens).toContain("unknown");
  });

  it("updates existing symbol on re-grounding", () => {
    groundSymbol("blue", { hue: 240 }, {});
    groundSymbol("blue", { saturation: 0.9 }, { color: true }, 0.95);
    expect(getAllSymbols().length).toBe(1);
    expect(getSymbol("blue")!.groundingConfidence).toBe(0.95);
  });

  it("returns null for unknown symbol", () => {
    expect(getSymbol("nonexistent")).toBeNull();
  });
});

// ─── symbolMapper ─────────────────────────────────────────────────────────────
describe("symbolMapper", () => {
  beforeEach(() => _resetSymbolMapperForTest());

  it("adds a symbol mapping", () => {
    const m = addMapping("happy", "joyful", "synonym", 0.95);
    expect(m.mappingId).toMatch(/^sm-/);
  });

  it("stores and retrieves embeddings", () => {
    storeEmbedding("king", [1, 0, 1, 0]);
    expect(getEmbedding("king")).toBeDefined();
  });

  it("finds similar symbols by embedding", () => {
    storeEmbedding("king", [1, 0, 1, 0]);
    storeEmbedding("queen", [0.9, 0.1, 0.9, 0.1]);
    storeEmbedding("car", [0, 1, 0, 1]);
    const similar = findSimilarSymbols("king", 1);
    expect(similar[0].symbol).toBe("queen");
  });

  it("retrieves mappings by type", () => {
    addMapping("hot", "cold", "antonym", 0.99);
    addMapping("hot", "warm", "synonym", 0.8);
    expect(getMappings("hot", "antonym").length).toBe(1);
  });

  it("bidirectional mapping works both ways", () => {
    addMapping("A", "B", "synonym", 0.9, true);
    expect(getMappings("B").length).toBe(1);
  });
});

// ─── pragmaticReasoner ────────────────────────────────────────────────────────
describe("pragmaticReasoner", () => {
  beforeEach(() => _resetPragmaticReasonerForTest());

  it("detects question speech act", () => {
    const analysis = analyzeUtterance("What is the weather?", "user-1");
    expect(analysis.speechAct).toBe("question");
  });

  it("detects request speech act", () => {
    const analysis = analyzeUtterance("Can you help me?", "user-2");
    expect(analysis.speechAct).toBe("request");
  });

  it("detects scalar implicature", () => {
    const analysis = analyzeUtterance("Some students passed the exam", "user-3");
    expect(analysis.implicatures.some(i => i.type === "scalar")).toBe(true);
  });

  it("detects conversational implicature", () => {
    const analysis = analyzeUtterance("Can you open the door?", "user-4");
    expect(analysis.implicatures.some(i => i.type === "conversational")).toBe(true);
  });

  it("retrieves analyses by speaker", () => {
    analyzeUtterance("Hello", "speaker-A");
    analyzeUtterance("Hi", "speaker-B");
    expect(getAnalyses("speaker-A").length).toBe(1);
  });
});

// ─── discourseManager ─────────────────────────────────────────────────────────
describe("discourseManager", () => {
  beforeEach(() => _resetDiscourseManagerForTest());

  it("creates a discourse", () => {
    const d = createDiscourse("Meeting");
    expect(d.discourseId).toMatch(/^disc-/);
    expect(d.turnCount).toBe(0);
  });

  it("adds turns", () => {
    const d = createDiscourse("Chat");
    addTurn(d.discourseId, "Hello", "user-1", ["greeting"]);
    addTurn(d.discourseId, "Hi there", "agent-1", ["greeting"]);
    expect(getDiscourse(d.discourseId)!.turnCount).toBe(2);
  });

  it("tracks participants", () => {
    const d = createDiscourse("Multi");
    addTurn(d.discourseId, "Hi", "alice", []);
    addTurn(d.discourseId, "Hello", "bob", []);
    expect(getDiscourse(d.discourseId)!.participants.size).toBe(2);
  });

  it("filters units by speaker", () => {
    const d = createDiscourse("Filter");
    addTurn(d.discourseId, "A says", "alice", []);
    addTurn(d.discourseId, "B says", "bob", []);
    expect(getUnits(d.discourseId, "alice").length).toBe(1);
  });

  it("updates coherence score", () => {
    const d = createDiscourse("Coherent");
    addTurn(d.discourseId, "About weather", "u1", ["weather"]);
    addTurn(d.discourseId, "More weather", "u2", ["weather"]);
    expect(getDiscourse(d.discourseId)!.coherenceScore).toBeGreaterThan(0.5);
  });
});

// ─── communicationProtocol ────────────────────────────────────────────────────
describe("communicationProtocol", () => {
  beforeEach(() => _resetCommunicationProtocolForTest());

  it("starts a conversation", () => {
    const thread = startConversation(["agent-1", "agent-2"]);
    expect(thread.conversationId).toMatch(/^conv-/);
    expect(thread.status).toBe("active");
  });

  it("sends a message", () => {
    const thread = startConversation(["a", "b"]);
    const msg = sendMessage(thread.conversationId, "a", "b", "inform", "Hello");
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("inform");
  });

  it("acknowledges a message", () => {
    const thread = startConversation(["a", "b"]);
    const msg = sendMessage(thread.conversationId, "a", "b", "query", "Status?")!;
    acknowledgeMessage(msg.messageId);
    expect(msg.acknowledged).toBe(true);
  });

  it("closes conversation", () => {
    const thread = startConversation(["a", "b"]);
    closeConversation(thread.conversationId);
    expect(getThread(thread.conversationId)!.status).toBe("completed");
  });

  it("filters messages by type", () => {
    const thread = startConversation(["a", "b"]);
    sendMessage(thread.conversationId, "a", "b", "inform", "info");
    sendMessage(thread.conversationId, "b", "a", "query", "question?");
    expect(getMessages(thread.conversationId, "inform").length).toBe(1);
  });
});

// ─── groundedDialogManager ────────────────────────────────────────────────────
describe("groundedDialogManager", () => {
  beforeEach(() => _resetGroundedDialogManagerForTest());

  it("creates dialog context", () => {
    const ctx = createDialogContext("session-1");
    expect(ctx.contextId).toMatch(/^dc-/);
    expect(ctx.turnCount).toBe(0);
  });

  it("processes a dialog turn", () => {
    const turn = processDialogTurn("session-2", "user", "Tell me about the cat", [{ name: "cat", type: "animal", attributes: { legs: 4 } }]);
    expect(turn).not.toBeNull();
    expect(turn!.groundedEntities).toContain("cat");
  });

  it("resolves pronouns from context", () => {
    processDialogTurn("session-3", "user", "I see a dog", [{ name: "dog", type: "animal", attributes: {} }]);
    const turn = processDialogTurn("session-3", "user", "It is big");
    expect(turn!.resolvedReferences["It"] ?? turn!.resolvedReferences["it"]).toBe("dog");
  });

  it("tracks shared beliefs", () => {
    createDialogContext("session-4");
    addSharedBelief("session-4", "earth_is_round", true);
    expect(getContext("session-4")!.sharedBeliefs["earth_is_round"]).toBe(true);
  });

  it("retrieves turns by session", () => {
    processDialogTurn("session-5", "u", "Hello");
    processDialogTurn("session-5", "a", "Hi");
    expect(getTurns("session-5").length).toBe(2);
  });
});
