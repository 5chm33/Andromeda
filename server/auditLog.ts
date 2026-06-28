/**
 * auditLog.ts — v6.38
 *
 * Structured audit log for all security-relevant events in Andromeda.
 *
 * Records:
 *   - Authentication events (login, logout, token refresh, auth failure)
 *   - Authorization events (access granted/denied, role changes)
 *   - RSI events (proposal created/applied/rejected, cycle started/completed)
 *   - Tenant events (tenant created, config changed, isolated)
 *   - Admin actions (role assignment, user management, config changes)
 *   - API access (rate limit hits, suspicious patterns)
 *
 * Storage:
 *   - Append-only JSONL file at data/audit/audit.jsonl
 *   - In-memory ring buffer (last 1000 events) for fast API queries
 *   - Optional: write to Postgres audit table if POSTGRES_URL is set
 *
 * Exported API:
 *   audit(event)              — record an audit event
 *   getRecentAuditEvents()    — query the in-memory ring buffer
 *   getAuditStats()           — summary counts by category/action
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("auditLog");

// ── Types ──────────────────────────────────────────────────────────────────────

export type AuditCategory =
  | "auth"
  | "authz"
  | "rsi"
  | "tenant"
  | "admin"
  | "api"
  | "data"
  | "system";

export type AuditAction =
  // auth
  | "login" | "logout" | "token_refresh" | "auth_failed" | "session_expired"
  // authz
  | "access_granted" | "access_denied" | "role_changed" | "permission_denied"
  // rsi
  | "proposal_created" | "proposal_applied" | "proposal_rejected" | "proposal_reverted"
  | "cycle_started" | "cycle_completed" | "cycle_aborted"
  // tenant
  | "tenant_created" | "tenant_updated" | "tenant_deleted" | "tenant_isolated"
  | "tenant_quota_exceeded"
  // admin
  | "user_created" | "user_deleted" | "user_role_changed" | "config_changed"
  | "system_reset" | "emergency_stop"
  // api
  | "rate_limit_hit" | "suspicious_request" | "invalid_token" | "cors_blocked"
  // data
  | "data_exported" | "data_deleted" | "data_accessed"
  // system
  | "server_started" | "server_stopped" | "module_loaded" | "module_failed"
  | "health_check" | "migration_run";

export interface AuditEvent {
  id: string;
  timestamp: number;
  category: AuditCategory;
  action: AuditAction;
  /** Who performed the action (userId, openId, or "system") */
  actor: string;
  /** What resource was affected */
  resource?: string;
  /** Tenant context (if multi-tenant) */
  tenantId?: string;
  /** HTTP request context */
  requestId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  /** Outcome */
  success: boolean;
  statusCode?: number;
  /** Additional structured data */
  details?: Record<string, unknown>;
  /** Error message if success=false */
  error?: string;
  /** Severity level */
  severity: "info" | "warn" | "error" | "critical";
}

// ── Storage ────────────────────────────────────────────────────────────────────

const AUDIT_DIR = path.join(process.cwd(), "data", "audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit.jsonl");
const RING_BUFFER_SIZE = 1000;

const ringBuffer: AuditEvent[] = [];
let ringHead = 0;
let totalEvents = 0;

function ensureAuditDir(): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  } catch { /* ignore */ }
}

