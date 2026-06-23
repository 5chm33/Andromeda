import { describe, it, expect } from "vitest";
import {
  recordInteraction,
  logDecision,
  updateDecisionOutcome,
  getRecentDecisions,
  getRecentReflections,
  triggerReflection,
} from "./selfReflectionEngine.js";

describe("selfReflectionEngine", () => {
  it("recordInteraction does not throw for success type", () => {
    expect(() => recordInteraction("success", "Applied: improve readability in utils.ts")).not.toThrow();
  });

  it("recordInteraction does not throw for failure type", () => {
    expect(() => recordInteraction("failure", "TypeScript check failed after patch")).not.toThrow();
  });

  it("logDecision does not throw with valid DecisionEntry", () => {
    expect(() => logDecision({
      decisionType: "self_modification",
      context: "server/utils.ts",
      alternativesConsidered: ["option A", "option B"],
      chosenApproach: "option A",
      rationale: "Lower complexity",
      outcome: "success",
      outcomeNotes: "Confidence: 0.87",
    })).not.toThrow();
  });

  it("updateDecisionOutcome does not throw with valid args", () => {
    expect(() => updateDecisionOutcome(
      "server/utils.ts",
      "success",
      "Applied: improve readability (confidence: 0.87)"
    )).not.toThrow();
  });

  it("getRecentDecisions returns an array", () => {
    const decisions = getRecentDecisions(10);
    expect(Array.isArray(decisions)).toBe(true);
  });

  it("getRecentReflections returns an array", () => {
    const reflections = getRecentReflections(5);
    expect(Array.isArray(reflections)).toBe(true);
  });

  it("triggerReflection resolves to ReflectionEntry or null", async () => {
    const result = await triggerReflection();
    // May return null if not enough decisions yet
    expect(result === null || typeof result === "object").toBe(true);
  }, 15000);
});
