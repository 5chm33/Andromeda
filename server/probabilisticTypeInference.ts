/**
 * probabilisticTypeInference.ts — v12.12.0 — Probabilistic Type Inference
 *
 * Tracks observed runtime types of key variables (via telemetry middleware)
 * and uses them to augment the static type information available to the LLM
 * and the invariant verifier.
 *
 * Problem: TypeScript's type system cannot fully represent all runtime
 * invariants. Proposals that pass `tsc --noEmit` can still introduce runtime
 * type errors in dynamically-typed paths (e.g., JSON parsing, Express request
 * bodies, database query results).
 *
 * Solution: Observe the actual runtime types of variables at key boundaries
 * (route handlers, database results, JSON.parse outputs) and build a
 * probabilistic model of what types actually appear at runtime. When a
 * proposal accesses a property that has historically been null at runtime
 * 15%+ of the time, the invariant verifier flags it as a warning.
 *
 * Integration:
 *  - observeRuntimeType() is called from telemetry middleware on each request
 *  - getTypeProfile() is called by proposalInvariantVerifier to augment checks
 *  - formatTypeProfileContext() is called by semanticImpactPredictor to inject
 *    runtime type observations into the LLM prompt
 *
 * Expected impact: +0.3–0.5% success rate by catching dynamic type errors
 * that static analysis misses.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("probabilisticTypeInference");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TypeObservation {
  /** The observed TypeScript-like type string */
  type: string;
  /** Number of times this type was observed */
  count: number;
  /** First observation timestamp */
  firstSeen: number;
  /** Last observation timestamp */
  lastSeen: number;
}

export interface TypeProfile {
  /** The variable/property path being tracked (e.g., "req.body.userId") */
  path: string;
  /** Total observations */
  totalObservations: number;
  /** Map of type string → observation data */
  observations: Record<string, TypeObservation>;
  /** Probability of null/undefined (0–1) */
  nullProbability: number;
  /** Most common type */
  dominantType: string;
  /** Whether this path has high null risk (>= 15%) */
  isHighNullRisk: boolean;
}

export interface TypeProfileStore {
  version: number;
  profiles: Record<string, TypeProfile>;
  lastSaved: number;
  totalObservations: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORE_FILENAME = "type_profiles.json";
const STORE_DIR = "workspace";
const NULL_RISK_THRESHOLD = 0.15; // 15% null rate = high risk
const MAX_PROFILES = 500; // Cap to prevent unbounded growth
const SAVE_INTERVAL_MS = 60_000; // Save every 60 seconds
const MAX_OBSERVATIONS_PER_PROFILE = 10_000; // Cap per profile

// ─── State ────────────────────────────────────────────────────────────────────

let _store: TypeProfileStore = {
  version: 1,
  profiles: {},
  lastSaved: 0,
  totalObservations: 0,
};
let _storeDir: string | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _initialized = false;

// ─── Initialization ───────────────────────────────────────────────────────────

export function initTypeProfileStore(storeDir?: string): void {
  _storeDir = storeDir ?? path.join(process.cwd(), STORE_DIR);
  const storePath = path.join(_storeDir, STORE_FILENAME);

  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const loaded = JSON.parse(raw) as TypeProfileStore;
      if (loaded.version === 1 && loaded.profiles) {
        _store = loaded;
        log.info(`[TypeProfiles] Loaded ${Object.keys(_store.profiles).length} profiles from disk`);
      }
    } catch (err) {
      log.warn(`[TypeProfiles] Failed to load store: ${err}`);
    }
  }
  _initialized = true;
}

function scheduleAutosave(): void {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveTypeProfileStore();
  }, SAVE_INTERVAL_MS);
  if (_saveTimer.unref) _saveTimer.unref();
}

export function saveTypeProfileStore(): void {
  if (!_storeDir || !_initialized) return;
  try {
    if (!fs.existsSync(_storeDir)) fs.mkdirSync(_storeDir, { recursive: true });
    _store.lastSaved = Date.now();
    fs.writeFileSync(
      path.join(_storeDir, STORE_FILENAME),
      JSON.stringify(_store, null, 2),
      "utf8"
    );
  } catch (err) {
    log.warn(`[TypeProfiles] Failed to save store: ${err}`);
  }
}

// ─── Core Observation API ─────────────────────────────────────────────────────

/**
 * Observe the runtime type of a value at a given path.
 * Called from telemetry middleware on each request boundary.
 *
 * @param variablePath - Dot-notation path (e.g., "req.body.userId", "db.getUser.result")
 * @param value - The actual runtime value
 */
export function observeRuntimeType(variablePath: string, value: unknown): void {
  if (!_initialized) return;
  if (Object.keys(_store.profiles).length >= MAX_PROFILES && !_store.profiles[variablePath]) {
    return; // Don't add new profiles beyond the cap
  }

  const typeStr = getRuntimeTypeString(value);
  const now = Date.now();

  if (!_store.profiles[variablePath]) {
    _store.profiles[variablePath] = {
      path: variablePath,
      totalObservations: 0,
      observations: {},
      nullProbability: 0,
      dominantType: typeStr,
      isHighNullRisk: false,
    };
  }

  const profile = _store.profiles[variablePath];

  // Cap observations per profile
  if (profile.totalObservations >= MAX_OBSERVATIONS_PER_PROFILE) return;

  if (!profile.observations[typeStr]) {
    profile.observations[typeStr] = {
      type: typeStr,
      count: 0,
      firstSeen: now,
      lastSeen: now,
    };
  }

  profile.observations[typeStr].count++;
  profile.observations[typeStr].lastSeen = now;
  profile.totalObservations++;
  _store.totalObservations++;

  // Recompute derived fields
  const nullCount =
    (profile.observations["null"]?.count ?? 0) +
    (profile.observations["undefined"]?.count ?? 0);
  profile.nullProbability = profile.totalObservations > 0
    ? nullCount / profile.totalObservations
    : 0;
  profile.isHighNullRisk = profile.nullProbability >= NULL_RISK_THRESHOLD;

  // Update dominant type
  let maxCount = 0;
  for (const [t, obs] of Object.entries(profile.observations)) {
    if (obs.count > maxCount) {
      maxCount = obs.count;
      profile.dominantType = t;
    }
  }

  scheduleAutosave();
}

