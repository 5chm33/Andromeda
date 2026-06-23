import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock rbac
vi.mock("../rbac.js", () => ({
  requireOperator: (req: any, res: any, next: any) => next(),
  requireAdmin: (req: any, res: any, next: any) => next(),
}));

// Mock adaptiveEval
const mockRunAdaptiveEval = vi.fn();
const mockGenerateBenchmarks = vi.fn();
const mockGetAdaptiveBenchmarks = vi.fn();
const mockGetAdaptiveEvalHistory = vi.fn();
const mockGetLatestGapAnalysis = vi.fn();
const mockGetBenchmarkEvolutionStats = vi.fn();
const mockAnalyzeGaps = vi.fn();

vi.mock("../adaptiveEval.js", () => ({
  runAdaptiveEval: mockRunAdaptiveEval,
  generateBenchmarks: mockGenerateBenchmarks,
  getAdaptiveBenchmarks: mockGetAdaptiveBenchmarks,
  getAdaptiveEvalHistory: mockGetAdaptiveEvalHistory,
  getLatestGapAnalysis: mockGetLatestGapAnalysis,
  getBenchmarkEvolutionStats: mockGetBenchmarkEvolutionStats,
  analyzeGaps: mockAnalyzeGaps,
}));

describe("adaptiveEvalRoutes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Set up app with router
    app = express();
    app.use(express.json());
    
    const { adaptiveEvalRouter } = await import("./adaptiveEvalRoutes");
    app.use("/api/adaptive-eval", adaptiveEvalRouter);
  });

  describe("POST /api/adaptive-eval/run", () => {
    it("should run adaptive eval successfully", async () => {
      mockRunAdaptiveEval.mockResolvedValueOnce({ id: "run-123", tasks: 5 });
      
      const res = await request(app)
        .post("/api/adaptive-eval/run")
        .send({ generateNew: true, newTaskCount: 5, totalTaskBudget: 15 });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.run.id).toBe("run-123");
      expect(mockRunAdaptiveEval).toHaveBeenCalledWith(expect.objectContaining({
        generateNew: true,
        newTaskCount: 5,
        totalTaskBudget: 15
      }));
    });

    it("should clamp values", async () => {
      mockRunAdaptiveEval.mockResolvedValueOnce({});
      
      await request(app)
        .post("/api/adaptive-eval/run")
        .send({ newTaskCount: 100, totalTaskBudget: 1000 });
        
      expect(mockRunAdaptiveEval).toHaveBeenCalledWith(expect.objectContaining({
        newTaskCount: 10,
        totalTaskBudget: 50
      }));
    });

    it("should handle errors", async () => {
      mockRunAdaptiveEval.mockRejectedValueOnce(new Error("Test error"));
      
      const res = await request(app)
        .post("/api/adaptive-eval/run")
        .send({});
        
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Test error");
    });
  });

  describe("POST /api/adaptive-eval/generate", () => {
    it("should generate benchmarks", async () => {
      mockAnalyzeGaps.mockReturnValueOnce({ category: "test" });
      mockGenerateBenchmarks.mockResolvedValueOnce([{ id: "bench-1" }, { id: "bench-2" }]);
      
      const res = await request(app)
        .post("/api/adaptive-eval/generate")
        .send({ count: 2, category: "coding" });
        
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.generated).toBe(2);
      expect(mockGenerateBenchmarks).toHaveBeenCalledWith(expect.objectContaining({
        count: 2,
        targetCategory: "coding",
        gapAnalysis: { category: "test" }
      }));
    });

    it("should handle errors", async () => {
      mockGenerateBenchmarks.mockRejectedValueOnce(new Error("Gen error"));
      
      const res = await request(app).post("/api/adaptive-eval/generate");
        
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Gen error");
    });
  });

  describe("GET /api/adaptive-eval/benchmarks", () => {
    it("should return benchmarks and stats", async () => {
      mockGetAdaptiveBenchmarks.mockReturnValueOnce([{ id: "b1" }]);
      mockGetBenchmarkEvolutionStats.mockReturnValueOnce({ total: 1 });
      
      const res = await request(app).get("/api/adaptive-eval/benchmarks?category=test");
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.benchmarks[0].id).toBe("b1");
      expect(mockGetAdaptiveBenchmarks).toHaveBeenCalledWith({
        category: "test",
        lifecycle: undefined,
        difficulty: undefined
      });
    });
  });

  describe("GET /api/adaptive-eval/benchmarks/:id", () => {
    it("should return a specific benchmark", async () => {
      mockGetAdaptiveBenchmarks.mockReturnValueOnce([{ id: "b1" }, { id: "b2" }]);
      
      const res = await request(app).get("/api/adaptive-eval/benchmarks/b2");
        
      expect(res.status).toBe(200);
      expect(res.body.benchmark.id).toBe("b2");
    });

    it("should return 404 if not found", async () => {
      mockGetAdaptiveBenchmarks.mockReturnValueOnce([]);
      
      const res = await request(app).get("/api/adaptive-eval/benchmarks/missing");
        
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/adaptive-eval/benchmarks/:id", () => {
    it("should retire a benchmark", async () => {
      const bench = { id: "b1", lifecycle: "active" };
      mockGetAdaptiveBenchmarks.mockReturnValueOnce([bench]);
      
      const res = await request(app).delete("/api/adaptive-eval/benchmarks/b1");
        
      expect(res.status).toBe(200);
      expect(bench.lifecycle).toBe("retired_hard");
    });

    it("should return 404 if not found", async () => {
      mockGetAdaptiveBenchmarks.mockReturnValueOnce([]);
      
      const res = await request(app).delete("/api/adaptive-eval/benchmarks/missing");
        
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/adaptive-eval/history", () => {
    it("should return history", async () => {
      mockGetAdaptiveEvalHistory.mockReturnValueOnce([{ id: "h1" }]);
      
      const res = await request(app).get("/api/adaptive-eval/history?limit=10");
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(mockGetAdaptiveEvalHistory).toHaveBeenCalledWith(10);
    });
  });

  describe("GET /api/adaptive-eval/gap-analysis", () => {
    it("should return gap analysis", async () => {
      mockGetLatestGapAnalysis.mockReturnValueOnce({ missing: "things" });
      
      const res = await request(app).get("/api/adaptive-eval/gap-analysis");
        
      expect(res.status).toBe(200);
      expect(res.body.gapAnalysis.missing).toBe("things");
    });
  });

  describe("GET /api/adaptive-eval/evolution-stats", () => {
    it("should return evolution stats", async () => {
      mockGetBenchmarkEvolutionStats.mockReturnValueOnce({ stats: true });
      
      const res = await request(app).get("/api/adaptive-eval/evolution-stats");
        
      expect(res.status).toBe(200);
      expect(res.body.stats.stats).toBe(true);
    });
  });
});
