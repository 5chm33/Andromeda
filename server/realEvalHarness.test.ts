import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./andromedaDb.js", () => {
  return {
    recordEval: vi.fn(),
    getEvalsForReplay: vi.fn().mockReturnValue([
      { id: 1, query: "Test query 1", response: "Old response 1" },
      { id: 2, query: "Test query 2", response: "Old response 2" },
      { id: 3, query: "Test query 3", response: "Old response 3" }
    ]),
    markEvalReplayed: vi.fn()
  };
});

vi.mock("./llmProvider.js", () => {
  return {
    getProviderApiKey: vi.fn().mockReturnValue("fake-key"),
    chatCompletion: vi.fn(async (messages) => {
      const query = messages[0].content;
      if (query === "Test query 1") return { content: "New response 1 (better)" };
      if (query === "Test query 2") return { content: "New response 2 (worse)" };
      return { content: "Old response 3" };
    })
  };
});

// Mock fetch for the openrouter call
global.fetch = vi.fn(async (url, options) => {
  const body = JSON.parse(options.body);
  const prompt = body.messages[0].content;
  
  let score = 50;
  
  if (prompt.includes("Old response 1")) score = 70;
  if (prompt.includes("New response 1 (better)")) score = 85; // +15 (improved)
  
  if (prompt.includes("Old response 2")) score = 80;
  if (prompt.includes("New response 2 (worse)")) score = 60; // -20 (degraded)
  
  if (prompt.includes("Old response 3")) score = 75; // Neutral
  
  return {
    ok: true,
    json: async () => ({
      choices: [
        { message: { content: `{"score": ${score}, "reason": "Test"}` } }
      ]
    })
  };
}) as any;

describe("realEvalHarness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset state via a hack (or just let it run)
    // _isRunning should be false
  });

  it("should record interactions correctly based on probability", async () => {
    const { recordRealInteraction } = await import("./realEvalHarness");
    const { recordEval } = await import("./andromedaDb");
    
    // Mock Math.random to always record
    const origRandom = Math.random;
    Math.random = () => 0.1;
    
    recordRealInteraction({
      sessionId: "s1",
      query: "This is a long enough query to be recorded",
      response: "Response"
    });
    
    expect(recordEval).toHaveBeenCalled();
    
    // Mock Math.random to never record
    Math.random = () => 0.9;
    vi.clearAllMocks();
    
    recordRealInteraction({
      sessionId: "s1",
      query: "This is a long enough query to be recorded",
      response: "Response"
    });
    
    expect(recordEval).not.toHaveBeenCalled();
    
    Math.random = origRandom;
  });

  it("should skip recording short queries", async () => {
    const { recordRealInteraction } = await import("./realEvalHarness");
    const { recordEval } = await import("./andromedaDb");
    
    const origRandom = Math.random;
    Math.random = () => 0.1;
    
    recordRealInteraction({
      sessionId: "s1",
      query: "Short",
      response: "Response"
    });
    
    expect(recordEval).not.toHaveBeenCalled();
    Math.random = origRandom;
  });

  it("should run the eval harness and generate a report", async () => {
    const { runEvalHarness, getLastEvalHarnessReport, isEvalHarnessRunning } = await import("./realEvalHarness");
    
    expect(isEvalHarnessRunning()).toBe(false);
    
    const report = await runEvalHarness();
    
    expect(report.totalReplayed).toBe(3);
    expect(report.improved).toBe(1);
    expect(report.degraded).toBe(1);
    expect(report.neutral).toBe(1);
    
    expect(report.worstQueries.length).toBeGreaterThan(0);
    expect(report.worstQueries[0].verdict).toBe("degraded");
    
    const lastReport = getLastEvalHarnessReport();
    expect(lastReport).toEqual(report);
  });

  it("should return degraded query targets", async () => {
    const { getDegradedQueryTargets } = await import("./realEvalHarness");
    
    const targets = getDegradedQueryTargets();
    expect(targets.length).toBe(1);
    expect(targets[0].query).toBe("Test query 2");
  });
  
  it("should prevent concurrent runs", async () => {
    const { runEvalHarness } = await import("./realEvalHarness");
    
    const p1 = runEvalHarness();
    const p2 = runEvalHarness();
    
    await expect(p2).rejects.toThrow("Already running");
    await p1;
  });
});