function generateId(): string {
  return `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Core audit function ────────────────────────────────────────────────────────

/**
 * Record an audit event. Non-blocking — writes to disk asynchronously.
 */
export function audit(event: Omit<AuditEvent, "id" | "timestamp">): void {
  if (!event || typeof event !== 'object' || !event.category || !event.action || typeof event.actor !== 'string') {
    log.warn(`[auditLog] Invalid audit event: ${JSON.stringify(event)}`);
    return;
  }
  const fullEvent: AuditEvent = {
    id: generateId(),
    timestamp: Date.now(),
    ...event,
  };

  // Add to ring buffer
  if (ringBuffer.length < RING_BUFFER_SIZE) {
    ringBuffer.push(fullEvent);
  } else {
    ringBuffer[ringHead % RING_BUFFER_SIZE] = fullEvent;
    ringHead++;
  }
  totalEvents++;

  // Write to disk asynchronously (non-blocking)
  ensureAuditDir();
  const line = JSON.stringify(fullEvent) + "\n";
  fs.appendFile(AUDIT_FILE, line, "utf-8", (err) => {
    if (err) log.warn(`[auditLog] Failed to write audit event: ${err.message}`);
  });

  // Log critical events to console
  if (fullEvent.severity === "critical" || fullEvent.severity === "error") {
    log.warn(`[AUDIT ${fullEvent.severity.toUpperCase()}] ${fullEvent.category}/${fullEvent.action} actor=${fullEvent.actor} success=${fullEvent.success}${fullEvent.error ? ` error=${fullEvent.error}` : ""}`);
  }
}

// ── Convenience helpers ────────────────────────────────────────────────────────

export function auditAuthFailure(opts: {
  actor: string;
  ip?: string;
  path?: string;
  requestId?: string;
  error?: string;
}): void {
  audit({
    category: "auth",
    action: "auth_failed",
    actor: opts.actor,
    ip: opts.ip,
    path: opts.path,
    requestId: opts.requestId,
    success: false,
    error: opts.error,
    severity: "warn",
  });
}

export function auditAccessDenied(opts: {
  actor: string;
  resource: string;
  requiredRole?: string;
  actualRole?: string;
  requestId?: string;
  ip?: string;
  path?: string;
}): void {
  audit({
    category: "authz",
    action: "access_denied",
    actor: opts.actor,
    resource: opts.resource,
    requestId: opts.requestId,
    ip: opts.ip,
    path: opts.path,
    success: false,
    severity: "warn",
    details: {
      requiredRole: opts.requiredRole,
      actualRole: opts.actualRole,
    },
  });
}

export function auditRsiEvent(opts: {
  action: "proposal_created" | "proposal_applied" | "proposal_rejected" | "proposal_reverted" | "cycle_started" | "cycle_completed" | "cycle_aborted";
  proposalId?: string;
  cycleId?: string;
  success: boolean;
  details?: Record<string, unknown>;
}): void {
  audit({
    category: "rsi",
    action: opts.action,
    actor: "system",
    resource: opts.proposalId ?? opts.cycleId,
    success: opts.success,
    severity: opts.success ? "info" : "warn",
    details: opts.details,
  });
}

export function auditAdminAction(opts: {
  actor: string;
  action: "user_role_changed" | "config_changed" | "system_reset" | "emergency_stop" | "user_created" | "user_deleted";
  resource?: string;
  requestId?: string;
  details?: Record<string, unknown>;
}): void {
  audit({
    category: "admin",
    action: opts.action,
    actor: opts.actor,
    resource: opts.resource,
    requestId: opts.requestId,
    success: true,
    severity: "warn",
    details: opts.details,
  });
}

// ── Query API ──────────────────────────────────────────────────────────────────

export interface AuditQuery {
  limit?: number;
  category?: AuditCategory;
  action?: AuditAction;
  actor?: string;
  tenantId?: string;
  severity?: AuditEvent["severity"];
  since?: number;
  success?: boolean;
}

/**
 * Query the in-memory ring buffer. Returns events in reverse-chronological order.
 */
export function getRecentAuditEvents(query: AuditQuery = {}): AuditEvent[] {
  const limit = Math.min(query.limit ?? 100, RING_BUFFER_SIZE);

  // Reconstruct ordered ring buffer
  let events: AuditEvent[];
  if (ringBuffer.length < RING_BUFFER_SIZE) {
    events = [...ringBuffer];
  } else {
    const head = ringHead % RING_BUFFER_SIZE;
    events = [...ringBuffer.slice(head), ...ringBuffer.slice(0, head)];
  }

  // Apply filters
  let filtered = events.filter(e => {
    if (query.category && e.category !== query.category) return false;
    if (query.action && e.action !== query.action) return false;
    if (query.actor && e.actor !== query.actor) return false;
    if (query.tenantId && e.tenantId !== query.tenantId) return false;
    if (query.severity && e.severity !== query.severity) return false;
    if (query.since && e.timestamp < query.since) return false;
    if (query.success !== undefined && e.success !== query.success) return false;
    return true;
  });

  // Reverse-chronological, limited
  return filtered.reverse().slice(0, limit);
}

/**
 * Get summary statistics from the ring buffer.
 */
export function getAuditStats(): {
  totalEvents: number;
  bufferedEvents: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recentFailures: number;
  lastEventAt: number | null;
} {
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let recentFailures = 0;
  const cutoff = Date.now() - 60 * 60 * 1000; // last hour

  for (const e of ringBuffer) {
    byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    if (!e.success && e.timestamp > cutoff) recentFailures++;
  }

  const lastEvent = ringBuffer.length > 0
    ? ringBuffer.reduce((a, b) => a.timestamp > b.timestamp ? a : b)
    : null;

  return {
    totalEvents,
    bufferedEvents: ringBuffer.length,
    byCategory,
    bySeverity,
    recentFailures,
    lastEventAt: lastEvent?.timestamp ?? null,
  };
}

/**
 * Load recent events from disk (for startup recovery).
 */
export function loadAuditFromDisk(limit = 200): void {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return;
    const lines = fs.readFileSync(AUDIT_FILE, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit);

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as AuditEvent;
        if (ringBuffer.length < RING_BUFFER_SIZE) {
          ringBuffer.push(event);
        } else {
          ringBuffer[ringHead % RING_BUFFER_SIZE] = event;
          ringHead++;
        }
        totalEvents++;
      } catch { /* skip malformed lines */ }
    }
    log.info(`[auditLog] Loaded ${lines.length} audit events from disk`);
  } catch (err) {
    log.warn(`[auditLog] Failed to load audit log from disk: ${(err as Error).message}`);
  }
}

// Auto-load and record server start — deferred to avoid test environment issues
// (vitest mocks fs before module load; setImmediate runs after all mocks are applied)
if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  setImmediate(() => {
    loadAuditFromDisk();
    audit({
      category: "system",
      action: "server_started",
      actor: "system",
      success: true,
      severity: "info",
      details: { pid: process.pid, nodeVersion: process.version },
    });
  });
}
