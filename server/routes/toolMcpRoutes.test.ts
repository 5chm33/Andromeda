import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock toolRegistry
const mockGetToolDefinitions = vi.fn();
const mockGetAllTools = vi.fn();

vi.mock("../tools/toolRegistry.js", () => ({
  getToolDefinitions: mockGetToolDefinitions,
  getAllTools: mockGetAllTools,
}));

// Mock mcpClient
const mockAddServerConfig = vi.fn();
const mockRemoveServerConfig = vi.fn();
const mockGetServerConfigs = vi.fn();
const mockGetConnectionStatus = vi.fn();
const mockConnectServer = vi.fn();
const mockDisconnectServer = vi.fn();
const mockConnectAllEnabled = vi.fn();

vi.mock("../mcpClient.js", () => ({
  addServerConfig: mockAddServerConfig,
  removeServerConfig: mockRemoveServerConfig,
  getServerConfigs: mockGetServerConfigs,
  getConnectionStatus: mockGetConnectionStatus,
  connectServer: mockConnectServer,
  disconnectServer: mockDisconnectServer,
  connectAllEnabled: mockConnectAllEnabled,
}));

// Mock llmProvider
const mockGetActiveProvider = vi.fn();
const mockSetActiveProvider = vi.fn();
const mockListProviders = vi.fn();

vi.mock("../llmProvider.js", () => ({
  getActiveProvider: mockGetActiveProvider,
  setActiveProvider: mockSetActiveProvider,
  listProviders: mockListProviders,
}));

describe("toolMcpRoutes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    const { registerToolMcpRoutes } = await import("./toolMcpRoutes");
    registerToolMcpRoutes(app);
  });

  describe("GET /api/llm/providers", () => {
    it("should return providers", async () => {
      mockListProviders.mockReturnValueOnce([{ id: "test" }]);
      mockGetActiveProvider.mockReturnValueOnce({ id: "test" });
      
      const res = await request(app).get("/api/llm/providers");
        
      expect(res.status).toBe(200);
      expect(res.body.providers[0].id).toBe("test");
      expect(res.body.active.id).toBe("test");
    });
  });

  describe("POST /api/llm/provider", () => {
    it("should set active provider", async () => {
      mockGetActiveProvider.mockReturnValueOnce({ id: "test2" });
      
      const res = await request(app)
        .post("/api/llm/provider")
        .send({ id: "test2" });
        
      expect(res.status).toBe(200);
      expect(mockSetActiveProvider).toHaveBeenCalledWith({ id: "test2" });
      expect(res.body.active.id).toBe("test2");
    });

    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/llm/provider")
        .send({});
        
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/tools", () => {
    it("should list tools", async () => {
      mockGetAllTools.mockReturnValueOnce([{ name: "t1", description: "d1" }]);
      
      const res = await request(app).get("/api/tools");
        
      expect(res.status).toBe(200);
      expect(res.body.tools[0].name).toBe("t1");
      expect(res.body.tools[0].category).toBe("general");
    });
  });

  describe("GET /api/tools/definitions", () => {
    it("should get definitions", async () => {
      mockGetToolDefinitions.mockReturnValueOnce([{ type: "function" }]);
      
      const res = await request(app).get("/api/tools/definitions");
        
      expect(res.status).toBe(200);
      expect(res.body.definitions[0].type).toBe("function");
    });
  });

  describe("GET /api/mcp/servers", () => {
    it("should get servers and connections", async () => {
      mockGetServerConfigs.mockReturnValueOnce([{ id: "s1" }]);
      mockGetConnectionStatus.mockReturnValueOnce({ s1: "connected" });
      
      const res = await request(app).get("/api/mcp/servers");
        
      expect(res.status).toBe(200);
      expect(res.body.servers[0].id).toBe("s1");
      expect(res.body.connections.s1).toBe("connected");
    });
  });

  describe("POST /api/mcp/servers", () => {
    it("should add server", async () => {
      const res = await request(app)
        .post("/api/mcp/servers")
        .send({ id: "s1", name: "Server 1" });
        
      expect(res.status).toBe(200);
      expect(mockAddServerConfig).toHaveBeenCalledWith({ id: "s1", name: "Server 1" });
    });

    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/mcp/servers")
        .send({ id: "s1" });
        
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/mcp/servers/:id", () => {
    it("should remove server", async () => {
      const res = await request(app).delete("/api/mcp/servers/s1");
        
      expect(res.status).toBe(200);
      expect(mockRemoveServerConfig).toHaveBeenCalledWith("s1");
    });
  });

  describe("POST /api/mcp/connect/:id", () => {
    it("should connect server", async () => {
      mockConnectServer.mockResolvedValueOnce({ success: true });
      
      const res = await request(app).post("/api/mcp/connect/s1");
        
      expect(res.status).toBe(200);
      expect(mockConnectServer).toHaveBeenCalledWith("s1");
    });

    it("should handle errors", async () => {
      mockConnectServer.mockRejectedValueOnce(new Error("Connect failed"));
      
      const res = await request(app).post("/api/mcp/connect/s1");
        
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/mcp/disconnect/:id", () => {
    it("should disconnect server", async () => {
      const res = await request(app).post("/api/mcp/disconnect/s1");
        
      expect(res.status).toBe(200);
      expect(mockDisconnectServer).toHaveBeenCalledWith("s1");
    });
  });

  describe("POST /api/mcp/connect-all", () => {
    it("should connect all", async () => {
      mockConnectAllEnabled.mockResolvedValueOnce(undefined);
      mockGetConnectionStatus.mockReturnValueOnce({ s1: "connected" });
      
      const res = await request(app).post("/api/mcp/connect-all");
        
      expect(res.status).toBe(200);
      expect(mockConnectAllEnabled).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
      mockConnectAllEnabled.mockRejectedValueOnce(new Error("Connect all failed"));
      
      const res = await request(app).post("/api/mcp/connect-all");
        
      expect(res.status).toBe(500);
    });
  });
});
