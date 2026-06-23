import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock rbac
vi.mock("../rbac.js", () => ({
  requireOperator: (req: any, res: any, next: any) => next(),
  requireAdmin: (req: any, res: any, next: any) => next(),
}));

// Mock watchdog
const mockGetWatchdogStatus = vi.fn();
const mockTriggerHealthCheck = vi.fn();
vi.mock("../watchdog.js", () => ({
  getWatchdogStatus: mockGetWatchdogStatus,
  triggerHealthCheck: mockTriggerHealthCheck,
}));

// Mock telemetry
const mockGetTelemetrySummary = vi.fn();
const mockGetRawSamples = vi.fn();
vi.mock("../telemetry.js", () => ({
  getTelemetrySummary: mockGetTelemetrySummary,
  getRawSamples: mockGetRawSamples,
}));

describe("v7Routes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    const { v7Router } = await import("./v7Routes");
    app.use("/api/v7", v7Router);
  });

  describe("GET /api/v7/watchdog/status", () => {
    it("should get watchdog status", async () => {
      mockGetWatchdogStatus.mockReturnValueOnce({ status: "ok" });
      const res = await request(app).get("/api/v7/watchdog/status");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });
  });

  describe("POST /api/v7/watchdog/check", () => {
    it("should trigger health check", async () => {
      mockTriggerHealthCheck.mockResolvedValueOnce({ ok: true });
      const res = await request(app).post("/api/v7/watchdog/check");
      expect(res.status).toBe(200);
      expect(res.body.status.ok).toBe(true);
    });

    it("should handle errors", async () => {
      mockTriggerHealthCheck.mockRejectedValueOnce(new Error("Check failed"));
      const res = await request(app).post("/api/v7/watchdog/check");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/v7/telemetry/summary", () => {
    it("should get telemetry summary", async () => {
      mockGetTelemetrySummary.mockReturnValueOnce({ cpu: 10 });
      const res = await request(app).get("/api/v7/telemetry/summary");
      expect(res.status).toBe(200);
      expect(res.body.cpu).toBe(10);
    });
  });

  describe("GET /api/v7/telemetry/metrics", () => {
    it("should get telemetry metrics", async () => {
      mockGetRawSamples.mockReturnValueOnce([{ val: 1 }]);
      const res = await request(app).get("/api/v7/telemetry/metrics");
      expect(res.status).toBe(200);
      expect(res.body[0].val).toBe(1);
    });
  });

  describe("GET /api/v7/capabilities", () => {
    it("should return capabilities", async () => {
      const res = await request(app).get("/api/v7/capabilities");
      expect(res.status).toBe(200);
      expect(res.body.version).toBe("7.0.0");
      expect(res.body.capabilityCount).toBeGreaterThan(0);
    });
  });

  describe("GET /api/v7/roadmap", () => {
    it("should return roadmap", async () => {
      const res = await request(app).get("/api/v7/roadmap");
      expect(res.status).toBe(200);
      expect(res.body.project).toBe("Andromeda");
      expect(res.body.milestones).toBeInstanceOf(Array);
    });
  });
});
