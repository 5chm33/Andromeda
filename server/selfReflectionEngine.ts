/**
 * selfReflectionEngine.ts — Self-Reflection Engine
 * Andromeda v5.68
 *
 * Runs on a scheduled basis and performs structured behavioral reflection:
 * - "What did I learn from the last N interactions?"
 * - "Where did I fail or get confused?"
 * - "What patterns in my responses could be improved?"
 * - "What capabilities am I missing that users keep asking for?"
 *
 * Distinct from ContinuousImprover (code-level fixes).
 * This targets behavioral and strategic reflection.
 */

import * as fs from "fs";
import * as path from "path";
import { chatCompletion } from "./llmProvider.js";
import { storeMemory, searchMemory } from "./memory.js";

const REFLECTION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REFLECTION_LOG_PATH = path.join(process.cwd(), "data", "reflection_journal.jsonl");
const DECISION_JOURNAL_PATH = path.join(process.cwd(), "data", "decision_journal.jsonl");

export interface ReflectionEntry {
  timestamp: string;
  sessionCount: number;
  themes: string[];
  failures: string[];
  improvements: string[];
  capabilityGaps: string[];
  confidenceScore: number; // 0-1, how confident the reflection is
  rawReflection: string;
}

export interface DecisionEntry {
  timestamp: string;
  decisionType: "self_modification" | "tool_selection" | "response_strategy" | "memory_storage";
  context: string;
  alternativesConsidered: string[];
  chosenApproach: string;
  rationale: string;
  outcome?: "success" | "failure" | "partial" | "pending";
  outcomeNotes?: string;
}

let reflectionTimer: ReturnType<typeof setInterval> | null = null;
let sessionInteractionCount = 0;
let sessionFailures: string[] = [];
let sessionSuccesses: string[] = [];

// Ensure data directory exists
function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Record an interaction outcome for reflection aggregation.
 * Called by reactEngine.ts after each tool call or response.
 */
export function recordInteraction(type: "success" | "failure" | "partial", notes: string): void {
  sessionInteractionCount++;
  if (type === "failure" || type === "partial") {
    sessionFailures.push(`[${new Date().toISOString()}] ${notes}`);
  } else {
    sessionSuccesses.push(`[${new Date().toISOString()}] ${notes}`);
  }
}

/**
 * Log a decision to the decision journal for explainability.
 */
