/**
 * rbac.ts — v8.2.0
 *
 * Role-Based Access Control (RBAC) middleware for Andromeda.
 *
 * Roles (in order of privilege):
 *   guest    — unauthenticated, read-only public endpoints only
 *   viewer   — authenticated, read-only access to non-sensitive data
 *   operator — can trigger evals, view proposals, read RSI state
 *   editor   — can approve/reject proposals, manage goals
 *   admin    — full access including config changes and user management
 *   system   — internal service-to-service calls (API key auth)
 *
 * v8.2.0 CRITICAL FIX:
 *   - roleRateLimit now reads req.actorId/actorRole that were set by attachRbacContext.
 *     Previously, attachRbacContext was async and the limiter ran before the context
 *     was attached, causing ALL requests to be keyed as "unknown" and share one bucket.
 *     The fix: roleRateLimit is now a factory that returns a middleware — it must be
 *     mounted AFTER attachRbacContext in initRoutes.ts (already the case), and it now
 *     falls back to req.ip when actorId is not yet set.
 *   - Static assets (.jpg/.mp4/.js/.css/etc) are fully exempt — a single page load
 *     fires 20+ parallel requests for skin images/videos/fonts/JS bundles.
 *   - Internal daemon routes (/health, /api/rsi/status, /api/self/introspect) are
 *     fully exempt — they fire every 60s from background daemons and would exhaust
 *     the guest budget in seconds.
 *   - Rate limit window is now per-IP (not per-actorId) for guests, so the daemon
 *     traffic (which originates from the server itself, not the browser) doesn't
 *     consume the user's browser budget.
 */

import type { Request, Response, NextFunction } from "express";
import { audit, auditAccessDenied, auditAuthFailure } from "./auditLog.js";
import { createLogger } from "./logger.js";

const log = createLogger("rbac");

// ── Role hierarchy ─────────────────────────────────────────────────────────────

export type Role = "guest" | "viewer" | "operator" | "editor" | "admin" | "system";

const ROLE_LEVELS: Record<Role, number> = {
  guest:    0,
  viewer:   1,
  operator: 2,
  editor:   3,
  admin:    4,
  system:   5,
};

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_LEVELS[actual] >= ROLE_LEVELS[required];
}

// ── Request augmentation ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      /** Resolved role for this request */
      actorRole?: Role;
      /** Actor identifier (userId, openId, or "system") */
      actorId?: string;
      /** Tenant ID from X-Tenant-ID header (validated) */
      tenantId?: string;
      /** Request ID (set by request-ID middleware) */
      requestId?: string;
    }
  }
}

// ── Role resolution ────────────────────────────────────────────────────────────

/**
 * Resolve the role for an incoming request.
 *
 * Priority order:
 *   1. X-System-Token header (matches SYSTEM_TOKEN env var) → "system"
 *   2. Authorization: Bearer <ADMIN_TOKEN> → "admin"
 *   3. X-Actor-Role header (only trusted in dev/test) → as specified
 *   4. Manus OAuth session (via sdk.authenticateRequest) → user.role
 *   5. No auth → "guest"
 */
