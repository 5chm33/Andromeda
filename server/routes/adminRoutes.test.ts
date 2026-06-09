import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock rbac
vi.mock("../rbac.js", () => ({
  requireOperator: (req: any, res: any, next: any) => next(),
  requireAdmin: (req: any, res: any, next: any) => next(),
  getRbacContext: vi.fn((req) => ({
    tenantId: "default",
    role: "admin",
    userId: "test-user",
    isAuthenticated: true,
  })),
}));

// Mock auditLog
const mockGetRecentAuditEvents = vi.fn();
const mockGetAuditStats = vi.fn();

vi.mock("../auditLog.js", () => ({
  getRecentAuditEvents: mockGetRecentAuditEvents,
  getAuditStats: mockGetAuditStats,
}));

// Mock tenantManager
const mockListTenants = vi.fn();
const mockCreateTenant = vi.fn();
const mockUpdateTenant = vi.fn();
const mockDeleteTenant = vi.fn();
const mockGetTenantStatus = vi.fn();

vi.mock("../tenantManager.js", () => ({
  listTenants: mockListTenants,
  createTenant: mockCreateTenant,
  updateTenant: mockUpdateTenant,
  deleteTenant: mockDeleteTenant,
  getTenantStatus: mockGetTenantStatus,
}));

describe("adminRoutes", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    
    // Add dummy requestId
    app.use((req: any, res, next) => {
      req.requestId = "req-123";
      next();
    });
    
    const { adminRouter } = await import("./adminRoutes");
    app.use("/api/admin", adminRouter);
  });

  describe("GET /api/admin/audit", () => {
    it("should return audit events", async () => {
      mockGetRecentAuditEvents.mockReturnValueOnce([{ id: "event-1" }]);
      
      const res = await request(app).get("/api/admin/audit?limit=50&category=system&success=true");
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(mockGetRecentAuditEvents).toHaveBeenCalledWith(expect.objectContaining({
        limit: 50,
        category: "system",
        success: true
      }));
    });
  });

  describe("GET /api/admin/audit/stats", () => {
    it("should return audit stats", async () => {
      mockGetAuditStats.mockReturnValueOnce({ totalEvents: 100 });
      
      const res = await request(app).get("/api/admin/audit/stats");
        
      expect(res.status).toBe(200);
      expect(res.body.totalEvents).toBe(100);
    });
  });

  describe("GET /api/admin/tenants", () => {
    it("should list tenants", async () => {
      mockListTenants.mockReturnValueOnce([{ id: "t1" }, { id: "t2" }]);
      
      const res = await request(app).get("/api/admin/tenants");
        
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });
  });

  describe("POST /api/admin/tenants", () => {
    it("should create a tenant", async () => {
      mockCreateTenant.mockReturnValueOnce({ id: "t1", name: "Tenant 1" });
      
      const res = await request(app)
        .post("/api/admin/tenants")
        .send({ id: "t1", name: "Tenant 1" });
        
      expect(res.status).toBe(201);
      expect(res.body.tenant.id).toBe("t1");
      expect(mockCreateTenant).toHaveBeenCalled();
    });

    it("should validate tenant ID", async () => {
      const res = await request(app)
        .post("/api/admin/tenants")
        .send({ id: "invalid id!", name: "Tenant" });
        
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid tenant ID");
    });

    it("should require tenant name", async () => {
      const res = await request(app)
        .post("/api/admin/tenants")
        .send({ id: "t1" });
        
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("name is required");
    });
  });

  describe("GET /api/admin/tenants/:id", () => {
    it("should return tenant status", async () => {
      mockGetTenantStatus.mockReturnValueOnce({ tenant: { id: "t1" }, usage: {} });
      
      const res = await request(app).get("/api/admin/tenants/t1");
        
      expect(res.status).toBe(200);
      expect(res.body.tenant.id).toBe("t1");
    });

    it("should return 404 if not found", async () => {
      mockGetTenantStatus.mockReturnValueOnce({ tenant: null });
      
      const res = await request(app).get("/api/admin/tenants/missing");
        
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/admin/tenants/:id", () => {
    it("should update a tenant", async () => {
      mockUpdateTenant.mockReturnValueOnce({ id: "t1", name: "Updated" });
      
      const res = await request(app)
        .patch("/api/admin/tenants/t1")
        .send({ name: "Updated" });
        
      expect(res.status).toBe(200);
      expect(res.body.tenant.name).toBe("Updated");
      expect(mockUpdateTenant).toHaveBeenCalledWith("t1", { name: "Updated" });
    });

    it("should return 404 if not found", async () => {
      mockUpdateTenant.mockReturnValueOnce(null);
      
      const res = await request(app)
        .patch("/api/admin/tenants/missing")
        .send({ name: "Updated" });
        
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/tenants/:id", () => {
    it("should delete a tenant", async () => {
      mockDeleteTenant.mockReturnValueOnce(true);
      
      const res = await request(app).delete("/api/admin/tenants/t1");
        
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should protect default tenant", async () => {
      const res = await request(app).delete("/api/admin/tenants/default");
        
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Cannot delete");
    });

    it("should return 404 if not found", async () => {
      mockDeleteTenant.mockReturnValueOnce(false);
      
      const res = await request(app).delete("/api/admin/tenants/missing");
        
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/admin/rbac/context", () => {
    it("should return RBAC context", async () => {
      const res = await request(app)
        .get("/api/admin/rbac/context")
        .set("x-tenant-id", "custom")
        .set("Authorization", "Bearer token");
        
      expect(res.status).toBe(200);
      expect(res.body.tenantId).toBe("default");
      expect(res.body.requestId).toBe("req-123");
      expect(res.body.headers["x-tenant-id"]).toBe("custom");
      expect(res.body.headers.authorization).toBe("[redacted]");
    });
  });

  describe("GET /api/admin/health", () => {
    it("should return health status", async () => {
      mockListTenants.mockReturnValueOnce([{ active: true }, { active: false }]);
      mockGetAuditStats.mockReturnValueOnce({ totalEvents: 100 });
      
      const res = await request(app).get("/api/admin/health");
        
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.tenants.count).toBe(2);
      expect(res.body.tenants.active).toBe(1);
      expect(res.body.audit.totalEvents).toBe(100);
    });
  });
});
