/**
 * episodicConsolidation.ts — v6.32
 *
 * Cross-session episodic memory consolidation:
 *   - Scans workspace/memory/episodes.jsonl for entries older than N days (default 7)
 *   - Groups them by goal/tag cluster
 *   - Asks the LLM to summarise each cluster into a "consolidated lesson"
 *   - Appends lessons to workspace/memory/consolidated_lessons.json
 *   - Rewrites episodes.jsonl without the consolidated entries (keeps file small)
 *
 * Triggered:
 *   - On server startup (if last consolidation > 24h ago)
 *   - Via POST /api/memory/episodic/consolidate
 *   - Optionally after each RSI cycle via rsiScheduler
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { resolve } from "path";
import { backgroundSimpleCompletion } from "./llmProvider.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Episode {
  id: string;
  timestamp: number;
  goal: string;
  outcome: string;
  summary: string;
  failedStep?: string;
  errorContext?: string;
  tags: string[];
  parentEpisodeId?: string;
  duration?: number;
}

export interface ConsolidatedLesson {
  id: string;
  createdAt: number;
  clusterKey: string;
  episodeIds: string[];
  episodeCount: number;
  dateRange: { from: number; to: number };
  lesson: string;
  successRate: number;
  commonTags: string[];
}

interface ConsolidationState {
  lastRunAt: number;
  totalEpisodesConsolidated: number;
  totalLessonsCreated: number;
}

export interface EpisodicConsolidationResult {
  consolidated: number;
  lessonsCreated: number;
  episodesRemaining: number;
  skipped: boolean;
  reason?: string;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const WORKSPACE_DIR  = resolve(process.cwd(), "workspace", "memory");
const EPISODES_FILE  = resolve(WORKSPACE_DIR, "episodes.jsonl");
const LESSONS_FILE   = resolve(WORKSPACE_DIR, "consolidated_lessons.json");
const EC_STATE_FILE  = resolve(WORKSPACE_DIR, "episodic_consolidation_state.json");

function ensureDir(): void {
  if (!existsSync(WORKSPACE_DIR)) mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadJSON<T>(filePath: string, fallback: T): T {
  ensureDir();
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJSON(filePath: string, data: unknown): void {
  ensureDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadEpisodes(): Episode[] {
  ensureDir();
  if (!existsSync(EPISODES_FILE)) return [];
  try {
    const raw = readFileSync(EPISODES_FILE, "utf8");
    if (!raw.trim()) return [];
    return raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as Episode);
  } catch {
    return [];
  }
}

function saveEpisodes(episodes: Episode[]): void {
  ensureDir();
  writeFileSync(
    EPISODES_FILE,
    episodes.map(e => JSON.stringify(e)).join("\n") + (episodes.length ? "\n" : ""),
    "utf8"
  );
}

function loadLessons(): ConsolidatedLesson[] {
  return loadJSON<ConsolidatedLesson[]>(LESSONS_FILE, []);
}

function saveLessons(lessons: ConsolidatedLesson[]): void {
  saveJSON(LESSONS_FILE, lessons);
}

function loadState(): ConsolidationState {
  return loadJSON<ConsolidationState>(EC_STATE_FILE, { lastRunAt: 0, totalEpisodesConsolidated: 0, totalLessonsCreated: 0 });
}

function saveState(s: ConsolidationState): void {
  saveJSON(EC_STATE_FILE, s);
}

// ─── Clustering ───────────────────────────────────────────────────────────────

function generateClusterKey(episode: Episode): string {
  if (episode.tags && episode.tags.length > 0) {
    return episode.tags[0];
  }
  // Fallback to a sanitized version of the first few words of the goal
  return episode.goal.split(" ").slice(0, 3).join("_").toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function clusterEpisodes(episodes: Episode[]): Map<string, Episode[]> {
  const clusters = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const key = generateClusterKey(ep);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(ep);
  }
  return clusters;
}

// ─── LLM summarisation ────────────────────────────────────────────────────────

async function summariseCluster(
  clusterKey: string,
  episodes: Episode[]
): Promise<string> {
  const successes = episodes.filter(e => e.outcome === "success").length;
  const failures  = episodes.filter(e => e.outcome !== "success").length;

  const lines = episodes
    .slice(0, 20)
    .map((e, i) =>
      `[${i + 1}] ${new Date(e.timestamp).toLocaleDateString()} — ${e.outcome.toUpperCase()}: ${e.summary}` +
      (e.failedStep ? ` (failed at: ${e.failedStep})` : "")
    )
    .join("\n");

  const prompt =
    `You are summarising past AI agent episodes for long-term memory storage.\n\n` +
    `Cluster topic: "${clusterKey}"\n` +
    `Episodes (${episodes.length} total, ${successes} successes, ${failures} failures):\n\n` +
    `${lines}\n\n` +
    `Write a concise consolidated lesson (3-5 sentences) capturing:\n` +
    `1. What approaches worked and why\n` +
    `2. What approaches failed and the root cause\n` +
    `3. The key insight an agent should remember for future tasks in this domain\n\n` +
    `Be specific and actionable.`;

  try {
    const lesson = await backgroundSimpleCompletion([
      { role: "system", content: "You are an episodic memory consolidation system. Extract key lessons from agent experiences. Be concise and actionable." },
      { role: "user", content: prompt }
    ]);
    return lesson?.trim() ??
      `Cluster "${clusterKey}": ${episodes.length} episodes (${successes} successes, ${failures} failures).`;
  } catch (error) {
    console.error(`Error summarising cluster ${clusterKey}:`, error);
    return `Cluster "${clusterKey}": ${episodes.length} episodes (${successes} successes, ${failures} failures).`;
  }
}

// ─── Main consolidation ───────────────────────────────────────────────────────

export async function consolidateEpisodicMemory(options: {
  olderThanDays?: number;
  forceRun?: boolean;
  minClusterSize?: number;
} = {}): Promise<EpisodicConsolidationResult> {
  const DEFAULT_OLDER_THAN_DAYS = 7;
const DEFAULT_MIN_CLUSTER_SIZE = 3;
const MIN_HOURS_BETWEEN_RUNS = 24;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

  const {
    olderThanDays  = DEFAULT_OLDER_THAN_DAYS,
    forceRun       = false,
    minClusterSize = DEFAULT_MIN_CLUSTER_SIZE,
  } = options;

  ensureDir();

  const state = loadState();
  const hoursSinceLast = (Date.now() - state.lastRunAt) / MS_PER_HOUR;
  if (!forceRun && hoursSinceLast < MIN_HOURS_BETWEEN_RUNS) {
    return {
      consolidated: 0,
      lessonsCreated: 0,
      episodesRemaining: loadEpisodes().length,
      skipped: true,
      reason: `Last run ${hoursSinceLast.toFixed(1)}h ago (min ${MIN_HOURS_BETWEEN_RUNS}h between runs)`,
    };
  }

  const allEpisodes = loadEpisodes();
  const cutoff = Date.now() - olderThanDays * MS_PER_DAY;

  const oldEpisodes  = allEpisodes.filter(e => e.timestamp < cutoff);
  const keepEpisodes = allEpisodes.filter(e => e.timestamp >= cutoff);

  if (oldEpisodes.length === 0) {
    return {
      consolidated: 0,
      lessonsCreated: 0,
      episodesRemaining: allEpisodes.length,
      skipped: false,
      reason: `No episodes older than ${olderThanDays} days`,
    };
  }

async function processClusters(
  clusters: Map<string, Episode[]>,
  minClusterSize: number,
  keepEpisodes: Episode[]
): Promise<{ newLessons: ConsolidatedLesson[]; consolidatedIds: Set<string> }> {
  const newLessons: ConsolidatedLesson[] = [];
  const consolidatedIds = new Set<string>();

  for (const [clusterKey, clusterEps] of clusters) {
    if (clusterEps.length < minClusterSize) {
      keepEpisodes.push(...clusterEps);
      continue;
    }

    console.log(`[EpisodicConsolidate] Summarising "${clusterKey}" (${clusterEps.length} episodes)…`);
    let lesson: string;
    try {
      lesson = await summariseCluster(clusterKey, clusterEps);
    } catch (error) {
      console.error(`[EpisodicConsolidate] Failed to summarise cluster "${clusterKey}":`, error);
      keepEpisodes.push(...clusterEps);
      continue;
    }

    const successCount = clusterEps.filter(e => e.outcome === "success").length;
    const tagFreq = new Map<string, number>();
    clusterEps.flatMap(e => e.tags ?? []).forEach(t => tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1));
    const commonTags = [...tagFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);

    newLessons.push({
      id:           `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt:    Date.now(),
      clusterKey,
      episodeIds:   clusterEps.map(e => e.id),
      episodeCount: clusterEps.length,
      dateRange: {
        from: Math.min(...clusterEps.map(e => e.timestamp)),
        to:   Math.max(...clusterEps.map(e => e.timestamp)),
      },
      lesson,
      successRate:  successCount / clusterEps.length,
      commonTags,
    });

    clusterEps.forEach(e => consolidatedIds.add(e.id));
  }

  return { newLessons, consolidatedIds };
}

// ... (rest of the consolidateEpisodes function)
const clusters = clusterEpisodes(oldEpisodes);
const existingLessons = loadLessons();
const { newLessons, consolidatedIds } = await processClusters(
  clusters,
  minClusterSize,
  keepEpisodes
);

  saveLessons([...existingLessons, ...newLessons]);
  saveEpisodes(keepEpisodes);
  saveState({
    lastRunAt:                    Date.now(),
    totalEpisodesConsolidated:    state.totalEpisodesConsolidated + consolidatedIds.size,
    totalLessonsCreated:          state.totalLessonsCreated + newLessons.length,
  });

  console.log(
    `[EpisodicConsolidate] Done — ${consolidatedIds.size} episodes → ${newLessons.length} lessons. ` +
    `${keepEpisodes.length} episodes remain.`
  );

  return {
    consolidated:      consolidatedIds.size,
    lessonsCreated:    newLessons.length,
    episodesRemaining: keepEpisodes.length,
    skipped:           false,
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getConsolidatedLessons(options: {
  tag?: string;
  limit?: number;
} = {}): ConsolidatedLesson[] {
  let lessons = loadLessons();
  if (options.tag) lessons = lessons.filter(l => l.commonTags.includes(options.tag!));
  lessons = lessons.sort((a, b) => b.createdAt - a.createdAt);
  if (options.limit) lessons = lessons.slice(0, options.limit);
  return lessons;
}

export function getEpisodicConsolidationStats(): ConsolidationState & {
  lessonCount: number;
  episodeCount: number;
} {
  const state = loadState();
  return {
    ...state,
    lessonCount:  loadLessons().length,
    episodeCount: loadEpisodes().length,
  };
}

// ─── Startup hook ─────────────────────────────────────────────────────────────

export async function initEpisodicConsolidation(): Promise<void> {
  try {
    const result = await consolidateEpisodicMemory();
    if (!result.skipped) {
      console.log(
        `[EpisodicConsolidate] Startup: ${result.consolidated} episodes → ${result.lessonsCreated} lessons`
      );
    }
  } catch (err) {
    console.warn("[EpisodicConsolidate] Startup failed (non-fatal):", err);
  }
}
