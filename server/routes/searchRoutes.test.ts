import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock AI functions
const mockStreamAIResponse = vi.fn();
const mockStreamAIResponseWithContext = vi.fn();
const mockStreamDeepResearch = vi.fn();
const mockGenerateSubQueries = vi.fn();
const mockSetModel = vi.fn();

vi.mock("../ai.js", () => ({
  streamAIResponse: mockStreamAIResponse,
  streamAIResponseWithContext: mockStreamAIResponseWithContext,
  streamDeepResearch: mockStreamDeepResearch,
  setModel: mockSetModel,
}));
vi.mock("../aiPlanning.js", () => ({
  generateSubQueries: mockGenerateSubQueries,
  streamAgentPlan: vi.fn(),
  generateExecutionPlan: vi.fn().mockResolvedValue({}),
  generateSuggestions: vi.fn().mockResolvedValue([]),
}));

// Mock Search functions
const mockAggregateSearch = vi.fn();
const mockDeepResearchSearch = vi.fn();

vi.mock("../search.js", () => ({
  aggregateSearch: mockAggregateSearch,
  deepResearchSearch: mockDeepResearchSearch,
}));

// Mock Bias Detector
const mockAnnotateSources = vi.fn();
const mockAnalyzeDiversity = vi.fn();
const mockDetectCensorshipSignals = vi.fn();
const mockBuildHonestyPromptAddendum = vi.fn();

vi.mock("../biasDetector.js", () => ({
  annotateSources: mockAnnotateSources,
  analyzeDiversity: mockAnalyzeDiversity,
  detectCensorshipSignals: mockDetectCensorshipSignals,
  buildHonestyPromptAddendum: mockBuildHonestyPromptAddendum,
}));

describe("searchRoutes", () => {
  let app: express.Application;
  let setSseHeaders: any;
  let sseWrite: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    setSseHeaders = vi.fn((res) => {
      res.setHeader("Content-Type", "text/event-stream");
    });
    sseWrite = vi.fn((res, data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
    
    const dummyLimiter = (req: any, res: any, next: any) => next();
    
    const { registerSearchRoutes } = await import("./searchRoutes");
    registerSearchRoutes(
      app,
      dummyLimiter,
      dummyLimiter,
      setSseHeaders,
      sseWrite
    );
  });

  describe("POST /api/search/stream", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/search/stream")
        .send({});
        
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid request");
    });

    it("should handle web search", async () => {
      mockAggregateSearch.mockResolvedValueOnce([{ url: "http://example.com" }]);
      mockAnnotateSources.mockReturnValueOnce([{ url: "http://example.com" }]);
      mockAnalyzeDiversity.mockReturnValueOnce({ score: 1 });
      mockDetectCensorshipSignals.mockReturnValueOnce(null);
      mockBuildHonestyPromptAddendum.mockReturnValueOnce("");
      mockStreamAIResponse.mockResolvedValueOnce("done");
      
      const res = await request(app)
        .post("/api/search/stream")
        .send({ query: "test", filter: "web" });
        
      expect(res.status).toBe(200);
      expect(mockAggregateSearch).toHaveBeenCalledWith("test", "web", 12, { useBrave: true });
      expect(mockStreamAIResponse).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "sources" }));
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "done", fullAnswer: "done" });
    });

    it("should use client sources if provided", async () => {
      mockAnnotateSources.mockReturnValueOnce([{ url: "http://client.com" }]);
      mockAnalyzeDiversity.mockReturnValueOnce({ score: 1 });
      mockDetectCensorshipSignals.mockReturnValueOnce(null);
      mockBuildHonestyPromptAddendum.mockReturnValueOnce("");
      mockStreamAIResponse.mockResolvedValueOnce("done");
      
      const res = await request(app)
        .post("/api/search/stream")
        .send({ query: "test", filter: "web", sources: [{ url: "http://client.com" }] });
        
      expect(res.status).toBe(200);
      expect(mockAggregateSearch).not.toHaveBeenCalled();
      expect(mockStreamAIResponse).toHaveBeenCalled();
    });

    it("should use context if provided", async () => {
      mockAnnotateSources.mockReturnValueOnce([]);
      mockAnalyzeDiversity.mockReturnValueOnce({ score: 1 });
      mockDetectCensorshipSignals.mockReturnValueOnce(null);
      mockBuildHonestyPromptAddendum.mockReturnValueOnce("");
      mockStreamAIResponseWithContext.mockResolvedValueOnce("done context");
      
      const res = await request(app)
        .post("/api/search/stream")
        .send({ query: "test", context: [{ query: "q", answer: "a" }] });
        
      expect(res.status).toBe(200);
      expect(mockStreamAIResponseWithContext).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      mockAggregateSearch.mockRejectedValueOnce(new Error("Search failed"));
      
      const res = await request(app)
        .post("/api/search/stream")
        .send({ query: "test", filter: "web" });
        
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "error", message: "Search failed" });
    });
  });

  describe("POST /api/search/deep", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/search/deep")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should perform deep research", async () => {
      mockGenerateSubQueries.mockResolvedValueOnce(["q1", "q2"]);
      mockDeepResearchSearch.mockResolvedValueOnce([
        { query: "q1", sources: [{ url: "http://1.com" }] },
        { query: "q2", sources: [{ url: "http://2.com" }, { url: "http://1.com" }] }
      ]);
      mockStreamDeepResearch.mockResolvedValueOnce("deep done");
      
      const res = await request(app)
        .post("/api/search/deep")
        .send({ query: "test deep" });
        
      expect(res.status).toBe(200);
      expect(mockGenerateSubQueries).toHaveBeenCalledWith("test deep");
      expect(mockDeepResearchSearch).toHaveBeenCalledWith(["q1", "q2"]);
      expect(mockStreamDeepResearch).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "progress", step: "planning" }));
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "progress", step: "queries" }));
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "progress", step: "sources", sources: expect.any(Array) }));
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "done", fullAnswer: "deep done" }));
    });

    it("should handle errors", async () => {
      mockGenerateSubQueries.mockRejectedValueOnce(new Error("Deep failed"));
      
      const res = await request(app)
        .post("/api/search/deep")
        .send({ query: "test deep" });
        
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "error", message: "Deep failed" });
    });
  });
});
