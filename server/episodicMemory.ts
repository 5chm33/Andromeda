/**
 * episodicMemory.ts — Episodic Memory with Causal Chains
 * Andromeda v6.19
 *
 * Stores "I tried X, it failed because Y, then I tried Z which worked" chains.
 * This is the key gap identified in the assessment — storing facts but not causal sequences.
 *
 * Architecture:
 *  - Episodes stored in workspace/memory/episodes.jsonl (append-only)
 *  - Semantic search via simple keyword overlap (upgrades to vector when embeddings available)
 *  - Causal chain reconstruction: given a goal, find the full chain of attempts
 *  - Integrated with taskPlanner.ts for automatic recording
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { resolve } from "path";
import { backgroundSimpleCompletion } from "./llmProvider.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Episode {
  id: string;
  timestamp: number;
  goal: string;
  outcome: "success" | "partial_failure" | "failure" | "abandoned";
  summary: string;
  failedStep?: string;
  errorContext?: string;
  tags: string[];
  parentEpisodeId?: string;  // for causal chains: this episode was triggered by a failure in parent
  duration?: number;         // milliseconds
}

export interface CausalChain {
  goal: string;
  episodes: Episode[];
  finalOutcome: "success" | "failure" | "in_progress";
  lessonsLearned: string[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const WORKSPACE_DIR = resolve(process.cwd(), "workspace", "memory");
const EPISODES_FILE = resolve(WORKSPACE_DIR, "episodes.jsonl");

function ensureDir(): void {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
}

function loadAllEpisodes(): Episode[] {
  ensureDir();
  if (!existsSync(EPISODES_FILE)) return [];
  try {
    return readFileSync(EPISODES_FILE, "utf8")
      .split("\n")
      .filter(l => l.trim())
      .map(l => JSON.parse(l) as Episode);
  } catch (error) {
    console.error(`Error loading episodes from ${EPISODES_FILE}:`, error);
    return [];
  }
}

function saveEpisode(episode: Episode): void {
  ensureDir();
  appendFileSync(EPISODES_FILE, JSON.stringify(episode) + "\n", "utf8");
}

// ─── Record an Episode ────────────────────────────────────────────────────────

export async function recordEpisode(data: {
  goal: string;
  outcome: Episode["outcome"];
  summary: string;
  failedStep?: string;
  errorContext?: string;
  parentEpisodeId?: string;
  duration?: number;
}): Promise<Episode> {
  const episode: Episode = {
    id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    goal: data.goal,
    outcome: data.outcome,
    summary: data.summary,
    failedStep: data.failedStep,
    errorContext: data.errorContext,
    parentEpisodeId: data.parentEpisodeId,
    duration: data.duration,
    tags: extractTags(data.goal + " " + data.summary),
  };

  saveEpisode(episode);
  return episode;
}

// ─── Retrieve Relevant Episodes ───────────────────────────────────────────────

/**
 * Find episodes relevant to a given goal using keyword overlap scoring.
 * Returns the top-k most relevant episodes.
 */
export async function getEpisodicMemory(goal: string, topK: number = 5): Promise<Episode[]> {
  const episodes = loadAllEpisodes();
  if (episodes.length === 0) return [];

  const goalTokens = tokenize(goal);

  const goalTokensArr = [...goalTokens];  // v6.22: Set has no .filter() — convert to array first
  const scored = episodes.map(ep => {
    const epTokens = tokenize(ep.goal + " " + ep.summary + " " + (ep.failedStep ?? ""));
    const overlap = goalTokensArr.filter(t => epTokens.has(t)).length;
    const score = overlap / Math.max(goalTokensArr.length, 1);
    return { ep, score };
  });

  return scored
    .filter(s => s.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.ep);
}

// ─── Causal Chain Reconstruction ─────────────────────────────────────────────

/**
 * Reconstruct the full causal chain for a goal:
 * "Tried X → failed because Y → tried Z → succeeded"
 */
export function getCausalChain(goal: string): CausalChain {
  const episodes = loadAllEpisodes();
  const goalTokens = tokenize(goal);

  // Find all episodes related to this goal
  const goalTokensArr = [...goalTokens];
  const related = episodes.filter(ep => {
    const epTokens = tokenize(ep.goal);
    const overlap = goalTokensArr.filter(t => epTokens.has(t)).length;
    return overlap / Math.max(goalTokensArr.length, 1) > 0.3;
  }).sort((a, b) => a.timestamp - b.timestamp);

  const finalOutcome = related.length === 0 ? "in_progress" :
    related[related.length - 1].outcome === "success" ? "success" : "failure";

  // Extract lessons learned from failures
  const failures = related.filter(ep => ep.outcome === "failure" || ep.outcome === "partial_failure");
  const lessonsLearned = failures.map(ep =>
    `Avoid: "${ep.failedStep ?? ep.summary.slice(0, 80)}"${ep.errorContext ? ` (reason: ${ep.errorContext.slice(0, 100)})` : ""}`
  );

  return { goal, episodes: related, finalOutcome, lessonsLearned };
}

