/**
 * tenantManager.ts — v6.38
 *
 * Multi-tenant isolation and quota management for Andromeda.
 *
 * Features:
 *   - Tenant registry (in-memory + persisted to data/tenants.json)
 *   - Per-tenant resource quotas (RSI cycles, eval runs, API calls)
 *   - Tenant-scoped data isolation helpers
 *   - Tenant health/status reporting
 *
 * Tenant config is loaded from:
 *   1. TENANTS_CONFIG env var (JSON string)
 *   2. data/tenants.json (persisted config)
 *   3. Default "default" tenant with generous limits
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { audit } from "./auditLog.js";

const log = createLogger("tenantManager");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TenantQuota {
  /** Max RSI cycles per day */
  rsiCyclesPerDay: number;
  /** Max eval runs per day */
  evalRunsPerDay: number;
  /** Max API calls per minute */
  apiCallsPerMinute: number;
  /** Max proposal auto-applies per day */
  autoAppliesPerDay: number;
  /** Max concurrent goals */
  maxActiveGoals: number;
  /** Max stored proposals */
  maxStoredProposals: number;
}

export interface TenantConfig {
  id: string;
  name: string;
  description?: string;
  quota: TenantQuota;
  /** Allowed RSI modules (empty = all allowed) */
  allowedModules: string[];
  /** Blocked RSI modules */
  blockedModules: string[];
  /** Whether this tenant can use constitutional AI expansion */
  constitutionalAiEnabled: boolean;
  /** Whether this tenant can use goal decomposition */
  goalDecompositionEnabled: boolean;
  /** Whether this tenant is active */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TenantUsage {
  tenantId: string;
  date: string; // YYYY-MM-DD
  rsiCycles: number;
  evalRuns: number;
  apiCalls: number;
  autoApplies: number;
  activeGoals: number;
}

// ── Default quotas ─────────────────────────────────────────────────────────────

const DEFAULT_QUOTA: TenantQuota = {
  rsiCyclesPerDay: 48,        // 2 per hour
  evalRunsPerDay: 24,          // 1 per hour
  apiCallsPerMinute: 120,
  autoAppliesPerDay: 10,
  maxActiveGoals: 50,
  maxStoredProposals: 500,
};

const UNLIMITED_QUOTA: TenantQuota = {
  rsiCyclesPerDay: 999999,
  evalRunsPerDay: 999999,
  apiCallsPerMinute: 999999,
  autoAppliesPerDay: 999999,
  maxActiveGoals: 999999,
  maxStoredProposals: 999999,
};

// ── Registry ───────────────────────────────────────────────────────────────────

const TENANTS_FILE = path.join(process.cwd(), "data", "tenants.json");
const registry = new Map<string, TenantConfig>();
const usageMap = new Map<string, TenantUsage>();

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateUsage(tenantId: string): TenantUsage {
  const today = todayStr();
  const key = `${tenantId}:${today}`;
  let usage = usageMap.get(key);
  if (!usage) {
    usage = { tenantId, date: today, rsiCycles: 0, evalRuns: 0, apiCalls: 0, autoApplies: 0, activeGoals: 0 };
    usageMap.set(key, usage);
  }
  return usage;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function saveTenants(): void {
  try {
    fs.mkdirSync(path.dirname(TENANTS_FILE), { recursive: true });
    const data = Object.fromEntries(registry);
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    log.warn(`[tenantManager] Failed to save tenants: ${(err as Error).message}`);
  }
}

function loadTenants(): void {
  // Ensure "default" tenant always exists
  if (!registry.has("default")) {
    registry.set("default", {
      id: "default",
      name: "Default Tenant",
      description: "Default single-tenant configuration",
      quota: { ...UNLIMITED_QUOTA }, // default tenant has no limits
      allowedModules: [],
      blockedModules: [],
      constitutionalAiEnabled: true,
      goalDecompositionEnabled: true,
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // Load from env var
  const envConfig = process.env.TENANTS_CONFIG;
  if (envConfig) {
    try {
      const parsed = JSON.parse(envConfig) as Record<string, Partial<TenantConfig>>;
      for (const [id, config] of Object.entries(parsed)) {
        registry.set(id, {
          id,
          name: config.name ?? id,
          description: config.description,
          quota: { ...DEFAULT_QUOTA, ...(config.quota ?? {}) },
          allowedModules: config.allowedModules ?? [],
          blockedModules: config.blockedModules ?? [],
          constitutionalAiEnabled: config.constitutionalAiEnabled ?? true,
          goalDecompositionEnabled: config.goalDecompositionEnabled ?? true,
          active: config.active ?? true,
          createdAt: config.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        });
      }
      log.info(`[tenantManager] Loaded ${Object.keys(parsed).length} tenants from TENANTS_CONFIG`);
    } catch (err) {
      log.warn(`[tenantManager] Failed to parse TENANTS_CONFIG: ${(err as Error).message}`);
    }
  }

  // Load from file
  try {
    if (fs.existsSync(TENANTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf-8")) as Record<string, TenantConfig>;
      for (const [id, config] of Object.entries(data)) {
        if (!registry.has(id)) { // env var takes precedence
          registry.set(id, config);
        }
      }
      log.info(`[tenantManager] Loaded ${Object.keys(data).length} tenants from disk`);
    }
  } catch (err) {
    log.warn(`[tenantManager] Failed to load tenants from disk: ${(err as Error).message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getTenant(tenantId: string): TenantConfig | null {
  return registry.get(tenantId) ?? null;
}

export function getOrDefaultTenant(tenantId: string): TenantConfig {
  return registry.get(tenantId) ?? registry.get("default") ?? {
    id: "default",
    name: "Default Tenant",
    quota: { ...UNLIMITED_QUOTA },
    allowedModules: [],
    blockedModules: [],
    constitutionalAiEnabled: true,
    goalDecompositionEnabled: true,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function listTenants(): TenantConfig[] {
  return Array.from(registry.values());
}

export function createTenant(config: Omit<TenantConfig, "createdAt" | "updatedAt">): TenantConfig {
  const tenant: TenantConfig = {
    ...config,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  registry.set(config.id, tenant);
  saveTenants();
  audit({
    category: "tenant",
    action: "tenant_created",
    actor: "system",
    resource: config.id,
    success: true,
    severity: "info",
    details: { name: config.name },
  });
  log.info(`[tenantManager] Created tenant: ${config.id}`);
  return tenant;
}

export function updateTenant(tenantId: string, updates: Partial<TenantConfig>): TenantConfig | null {
  const existing = registry.get(tenantId);
  if (!existing) return null;
  const updated: TenantConfig = { ...existing, ...updates, id: tenantId, updatedAt: Date.now() };
  registry.set(tenantId, updated);
  saveTenants();
  audit({
    category: "tenant",
    action: "tenant_updated",
    actor: "system",
    resource: tenantId,
    success: true,
    severity: "info",
    details: { updates: Object.keys(updates) },
  });
  return updated;
}

export function deleteTenant(tenantId: string): boolean {
  if (tenantId === "default") return false; // can't delete default
  const existed = registry.delete(tenantId);
  if (existed) {
    saveTenants();
    audit({
      category: "tenant",
      action: "tenant_deleted",
      actor: "system",
      resource: tenantId,
      success: true,
      severity: "warn",
    });
  }
  return existed;
}

// ── Quota enforcement ──────────────────────────────────────────────────────────

export type QuotaResource = "rsiCycles" | "evalRuns" | "apiCalls" | "autoApplies";

export interface QuotaCheckResult {
  allowed: boolean;
  tenantId: string;
  resource: QuotaResource;
  used: number;
  limit: number;
  remaining: number;
}

export function checkQuota(tenantId: string, resource: QuotaResource): QuotaCheckResult {
  const tenant = getOrDefaultTenant(tenantId);
  const usage = getOrCreateUsage(tenantId);

  const limitMap: Record<QuotaResource, number> = {
    rsiCycles:  tenant.quota.rsiCyclesPerDay,
    evalRuns:   tenant.quota.evalRunsPerDay,
    apiCalls:   tenant.quota.apiCallsPerMinute,
    autoApplies: tenant.quota.autoAppliesPerDay,
  };

  const usedMap: Record<QuotaResource, number> = {
    rsiCycles:  usage.rsiCycles,
    evalRuns:   usage.evalRuns,
    apiCalls:   usage.apiCalls,
    autoApplies: usage.autoApplies,
  };

  const limit = limitMap[resource];
  const used = usedMap[resource];
  const allowed = used < limit;

  if (!allowed) {
    audit({
      category: "tenant",
      action: "tenant_quota_exceeded",
      actor: "system",
      resource: tenantId,
      tenantId,
      success: false,
      severity: "warn",
      details: { resource, used, limit },
    });
  }

  return { allowed, tenantId, resource, used, limit, remaining: Math.max(0, limit - used) };
}

export function incrementUsage(tenantId: string, resource: QuotaResource, amount = 1): void {
  const usage = getOrCreateUsage(tenantId);
  (usage as unknown as Record<string, number>)[resource] =
    ((usage as unknown as Record<string, number>)[resource] ?? 0) + amount;
}

export function getTenantUsage(tenantId: string): TenantUsage {
  return getOrCreateUsage(tenantId);
}

export function getTenantStatus(tenantId: string): {
  tenant: TenantConfig | null;
  usage: TenantUsage;
  quotaHealth: Record<QuotaResource, { pct: number; status: "ok" | "warn" | "critical" }>;
} {
  const tenant = getTenant(tenantId);
  const usage = getOrCreateUsage(tenantId);
  const resources: QuotaResource[] = ["rsiCycles", "evalRuns", "apiCalls", "autoApplies"];

  const quotaHealth: Record<string, { pct: number; status: "ok" | "warn" | "critical" }> = {};
  for (const r of resources) {
    const check = checkQuota(tenantId, r);
    const pct = check.limit > 0 ? (check.used / check.limit) * 100 : 0;
    quotaHealth[r] = {
      pct: Math.round(pct),
      status: pct >= 100 ? "critical" : pct >= 80 ? "warn" : "ok",
    };
  }

  return { tenant, usage, quotaHealth };
}

// ── Module isolation helpers ───────────────────────────────────────────────────

export function isTenantModuleAllowed(tenantId: string, moduleName: string): boolean {
  const tenant = getOrDefaultTenant(tenantId);
  if (tenant.blockedModules.includes(moduleName)) return false;
  if (tenant.allowedModules.length > 0 && !tenant.allowedModules.includes(moduleName)) return false;
  return true;
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initTenantManager(): void {
  loadTenants();
  log.info(`[tenantManager] Initialized — ${registry.size} tenant(s) registered`);
}

// Auto-init on module load
initTenantManager();
