/**
 * evalSeed.ts — v9.6.0
 *
 * Seeds the adaptive eval suite with 20 high-quality hand-crafted benchmark
 * cases across all 6 categories (reasoning, code, tool_use, self_knowledge,
 * multi_step, browser) at three difficulty levels.
 *
 * Called once at startup by initAdaptiveEval() if adaptive_benchmarks.json
 * is empty or missing. Seeds are marked source: "gap_analysis" so they
 * integrate naturally with the existing adaptive pipeline.
 *
 * Why this matters:
 *   evalDrivenTargeting.ts only activates when a category pass rate drops
 *   below 0.7 AND there are at least 2 tasks in that category. Without seeds,
 *   the adaptive system has nothing to run and targeting never fires.
 */

import * as fs from "fs";
import * as path from "path";
import type { AdaptiveBenchmark } from "./adaptiveEval.js";

const DATA_DIR = path.join(process.cwd(), "data");
const BENCHMARKS_FILE = path.join(DATA_DIR, "adaptive_benchmarks.json");

const SEED_BENCHMARKS: AdaptiveBenchmark[] = [
  // ── Reasoning (4) ─────────────────────────────────────────────────────────
  {
    id: "seed_r01", category: "reasoning", difficulty: "easy",
    prompt: "If you have 3 apples and give away 1, then receive 2 more, how many do you have?",
    expectedKeywords: ["4"],
    forbiddenKeywords: ["I cannot", "I don't know"],
    maxTokens: 100, timeoutMs: 10000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_r02", category: "reasoning", difficulty: "medium",
    prompt: "A snail climbs 3 feet up a wall during the day and slides back 2 feet at night. The wall is 10 feet tall. How many days does it take to reach the top?",
    expectedKeywords: ["8", "eight"],
    forbiddenKeywords: ["10 days", "never"],
    maxTokens: 300, timeoutMs: 15000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_r03", category: "reasoning", difficulty: "medium",
    prompt: "You have two ropes, each takes exactly 1 hour to burn (but burns unevenly). How do you measure exactly 45 minutes using only these ropes and a lighter?",
    expectedKeywords: ["both ends", "light", "30 minutes", "45"],
    forbiddenKeywords: ["impossible", "cannot"],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_r04", category: "reasoning", difficulty: "hard",
    prompt: "Three missionaries and three cannibals must cross a river using a boat that holds at most 2 people. Cannibals must never outnumber missionaries on either bank. What is the minimum number of crossings?",
    expectedKeywords: ["11", "eleven"],
    forbiddenKeywords: ["impossible", "cannot be done"],
    maxTokens: 600, timeoutMs: 30000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },

  // ── Code (4) ──────────────────────────────────────────────────────────────
  {
    id: "seed_c01", category: "code", difficulty: "easy",
    prompt: "What does the following TypeScript code output? const x = [1,2,3]; console.log(x.map(n => n * 2));",
    expectedKeywords: ["2", "4", "6"],
    forbiddenKeywords: ["error", "undefined"],
    maxTokens: 150, timeoutMs: 10000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_c02", category: "code", difficulty: "medium",
    prompt: "Write a TypeScript function that takes an array of numbers and returns the two numbers that sum to a given target. Assume exactly one solution exists.",
    expectedKeywords: ["function", "Map", "return", "target"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_c03", category: "code", difficulty: "medium",
    prompt: "Explain the difference between 'interface' and 'type' in TypeScript. When would you use each?",
    expectedKeywords: ["interface", "type", "extends", "union", "intersection"],
    forbiddenKeywords: [],
    maxTokens: 400, timeoutMs: 15000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_c04", category: "code", difficulty: "hard",
    prompt: "Implement a TypeScript function that flattens a deeply nested array to any depth. Do not use Array.prototype.flat().",
    expectedKeywords: ["function", "Array.isArray", "reduce", "concat", "recursive"],
    forbiddenKeywords: [".flat("],
    maxTokens: 500, timeoutMs: 25000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },

  // ── Tool Use (3) ──────────────────────────────────────────────────────────
  {
    id: "seed_t01", category: "tool_use", difficulty: "easy",
    prompt: "What is your current version number? Answer with just the version string.",
    expectedKeywords: ["9."],
    forbiddenKeywords: ["I don't know", "cannot determine", "6."],
    maxTokens: 50, timeoutMs: 10000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_t02", category: "tool_use", difficulty: "medium",
    prompt: "How many pending self-improvement proposals are currently in the queue?",
    expectedKeywords: ["proposal", "pending", "queue"],
    forbiddenKeywords: ["I don't know", "cannot access"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_t03", category: "tool_use", difficulty: "hard",
    prompt: "Read the CHANGELOG_AI.md file and tell me how many self-improvement entries it contains. If the file doesn't exist yet, say so.",
    expectedKeywords: ["CHANGELOG", "entries", "self-improvement"],
    forbiddenKeywords: ["cannot", "error accessing"],
    maxTokens: 300, timeoutMs: 30000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },

  // ── Self-Knowledge (3) ────────────────────────────────────────────────────
  {
    id: "seed_s01", category: "self_knowledge", difficulty: "easy",
    prompt: "What is the name of the file that stores your self-improvement proposals?",
    expectedKeywords: ["proposals", ".json", "andromeda"],
    forbiddenKeywords: ["I don't know", "no file"],
    maxTokens: 150, timeoutMs: 10000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_s02", category: "self_knowledge", difficulty: "medium",
    prompt: "Describe the twoPhaseCommit system. What problem does it solve and what are its two phases?",
    expectedKeywords: ["backup", "write", "verify", "rollback", "integrity"],
    forbiddenKeywords: ["I don't know", "no such system"],
    maxTokens: 400, timeoutMs: 20000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_s03", category: "self_knowledge", difficulty: "hard",
    prompt: "What is the re-entry guard in your self-improvement system? What bug did it fix and how does it work?",
    expectedKeywords: ["_applyingProposals", "circular", "recursion", "Set", "re-entry"],
    forbiddenKeywords: ["I don't know", "no such guard"],
    maxTokens: 500, timeoutMs: 25000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },

  // ── Multi-Step (3) ────────────────────────────────────────────────────────
  {
    id: "seed_m01", category: "multi_step", difficulty: "easy",
    prompt: "What is the current git branch name and the version in package.json? Report both.",
    expectedKeywords: ["main", "9.", "branch", "version"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 20000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_m02", category: "multi_step", difficulty: "medium",
    prompt: "How many TypeScript files are in the server directory, and which one is the largest by line count?",
    expectedKeywords: [".ts", "files", "largest", "lines"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 300, timeoutMs: 30000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_m03", category: "multi_step", difficulty: "hard",
    prompt: "List all new TypeScript files added in v9.5.0 (hint: check git log for the v9.5.0 commit and look at the changed files).",
    expectedKeywords: ["proposalFeedback", "evalDrivenTargeting", "multiFileProposalPlanner", "aiChangelog", "knowledgeBaseConsolidation", "capabilityBootstrapper"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 600, timeoutMs: 60000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },

  // ── Browser (3) ───────────────────────────────────────────────────────────
  {
    id: "seed_b01", category: "browser", difficulty: "easy",
    prompt: "Fetch the content of https://httpbin.org/get and return the value of the 'url' field from the JSON response.",
    expectedKeywords: ["httpbin.org", "url", "get"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 30000, scoreWeight: 1,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_b02", category: "browser", difficulty: "medium",
    prompt: "Fetch https://httpbin.org/uuid and return the UUID value from the JSON response.",
    expectedKeywords: ["uuid", "-"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 200, timeoutMs: 30000, scoreWeight: 2,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
  {
    id: "seed_b03", category: "browser", difficulty: "hard",
    prompt: "POST to https://httpbin.org/post with JSON body {\"test\": \"andromeda_eval\"} and return the 'json' field from the response.",
    expectedKeywords: ["andromeda_eval", "json", "test"],
    forbiddenKeywords: ["cannot", "error"],
    maxTokens: 300, timeoutMs: 30000, scoreWeight: 3,
    source: "gap_analysis", generatedAt: Date.now(), lifecycle: "active",
    runCount: 0, passCount: 0, avgScore: 0, promoted: false,
    generationContext: "seed_v9.6.0",
  },
];

/**
 * Seed the adaptive benchmark store if it is empty.
 * Safe to call multiple times — only seeds once.
 */
export function seedAdaptiveBenchmarks(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    // Check if already seeded
    if (fs.existsSync(BENCHMARKS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, "utf-8")) as AdaptiveBenchmark[];
      if (existing.length > 0) {
        console.log(`[EvalSeed] Already seeded — ${existing.length} benchmarks present, skipping.`);
        return;
      }
    }

    // Write seed benchmarks
    fs.writeFileSync(BENCHMARKS_FILE, JSON.stringify(SEED_BENCHMARKS, null, 2), "utf-8");
    console.log(`[EvalSeed] Seeded ${SEED_BENCHMARKS.length} adaptive benchmarks across 6 categories.`);
  } catch (err) {
    console.warn(`[EvalSeed] Failed to seed benchmarks: ${(err as Error).message}`);
  }
}

export { SEED_BENCHMARKS };
