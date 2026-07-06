/**
 * Andromeda v5.27 — Skill Graph
 *
 * Maps learned patterns to code modules for cross-session skill transfer.
 * When an error is fixed, the pattern is stored so similar errors in other
 * modules can be fixed automatically.
 *
 * Integrates with:
 * - selfKnowledgeBase.ts (learning storage)
 * - selfHeal.ts (auto-fix suggestions)
 * - selfModify.ts (applying learned fixes)
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillPattern {
  pattern: string;         // Error pattern signature
  fix: string;            // Description of the fix applied
  fixCode?: string;       // Actual code change (if available)
  success: boolean;
  confidence: number;     // 0-1
  timestamp: number;
  appliedCount: number;   // How many times this fix has been applied
}

interface SkillNode {
  module: string;
  knownPatterns: SkillPattern[];
  lastUpdated: number;
}

interface FixSuggestion {
  module: string;
  pattern: string;
  fix: string;
  fixCode?: string;
  confidence: number;
  source: string; // Which module the fix was learned from
}

// ── State ────────────────────────────────────────────────────────────────────

const PERSIST_PATH = path.join(process.cwd(), ".data", "skill_graph.json");
const graph: Map<string, SkillNode> = new Map();
let totalLearnings = 0;
let totalSuggestions = 0;
let totalApplied = 0;

// ── Persistence ──────────────────────────────────────────────────────────────

function loadGraph(): void {
  try {
    if (fs.existsSync(PERSIST_PATH)) {
      const data = JSON.parse(fs.readFileSync(PERSIST_PATH, "utf-8"));
      for (const node of data.nodes || []) {
        graph.set(node.module, node);
      }
      totalLearnings = data.totalLearnings || 0;
      totalApplied = data.totalApplied || 0;
    }
  } catch { /* fresh start */ }
}

