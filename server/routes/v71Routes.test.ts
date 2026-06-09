import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock adminAuth
vi.mock("../adminAuth.js", () => ({
  requireAdminAuth: (req: any, res: any, next: any) => next(),
}));

// Mock autoRebuild
const mockGetAutoRebuildStatus = vi.fn();
const mockTriggerRebuildNow = vi.fn();
const mockSetAutoRebuildConfig = vi.fn();
vi.mock("../autoRebuild.js", () => ({
  getAutoRebuildStatus: mockGetAutoRebuildStatus,
  triggerRebuildNow: mockTriggerRebuildNow,
  setAutoRebuildConfig: mockSetAutoRebuildConfig,
}));

// Mock rlhfCollector
const mockGetRlhfStats = vi.fn();
const mockGetRlhfAggregates = vi.fn();
const mockGetRecentFeedback = vi.fn();
const mockRecordFeedback = vi.fn();
vi.mock("../rlhfCollector.js", () => ({
  getRlhfStats: mockGetRlhfStats,
  getRlhfAggregates: mockGetRlhfAggregates,
  getRecentFeedback: mockGetRecentFeedback,
  recordFeedback: mockRecordFeedback,
}));

// Mock prGenerator
const mockGetPRGeneratorStatus = vi.fn();
const mockSyncOpenPRStatus = vi.fn();
vi.mock("../prGenerator.js", () => ({
  getPRGeneratorStatus: mockGetPRGeneratorStatus,
  syncOpenPRStatus: mockSyncOpenPRStatus,
}));

// Mock knowledgeTransfer
const mockGetKnowledgeTransferStatus = vi.fn();
const mockExportKnowledgePackage = vi.fn();
const mockImportKnowledgePackage = vi.fn();
vi.mock("../knowledgeTransfer.js", () => ({
  getKnowledgeTransferStatus: mockGetKnowledgeTransferStatus,
  exportKnowledgePackage: mockExportKnowledgePackage,
  importKnowledgePackage: mockImportKnowledgePackage,
}));