/**
 * Get the type profile for a given variable path.
 */
export function getTypeProfile(variablePath: string): TypeProfile | undefined {
  return _store.profiles[variablePath];
}

/**
 * Get all high-null-risk profiles for a given file path.
 * Used by proposalInvariantVerifier to augment static checks.
 */
export function getHighRiskProfilesForFile(filePath: string): TypeProfile[] {
  const normalized = filePath.replace(/\\/g, "/");
  return Object.values(_store.profiles).filter(
    (p) => p.isHighNullRisk && p.path.includes(normalized.split("/").pop() ?? "")
  );
}

/**
 * Format a human-readable context block for injection into LLM prompts.
 * Called by semanticImpactPredictor.ts.
 */
export function formatTypeProfileContext(filePath: string, maxProfiles = 5): string {
  const highRisk = getHighRiskProfilesForFile(filePath).slice(0, maxProfiles);
  if (highRisk.length === 0) return "";

  const lines: string[] = [
    `RUNTIME TYPE OBSERVATIONS (${highRisk.length} high-null-risk paths):`,
  ];
  for (const p of highRisk) {
    const pct = (p.nullProbability * 100).toFixed(1);
    lines.push(`  ${p.path}: null/undefined ${pct}% of the time (dominant: ${p.dominantType}, n=${p.totalObservations})`);
  }
  lines.push("NOTE: These paths have been null at runtime — add null guards before accessing properties.");
  return lines.join("\n");
}

/**
 * Get overall stats for the type profile store.
 */
export function getTypeProfileStats(): {
  totalProfiles: number;
  highRiskProfiles: number;
  totalObservations: number;
  lastSaved: number;
} {
  const highRisk = Object.values(_store.profiles).filter((p) => p.isHighNullRisk).length;
  return {
    totalProfiles: Object.keys(_store.profiles).length,
    highRiskProfiles: highRisk,
    totalObservations: _store.totalObservations,
    lastSaved: _store.lastSaved,
  };
}

/**
 * Reset the in-memory profile store (for testing only).
 * Does NOT persist to disk.
 */
export function clearTypeProfiles(): void {
  _store = { version: 1, profiles: {}, lastSaved: 0, totalObservations: 0 };
  _initialized = true;
}

/**
 * Prune profiles that haven't been observed in the last 30 days.
 */
export function pruneStaleProfiles(maxAgeDays = 30): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const [key, profile] of Object.entries(_store.profiles)) {
    const lastSeen = Math.max(
      ...Object.values(profile.observations).map((o) => o.lastSeen)
    );
    if (lastSeen < cutoff) {
      delete _store.profiles[key];
      pruned++;
    }
  }
  if (pruned > 0) {
    log.info(`[TypeProfiles] Pruned ${pruned} stale profiles`);
    saveTypeProfileStore();
  }
  return pruned;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a runtime value to a TypeScript-like type string.
 */
export function getRuntimeTypeString(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    if (value.length === 0) return "never[]";
    const elementType = getRuntimeTypeString(value[0]);
    return `${elementType}[]`;
  }
  const t = typeof value;
  if (t === "object") {
    const keys = Object.keys(value as object).slice(0, 3);
    if (keys.length === 0) return "{}";
    return `{ ${keys.join("; ")} }`;
  }
  return t; // "string" | "number" | "boolean" | "function" | "symbol" | "bigint"
}

/**
 * Check if a code snippet accesses properties on paths that are high-null-risk.
 * Returns a list of warnings for the invariant verifier.
 */
export function checkSnippetForNullRiskAccess(
  snippet: string,
  filePath: string
): Array<{ path: string; nullProbability: number; line: number }> {
  const warnings: Array<{ path: string; nullProbability: number; line: number }> = [];
  const highRisk = getHighRiskProfilesForFile(filePath);
  if (highRisk.length === 0) return warnings;

  const lines = snippet.split("\n");
  for (const profile of highRisk) {
    // Extract the last segment of the path (e.g., "userId" from "req.body.userId")
    const segments = profile.path.split(".");
    const lastSegment = segments[segments.length - 1];
    if (!lastSegment || lastSegment.length < 3) continue;

    // Look for direct property access without null check
    const accessPattern = new RegExp(`\\.${lastSegment}\\b(?!\\s*[?!])`);
    lines.forEach((line, idx) => {
      if (accessPattern.test(line) && !line.includes("?.") && !line.includes("??")) {
        warnings.push({
          path: profile.path,
          nullProbability: profile.nullProbability,
          line: idx + 1,
        });
      }
    });
  }
  return warnings;
}
