import { describe, it, expect } from "vitest";
import {
  recordRsiCycle,
  recordLlmCall,
  recordEvalScore,
  recordError,
  initTelemetry,
} from "./telemetry.js";

describe("telemetry", () => {
  it("initTelemetry is exported as a function", () => {
    expect(typeof initTelemetry).toBe("function");
  });

  it("recordRsiCycle accepts a valid RsiCycleSample and does not throw", () => {
    expect(() => recordRsiCycle({
      cycleId: "test-cycle-1",
      durationMs: 1200,
      proposalsGenerated: 5,
      proposalsApplied: 3,
      evalScore: 0.87,
    })).not.toThrow();
  });

  it("recordLlmCall accepts a valid LlmCallSample and does not throw", () => {
    expect(() => recordLlmCall({
      model: "gpt-4o",
      inputTokens: 512,
      outputTokens: 128,
      latencyMs: 340,
      cost: 0.002,
      success: true,
    })).not.toThrow();
  });

  it("recordEvalScore accepts a valid EvalScoreSample and does not throw", () => {
    expect(() => recordEvalScore({
      evalId: "eval-001",
      score: 0.92,
      category: "readability",
    })).not.toThrow();
  });

  it("recordError accepts a valid ErrorSample and does not throw", () => {
    expect(() => recordError({
      errorType: "TypeCheckFailed",
      module: "selfImprove",
      message: "TS2345: Argument type mismatch",
      fatal: false,
    })).not.toThrow();
  });

  it("recordRsiCycle with evalScore null does not throw", () => {
    expect(() => recordRsiCycle({
      cycleId: "test-cycle-null",
      durationMs: 800,
      proposalsGenerated: 2,
      proposalsApplied: 1,
      evalScore: null,
    })).not.toThrow();
  });
});
