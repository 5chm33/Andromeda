/**
 * longTermMemoryConsolidation.ts — v1.0.0
 *
 * Phase 2: Long-term memory consolidation — abstract pattern learning over weeks.
 *
 * Builds on the existing memoryConsolidation.ts (which handles deduplication and
 * forgetting curves) to add:
 *
 *   1. Pattern extraction: identify recurring themes across RSI cycles
 *   2. Abstract rule synthesis: distill patterns into reusable improvement rules
 *   3. Knowledge graph: track relationships between patterns and outcomes
 *   4. Temporal weighting: recent patterns weighted more heavily
 *   5. Outcome correlation: link patterns to eval score improvements
 *
 * This allows Andromeda to learn "meta-lessons" like:
 *   - "Adding error boundaries to async functions consistently improves reliability"
 *   - "Reducing timeout values in test helpers reduces CI flakiness"
 *   - "Extracting helper functions improves proposal acceptance rate"
 */
import { createLogger } from "./logger.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const log = createLogger("longTermMemory");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_FILE = path.join(__dirname, "..", "workspace", "long-term-patterns.json");

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface ImprovementPattern {
  id: string;
  description: string;           // Human-readable pattern description
  category: PatternCategory;
  occurrences: number;           // How many times this pattern appeared
  successRate: number;           // 0-1: fraction of times this led to improvement
  avgScoreDelta: number;         // Average eval score change when applied
  firstSeenAt: number;           // Unix timestamp
  lastSeenAt: number;
  relatedFiles: string[];        // Files where this pattern appears most
  exampleDiffs: string[];        // Short examples of the pattern in code
  synthesizedRule?: string;      // Abstract rule derived from this pattern
}

export type PatternCategory =
  | "error_handling"
  | "async_safety"
  | "type_safety"
  | "test_coverage"
  | "performance"
  | "security"
  | "readability"
  | "architectural";

export interface PatternObservation {
  cycleId: string;
  timestamp: number;
  targetFile: string;
  changeDescription: string;
  diff: string;
  evalScoreBefore: number;
  evalScoreAfter: number;
  accepted: boolean;
}

export interface KnowledgeGraphNode {
  patternId: string;
  relatedPatterns: string[];     // IDs of related patterns
  conflictingPatterns: string[]; // IDs of patterns that conflict
  prerequisitePatterns: string[];
}

export interface ConsolidationResult {
  newPatternsFound: number;
  patternsStrengthened: number;
  rulesGenerated: number;
  totalPatterns: number;
}

// ─── State ─────────────────────────────────────────────────────────────────────
let patterns: Map<string, ImprovementPattern> = new Map();
let knowledgeGraph: Map<string, KnowledgeGraphNode> = new Map();
let observations: PatternObservation[] = [];
let consolidationRunning = false;

// ─── Pattern Recognition ───────────────────────────────────────────────────────

/**
 * Analyze a diff and extract improvement patterns.
 */
export function extractPatternsFromDiff(
  diff: string,
  targetFile: string,
): PatternCategory[] {
  const categories: PatternCategory[] = [];
  const lower = diff.toLowerCase();

  // Error handling patterns
  if (lower.includes("try {") || lower.includes("catch") || lower.includes(".catch(") ||
      lower.includes("error boundary") || lower.includes("throw new")) {
    categories.push("error_handling");
  }

  // Async safety patterns
  if (lower.includes("await") || lower.includes("promise") || lower.includes("async") ||
      lower.includes("settimeout") || lower.includes("abort")) {
    categories.push("async_safety");
  }

  // Type safety patterns
  if (lower.includes(": string") || lower.includes(": number") || lower.includes(": boolean") ||
      lower.includes("as unknown") || lower.includes("typeof") || lower.includes("instanceof")) {
    categories.push("type_safety");
  }

  // Test coverage patterns
  if (lower.includes("test(") || lower.includes("it(") || lower.includes("describe(") ||
      lower.includes("expect(") || lower.includes(".test.ts")) {
    categories.push("test_coverage");
  }

  // Performance patterns
  if (lower.includes("cache") || lower.includes("memo") || lower.includes("debounce") ||
      lower.includes("throttle") || lower.includes("lazy") || lower.includes("chunk")) {
    categories.push("performance");
  }

  // Security patterns
  if (lower.includes("sanitize") || lower.includes("validate") || lower.includes("escape") ||
      lower.includes("auth") || lower.includes("permission") || lower.includes("guard")) {
    categories.push("security");
  }

  // Readability patterns
  if (lower.includes("extract") || lower.includes("refactor") || lower.includes("rename") ||
      lower.includes("helper") || lower.includes("util") || lower.includes("const ")) {
    categories.push("readability");
  }

  // Architectural patterns
  if (lower.includes("interface") || lower.includes("abstract") || lower.includes("factory") ||
      lower.includes("singleton") || lower.includes("observer") || lower.includes("module")) {
    categories.push("architectural");
  }

  return [...new Set(categories)];
}

