import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock AI functions
const mockStreamChat = vi.fn();
const mockStreamContinue = vi.fn();
const mockGenerateImageFromPrompt = vi.fn();
const mockSetModel = vi.fn();
const mockStreamAgentPlan = vi.fn();

vi.mock("../ai.js", () => ({
  streamChat: mockStreamChat,
  streamContinue: mockStreamContinue,
  generateImageFromPrompt: mockGenerateImageFromPrompt,
  setModel: mockSetModel,
  streamAgentPlan: mockStreamAgentPlan,
}));

// Mock browser
const mockBrowseUrl = vi.fn();
vi.mock("../browser.js", () => ({
  browseUrl: mockBrowseUrl,
}));

// Mock workspace
vi.mock("../workspace.js", () => ({
  getWorkspaceDir: vi.fn(() => "/workspace"),
}));

// Mock reactEngine
const mockStreamAgentToSSE = vi.fn();
vi.mock("../reactEngine.js", () => ({
  streamAgentToSSE: mockStreamAgentToSSE,
}));

describe("chatRoutes", () => {
  let app: express.Application;
  let activeAgentSessions: Map<string, any>;
  let setSseHeaders: any;
  let sseWrite: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    activeAgentSessions = new Map();
    setSseHeaders = vi.fn((res) => {
      res.setHeader("Content-Type", "text/event-stream");
    });
    sseWrite = vi.fn((res, data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
    
    const dummyLimiter = (req: any, res: any, next: any) => next();
    
    const { registerChatRoutes } = await import("./chatRoutes");
    registerChatRoutes(
      app,
      dummyLimiter,
      dummyLimiter,
      setSseHeaders,
      sseWrite,
      { activeAgentSessions }
    );
  });

  describe("POST /api/chat/stream", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/chat/stream")
        .send({});
        
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("expected array");
    });

    it("should handle standard chat", async () => {
      mockStreamChat.mockResolvedValueOnce("Hello there");
      
      const res = await request(app)
        .post("/api/chat/stream")
        .send({ messages: [{ role: "user", content: "Hi" }] });
        
      expect(res.status).toBe(200);
      expect(mockStreamChat).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "done", fullAnswer: "Hello there" });
    });

    it("should redirect self-modification to agent loop", async () => {
      const mockEngine = { stop: vi.fn() };
      mockStreamAgentToSSE.mockReturnValueOnce(mockEngine);
      
      // Send request without awaiting immediately, as the agent stream doesn't end the response right away in the mock
      request(app)
        .post("/api/chat/stream")
        .send({ messages: [{ role: "user", content: "take a look at your code" }] })
        .end();
        
      // Give it a tiny tick to process
      await new Promise(r => setTimeout(r, 50));
        
      expect(mockStreamAgentToSSE).toHaveBeenCalled();
      expect(mockStreamChat).not.toHaveBeenCalled();
      expect(activeAgentSessions.size).toBe(1);
    });

    it("should handle errors", async () => {
      mockStreamChat.mockRejectedValueOnce(new Error("Chat failed"));
      
      const res = await request(app)
        .post("/api/chat/stream")
        .send({ messages: [{ role: "user", content: "Hi" }] });
        
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "error", message: "Chat failed" });
    });
  });

  describe("POST /api/continue/stream", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/continue/stream")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should handle continue", async () => {
      mockStreamContinue.mockResolvedValueOnce("Continued text");
      
      const res = await request(app)
        .post("/api/continue/stream")
        .send({ messages: [{ role: "assistant", content: "Part 1" }] });
        
      expect(res.status).toBe(200);
      expect(mockStreamContinue).toHaveBeenCalled();
      expect(sseWrite).toHaveBeenCalledWith(expect.anything(), { type: "done", fullAnswer: "Continued text" });
    });
  });

  describe("POST /api/image/generate", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/image/generate")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should generate image", async () => {
      mockGenerateImageFromPrompt.mockResolvedValueOnce({ 
        url: "http://img.com/1.png",
        enhancedPrompt: "A beautiful cat"
      });
      
      const res = await request(app)
        .post("/api/image/generate")
        .send({ prompt: "cat" });
        
      expect(res.status).toBe(200);
      expect(res.body.url).toBe("http://img.com/1.png");
    });
  });

  describe("POST /api/browse", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/browse")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should browse URL", async () => {
      mockBrowseUrl.mockResolvedValueOnce({ markdown: "# Hello" });
      
      const res = await request(app)
        .post("/api/browse")
        .send({ url: "http://example.com" });
        
      expect(res.status).toBe(200);
      expect(res.body.markdown).toBe("# Hello");
    });

    it("should handle browse error", async () => {
      mockBrowseUrl.mockResolvedValueOnce({ error: "Page not found" });
      
      const res = await request(app)
        .post("/api/browse")
        .send({ url: "http://example.com" });
        
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("Page not found");
    });
  });

  describe("POST /api/agent/plan", () => {
    it("should validate input", async () => {
      const res = await request(app)
        .post("/api/agent/plan")
        .send({});
        
      expect(res.status).toBe(400);
    });

    it("should stream agent plan", async () => {
      mockStreamAgentPlan.mockResolvedValueOnce(undefined);
      
      const res = await request(app)
        .post("/api/agent/plan")
        .send({ query: "do a task" });
        
      expect(res.status).toBe(200);
      expect(mockStreamAgentPlan).toHaveBeenCalled();
    });
  });
});