describe("v71Routes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    const { v71Router } = await import("./v71Routes");
    app.use("/api/v71", v71Router);
  });

  describe("GET /api/v71/rebuild/status", () => {
    it("should get status", async () => {
      mockGetAutoRebuildStatus.mockReturnValueOnce({ active: true });
      const res = await request(app).get("/api/v71/rebuild/status");
      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(true);
    });

    it("should handle errors", async () => {
      mockGetAutoRebuildStatus.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).get("/api/v71/rebuild/status");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/v71/rebuild/trigger", () => {
    it("should trigger rebuild", async () => {
      mockTriggerRebuildNow.mockResolvedValueOnce({ id: "1" });
      const res = await request(app).post("/api/v71/rebuild/trigger");
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("1");
    });

    it("should handle errors", async () => {
      mockTriggerRebuildNow.mockRejectedValueOnce(new Error("Failed"));
      const res = await request(app).post("/api/v71/rebuild/trigger");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/v71/rebuild/config", () => {
    it("should update config", async () => {
      const res = await request(app).post("/api/v71/rebuild/config").send({ foo: "bar" });
      expect(res.status).toBe(200);
      expect(mockSetAutoRebuildConfig).toHaveBeenCalledWith({ foo: "bar" });
    });

    it("should handle errors", async () => {
      mockSetAutoRebuildConfig.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).post("/api/v71/rebuild/config");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v71/rlhf/stats", () => {
    it("should get stats", async () => {
      mockGetRlhfStats.mockReturnValueOnce({ count: 1 });
      mockGetRlhfAggregates.mockReturnValueOnce({ avg: 5 });
      mockGetRecentFeedback.mockReturnValueOnce([{ id: "1" }]);
      
      const res = await request(app).get("/api/v71/rlhf/stats");
      expect(res.status).toBe(200);
      expect(res.body.data.stats.count).toBe(1);
    });

    it("should handle errors", async () => {
      mockGetRlhfStats.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).get("/api/v71/rlhf/stats");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/v71/rlhf/feedback", () => {
    it("should record feedback", async () => {
      mockRecordFeedback.mockReturnValueOnce({ id: "f1" });
      
      const res = await request(app)
        .post("/api/v71/rlhf/feedback")
        .send({ proposalId: "p1", feedbackType: "implicit_accept" });
        
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe("f1");
    });

    it("should require proposalId and feedbackType", async () => {
      const res = await request(app).post("/api/v71/rlhf/feedback").send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockRecordFeedback.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app)
        .post("/api/v71/rlhf/feedback")
        .send({ proposalId: "p1", feedbackType: "implicit_accept" });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v71/prs/status", () => {
    it("should get PR status", async () => {
      mockGetPRGeneratorStatus.mockReturnValueOnce({ open: 1 });
      const res = await request(app).get("/api/v71/prs/status");
      expect(res.status).toBe(200);
      expect(res.body.data.open).toBe(1);
    });

    it("should handle errors", async () => {
      mockGetPRGeneratorStatus.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).get("/api/v71/prs/status");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/v71/prs/sync", () => {
    it("should sync PRs", async () => {
      mockSyncOpenPRStatus.mockResolvedValueOnce(undefined);
      const res = await request(app).post("/api/v71/prs/sync");
      expect(res.status).toBe(200);
    });

    it("should handle errors", async () => {
      mockSyncOpenPRStatus.mockRejectedValueOnce(new Error("Failed"));
      const res = await request(app).post("/api/v71/prs/sync");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v71/knowledge/status", () => {
    it("should get knowledge status", async () => {
      mockGetKnowledgeTransferStatus.mockReturnValueOnce({ active: true });
      const res = await request(app).get("/api/v71/knowledge/status");
      expect(res.status).toBe(200);
    });

    it("should handle errors", async () => {
      mockGetKnowledgeTransferStatus.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).get("/api/v71/knowledge/status");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v71/knowledge/export", () => {
    it("should export knowledge", async () => {
      mockExportKnowledgePackage.mockResolvedValueOnce({ packageId: "k1" });
      const res = await request(app).get("/api/v71/knowledge/export");
      expect(res.status).toBe(200);
    });

    it("should handle errors", async () => {
      mockExportKnowledgePackage.mockRejectedValueOnce(new Error("Failed"));
      const res = await request(app).get("/api/v71/knowledge/export");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/v71/knowledge/import", () => {
    it("should import knowledge", async () => {
      mockImportKnowledgePackage.mockResolvedValueOnce({ imported: 5 });
      const res = await request(app)
        .post("/api/v71/knowledge/import")
        .send({ packageId: "k1", sourceInstanceId: "s1" });
      expect(res.status).toBe(200);
    });

    it("should validate package", async () => {
      const res = await request(app).post("/api/v71/knowledge/import").send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockImportKnowledgePackage.mockRejectedValueOnce(new Error("Failed"));
      const res = await request(app)
        .post("/api/v71/knowledge/import")
        .send({ packageId: "k1", sourceInstanceId: "s1" });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v71/status", () => {
    it("should get full status", async () => {
      mockGetAutoRebuildStatus.mockReturnValueOnce({ r: 1 });
      mockGetRlhfStats.mockReturnValueOnce({ s: 1 });
      mockGetPRGeneratorStatus.mockReturnValueOnce({ p: 1 });
      mockGetKnowledgeTransferStatus.mockReturnValueOnce({ k: 1 });
      
      const res = await request(app).get("/api/v71/status");
      expect(res.status).toBe(200);
      expect(res.body.data.autoRebuild.r).toBe(1);
    });

    it("should handle errors", async () => {
      mockGetAutoRebuildStatus.mockImplementationOnce(() => { throw new Error("Failed"); });
      const res = await request(app).get("/api/v71/status");
      expect(res.status).toBe(500);
    });
  });
});
