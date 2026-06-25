/**
 * promptEngineer.ts — Self-Modifying Prompt Engineering
 * Andromeda v5.68
 *
 * Analyzes prompt effectiveness by correlating phrasing with response quality,
 * A/B tests prompt variations, auto-tunes prompts by task type, and stores
 * successful prompt patterns in memory.
 */

import * as fs from "fs";
import * as path from "path";
import { chatCompletion } from "./llmProvider.js";
import { storeMemory, searchMemory } from "./memory.js";

const PROMPT_STORE_PATH = path.join(process.cwd(), "data", "prompt_patterns.json");
const PROMPT_METRICS_PATH = path.join(process.cwd(), "data", "prompt_metrics.jsonl");

export type TaskType = "research" | "coding" | "creative" | "analysis" | "self_improvement" | "conversation" | "tool_use";

export interface PromptPattern {
  id: string;
  taskType: TaskType;
  pattern: string; // The prompt template or instruction fragment
  successRate: number; // 0-1
  useCount: number;
  avgResponseQuality: number; // 0-10
  lastUsed: string;
  tags: string[];
}

export interface PromptMetric {
  timestamp: string;
  taskType: TaskType;
  promptHash: string;
  responseQuality: number; // 0-10, estimated from outcome
  outcome: "success" | "failure" | "partial";
  notes: string;
}

let promptPatterns: Map<string, PromptPattern> = new Map();
let initialized = false;

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

function loadPatterns(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(PROMPT_STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(PROMPT_STORE_PATH, "utf-8"));
      promptPatterns = new Map(Object.entries(data));
    }
  } catch {
    promptPatterns = new Map();
  }
  initialized = true;
}

function savePatterns(): void {
  ensureDataDir();
  try {
    const obj: Record<string, PromptPattern> = {};
    for (const [k, v] of promptPatterns.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(PROMPT_STORE_PATH, JSON.stringify(obj, null, 2), "utf-8");
  } catch {
    // Non-fatal
  }
}

/**
 * Record the outcome of a prompt usage for learning.
 */
export function recordPromptOutcome(
  taskType: TaskType,
  promptFragment: string,
  quality: number,
  outcome: "success" | "failure" | "partial",
  notes = ""
): void {
  if (!initialized) loadPatterns();

  const hash = hashString(promptFragment);
  const metric: PromptMetric = {
    timestamp: new Date().toISOString(),
    taskType,
    promptHash: hash,
    responseQuality: quality,
    outcome,
    notes,
  };

  // Append to metrics log
  ensureDataDir();
  try {
    fs.appendFileSync(PROMPT_METRICS_PATH, JSON.stringify(metric) + "\n", "utf-8");
  } catch {
    // Non-fatal
  }

  // Update pattern store
  const existing = promptPatterns.get(hash);
  if (existing) {
    existing.useCount++;
    existing.avgResponseQuality = (existing.avgResponseQuality * (existing.useCount - 1) + quality) / existing.useCount;
    existing.successRate = outcome === "success"
      ? (existing.successRate * (existing.useCount - 1) + 1) / existing.useCount
      : (existing.successRate * (existing.useCount - 1)) / existing.useCount;
    existing.lastUsed = new Date().toISOString();
  } else {
    const newPattern: PromptPattern = {
      id: hash,
      taskType,
      pattern: promptFragment.substring(0, 500), // Store first 500 chars
      successRate: outcome === "success" ? 1 : 0,
      useCount: 1,
      avgResponseQuality: quality,
      lastUsed: new Date().toISOString(),
      tags: [taskType],
    };
    promptPatterns.set(hash, newPattern);
  }

  savePatterns();
}

/**
 * Get the best-performing prompt patterns for a given task type.
 */
export function getBestPatterns(taskType: TaskType, limit = 3): PromptPattern[] {
  if (!initialized) loadPatterns();

  const relevant = Array.from(promptPatterns.values())
    .filter((p) => p.taskType === taskType && p.useCount >= 2);

  return relevant
    .sort((a, b) => (b.successRate * b.avgResponseQuality) - (a.successRate * a.avgResponseQuality))
    .slice(0, limit);
}

/**
 * Generate an optimized system prompt addendum for a given task type.
 * Uses past successful patterns to augment the base prompt.
 */
export async function getOptimizedPromptAddendum(taskType: TaskType): Promise<string> {
  if (!initialized) loadPatterns();

  const bestPatterns = getBestPatterns(taskType, 3);
  if (bestPatterns.length === 0) return "";

  // Search memory for task-type-specific learnings
  let memoryContext = "";
  try {
    const results = await searchMemory(`${taskType} prompt improvement success`, 3);
    memoryContext = (results || []).map((r) => r.entry.content).join("\n");
  } catch {
    // Non-fatal
  }

  if (bestPatterns.length === 0 && !memoryContext) return "";

  const patternSummary = bestPatterns
    .map((p) => `- Success rate ${(p.successRate * 100).toFixed(0)}%, quality ${p.avgResponseQuality.toFixed(1)}/10: "${p.pattern.substring(0, 100)}..."`)
    .join("\n");

  return `\n[Prompt Engineering — ${taskType} task]\nBest-performing approaches:\n${patternSummary}${memoryContext ? `\nLearned context:\n${memoryContext}` : ""}`;
}

/**
 * Analyze prompt effectiveness and generate improvement proposals.
 * Called by the Self-Reflection Engine periodically.
 */
export async function analyzeAndImprovePrompts(): Promise<string[]> {
  if (!initialized) loadPatterns();
  ensureDataDir();

  // Find patterns with poor performance
  const poorPatterns = Array.from(promptPatterns.values())
    .filter((p) => p.useCount >= 3 && p.successRate < 0.5);

  if (poorPatterns.length === 0) return [];

  const analysis = poorPatterns
    .map((p) => `Task: ${p.taskType}, Success: ${(p.successRate * 100).toFixed(0)}%, Pattern: "${p.pattern.substring(0, 150)}"`)
    .join("\n");

  try {
    const response = await chatCompletion([
      {
        role: "user",
        content: `You are Andromeda analyzing your own prompt patterns. These patterns have poor success rates:\n\n${analysis}\n\nFor each, suggest a specific improvement to the prompt phrasing or approach. Return as a JSON array of strings: ["improvement 1", "improvement 2", ...]`,
      },
    ], { maxTokens: 500, temperature: 0.3 });

    const content = response.content || "[]";
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const improvements: string[] = JSON.parse(jsonMatch[0]);

    // Store improvements in memory
    if (improvements.length > 0) {
      storeMemory(
        `Prompt engineering improvements (${new Date().toISOString()}): ${improvements.join("; ")}`,
        "fact",
        ["prompt-engineering", "improvement", "behavioral"]
      );
    }

    return improvements;
  } catch {
    return [];
  }
}

/**
 * Get prompt engineering stats for the diagnostic endpoint.
 */
export function getPromptStats(): { totalPatterns: number; avgSuccessRate: number; topTaskType: string } {
  if (!initialized) loadPatterns();

  const patterns = Array.from(promptPatterns.values());
  if (patterns.length === 0) return { totalPatterns: 0, avgSuccessRate: 0, topTaskType: "none" };

  const avgSuccessRate = patterns.reduce((sum, p) => sum + p.successRate, 0) / patterns.length;

  const taskTypeCounts: Record<string, number> = {};
  for (const p of patterns) {
    taskTypeCounts[p.taskType] = (taskTypeCounts[p.taskType] || 0) + p.useCount;
  }
  const topTaskType = Object.entries(taskTypeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "none";

  return { totalPatterns: patterns.length, avgSuccessRate, topTaskType };
}