/**
 * Record an observation from an RSI cycle for later consolidation.
 */
export function recordObservation(obs: PatternObservation): void {
  observations.push(obs);
  // Keep last 1000 observations in memory
  if (observations.length > 1000) observations.splice(0, observations.length - 1000);
}

/**
 * Run a consolidation pass to extract and strengthen patterns.
 * Should be called periodically (e.g., daily).
 */
export async function runLongTermConsolidation(): Promise<ConsolidationResult> {
  if (consolidationRunning) {
    log.info("[LongTermMemory] Consolidation already running — skipping");
    return { newPatternsFound: 0, patternsStrengthened: 0, rulesGenerated: 0, totalPatterns: patterns.size };
  }

  consolidationRunning = true;
  let newPatternsFound = 0;
  let patternsStrengthened = 0;
  let rulesGenerated = 0;

  try {
    log.info(`[LongTermMemory] Running consolidation over ${observations.length} observations`);

    for (const obs of observations) {
      const categories = extractPatternsFromDiff(obs.diff, obs.targetFile);
      const scoreDelta = obs.evalScoreAfter - obs.evalScoreBefore;

      for (const category of categories) {
        const patternKey = `${category}:${path.basename(obs.targetFile).replace(/\.ts$/, "")}`;
        const existing = patterns.get(patternKey);

        if (existing) {
          // Strengthen existing pattern
          existing.occurrences++;
          existing.lastSeenAt = obs.timestamp;
          existing.successRate = (existing.successRate * (existing.occurrences - 1) + (obs.accepted ? 1 : 0)) / existing.occurrences;
          existing.avgScoreDelta = (existing.avgScoreDelta * (existing.occurrences - 1) + scoreDelta) / existing.occurrences;
          if (!existing.relatedFiles.includes(obs.targetFile)) {
            existing.relatedFiles.push(obs.targetFile);
          }
          patternsStrengthened++;
        } else {
          // New pattern discovered
          const newPattern: ImprovementPattern = {
            id: patternKey,
            description: `${category.replace(/_/g, " ")} improvement in ${path.basename(obs.targetFile)}`,
            category,
            occurrences: 1,
            successRate: obs.accepted ? 1 : 0,
            avgScoreDelta: scoreDelta,
            firstSeenAt: obs.timestamp,
            lastSeenAt: obs.timestamp,
            relatedFiles: [obs.targetFile],
            exampleDiffs: [obs.diff.slice(0, 200)],
          };
          patterns.set(patternKey, newPattern);
          newPatternsFound++;
        }
      }
    }

    // Synthesize abstract rules for high-confidence patterns
    for (const [, pattern] of patterns) {
      if (pattern.occurrences >= 3 && pattern.successRate >= 0.7 && !pattern.synthesizedRule) {
        pattern.synthesizedRule = synthesizeRule(pattern);
        rulesGenerated++;
      }
    }

    // Update knowledge graph
    updateKnowledgeGraph();

    // Persist to disk
    await persistPatterns();

    log.info(`[LongTermMemory] Consolidation complete — new=${newPatternsFound}, strengthened=${patternsStrengthened}, rules=${rulesGenerated}`);
  } finally {
    consolidationRunning = false;
  }

  return { newPatternsFound, patternsStrengthened, rulesGenerated, totalPatterns: patterns.size };
}

/**
 * Synthesize an abstract improvement rule from a pattern.
 */
function synthesizeRule(pattern: ImprovementPattern): string {
  const successPct = Math.round(pattern.successRate * 100);
  const deltaSign = pattern.avgScoreDelta >= 0 ? "+" : "";
  return `When modifying ${pattern.category.replace(/_/g, "-")} code (especially in ${pattern.relatedFiles.map(f => path.basename(f)).slice(0, 2).join(", ")}), this pattern has a ${successPct}% acceptance rate and ${deltaSign}${pattern.avgScoreDelta.toFixed(2)} avg eval score impact across ${pattern.occurrences} observations.`;
}

