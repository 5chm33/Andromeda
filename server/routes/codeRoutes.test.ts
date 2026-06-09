import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock workspace
const mockExecuteCodeWithWorkspace = vi.fn();
const mockListWorkspaceFiles = vi.fn();
const mockReadWorkspaceFile = vi.fn();
const mockWriteWorkspaceFile = vi.fn();
const mockDeleteWorkspaceFile = vi.fn();
const mockGetWorkspaceDir = vi.fn(() => "/workspace");

vi.mock("../workspace.js", () => ({
  executeCodeWithWorkspace: mockExecuteCodeWithWorkspace,
  listWorkspaceFiles: mockListWorkspaceFiles,
  readWorkspaceFile: mockReadWorkspaceFile,
  writeWorkspaceFile: mockWriteWorkspaceFile,
  deleteWorkspaceFile: mockDeleteWorkspaceFile,
  getWorkspaceDir: mockGetWorkspaceDir,
}));

// Mock codeIntel
const mockResolveDependencies = vi.fn();
const mockReadPackageJson = vi.fn();
const mockDiagnoseError = vi.fn();
const mockSearchWorkspaceCode = vi.fn();
const mockGenerateUnifiedDiff = vi.fn();

vi.mock("../codeIntel.js", () => ({
  resolveDependencies: mockResolveDependencies,
  readPackageJson: mockReadPackageJson,
  diagnoseError: mockDiagnoseError,
  searchWorkspaceCode: mockSearchWorkspaceCode,
  generateUnifiedDiff: mockGenerateUnifiedDiff,
}));

// Mock multiAgent
const mockRunTeamAgent = vi.fn();
vi.mock("../multiAgent.js", () => ({
  runTeamAgent: mockRunTeamAgent,
}));