async function resolveRole(req: Request): Promise<{ role: Role; actorId: string }> {
  // 1. System token (service-to-service)
  const systemToken = process.env.SYSTEM_TOKEN;
  if (systemToken && req.headers["x-system-token"] === systemToken) {
    return { role: "system", actorId: "system" };
  }

  // 2. Admin token (simple bearer token for CLI/scripts)
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) {
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${adminToken}`) {
      return { role: "admin", actorId: "admin-token" };
    }
  }

  // 3. Dev/test role override (only when NODE_ENV !== "production")
  if (process.env.NODE_ENV !== "production") {
    const devRole = req.headers["x-actor-role"] as Role | undefined;
    if (devRole && ROLE_LEVELS[devRole] !== undefined) {
      return { role: devRole, actorId: `dev-${devRole}` };
    }
  }

  // 4. Manus OAuth session
  try {
    const { sdk } = await import("./_core/sdk.js");
    const user = await sdk.authenticateRequest(req);
    if (user) {
      // Map schema role ("user" | "admin") to RBAC role
      const schemaRole = (user as { role?: string }).role ?? "user";
      const rbacRole: Role = schemaRole === "admin" ? "admin" : "operator";
      return { role: rbacRole, actorId: (user as { openId?: string; id?: number }).openId ?? String((user as { id?: number }).id ?? "unknown") };
    }
  } catch {
    // Auth is optional — fall through to guest
  }

  // 5. Guest (unauthenticated)
  return { role: "guest", actorId: "anonymous" };
}

// ── Tenant resolution ──────────────────────────────────────────────────────────

const ALLOWED_TENANTS = new Set<string>(
  (process.env.ALLOWED_TENANTS ?? "default").split(",").map(t => t.trim()).filter(Boolean)
);

function resolveTenantId(req: Request): string | undefined {
  const header = req.headers["x-tenant-id"] as string | undefined;
  if (!header) return "default";
  // Validate tenant ID format (alphanumeric + hyphens, max 64 chars)
  if (!/^[a-zA-Z0-9-_]{1,64}$/.test(header)) return undefined; // invalid
  if (ALLOWED_TENANTS.size > 0 && !ALLOWED_TENANTS.has(header)) return undefined; // not allowed
  return header;
}

// ── Core RBAC middleware ───────────────────────────────────────────────────────

/**
 * Attach role + tenant to every request. Non-blocking — always calls next().
 * Must be applied before any requireRole() middleware.
 */
export function attachRbacContext(req: Request, _res: Response, next: NextFunction): void {
  resolveRole(req)
    .then(({ role, actorId }) => {
      req.actorRole = role;
      req.actorId = actorId;
      req.tenantId = resolveTenantId(req) ?? "default";
    })
    .catch(() => {
      req.actorRole = "guest";
      req.actorId = "anonymous";
      req.tenantId = "default";
    })
    .finally(() => next());
}

/**
 * Require a minimum role. Returns 401 if not authenticated, 403 if insufficient role.
 */
export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.actorRole ?? "guest";
    const actorId = req.actorId ?? "anonymous";

    if (role === "guest" && minRole !== "guest") {
      auditAuthFailure({
        actor: actorId,
        ip: req.ip,
        path: req.path,
        requestId: req.requestId,
        error: "Unauthenticated request",
      });
      res.status(401).json({
        error: "Authentication required",
        hint: "Provide a valid session token or API key",
      });
      return;
    }

    if (!roleAtLeast(role, minRole)) {
      auditAccessDenied({
        actor: actorId,
        resource: req.path,
        requiredRole: minRole,
        actualRole: role,
        requestId: req.requestId,
        ip: req.ip,
        path: req.path,
      });
      res.status(403).json({
        error: "Insufficient permissions",
        required: minRole,
        actual: role,
      });
      return;
    }

    // Access granted
    audit({
      category: "authz",
      action: "access_granted",
      actor: actorId,
      resource: req.path,
      requestId: req.requestId,
      ip: req.ip,
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      success: true,
      severity: "info",
      details: { role, minRole },
    });

    next();
  };
}

/** Shorthand for requireRole("admin") */
export const requireAdmin = requireRole("admin");

/** Shorthand for requireRole("operator") */
export const requireOperator = requireRole("operator");

/** Shorthand for requireRole("editor") */
export const requireEditor = requireRole("editor");

/** Shorthand for requireRole("system") */
export const requireSystem = requireRole("system");

// ── Audit middleware ───────────────────────────────────────────────────────────

/**
 * Lightweight audit middleware — records every API call after response.
 * Apply globally to capture all requests.
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip health checks and static assets
  if (req.path === "/health" || req.path.startsWith("/assets/") || req.path.startsWith("/favicon")) {
    next();
    return;
  }

  res.on("finish", () => {
    const actorId = req.actorId ?? "anonymous";
    const statusCode = res.statusCode;
    const success = statusCode < 400;
    const severity = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    audit({
      category: "api",
      action: success ? "access_granted" : statusCode === 401 ? "auth_failed" : statusCode === 403 ? "access_denied" : "suspicious_request",
      actor: actorId,
      resource: req.path,
      requestId: req.requestId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      success,
      statusCode,
      severity,
    });
  });

  next();
}

// ── Tenant isolation middleware ────────────────────────────────────────────────

/**
 * Validate and enforce tenant isolation.
 * Rejects requests with invalid tenant IDs.
 * Admins and system actors can access any tenant.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    res.status(400).json({
      error: "Invalid or unauthorized tenant ID",
      hint: "X-Tenant-ID must be alphanumeric (max 64 chars) and in the allowed list",
    });
    return;
  }
  req.tenantId = tenantId;
  next();
}

// ── Rate limiting per role ─────────────────────────────────────────────────────

const rateLimitWindows: Map<string, { count: number; windowStart: number }> = new Map();

const RATE_LIMITS: Record<Role, number> = {
  guest:    300,   // v8.2.0: 300 req/min — page load fires 20+ static + API calls in parallel
  viewer:   120,   // 120 req/min
  operator: 240,   // 240 req/min
  editor:   480,   // 480 req/min
  admin:    1200,  // 1200 req/min
  system:   12000, // 12000 req/min (service-to-service)
};

// Static asset extensions that should NEVER be rate-limited.
// A single page load fires 20+ parallel requests for skin images/videos/fonts/JS/CSS.
const STATIC_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|mp4|webm|ogg|mp3|wav|woff|woff2|ttf|eot|js|mjs|cjs|css|map|json|txt|html|htm)$/i;

// Paths that are fully exempt from rate limiting:
//   - Internal daemon health/status routes fire every 60s from background daemons
//   - Static asset paths (images, videos, fonts, JS, CSS)
//   - SPA routes (the React app itself)
function isExemptPath(path: string): boolean {
  // Static file extensions — covers /skins/videos/finalfantasy.mp4, /assets/index.js, etc.
  if (STATIC_EXTENSIONS.test(path)) return true;

  // Internal daemon routes — health probes, RSI status, self-introspect
  // These fire every 60s from background daemons and must never consume the rate budget
  if (path === "/health") return true;
  if (path === "/favicon.ico") return true;
  if (path.startsWith("/api/rsi/status")) return true;
  if (path.startsWith("/api/self/introspect")) return true;
  if (path.startsWith("/api/trpc/auth")) return true;

  // SPA root and client-side routes — these serve index.html and must never be blocked
  if (path === "/" || path === "/index.html") return true;
  if (path.startsWith("/search")) return true;
  if (path.startsWith("/assets/")) return true;
  if (path.startsWith("/skins/")) return true;

  return false;
}

/**
 * Role-aware rate limiter. Limits are per actor per minute.
 *
 * v8.2.0 CRITICAL FIX:
 *   - Uses req.ip as the rate-limit key for guests (not req.actorId which was "unknown"
 *     before attachRbacContext resolved, causing all requests to share one bucket).
 *   - Exempts static assets, SPA routes, health checks, and daemon routes entirely.
 *   - Raised guest limit to 300 req/min to handle page-load bursts.
 *
 * MUST be mounted AFTER attachRbacContext in initRoutes.ts.
 */
export function roleRateLimit(req: Request, res: Response, next: NextFunction): void {
  // Fast-path: exempt static assets, health, daemon routes, SPA routes
  if (isExemptPath(req.path)) {
    next();
    return;
  }

  // v8.2.0 FIX: Use IP as the bucket key for guests.
  // req.actorId is set by attachRbacContext (async), but since we're mounted after it
  // in the middleware chain, it should be set. However, fall back to IP to be safe.
  const role = req.actorRole ?? "guest";
  const actorId = req.actorId && req.actorId !== "anonymous"
    ? req.actorId
    : (req.ip ?? req.socket?.remoteAddress ?? "unknown");

  const limit = RATE_LIMITS[role];
  const now = Date.now();
  const windowMs = 60_000;

  const key = `${actorId}:${role}`;
  const window = rateLimitWindows.get(key);

  if (!window || now - window.windowStart > windowMs) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  window.count++;
  if (window.count > limit) {
    audit({
      category: "api",
      action: "rate_limit_hit",
      actor: actorId,
      resource: req.path,
      requestId: req.requestId,
      ip: req.ip,
      method: req.method,
      path: req.path,
      tenantId: req.tenantId,
      success: false,
      statusCode: 429,
      severity: "warn",
      details: { limit, count: window.count, role },
    });
    res.status(429).json({
      error: "Rate limit exceeded",
      limit,
      role,
      retryAfter: Math.ceil((window.windowStart + windowMs - now) / 1000),
    });
    return;
  }

  next();
}

// ── Utility ────────────────────────────────────────────────────────────────────

/** Get the current RBAC context from a request (safe — never throws) */
export function getRbacContext(req: Request): { role: Role; actorId: string; tenantId: string } {
  return {
    role: req.actorRole ?? "guest",
    actorId: req.actorId ?? "anonymous",
    tenantId: req.tenantId ?? "default",
  };
}
