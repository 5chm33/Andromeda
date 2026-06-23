import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock AI functions
const mockStreamFileAnalysis = vi.fn();
const mockSetModel = vi.fn();
vi.mock("../ai.js", () => ({
  streamFileAnalysis: mockStreamFileAnalysis,
  setModel: mockSetModel,
}));

// Mock codeRunner
const mockExecuteCode = vi.fn();
vi.mock("../codeRunner.js", () => ({
  executeCode: mockExecuteCode,
}));

// Mock fileEngine
const mockRunMultiPassEdit = vi.fn();
const mockStreamMultiPassAnalysis = vi.fn();
const mockRunMultiPassEditWithAutosubmit = vi.fn();
const mockCreateBudget = vi.fn(() => ({}));
vi.mock("../fileEngine.js", () => ({
  runMultiPassEdit: mockRunMultiPassEdit,
  streamMultiPassAnalysis: mockStreamMultiPassAnalysis,
  runMultiPassEditWithAutosubmit: mockRunMultiPassEditWithAutosubmit,
  createBudget: mockCreateBudget,
}));

// Mock llmProvider
vi.mock("../llmProvider.js", () => ({
  getActiveProvider: vi.fn(() => ({ apiKey: "test-key", model: "test-model" })),
}));

describe("editRoutes", () => {
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
    
    const { registerEditRoutes } = await import("./editRoutes");
    registerEditRoutes(
      app,
      dummyLimiter,
      dummyLimiter,
      setSseHeaders,
      sseWrite
    );
  });

  describe("POST /api/edit/zip", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/edit/zip")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should run multi-pass edit", async () => {
      mockRunMultiPassEdit.mockResolvedValueOnce({
        editedZip: "base64",
        summary: "done",
        editsApplied: 1,
        log: []
      });
      
      const res = await request(app)
        .post("/api/edit/zip")
        .send({ fileContent: "base64", fileName: "test.zip", instructions: "do it" });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.editedContent).toBe("base64");
    });

    it("should handle errors", async () => {
      mockRunMultiPassEdit.mockRejectedValueOnce(new Error("Edit failed"));
      
      const res = await request(app)
        .post("/api/edit/zip")
        .send({ fileContent: "base64", fileName: "test.zip", instructions: "do it" });
        
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/edit/zip/stream", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/edit/zip/stream")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should stream multi-pass edit", async () => {
      mockRunMultiPassEditWithAutosubmit.mockImplementationOnce(async (c, i, k, m, cb) => {
        cb({ type: "progress", message: "working" });
        return { success: true, editedZip: "base64" };
      });
      
      const res = await request(app)
        .post("/api/edit/zip/stream")
        .send({ fileContent: "base64", fileName: "test.zip", instructions: "do it" });
        
      expect(res.status).toBe(200);
      expect(mockRunMultiPassEditWithAutosubmit).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "progress", message: "working" });
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "done", success: true }));
    });

    it("should handle errors", async () => {
      mockRunMultiPassEditWithAutosubmit.mockRejectedValueOnce(new Error("Stream edit failed"));
      
      const res = await request(app)
        .post("/api/edit/zip/stream")
        .send({ fileContent: "base64", fileName: "test.zip", instructions: "do it" });
        
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "error", message: "Stream edit failed" });
    });
  });

  describe("POST /api/analyze/stream", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/analyze/stream")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should handle raw zip analysis", async () => {
      mockStreamMultiPassAnalysis.mockResolvedValueOnce(undefined);
      
      const res = await request(app)
        .post("/api/analyze/stream")
        .send({ message: "look", fileContent: "base64", isRawZip: true });
        
      expect(res.status).toBe(200);
      expect(mockStreamMultiPassAnalysis).toHaveBeenCalled();
    });

    it("should handle single file analysis", async () => {
      mockStreamFileAnalysis.mockResolvedValueOnce("analysis done");
      
      const res = await request(app)
        .post("/api/analyze/stream")
        .send({ message: "look", fileContent: "code", fileName: "test.ts" });
        
      expect(res.status).toBe(200);
      expect(mockStreamFileAnalysis).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "done", fullAnswer: "analysis done" });
    });

    it("should handle image analysis", async () => {
      mockStreamFileAnalysis.mockResolvedValueOnce("image done");
      
      const res = await request(app)
        .post("/api/analyze/stream")
        .send({ message: "look", fileContent: "base64", mimeType: "image/png" });
        
      expect(res.status).toBe(200);
      expect(mockStreamFileAnalysis).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      mockStreamFileAnalysis.mockRejectedValueOnce(new Error("Analysis failed"));
      
      const res = await request(app)
        .post("/api/analyze/stream")
        .send({ message: "look", fileContent: "code" });
        
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "error", message: "Analysis failed" });
    });
  });

  describe("POST /api/code/execute", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/code/execute")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should execute code", async () => {
      mockExecuteCode.mockResolvedValueOnce({ output: "done" });
      
      const res = await request(app)
        .post("/api/code/execute")
        .send({ code: "console.log(1)", language: "javascript" });
        
      expect(res.status).toBe(200);
      expect(res.body.output).toBe("done");
    });

    it("should handle errors", async () => {
      mockExecuteCode.mockRejectedValueOnce(new Error("Exec failed"));
      
      const res = await request(app)
        .post("/api/code/execute")
        .send({ code: "bad", language: "javascript" });
        
      expect(res.status).toBe(500);
    });
  });
});
