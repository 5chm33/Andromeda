/**
 * v60.test.ts — The Communication Layer
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerTemplate, generateText, getGeneratedTexts, _resetNaturalLanguageGeneratorForTest } from "./naturalLanguageGenerator";
import { defineIntent, parseIntent, getParsedIntents, _resetIntentParserForTest } from "./intentParser";
import { createSession, addTurn, fillSlot, getSession, _resetDialogueManagerForTest } from "./dialogueManager";
import { registerProfile, generateContextualResponse, _resetContextualResponderForTest } from "./contextualResponder";
import { encodeMultimodal, computeSimilarity, _resetMultimodalEncoderForTest } from "./multimodalEncoder";
import { adaptStyle, getAdaptations, _resetCommunicationStyleAdapterForTest } from "./communicationStyleAdapter";

beforeEach(() => {
  _resetNaturalLanguageGeneratorForTest();
  _resetIntentParserForTest();
  _resetDialogueManagerForTest();
  _resetContextualResponderForTest();
  _resetMultimodalEncoderForTest();
  _resetCommunicationStyleAdapterForTest();
});

describe("naturalLanguageGenerator", () => {
  it("generates text from template with slots", () => {
    const tpl = registerTemplate("Hello, {name}! Your score is {score}.", ["name", "score"], "formal");
    const gen = generateText(tpl.templateId, { name: "Alice", score: "95" });
    expect(gen.text).toBe("Hello, Alice! Your score is 95.");
    expect(gen.wordCount).toBeGreaterThan(0);
  });

  it("throws for unknown template", () => {
    expect(() => generateText("nonexistent", {})).toThrow();
  });

  it("tracks generated texts", () => {
    const tpl = registerTemplate("{greeting} world!", ["greeting"], "casual");
    generateText(tpl.templateId, { greeting: "Hello" });
    expect(getGeneratedTexts()).toHaveLength(1);
  });
});

describe("intentParser", () => {
  it("parses a known intent", () => {
    defineIntent("book_flight", ["book flight to", "fly to", "reserve ticket"], ["destination"]);
    const result = parseIntent("I want to book flight to Paris");
    expect(result.intentName).toBe("book_flight");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("returns unknown intent for unrecognized input", () => {
    const result = parseIntent("xyzzy frobozz");
    expect(result.intentName).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  it("tracks parsed intents", () => {
    defineIntent("greet", ["hello", "hi there"], []);
    parseIntent("hello world");
    expect(getParsedIntents()).toHaveLength(1);
  });
});

describe("dialogueManager", () => {
  it("creates a session with pending slots", () => {
    const session = createSession("book_flight", ["destination", "date"]);
    expect(session.state).toBe("active");
    expect(session.pendingSlots).toHaveLength(2);
  });

  it("completes session when all slots filled", () => {
    const session = createSession("order", ["item", "quantity"]);
    fillSlot(session.sessionId, "item", "pizza");
    fillSlot(session.sessionId, "quantity", "2");
    const updated = getSession(session.sessionId)!;
    expect(updated.state).toBe("completed");
    expect(updated.filledSlots.item).toBe("pizza");
  });

  it("adds turns to session", () => {
    const session = createSession("chat", []);
    addTurn(session.sessionId, "user", "Hello");
    addTurn(session.sessionId, "agent", "Hi there!");
    const updated = getSession(session.sessionId)!;
    expect(updated.turns).toHaveLength(2);
  });

  it("throws for unknown session", () => {
    expect(() => addTurn("nonexistent", "user", "test")).toThrow();
  });
});

describe("contextualResponder", () => {
  it("generates response adapted to user profile", () => {
    registerProfile({ userId: "u1", preferredStyle: "casual", expertiseLevel: "novice" });
    const response = generateContextualResponse("u1", "help_request", ["context1"]);
    expect(response.text).toContain("Hey!");
    expect(response.adaptedToProfile).toBe(true);
  });

  it("generates default formal response for unknown user", () => {
    const response = generateContextualResponse("unknown", "query", []);
    expect(response.adaptedToProfile).toBe(false);
    expect(response.confidence).toBeGreaterThan(0);
  });
});

describe("multimodalEncoder", () => {
  it("encodes multimodal inputs into a vector", () => {
    const enc = encodeMultimodal([
      { modality: "text", data: "Hello world", weight: 0.7 },
      { modality: "numeric", data: 42, weight: 0.3 },
    ]);
    expect(enc.vector).toHaveLength(64);
    expect(enc.modalitiesUsed).toContain("text");
    expect(enc.modalitiesUsed).toContain("numeric");
  });

  it("computes similarity between similar encodings", () => {
    const enc1 = encodeMultimodal([{ modality: "text", data: "cat", weight: 1.0 }]);
    const enc2 = encodeMultimodal([{ modality: "text", data: "cat", weight: 1.0 }]);
    const sim = computeSimilarity(enc1, enc2);
    expect(sim).toBeCloseTo(1.0, 3);
  });

  it("computes lower similarity for different inputs", () => {
    const enc1 = encodeMultimodal([{ modality: "text", data: "apple", weight: 1.0 }]);
    const enc2 = encodeMultimodal([{ modality: "numeric", data: 99999, weight: 1.0 }]);
    const sim = computeSimilarity(enc1, enc2);
    expect(sim).toBeLessThan(1.0);
  });
});

describe("communicationStyleAdapter", () => {
  it("wraps email channel with greeting and sign-off", () => {
    const result = adaptStyle("Please review the attached report.", "email", "professional");
    expect(result.adaptedText).toContain("Dear User");
    expect(result.transformations).toContain("email_wrapper");
  });

  it("serializes to JSON for API channel", () => {
    const result = adaptStyle("Operation successful.", "api", "general");
    const parsed = JSON.parse(result.adaptedText);
    expect(parsed.message).toContain("Operation successful");
  });

  it("simplifies vocabulary for elementary level", () => {
    const result = adaptStyle("We will utilize this to facilitate growth.", "chat", "elementary");
    expect(result.adaptedText).not.toContain("utilize");
    expect(result.adaptedText).not.toContain("facilitate");
  });

  it("tracks adaptations", () => {
    adaptStyle("Test.", "voice", "general");
    expect(getAdaptations()).toHaveLength(1);
  });
});
