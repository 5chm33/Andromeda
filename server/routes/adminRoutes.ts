/**
 * adminRoutes.ts — v6.38
 *
 * Admin API routes for RBAC, audit log, and tenant management.
 *
 * Endpoints:
 *   GET  /api/admin/audit            — query audit log
 *   GET  /api/admin/audit/stats      — audit log statistics
 *   GET  /api/admin/tenants          — list all tenants
 *   POST /api/admin/tenants          — create a tenant
 *   GET  /api/admin/tenants/:id      — get tenant details + quota status
 *   PATCH /api/admin/tenants/:id     — update tenant config
 *   DELETE /api/admin/tenants/:id    — delete a tenant
 *   GET  /api/admin/rbac/context     — get RBAC context for current request
 *   GET  /api/admin/health           — admin health check (includes RBAC + tenant status)
 */

import { Router, type Request, type Response } from "express";
import {
  getRecentAuditEvents,
  getAuditStats,
  type AuditCategory,
  type AuditAction,
} from "../auditLog.js";
import {
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantStatus,
  type TenantConfig,
} from "../tenantManager.js";
import {
  requireAdmin,
  requireOperator,
  getRbacContext,
} from "../rbac.js";

export const adminRouter = Router();

// ── Audit log endpoints ────────────────────────────────────────────────────────

/** GET /api/admin/audit — query recent audit events */
adminRouter.get("/audit", requireOperator, (req: Request, res: Response) => {
  const {
    limit = "100",
    category,
    action,
    actor,
    tenantId,
    severity,
    since,
    success,
  } = req.query as Record<string, string | undefined>;

  const events = getRecentAuditEvents({
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    category: category as AuditCategory | undefined,
    action: action as AuditAction | undefined,
    actor,
    tenantId,
    severity: severity as AuditEvent["severity"] | undefined,
    since: since ? parseInt(since, 10) : undefined,
    success: success === "true" ? true : success === "false" ? false : undefined,
  });

  res.json({ events, count: events.length });
});

/** GET /api/admin/audit/stats — audit log statistics */
adminRouter.get("/audit/stats", requireOperator, (_req: Request, res: Response) => {
  const stats = getAuditStats();
  res.json(stats);
});

// ── Tenant management endpoints ────────────────────────────────────────────────

/** GET /api/admin/tenants — list all tenants */
adminRouter.get("/tenants", requireAdmin, (_req: Request, res: Response) => {
  const tenants = listTenants();
  res.json({ tenants, count: tenants.length });
});

/** POST /api/admin/tenants — create a new tenant */
adminRouter.post("/tenants", requireAdmin, (req: Request, res: Response) => {
  const body = req.body as Partial<TenantConfig>;

  if (!body.id || !/^[a-zA-Z0-9-_]{1,64}$/.test(body.id)) {
    res.status(400).json({ error: "Invalid tenant ID — must be alphanumeric, max 64 chars" });
    return;
  }

  if (!body.name) {
    res.status(400).json({ error: "Tenant name is required" });
    return;
  }

  const tenant = createTenant({
    id: body.id,
    name: body.name,
    description: body.description,
    quota: body.quota ?? {
      rsiCyclesPerDay: 48,
      evalRunsPerDay: 24,
      apiCallsPerMinute: 120,
      autoAppliesPerDay: 10,
      maxActiveGoals: 50,
      maxStoredProposals: 500,
    },
    allowedModules: body.allowedModules ?? [],
    blockedModules: body.blockedModules ?? [],
    constitutionalAiEnabled: body.constitutionalAiEnabled ?? true,
    goalDecompositionEnabled: body.goalDecompositionEnabled ?? true,
    active: body.active ?? true,
  });

  res.status(201).json({ tenant });
});

/** GET /api/admin/tenants/:id — get tenant details + quota status */
adminRouter.get("/tenants/:id", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const status = getTenantStatus(id);

  if (!status.tenant) {
    res.status(404).json({ error: `Tenant '${id}' not found` });
    return;
  }

  res.json(status);
});

/** PATCH /api/admin/tenants/:id — update tenant config */
adminRouter.patch("/tenants/:id", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as Partial<TenantConfig>;

  // Prevent changing the ID
  delete (updates as Record<string, unknown>).id;

  const updated = updateTenant(id, updates);
  if (!updated) {
    res.status(404).json({ error: `Tenant '${id}' not found` });
    return;
  }

  res.json({ tenant: updated });
});

/** DELETE /api/admin/tenants/:id — delete a tenant */
adminRouter.delete("/tenants/:id", requireAdmin, (req: Request, res: Response) => {
  const { id } = req.params;

  if (id === "default") {
    res.status(400).json({ error: "Cannot delete the default tenant" });
    return;
  }

  const deleted = deleteTenant(id);
  if (!deleted) {
    res.status(404).json({ error: `Tenant '${id}' not found` });
    return;
  }

  res.json({ success: true, message: `Tenant '${id}' deleted` });
});

// ── RBAC context endpoint ──────────────────────────────────────────────────────

/** GET /api/admin/rbac/context — get RBAC context for current request */
adminRouter.get("/rbac/context", (req: Request, res: Response) => {
  const context = getRbacContext(req);
  res.json({
    ...context,
    requestId: req.requestId,
    headers: {
      "x-tenant-id": req.headers["x-tenant-id"] ?? null,
      "x-actor-role": req.headers["x-actor-role"] ?? null,
      authorization: req.headers.authorization ? "[redacted]" : null,
    },
  });
});

// ── Admin health check ─────────────────────────────────────────────────────────

/** GET /api/admin/health — admin health check */
adminRouter.get("/health", requireOperator, (_req: Request, res: Response) => {
  const tenants = listTenants();
  const auditStats = getAuditStats();

  res.json({
    ok: true,
    rbac: { enabled: true, roles: ["guest", "viewer", "operator", "editor", "admin", "system"] },
    tenants: { count: tenants.length, active: tenants.filter(t => t.active).length },
    audit: {
      totalEvents: auditStats.totalEvents,
      bufferedEvents: auditStats.bufferedEvents,
      recentFailures: auditStats.recentFailures,
      lastEventAt: auditStats.lastEventAt,
    },
  });
});

// Fix missing type import for AuditEvent severity
import type { AuditEvent } from "../auditLog.js";