/**
 * Build/update the knowledge graph linking related patterns.
 */
function updateKnowledgeGraph(): void {
  const patternList = [...patterns.values()];

  for (const pattern of patternList) {
    const node = knowledgeGraph.get(pattern.id) || {
      patternId: pattern.id,
      relatedPatterns: [],
      conflictingPatterns: [],
      prerequisitePatterns: [],
    };

    // Find related patterns (same category or overlapping files)
    node.relatedPatterns = patternList
      .filter(p => p.id !== pattern.id && (
        p.category === pattern.category ||
        p.relatedFiles.some(f => pattern.relatedFiles.includes(f))
      ))
      .map(p => p.id)
      .slice(0, 5);

    knowledgeGraph.set(pattern.id, node);
  }
}

/**
 * Get the top N most valuable patterns (highest success rate × occurrences).
 */
export function getTopPatterns(limit = 20): ImprovementPattern[] {
  return [...patterns.values()]
    .sort((a, b) => (b.successRate * b.occurrences) - (a.successRate * a.occurrences))
    .slice(0, limit);
}

/**
 * Get patterns relevant to a specific file being analyzed.
 */
export function getRelevantPatterns(targetFile: string, area?: string): ImprovementPattern[] {
  const filename = path.basename(targetFile);
  return [...patterns.values()]
    .filter(p =>
      p.relatedFiles.some(f => path.basename(f) === filename) ||
      (area && p.category === area)
    )
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 10);
}

/**
 * Get synthesized rules as a formatted string for injection into prompts.
 */
export function getSynthesizedRulesForPrompt(targetFile: string): string {
  const relevant = getRelevantPatterns(targetFile);
  const rules = relevant.filter(p => p.synthesizedRule);
  if (rules.length === 0) return "";
  return `\n\n## Learned Improvement Patterns (from ${rules.length} historical observations):\n` +
    rules.map(r => `- ${r.synthesizedRule}`).join("\n");
}

// ─── Persistence ───────────────────────────────────────────────────────────────
async function persistPatterns(): Promise<void> {
  try {
    fs.mkdirSync(path.dirname(PATTERNS_FILE), { recursive: true });
    const data = {
      version: "1.0.0",
      savedAt: Date.now(),
      patterns: Object.fromEntries(patterns),
      knowledgeGraph: Object.fromEntries(knowledgeGraph),
    };
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.warn("[LongTermMemory] Failed to persist patterns:", err);
  }
}

function loadPatterns(): void {
  try {
    if (fs.existsSync(PATTERNS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PATTERNS_FILE, "utf-8"));
      if (data.patterns) {
        for (const [k, v] of Object.entries(data.patterns)) {
          patterns.set(k, v as ImprovementPattern);
        }
      }
      if (data.knowledgeGraph) {
        for (const [k, v] of Object.entries(data.knowledgeGraph)) {
          knowledgeGraph.set(k, v as KnowledgeGraphNode);
        }
      }
      log.info(`[LongTermMemory] Loaded ${patterns.size} patterns from disk`);
    }
  } catch { /* non-fatal */ }
}

// ─── Stats ─────────────────────────────────────────────────────────────────────
export function getLongTermMemoryStats() {
  const patternList = [...patterns.values()];
  const byCategory: Record<string, number> = {};
  for (const p of patternList) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  }
  return {
    totalPatterns: patterns.size,
    totalObservations: observations.length,
    patternsWithRules: patternList.filter(p => p.synthesizedRule).length,
    avgSuccessRate: patternList.length > 0
      ? patternList.reduce((s, p) => s + p.successRate, 0) / patternList.length
      : 0,
    byCategory,
    knowledgeGraphNodes: knowledgeGraph.size,
    consolidationRunning,
  };
}

// ─── Init ──────────────────────────────────────────────────────────────────────
export function initLongTermMemoryConsolidation(): void {
  loadPatterns();
  // Run consolidation every 6 hours
  const CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    runLongTermConsolidation().catch(err =>
      log.warn("[LongTermMemory] Scheduled consolidation failed:", err)
    );
  }, CONSOLIDATION_INTERVAL_MS);
  log.info(`[LongTermMemory] Initialized — ${patterns.size} patterns loaded, consolidation every 6h`);
}
