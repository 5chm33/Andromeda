import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock rbac
vi.mock("../rbac.js", () => ({
  requireOperator: (req: any, res: any, next: any) => next(),
  requireAdmin: (req: any, res: any, next: any) => next(),
}));

// Mock federatedLearning
const mockRegisterNode = vi.fn();
const mockListNodes = vi.fn();
const mockGetNode = vi.fn();
const mockGetFederatedStats = vi.fn();
const mockProcessSyncPayload = vi.fn();
const mockPrepareSyncPayload = vi.fn();
const mockGetReceivedProposals = vi.fn();
const mockMarkProposalValidated = vi.fn();
const mockMarkProposalApplied = vi.fn();
const mockComputeFederatedAvgScore = vi.fn();
const mockUpdateLocalScore = vi.fn();
const mockGetNodeId = vi.fn(() => "node-123");
const mockInitFederatedLearning = vi.fn();

vi.mock("../federatedLearning.js", () => ({
  registerNode: mockRegisterNode,
  listNodes: mockListNodes,
  getNode: mockGetNode,
  getFederatedStats: mockGetFederatedStats,
  processSyncPayload: mockProcessSyncPayload,
  prepareSyncPayload: mockPrepareSyncPayload,
  getReceivedProposals: mockGetReceivedProposals,
  markProposalValidated: mockMarkProposalValidated,
  markProposalApplied: mockMarkProposalApplied,
  computeFederatedAvgScore: mockComputeFederatedAvgScore,
  updateLocalScore: mockUpdateLocalScore,
  getNodeId: mockGetNodeId,
  initFederatedLearning: mockInitFederatedLearning,
}));

