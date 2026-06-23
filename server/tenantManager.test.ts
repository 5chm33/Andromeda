import { describe, it, expect, afterEach } from "vitest";
import { getTenant, listTenants, createTenant, deleteTenant } from "./tenantManager.js";

const TEST_TENANT_ID = "test-tenant-audit10";

describe("tenantManager", () => {
  afterEach(() => {
    try { deleteTenant(TEST_TENANT_ID); } catch { /* non-fatal */ }
  });

  it("exports getTenant, listTenants, createTenant, deleteTenant", () => {
    expect(typeof getTenant).toBe("function");
    expect(typeof listTenants).toBe("function");
    expect(typeof createTenant).toBe("function");
    expect(typeof deleteTenant).toBe("function");
  });

  it("listTenants returns an array", () => {
    const tenants = listTenants();
    expect(Array.isArray(tenants)).toBe(true);
  });

  it("getTenant returns null for unknown tenant", () => {
    const tenant = getTenant("nonexistent-tenant-xyz");
    expect(tenant).toBeNull();
  });

  it("createTenant creates and returns a tenant", () => {
    const tenant = createTenant({
      id: TEST_TENANT_ID,
      name: "Test Tenant",
      quota: { maxProposalsPerDay: 10, maxFilesPerProposal: 5, maxTokensPerProposal: 1000, maxConcurrentCycles: 1 },
      allowedModules: [],
      blockedModules: [],
      constitutionalAiEnabled: true,
      goalDecompositionEnabled: true,
      active: true,
    });
    expect(tenant).toHaveProperty("id", TEST_TENANT_ID);
    expect(tenant).toHaveProperty("name", "Test Tenant");
  });

  it("getTenant retrieves a created tenant", () => {
    createTenant({
      id: TEST_TENANT_ID,
      name: "Test Tenant",
      quota: { maxProposalsPerDay: 10, maxFilesPerProposal: 5, maxTokensPerProposal: 1000, maxConcurrentCycles: 1 },
      allowedModules: [],
      blockedModules: [],
      constitutionalAiEnabled: true,
      goalDecompositionEnabled: true,
      active: true,
    });
    const tenant = getTenant(TEST_TENANT_ID);
    expect(tenant).not.toBeNull();
    expect(tenant?.id).toBe(TEST_TENANT_ID);
  });

  it("deleteTenant removes a tenant", () => {
    createTenant({
      id: TEST_TENANT_ID,
      name: "Test Tenant",
      quota: { maxProposalsPerDay: 10, maxFilesPerProposal: 5, maxTokensPerProposal: 1000, maxConcurrentCycles: 1 },
      allowedModules: [],
      blockedModules: [],
      constitutionalAiEnabled: true,
      goalDecompositionEnabled: true,
      active: true,
    });
    const deleted = deleteTenant(TEST_TENANT_ID);
    expect(deleted).toBe(true);
    expect(getTenant(TEST_TENANT_ID)).toBeNull();
  });
});