/**
 * Get a natural language summary of what the agent has learned about a topic.
 * Uses LLM to synthesize the causal chain into actionable insights.
 */
export async function synthesizeLessons(goal: string): Promise<string> {
  const chain = getCausalChain(goal);
  if (chain.episodes.length === 0) {
    return "No prior experience with this type of task.";
  }

  const chainText = chain.episodes.map((ep, i) =>
    `Attempt ${i + 1}: ${ep.outcome.toUpperCase()} — ${ep.summary}${ep.failedStep ? ` (failed at: ${ep.failedStep})` : ""}`
  ).join("\n");

  const prompt = `Based on these past attempts at "${goal}", summarize in 2-3 sentences what was learned and what to avoid:\n\n${chainText}`;

  try {
    return await backgroundSimpleCompletion([
      { role: "system", content: "You are a learning system. Synthesize past experience into actionable lessons. Be concise." },
      { role: "user", content: prompt }
    ]);
  } catch {
    return chain.lessonsLearned.join("; ") || "No clear lessons yet.";
  }
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export function getEpisodicStats(): {
  total: number;
  successes: number;
  failures: number;
  successRate: number;
  mostCommonFailures: string[];
} {
  const episodes = loadAllEpisodes();
  const successes = episodes.filter(e => e.outcome === "success").length;
  const failures = episodes.filter(e => e.outcome === "failure" || e.outcome === "partial_failure").length;

  // Find most common failure patterns
  const failureTags: Record<string, number> = {};
  episodes
    .filter(e => e.outcome !== "success")
    .forEach(e => e.tags.forEach(t => { failureTags[t] = (failureTags[t] ?? 0) + 1; }));

  const mostCommonFailures = Object.entries(failureTags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag, count]) => `${tag} (${count}x)`);

  return {
    total: episodes.length,
    successes,
    failures,
    successRate: episodes.length > 0 ? successes / episodes.length : 0,
    mostCommonFailures,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalizedText.split(/\s+/).filter(t => t.length > 3);
  return new Set(tokens);
}

function extractTags(text: string): string[] {
  const keywords = [
    "file", "code", "browser", "search", "memory", "api", "error", "timeout",
    "auth", "database", "network", "parse", "json", "typescript", "python",
    "git", "docker", "test", "build", "deploy", "install", "config",
  ];
  const lower = text.toLowerCase();
  return keywords.filter(k => lower.includes(k));
}

// ─── v11.0.0 Trajectory Extensions ──────────────────────────────────────────

export interface EpisodeStep {
  action: string;
  observation: string;
  reward: number;
  timestamp: number;
}

export interface TrajectoryEpisode extends Omit<Episode, 'outcome'> {
  steps: EpisodeStep[];
  totalReward: number;
  durationMs: number;
  /** Allow 'partial' as a v11 shorthand; stored as 'partial_failure' */
  outcome: Episode["outcome"] | "partial";
}

/**
 * storeEpisode — v11 alias that accepts a full trajectory and persists it.
 */
export async function storeEpisode(
  data: Omit<TrajectoryEpisode, 'id' | 'timestamp'>
): Promise<TrajectoryEpisode> {
  const normalizedOutcome: Episode["outcome"] =
    data.outcome === 'partial' ? 'partial_failure' : (data.outcome as Episode["outcome"]);
  const base = await recordEpisode({
    goal: data.goal,
    outcome: normalizedOutcome,
    summary: data.steps.map(s => s.action).join(' → '),
    duration: data.durationMs,
  });
  return { ...base, steps: data.steps, totalReward: data.totalReward, durationMs: data.durationMs };
}

/**
 * retrieveSimilar — semantic retrieval of K most similar past episodes.
 */
export async function retrieveSimilar(query: string, k = 5): Promise<Episode[]> {
  return getEpisodicMemory(query, k);
}

/**
 * clearEpisodicMemory — wipe all stored episodes (use with caution).
 */
export function clearEpisodicMemory(): void {
  const file = resolve(process.cwd(), 'workspace', 'memory', 'episodes.jsonl');
  if (existsSync(file)) unlinkSync(file);
}
