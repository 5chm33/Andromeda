/**
 * learnedConstraints.ts — v6.36
 *
 * Constitutional AI Expansion: automatically learns new safety constraints from
 * repeated proposal rejections and appends them to data/learned_constraints.json.
 *
 * These learned constraints are loaded by safetySupervisor.ts and checked
 * alongside the static constitution patterns on every proposal.
 *
 * Flow:
 *   1. When a proposal is rejected by the safety guard, the rejection reason is
 *      analysed to extract the pattern that caused the rejection.
 *   2. If the same pattern causes ≥2 rejections, it is promoted to a learned
 *      constraint and persisted.
 *   3. safetySupervisor.ts loads learned constraints on every check call.
 *
 * This means Andromeda's safety envelope grows automatically over time without
 * requiring manual updates to the static constitution file.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEARNED_CONSTRAINTS_PATH = path.join(__dirname, "../data/learned_constraints.json");

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LearnedConstraint {
  id: string;
  pattern: string;           // regex or substring to check in proposedSnippet
  reason: string;            // human-readable explanation
  rejectionCount: number;    // how many times this pattern caused a rejection
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;           // false = soft-disabled (don't check)
}

interface ConstraintStore {
  constraints: LearnedConstraint[];
  lastUpdatedAt: number;
}

// ── Persistence ────────────────────────────────────────────────────────────────

function loadStore(): ConstraintStore {
  try {
    if (fs.existsSync(LEARNED_CONSTRAINTS_PATH)) {
      return JSON.parse(fs.readFileSync(LEARNED_CONSTRAINTS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { constraints: [], lastUpdatedAt: 0 };
}

function saveStore(store: ConstraintStore): void {
  try {
    const dir = path.dirname(LEARNED_CONSTRAINTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    store.lastUpdatedAt = Date.now();
    fs.writeFileSync(LEARNED_CONSTRAINTS_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("[LearnedConstraints] Save failed:", (err as Error).message);
  }
}

// ── In-memory cache ────────────────────────────────────────────────────────────

let _cache: ConstraintStore | null = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

function getStore(): ConstraintStore {
  const now = Date.now();
  if (!_cache || now - _cacheLoadedAt > CACHE_TTL_MS) {
    _cache = loadStore();
    _cacheLoadedAt = now;
  }
  return _cache;
}

function invalidateCache(): void {
  _cache = null;
  _cacheLoadedAt = 0;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Record a rejection event. If the same pattern is rejected ≥2 times,
 * it is promoted to an active learned constraint.
 *
 * @param pattern   The code pattern or substring that caused the rejection
 * @param reason    Human-readable reason for the rejection
 */
export function recordRejection(pattern: string, reason: string): void {
  if (!pattern || pattern.trim().length < 3) return; // too short to be useful

  const store = loadStore();
  const existing = store.constraints.find(c => c.pattern === pattern);

  if (existing) {
    existing.rejectionCount++;
    existing.lastSeenAt = Date.now();
    // Promote to active after 2 rejections
    if (existing.rejectionCount >= 2 && !existing.active) {
      existing.active = true;
      console.log(`[LearnedConstraints] Promoted constraint to active: "${pattern}" (${existing.rejectionCount} rejections)`);
    }
  } else {
    const constraint: LearnedConstraint = {
      id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      pattern,
      reason,
      rejectionCount: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      active: false, // needs ≥2 rejections to become active
    };
    store.constraints.push(constraint);
    console.log(`[LearnedConstraints] Recorded new rejection pattern: "${pattern}"`);
  }

  // Keep at most 500 constraints
  if (store.constraints.length > 500) {
    store.constraints = store.constraints
      .sort((a, b) => b.rejectionCount - a.rejectionCount)
      .slice(0, 500);
  }

  saveStore(store);
  invalidateCache();
}

/**
 * Add a learned constraint directly (bypassing the 2-rejection threshold).
 * Used for manually curated constraints.
 */
export function addLearnedConstraint(pattern: string, reason: string): LearnedConstraint {
  const store = loadStore();
  const existing = store.constraints.find(c => c.pattern === pattern);
  if (existing) {
    existing.rejectionCount++;
    existing.active = true;
    existing.lastSeenAt = Date.now();
    saveStore(store);
    invalidateCache();
    return existing;
  }
  const constraint: LearnedConstraint = {
    id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    pattern,
    reason,
    rejectionCount: 2, // start at 2 so it's immediately active
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    active: true,
  };
  store.constraints.push(constraint);
  saveStore(store);
  invalidateCache();
  console.log(`[LearnedConstraints] Added constraint: "${pattern}"`);
  return constraint;
}

/**
 * Get all active learned constraints (for use in safetySupervisor.ts).
 */
export function getLearnedConstraints(): LearnedConstraint[] {
  return getStore().constraints.filter(c => c.active);
}

/**
 * Get all constraints (active and inactive) for the admin UI.
 */
export function getAllConstraints(): LearnedConstraint[] {
  return getStore().constraints;
}

/**
 * Check if a code snippet violates any learned constraint.
 * Returns the first violated constraint, or null if clean.
 */
export function checkLearnedConstraints(snippet: string): LearnedConstraint | null {
  if (typeof snippet !== 'string' || snippet.length === 0) return null;
  const active = getLearnedConstraints();
  for (const constraint of active) {
    try {
      // Try as regex first, fall back to substring match
      let matches = false;
      try {
        if (constraint.pattern == null) continue;
        matches = new RegExp(constraint.pattern, "i").test(snippet);
      } catch {
        matches = constraint.pattern != null && snippet.includes(constraint.pattern);
      }
      if (matches) return constraint;
    } catch { /* skip malformed constraint */ }
  }
  return null;
}

/**
 * Disable a constraint (soft-delete — keeps the record for audit purposes).
 */
export function disableConstraint(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  const store = loadStore();
  const constraint = store.constraints.find(c => c.id === id);
  if (constraint == null) return false;
  constraint.active = false;
  saveStore(store);
  invalidateCache();
  return true;
}
