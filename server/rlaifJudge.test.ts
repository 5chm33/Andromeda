import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("./logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })
}));

const mockRun = vi.fn();
const mockAll = vi.fn();
const mockPrepare = vi.fn(() => ({
  all: mockAll,
  run: mockRun
}));

vi.mock("./andromedaDb.js", () => ({
  getDb: () => ({
    prepare: mockPrepare
  })
}));

vi.mock("./llmProvider.js", () => ({
  getProviderForTier: vi.fn().mockReturnValue("pro-provider"),
  chatCompletion: vi.fn(async (messages) => {
    const prompt = messages[0].content;
    
    if (prompt.includes("perfect query")) {
      return { content: JSON.stringify({ score: 10, reasoning: "Great", improved_response: "PERFECT" }) };
    }
    
    if (prompt.includes("bad query")) {
      return { content: JSON.stringify({ score: 5, reasoning: "Poor", improved_response: "Much better response" }) };
    }
    
    if (prompt.includes("markdown json")) {
      return { content: "```json\n" + JSON.stringify({ score: 6, reasoning: "Okay", improved_response: "Better" }) + "\n```" };
    }
    
    if (prompt.includes("invalid json")) {
      return { content: "Not json at all" };
    }
    
    return { content: "" };
  })
}));

describe("rlaifJudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array if no unrated queries found", async () => {
    const { generateRlaifPairs } = await import("./rlaifJudge");
    
    mockAll.mockReturnValueOnce([]);
    
    const pairs = await generateRlaifPairs();
    
    expect(pairs.length).toBe(0);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it("should skip perfect responses", async () => {
    const { generateRlaifPairs } = await import("./rlaifJudge");
    
    mockAll.mockReturnValueOnce([
      { query: "perfect query", response: "perfect response" }
    ]);
    
    const pairs = await generateRlaifPairs();
    
    expect(pairs.length).toBe(0);
    // Should not insert into DB
    expect(mockPrepare).toHaveBeenCalledTimes(1); // Only the select
  });

  it("should generate pairs and save to DB for poor responses", async () => {
    const { generateRlaifPairs } = await import("./rlaifJudge");
    
    mockAll.mockReturnValueOnce([
      { query: "bad query", response: "bad response" }
    ]);
    
    const pairs = await generateRlaifPairs();
    
    expect(pairs.length).toBe(1);
    expect(pairs[0].chosen).toBe("Much better response");
    expect(pairs[0].rejected).toBe("bad response");
    expect(pairs[0].score).toBe(5);
    
    // Should insert into DB twice (chosen and rejected)
    expect(mockPrepare).toHaveBeenCalledTimes(3); // 1 select + 2 inserts
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("should parse markdown json correctly", async () => {
    const { generateRlaifPairs } = await import("./rlaifJudge");
    
    mockAll.mockReturnValueOnce([
      { query: "markdown json", response: "response" }
    ]);
    
    const pairs = await generateRlaifPairs();
    
    expect(pairs.length).toBe(1);
    expect(pairs[0].score).toBe(6);
  });

  it("should handle invalid json gracefully", async () => {
    const { generateRlaifPairs } = await import("./rlaifJudge");
    
    mockAll.mockReturnValueOnce([
      { query: "invalid json", response: "response" }
    ]);
    
    const pairs = await generateRlaifPairs();
    
    expect(pairs.length).toBe(0);
  });
});