describe("federatedRoutes", () => {
  let app: express.Application;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    
    app = express();
    app.use(express.json());
    
    const { federatedRouter } = await import("./federatedRoutes");
    app.use("/api/federated", federatedRouter);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("GET /api/federated/heartbeat", () => {
    it("should return heartbeat", async () => {
      mockGetFederatedStats.mockReturnValueOnce({
        nodeId: "node-123",
        localCapabilityScore: 90,
        federatedAvgScore: 85,
        peerCount: 2,
        enabled: true
      });
      
      const res = await request(app).get("/api/federated/heartbeat");
        
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.nodeId).toBe("node-123");
    });
  });

  describe("POST /api/federated/register", () => {
    it("should register a node", async () => {
      process.env.FEDERATED_TOKEN = "secret";
      mockRegisterNode.mockReturnValueOnce({ id: "peer-1" });
      
      const res = await request(app)
        .post("/api/federated/register")
        .set("x-federated-token", "secret")
        .send({ nodeId: "peer-1", url: "http://peer" });
        
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(mockRegisterNode).toHaveBeenCalled();
    });

    it("should require token if configured", async () => {
      process.env.FEDERATED_TOKEN = "secret";
      
      const res = await request(app)
        .post("/api/federated/register")
        .send({ nodeId: "peer-1", url: "http://peer" });
        
      expect(res.status).toBe(401);
    });

    it("should validate input", async () => {
      process.env.FEDERATED_TOKEN = ""; // dev mode
      
      const res = await request(app)
        .post("/api/federated/register")
        .send({});
        
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/federated/sync", () => {
    it("should process sync payload", async () => {
      mockProcessSyncPayload.mockReturnValueOnce({ accepted: true, proposalsAccepted: 2, proposalsRejected: 0 });
      
      const res = await request(app)
        .post("/api/federated/sync")
        .send({ fromNodeId: "peer-1" });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.proposalsAccepted).toBe(2);
    });

    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/federated/sync")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should handle rejected sync", async () => {
      mockProcessSyncPayload.mockReturnValueOnce({ accepted: false, error: "Bad payload" });
      
      const res = await request(app)
        .post("/api/federated/sync")
        .send({ fromNodeId: "peer-1" });
        
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Bad payload");
    });
  });

  describe("GET /api/federated/proposals", () => {
    it("should serve proposals", async () => {
      process.env.FEDERATED_TOKEN = "";
      mockPrepareSyncPayload.mockResolvedValueOnce({
        proposals: [{ id: "p1", confidence: 0.9, category: "test" }, { id: "p2", confidence: 0.5, category: "test" }]
      });
      
      const res = await request(app).get("/api/federated/proposals?minConfidence=0.8&category=test");
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.proposals[0].id).toBe("p1");
    });

    it("should handle errors", async () => {
      process.env.FEDERATED_TOKEN = "";
      mockPrepareSyncPayload.mockRejectedValueOnce(new Error("Failed to prepare"));
      
      const res = await request(app).get("/api/federated/proposals");
        
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/federated/stats", () => {
    it("should return stats", async () => {
      mockGetFederatedStats.mockReturnValueOnce({ stat: true });
      const res = await request(app).get("/api/federated/stats");
      expect(res.status).toBe(200);
      expect(res.body.stat).toBe(true);
    });
  });

  describe("GET /api/federated/nodes", () => {
    it("should list nodes", async () => {
      mockListNodes.mockReturnValueOnce([{ id: "n1" }]);
      const res = await request(app).get("/api/federated/nodes");
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });

  describe("GET /api/federated/nodes/:id", () => {
    it("should get a node", async () => {
      mockGetNode.mockReturnValueOnce({ id: "n1" });
      const res = await request(app).get("/api/federated/nodes/n1");
      expect(res.status).toBe(200);
      expect(res.body.node.id).toBe("n1");
    });

    it("should return 404 if not found", async () => {
      mockGetNode.mockReturnValueOnce(undefined);
      const res = await request(app).get("/api/federated/nodes/missing");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/federated/proposals/received", () => {
    it("should list received proposals", async () => {
      mockGetReceivedProposals.mockReturnValueOnce([{ id: "p1" }]);
      const res = await request(app).get("/api/federated/proposals/received?locallyApplied=true");
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(mockGetReceivedProposals).toHaveBeenCalledWith(expect.objectContaining({ locallyApplied: true }));
    });
  });

  describe("POST /api/federated/proposals/:id/validate", () => {
    it("should validate proposal", async () => {
      const res = await request(app)
        .post("/api/federated/proposals/p1/validate")
        .send({ validated: false });
        
      expect(res.status).toBe(200);
      expect(res.body.validated).toBe(false);
      expect(mockMarkProposalValidated).toHaveBeenCalledWith("p1", false);
    });
  });

  describe("POST /api/federated/proposals/:id/adopt", () => {
    it("should adopt proposal", async () => {
      const res = await request(app).post("/api/federated/proposals/p1/adopt");
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockMarkProposalValidated).toHaveBeenCalledWith("p1", true);
      expect(mockMarkProposalApplied).toHaveBeenCalledWith("p1");
    });
  });

  describe("POST /api/federated/sync/trigger", () => {
    it("should trigger sync", async () => {
      process.env.FEDERATED_PEERS = "http://peer1,http://peer2";
      
      const res = await request(app).post("/api/federated/sync/trigger");
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.peers).toHaveLength(2);
    });

    it("should fail if no peers", async () => {
      process.env.FEDERATED_PEERS = "";
      
      const res = await request(app).post("/api/federated/sync/trigger");
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/federated/score/update", () => {
    it("should update score", async () => {
      mockComputeFederatedAvgScore.mockReturnValueOnce(85);
      
      const res = await request(app)
        .post("/api/federated/score/update")
        .send({ score: 95 });
        
      expect(res.status).toBe(200);
      expect(res.body.score).toBe(95);
      expect(mockUpdateLocalScore).toHaveBeenCalledWith(95);
    });

    it("should validate score", async () => {
      const res = await request(app)
        .post("/api/federated/score/update")
        .send({ score: 150 });
        
      expect(res.status).toBe(400);
    });
  });
});