function saveGraph(): void {
  try {
    const dir = path.dirname(PERSIST_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      nodes: Array.from(graph.values()),
      totalLearnings,
      totalApplied,
      savedAt: Date.now(),
    };
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

// ── Pattern Matching ─────────────────────────────────────────────────────────

/**
 * Extracts a normalized signature from an error for pattern matching.
 * Preserves the first 60 characters (error type + key phrase) verbatim,
 * then normalizes long numbers, file paths, and hex addresses in the remainder.
 */
function extractPattern(error: Error | string): string {
  const msg = typeof error === "string" ? error : error.message;
  const head = msg.slice(0, 60);
  const tail = msg
    .slice(60)
    .replace(/\b\d{4,}\b/g, "N")          // Replace long numbers (line numbers, IDs)
    .replace(/\/[^\s'"]+/g, "/PATH")       // Replace file paths
    .replace(/0x[0-9a-fA-F]+/g, "0xADDR"); // Replace hex addresses
  return (head + tail).trim().slice(0, 200);
}

/**
 * Computes the Jaccard similarity between two strings based on word overlap.
 * Returns a value between 0 (no common words) and 1 (identical).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aWords = a.toLowerCase().split(/\s+/);
  const bWords = b.toLowerCase().split(/\s+/);
  const bSet = new Set(bWords);
  const intersection = aWords.filter((w) => bSet.has(w));
  const allWords = new Set([...aWords, ...bWords]);
  return allWords.size > 0 ? intersection.length / allWords.size : 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function learnFromError(
  error: Error | string,
  module: string,
  fixApplied: string,
  fixCode?: string,
  success = true
): void {
  if (!error || !module || !fixApplied) {
    console.warn('[SkillGraph] learnFromError called with invalid arguments');
    return;
  }
  const pattern = extractPattern(error);
  const node = graph.get(module) || {
    module,
    knownPatterns: [],
    lastUpdated: Date.now(),
  };

  const SIMILARITY_THRESHOLD = 0.8;
  const CONFIDENCE_BOOST = 0.05;
  const CONFIDENCE_PENALTY = 0.1;
  const INITIAL_CONFIDENCE_SUCCESS = 0.7;
  const INITIAL_CONFIDENCE_FAILURE = 0.3;
  const MAX_PATTERNS_PER_MODULE = 50;
  const PROPAGATION_CONFIDENCE_MULTIPLIER = 0.5;
  const MIN_CONFIDENCE_TO_PROPAGATE = 0.7;
  const PROPAGATION_SIMILARITY_THRESHOLD = 0.8;
  const DECAY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const DECAY_RATE = 0.95; // 5% decay per cycle
  const MIN_CONFIDENCE_AFTER_DECAY = 0.1;
  const SUCCESS_OUTCOME_CONFIDENCE_BOOST = 0.1;
  const FAILURE_OUTCOME_CONFIDENCE_PENALTY = 0.2;
  const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
  const DECAY_INTERVAL_MS = 30 * 60 * 1000;
  const LEARNINGS_BEFORE_AUTO_SAVE = 10;
  const SUGGEST_FIX_SIMILARITY_THRESHOLD = 0.7;
  const SUGGEST_FIX_MIN_CONFIDENCE = 0.5;
  const PROPAGATE_MIN_CONFIDENCE = 0.85;
  const PROPAGATE_MIN_APPLIED_COUNT = 2;

  // Check if this pattern already exists
  const existing = node.knownPatterns.find(p => similarity(p.pattern, pattern) > SIMILARITY_THRESHOLD);
  if (existing) {
    existing.appliedCount++;
    existing.confidence = success
      ? Math.min(1, existing.confidence + CONFIDENCE_BOOST)
      : Math.max(0, existing.confidence - CONFIDENCE_PENALTY);
    existing.timestamp = Date.now();
    totalLearnings++; // Count reinforcement learning too, not just new patterns
  } else {
    node.knownPatterns.push({
      pattern,
      fix: fixApplied,
      fixCode,
      success,
      confidence: success ? INITIAL_CONFIDENCE_SUCCESS : INITIAL_CONFIDENCE_FAILURE,
      timestamp: Date.now(),
      appliedCount: 1,
    });
  }

  // Keep only top patterns per module
  if (node.knownPatterns.length > MAX_PATTERNS_PER_MODULE) {
    node.knownPatterns.sort((a, b) => b.confidence - a.confidence);
    node.knownPatterns = node.knownPatterns.slice(0, MAX_PATTERNS_PER_MODULE);
  }

  node.lastUpdated = Date.now();
  graph.set(module, node);
  totalLearnings++;

  // Auto-persist every 10 learnings
  if (totalLearnings % 10 === 0) saveGraph();
}

export function suggestFix(error: Error | string): FixSuggestion | null {
  const pattern = extractPattern(error);
  let bestMatch: FixSuggestion | null = null;
  let bestSimilarity = 0;

  for (const [module, node] of Array.from(graph.entries())) {
    for (const known of node.knownPatterns) {
      if (!known.success || known.confidence < 0.5) continue;
      const sim = similarity(known.pattern, pattern);
      if (sim > 0.7 && sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = {
          module,
          pattern: known.pattern,
          fix: known.fix,
          fixCode: known.fixCode,
          confidence: known.confidence * sim,
          source: module,
        };
      }
    }
  }

  if (bestMatch) totalSuggestions++;
  return bestMatch;
}

export function getSkillsForModule(module: string): SkillPattern[] {
  return graph.get(module)?.knownPatterns || [];
}

export function getGraphStats() {
  return {
    totalModules: graph.size,
    totalPatterns: Array.from(graph.values()).reduce((sum, n) => sum + n.knownPatterns.length, 0),
    totalLearnings,
    totalSuggestions,
    totalApplied,
    topModules: Array.from(graph.entries())
      .sort((a, b) => b[1].knownPatterns.length - a[1].knownPatterns.length)
      .slice(0, 5)
      .map(([module, node]) => ({ module, patterns: node.knownPatterns.length })),
  };
}

export function recordAppliedSuggestion(): void {
  totalApplied++;
}

/**
 * Learning Pipeline (v6.03) — Cross-module pattern transfer and confidence decay.
 *
 * 1. Cross-module transfer: When a fix succeeds in module A, propagate the pattern
 *    to similar modules with reduced confidence (transfer learning).
 * 2. Confidence decay: Patterns that haven't been applied recently decay over time.
 * 3. Outcome feedback: Record whether a suggested fix actually worked, updating confidence.
 */

/** Transfer a successful pattern to related modules */
export function propagatePattern(sourceModule: string, pattern: SkillPattern): void {
  if (!pattern.success || pattern.confidence < 0.7) return;

  // Find modules with similar patterns (likely related)
  for (const [module, node] of Array.from(graph.entries())) {
    if (module === sourceModule) continue;
    // Check if this module already has this pattern
    const alreadyKnown = node.knownPatterns.some(p => similarity(p.pattern, pattern.pattern) > 0.8);
    if (alreadyKnown) continue;

    // Transfer with reduced confidence (0.5x)
    node.knownPatterns.push({
      pattern: pattern.pattern,
      fix: pattern.fix,
      fixCode: pattern.fixCode,
      success: true,
      confidence: pattern.confidence * 0.5, // Lower confidence for transferred patterns
      timestamp: Date.now(),
      appliedCount: 0,
    });
    node.lastUpdated = Date.now();
  }
}

/** Decay confidence of stale patterns (called periodically) */
export function decayStalePatterns(): void {
  const DECAY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const DECAY_RATE = 0.95; // 5% decay per cycle
  const now = Date.now();

  for (const [, node] of Array.from(graph.entries())) {
    for (const pattern of node.knownPatterns) {
      if (now - pattern.timestamp > DECAY_THRESHOLD_MS) {
        pattern.confidence *= DECAY_RATE;
      }
    }
    // Prune patterns with confidence below 0.1
    node.knownPatterns = node.knownPatterns.filter(p => p.confidence >= 0.1);
  }
}

/** Record outcome of a suggested fix — updates confidence based on actual result */
export function recordFixOutcome(
  module: string,
  patternSignature: string,
  success: boolean
): void {
  const node = graph.get(module);
  if (!node) return;

  const pattern = node.knownPatterns.find(p => similarity(p.pattern, patternSignature) > 0.8);
  if (!pattern) return;

  if (success) {
    pattern.confidence = Math.min(1, pattern.confidence + 0.1);
    pattern.appliedCount++;
    totalApplied++;
    // Propagate successful pattern to other modules
    propagatePattern(module, pattern);
  } else {
    pattern.confidence = Math.max(0, pattern.confidence - 0.2);
  }
  pattern.timestamp = Date.now();
  node.lastUpdated = Date.now();
  saveGraph();
}

/** Run the full learning pipeline cycle (called by orchestrator) */
export function runLearningPipeline(): { decayed: number; propagated: number } {
  const beforePatterns = Array.from(graph.values()).reduce((s, n) => s + n.knownPatterns.length, 0);
  decayStalePatterns();
  const afterPatterns = Array.from(graph.values()).reduce((s, n) => s + n.knownPatterns.length, 0);

  // Propagate high-confidence patterns that haven't been propagated yet
  let propagated = 0;
  for (const [module, node] of Array.from(graph.entries())) {
    for (const pattern of node.knownPatterns) {
      if (pattern.confidence >= 0.85 && pattern.appliedCount >= 2) {
        propagatePattern(module, pattern);
        propagated++;
      }
    }
  }

  saveGraph();
  return { decayed: beforePatterns - afterPatterns, propagated };
}

let saveInterval: ReturnType<typeof setInterval> | null = null;
let decayInterval: ReturnType<typeof setInterval> | null = null;

let dispatchInterval: NodeJS.Timeout | null = null;

export function initSkillGraph(): void {
  loadGraph();
  // Seed bootstrap patterns if graph is empty (first run)
  if (graph.size === 0) {
    seedBootstrapPatterns();
  }
  // Single dispatch loop: auto-save every 5 min, decay every 30 min
  const SAVE_INTERVAL_MS = 5 * 60 * 1000;
  const DECAY_INTERVAL_MS = 30 * 60 * 1000;
  let lastSave = Date.now();
  let lastDecay = Date.now();
  dispatchInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastSave >= SAVE_INTERVAL_MS) {
      saveGraph();
      lastSave = now;
    }
    if (now - lastDecay >= DECAY_INTERVAL_MS) {
      decayStalePatterns();
      lastDecay = now;
    }
  }, 60_000); // check every minute
  console.log(`[SkillGraph] Initialized. ${graph.size} modules, ${Array.from(graph.values()).reduce((s, n) => s + n.knownPatterns.length, 0)} patterns loaded.`);
}

export function stopSkillGraph(): void {
  if (dispatchInterval) {
    clearInterval(dispatchInterval);
    dispatchInterval = null;
  }
}

/** Seed the skill graph with known patterns from Andromeda's development history */
function seedBootstrapPatterns(): void {
  const bootstrapData: Array<{ module: string; pattern: string; fix: string; confidence: number }> = [
    { module: "ai.ts", pattern: "Model ID ambiguous — it matches multiple models", fix: "Use fully-qualified model IDs (e.g. deepseek/deepseek-chat instead of deepseek-chat)", confidence: 0.95 },
    { module: "ai.ts", pattern: "ECONNRESET on streaming response", fix: "Add retry logic with exponential backoff for transient network errors", confidence: 0.9 },
    { module: "selfModify.ts", pattern: "File lock deadlock — timeout exceeded", fix: "Add timeout to acquireFileLock to prevent permanent deadlocks", confidence: 0.95 },
    { module: "memoryConsolidation.ts", pattern: "Memory leak in accessLog — orphaned entries", fix: "Clean up orphaned accessLog entries during consolidation cycles", confidence: 0.9 },
    { module: "dependencyResolver.ts", pattern: "Event loop blocked during package install", fix: "Use async exec instead of execSync for package installation", confidence: 0.95 },
    { module: "workspace.ts", pattern: "Path traversal attempt — resolved outside root", fix: "Validate resolved path starts with workspace root using path.resolve", confidence: 0.98 },
    { module: "twoPhaseCommit.ts", pattern: "Partial write corruption on crash", fix: "Write to temp file then atomic rename to prevent corruption", confidence: 0.95 },
    { module: "streamRouter.ts", pattern: "SSE connection dropped — client disconnect", fix: "Implement heartbeat pings and auto-reconnect with backoff", confidence: 0.85 },
    { module: "contextBus.ts", pattern: "Subscription leak — unbounded growth", fix: "Cap MAX_SUBSCRIPTIONS per agent and clean up on disconnect", confidence: 0.9 },
    { module: "selfHeal.ts", pattern: "Heal loop infinite retry — same error recurring", fix: "Add max retry count and circuit breaker for repeated heal failures", confidence: 0.9 },
  ];
  for (const { module, pattern, fix, confidence } of bootstrapData) {
    learnFromError(pattern, module, fix, undefined, true);
    // Boost confidence for bootstrap patterns
    const node = graph.get(module);
    if (node && node.knownPatterns.length > 0) {
      const last = node.knownPatterns[node.knownPatterns.length - 1];
      last.confidence = confidence;
      last.appliedCount = 3;
    }
  }
  saveGraph();
  console.log(`[SkillGraph] Seeded ${bootstrapData.length} bootstrap patterns from development history.`);
}