describe("codeRoutes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    const dummyLimiter = (req: any, res: any, next: any) => next();
    
    const { registerCodeRoutes } = await import("./codeRoutes");
    registerCodeRoutes(app, dummyLimiter, dummyLimiter);
  });

  describe("GET /api/workspace/files", () => {
    it("should list workspace files", async () => {
      mockListWorkspaceFiles.mockResolvedValueOnce([{ name: "test.ts" }]);
      
      const res = await request(app).get("/api/workspace/files");
        
      expect(res.status).toBe(200);
      expect(res.body.files[0].name).toBe("test.ts");
      expect(res.body.workspaceDir).toBe("/workspace");
    });

    it("should handle errors", async () => {
      mockListWorkspaceFiles.mockRejectedValueOnce(new Error("List failed"));
      
      const res = await request(app).get("/api/workspace/files");
        
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("List failed");
    });
  });

  describe("GET /api/workspace/file", () => {
    it("should read a file", async () => {
      mockReadWorkspaceFile.mockResolvedValueOnce("file content");
      
      const res = await request(app).get("/api/workspace/file?name=test.ts");
        
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test.ts");
      expect(res.body.content).toBe("file content");
    });

    it("should require name", async () => {
      const res = await request(app).get("/api/workspace/file");
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockReadWorkspaceFile.mockRejectedValueOnce(new Error("Read failed"));
      
      const res = await request(app).get("/api/workspace/file?name=test.ts");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Read failed");
    });
  });

  describe("POST /api/code/execute-workspace", () => {
    it("should execute code", async () => {
      mockExecuteCodeWithWorkspace.mockResolvedValueOnce({ output: "success" });
      
      const res = await request(app)
        .post("/api/code/execute-workspace")
        .send({ code: "console.log(1)", language: "javascript" });
        
      expect(res.status).toBe(200);
      expect(res.body.output).toBe("success");
    });

    it("should require code", async () => {
      const res = await request(app)
        .post("/api/code/execute-workspace")
        .send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockExecuteCodeWithWorkspace.mockRejectedValueOnce(new Error("Exec failed"));
      
      const res = await request(app)
        .post("/api/code/execute-workspace")
        .send({ code: "bad" });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/deps/resolve", () => {
    it("should resolve dependencies from packages array", async () => {
      mockResolveDependencies.mockResolvedValueOnce([{ name: "react", version: "18" }]);
      
      const res = await request(app)
        .post("/api/deps/resolve")
        .send({ packages: ["react"] });
        
      expect(res.status).toBe(200);
      expect(res.body.dependencies[0].name).toBe("react");
    });

    it("should resolve dependencies from package.json if packages array is empty", async () => {
      mockReadPackageJson.mockReturnValueOnce({ dependencies: { react: "^18" } });
      mockResolveDependencies.mockResolvedValueOnce([{ name: "react", version: "18" }]);
      
      const res = await request(app)
        .post("/api/deps/resolve")
        .send({});
        
      expect(res.status).toBe(200);
      expect(mockReadPackageJson).toHaveBeenCalled();
      expect(mockResolveDependencies).toHaveBeenCalledWith(["react"], undefined);
    });

    it("should handle errors", async () => {
      mockResolveDependencies.mockRejectedValueOnce(new Error("Resolve failed"));
      
      const res = await request(app)
        .post("/api/deps/resolve")
        .send({ packages: ["react"] });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/deps/package-json", () => {
    it("should read package.json", async () => {
      mockReadPackageJson.mockReturnValueOnce({ name: "test-pkg" });
      
      const res = await request(app).get("/api/deps/package-json");
        
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("test-pkg");
    });

    it("should handle errors", async () => {
      mockReadPackageJson.mockImplementationOnce(() => { throw new Error("Read failed"); });
      
      const res = await request(app).get("/api/deps/package-json");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/code/explain-error", () => {
    it("should explain error", async () => {
      mockDiagnoseError.mockReturnValueOnce("It's a syntax error");
      
      const res = await request(app)
        .post("/api/code/explain-error")
        .send({ error: "SyntaxError" });
        
      expect(res.status).toBe(200);
      expect(res.body.diagnosis).toBe("It's a syntax error");
    });

    it("should require error", async () => {
      const res = await request(app)
        .post("/api/code/explain-error")
        .send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockDiagnoseError.mockImplementationOnce(() => { throw new Error("Explain failed"); });
      
      const res = await request(app)
        .post("/api/code/explain-error")
        .send({ error: "bad" });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/workspace/search", () => {
    it("should search workspace", async () => {
      mockSearchWorkspaceCode.mockReturnValueOnce([{ file: "test.ts" }]);
      
      const res = await request(app)
        .post("/api/workspace/search")
        .send({ pattern: "foo" });
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it("should require pattern", async () => {
      const res = await request(app)
        .post("/api/workspace/search")
        .send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockSearchWorkspaceCode.mockImplementationOnce(() => { throw new Error("Search failed"); });
      
      const res = await request(app)
        .post("/api/workspace/search")
        .send({ pattern: "foo" });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/code/diff", () => {
    it("should generate diff", async () => {
      mockGenerateUnifiedDiff.mockReturnValueOnce("diff output");
      
      const res = await request(app)
        .post("/api/code/diff")
        .send({ original: "a", modified: "b" });
        
      expect(res.status).toBe(200);
      expect(res.body.diff).toBe("diff output");
    });

    it("should require original and modified", async () => {
      const res = await request(app)
        .post("/api/code/diff")
        .send({ original: "a" });
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockGenerateUnifiedDiff.mockImplementationOnce(() => { throw new Error("Diff failed"); });
      
      const res = await request(app)
        .post("/api/code/diff")
        .send({ original: "a", modified: "b" });
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/workspace/file", () => {
    it("should write file", async () => {
      mockWriteWorkspaceFile.mockResolvedValueOnce(undefined);
      
      const res = await request(app)
        .post("/api/workspace/file")
        .send({ name: "test.ts", content: "data" });
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should require name and content", async () => {
      const res = await request(app)
        .post("/api/workspace/file")
        .send({ name: "test.ts" });
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockWriteWorkspaceFile.mockRejectedValueOnce(new Error("Write failed"));
      
      const res = await request(app)
        .post("/api/workspace/file")
        .send({ name: "test.ts", content: "data" });
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/workspace/file", () => {
    it("should delete file", async () => {
      mockDeleteWorkspaceFile.mockResolvedValueOnce(undefined);
      
      const res = await request(app).delete("/api/workspace/file?name=test.ts");
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should require name", async () => {
      const res = await request(app).delete("/api/workspace/file");
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockDeleteWorkspaceFile.mockRejectedValueOnce(new Error("Delete failed"));
      
      const res = await request(app).delete("/api/workspace/file?name=test.ts");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/agent/team", () => {
    it("should run team agent", async () => {
      mockRunTeamAgent.mockImplementationOnce(async (task, res) => {
        res.end(); // We must end the response since it's a stream
      });
      
      const res = await request(app)
        .post("/api/agent/team")
        .send({ task: "do it" });
        
      expect(res.status).toBe(200);
      expect(mockRunTeamAgent).toHaveBeenCalled();
    });

    it("should require task", async () => {
      const res = await request(app)
        .post("/api/agent/team")
        .send({});
      expect(res.status).toBe(400);
    });

    it("should handle errors", async () => {
      mockRunTeamAgent.mockRejectedValueOnce(new Error("Team failed"));
      
      const res = await request(app)
        .post("/api/agent/team")
        .send({ task: "do it" });
        
      expect(res.text).toContain("Team failed");
    });
  });

  describe("POST /api/agent/team/download", () => {
    it("should download files", async () => {
      mockListWorkspaceFiles.mockResolvedValueOnce([{ name: "test.ts" }]);
      mockReadWorkspaceFile.mockResolvedValueOnce("content");
      
      const res = await request(app).post("/api/agent/team/download");
        
      expect(res.status).toBe(200);
      expect(res.body.files[0].name).toBe("test.ts");
      expect(res.body.files[0].content).toBe("content");
    });

    it("should return 404 if no files", async () => {
      mockListWorkspaceFiles.mockResolvedValueOnce([]);
      
      const res = await request(app).post("/api/agent/team/download");
      expect(res.status).toBe(404);
    });

    it("should handle read errors gracefully", async () => {
      mockListWorkspaceFiles.mockResolvedValueOnce([{ name: "test.ts" }]);
      mockReadWorkspaceFile.mockRejectedValueOnce(new Error("Read failed"));
      
      const res = await request(app).post("/api/agent/team/download");
        
      expect(res.status).toBe(200);
      expect(res.body.files[0].content).toBe("");
    });

    it("should handle list errors", async () => {
      mockListWorkspaceFiles.mockRejectedValueOnce(new Error("List failed"));
      
      const res = await request(app).post("/api/agent/team/download");
      expect(res.status).toBe(500);
    });
  });
});