export function logDecision(entry: Omit<DecisionEntry, "timestamp">): void {
  ensureDataDir();
  const fullEntry: DecisionEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  try {
    fs.appendFileSync(DECISION_JOURNAL_PATH, JSON.stringify(fullEntry) + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

/**
 * Update the outcome of a previously logged decision.
 */
export function updateDecisionOutcome(
  context: string,
  outcome: DecisionEntry["outcome"],
  notes: string
): void {
  ensureDataDir();
  // Read last 100 entries and update the matching one
  try {
    if (!fs.existsSync(DECISION_JOURNAL_PATH)) return;
    const lines = fs.readFileSync(DECISION_JOURNAL_PATH, "utf-8").trim().split("\n");
    const updated = lines.map((line) => {
      try {
        const entry: DecisionEntry = JSON.parse(line);
        if (entry.context === context && entry.outcome === "pending") {
          return JSON.stringify({ ...entry, outcome, outcomeNotes: notes });
        }
        return line;
      } catch {
        return line;
      }
    });
    fs.writeFileSync(DECISION_JOURNAL_PATH, updated.join("\n") + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

/**
 * Read recent decisions from the journal.
 */
export function getRecentDecisions(limit = 20): DecisionEntry[] {
  ensureDataDir();
  try {
    if (!fs.existsSync(DECISION_JOURNAL_PATH)) return [];
    const lines = fs.readFileSync(DECISION_JOURNAL_PATH, "utf-8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as DecisionEntry; } catch { return null; }
      })
      .filter((e): e is DecisionEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Read recent reflections from the journal.
 */
export function getRecentReflections(limit = 5): ReflectionEntry[] {
  ensureDataDir();
  try {
    if (!fs.existsSync(REFLECTION_LOG_PATH)) return [];
    const lines = fs.readFileSync(REFLECTION_LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as ReflectionEntry; } catch { return null; }
      })
      .filter((e): e is ReflectionEntry => e !== null);
  } catch {
    return [];
  }
}

/**
 * Run a reflection cycle.
 */
async function runReflectionCycle(): Promise<void> {
  if (sessionInteractionCount < 3 && sessionFailures.length === 0) {
    // Not enough data to reflect on
    return;
  }

  console.log("[SelfReflection] Starting reflection cycle...");

  // Search memory for recent self-improvement history
  let pastReflections: string[] = [];
  try {
    const memResults = await searchMemory("self-reflection failure improvement", 5);
    pastReflections = memResults.map((m) => m.entry.content);
  } catch {
    // Non-fatal
  }

  const recentDecisions = getRecentDecisions(10);
  const failureSummary = sessionFailures.slice(-10).join("\n") || "No failures recorded";
  const successSummary = sessionSuccesses.slice(-5).join("\n") || "No successes recorded";
  const decisionSummary = recentDecisions
    .map((d) => `[${d.decisionType}] ${d.chosenApproach} → ${d.outcome ?? "pending"}`)
    .join("\n") || "No decisions logged";

  const prompt = `You are Andromeda, a self-improving AI assistant. Perform a structured self-reflection on your recent performance.

## Recent Session Data
**Interactions this session**: ${sessionInteractionCount}
**Failures/Issues**:
${failureSummary}

**Successes**:
${successSummary}

**Recent Decisions**:
${decisionSummary}

**Past Reflections** (for context):
${pastReflections.join("\n---\n") || "None yet"}

## Reflection Task
Analyze the above data and provide a structured reflection in JSON format:
{
  "themes": ["list of 2-4 recurring themes in your behavior"],
  "failures": ["list of specific failure patterns identified"],
  "improvements": ["list of concrete behavioral improvements to make"],
  "capabilityGaps": ["list of capabilities users needed that you lacked"],
  "confidenceScore": 0.0-1.0,
  "rawReflection": "2-3 paragraph narrative reflection"
}

Be honest, specific, and actionable. Focus on patterns, not individual incidents.`;

  try {
    const response = await chatCompletion([{ role: "user", content: prompt }], {
      maxTokens: 1000,
      temperature: 0.3,
    });

    const content = response.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[SelfReflection] Could not parse reflection JSON");
      return;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const entry: ReflectionEntry = {
      timestamp: new Date().toISOString(),
      sessionCount: sessionInteractionCount,
      themes: parsed.themes || [],
      failures: parsed.failures || [],
      improvements: parsed.improvements || [],
      capabilityGaps: parsed.capabilityGaps || [],
      confidenceScore: parsed.confidenceScore || 0.5,
      rawReflection: parsed.rawReflection || content,
    };

    // Save to reflection journal
    ensureDataDir();
    fs.appendFileSync(REFLECTION_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");

    // Store key insights in persistent memory
    if (entry.improvements.length > 0) {
      storeMemory(
        `Self-reflection (${entry.timestamp}): Key improvements needed: ${entry.improvements.join("; ")}. Themes: ${entry.themes.join(", ")}.`,
        "fact",
        ["self-reflection", "improvement", "behavioral"]
      );
    }

    if (entry.capabilityGaps.length > 0) {
      storeMemory(
        `Capability gaps identified (${entry.timestamp}): ${entry.capabilityGaps.join("; ")}`,
        "fact",
        ["self-reflection", "capability-gap", "improvement"]
      );
    }

    // Reset session counters
    sessionInteractionCount = 0;
    sessionFailures = [];
    sessionSuccesses = [];

    console.log(`[SelfReflection] Cycle complete. Themes: ${entry.themes.join(", ")}. Confidence: ${entry.confidenceScore}`);
  } catch (err) {
    console.warn("[SelfReflection] Reflection cycle failed:", (err as Error).message);
  }
}

/**
 * Start the Self-Reflection Engine daemon.
 */
export function startSelfReflectionEngine(): void {
  ensureDataDir();
  console.log("[SelfReflection] Engine started (interval: 1 hour)");

  // Run first reflection after 5 minutes to capture startup state
  setTimeout(() => {
    runReflectionCycle().catch(() => {});
  }, 5 * 60 * 1000);

  reflectionTimer = setInterval(() => {
    runReflectionCycle().catch(() => {});
  }, REFLECTION_INTERVAL_MS);
}

/**
 * Stop the Self-Reflection Engine daemon.
 */
export function stopSelfReflectionEngine(): void {
  if (reflectionTimer) {
    clearInterval(reflectionTimer);
    reflectionTimer = null;
  }
}

/**
 * Manually trigger a reflection cycle (for testing or on-demand reflection).
 */
export async function triggerReflection(): Promise<ReflectionEntry | null> {
  await runReflectionCycle();
  const recent = getRecentReflections(1);
  return recent[0] || null;
}
