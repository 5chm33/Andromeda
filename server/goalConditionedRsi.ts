/**
 * goalConditionedRsi.ts — v19.0.0
 *
 * GOALS.md parser and file selection bias.
 *
 * This module allows RSI to be guided by a high-level GOALS.md file.
 * It parses the goals, uses an LLM to identify which files in the codebase
 * are most relevant to those goals, and returns a weighted list of files
 * to bias the random file selection in the RSI engine.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import { getActiveModel, getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";
import { safeJsonParse } from "./_core/safeJsonParse.js";

const log = createLogger("goalConditionedRsi");

export interface RsiGoal {
  id: string;
  description: string;
  priority: "high" | "medium" | "low";
}

export interface GoalConditionedContext {
  activeGoals: RsiGoal[];
  relevantFiles: Array<{ path: string; relevanceScore: number; reason: string }>;
}

/**
 * Parses the GOALS.md file in the project root.
 *
 * @param projectDir The root directory of the project.
 * @returns Array of parsed goals.
 */
export function parseGoalsFile(projectDir: string): RsiGoal[] {
  const goalsPath = path.join(projectDir, "GOALS.md");
  if (!fs.existsSync(goalsPath)) {
    log.info("No GOALS.md found. Goal-conditioned RSI is inactive.");
    return [];
  }

  try {
    const content = fs.readFileSync(goalsPath, "utf-8");
    const goals: RsiGoal[] = [];
    
    // Simple markdown parsing: look for lists or headings
    const lines = content.split("\n");
    let currentPriority: "high" | "medium" | "low" = "medium";
    let goalCounter = 1;

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("high priority") || lowerLine.includes("p1")) currentPriority = "high";
      else if (lowerLine.includes("medium priority") || lowerLine.includes("p2")) currentPriority = "medium";
      else if (lowerLine.includes("low priority") || lowerLine.includes("p3")) currentPriority = "low";

      const listMatch = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
      if (listMatch) {
        goals.push({
          id: `goal-${goalCounter++}`,
          description: listMatch[1].trim(),
          priority: currentPriority,
        });
      }
    }

    log.info(`Parsed ${goals.length} goals from GOALS.md`);
    return goals;
  } catch (error) {
    log.error(`Failed to parse GOALS.md: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Uses an LLM to map active goals to relevant files in the codebase.
 *
 * @param goals The active goals.
 * @param allFiles List of all file paths in the codebase.
 * @returns Promise resolving to a list of relevant files with scores.
 */
export async function identifyRelevantFiles(
  goals: RsiGoal[],
  allFiles: string[]
): Promise<GoalConditionedContext["relevantFiles"]> {
  if (goals.length === 0 || allFiles.length === 0) return [];

  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn("No API key configured, skipping relevant file identification.");
    return [];
  }

  const prompt = `You are an expert software architect.
Given a list of project goals and a list of files in the codebase, identify which files are most relevant to achieving the goals.

Active Goals:
${goals.map(g => `- [${g.priority.toUpperCase()}] ${g.description}`).join("\n")}

Codebase Files:
${allFiles.join("\n")}

Return a JSON object with the following structure:
{
  "relevantFiles": [
    {
      "path": "path/to/file.ts",
      "relevanceScore": number (0.0 to 1.0, where 1.0 is highly relevant),
      "reason": "brief explanation of why this file is relevant to which goal"
    }
  ]
}

Only include files with a relevance score > 0.5. Limit to the top 20 most relevant files.`;

  try {
    const response = await fetch(getApiUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...getProviderHeaders(),
      },
      body: JSON.stringify({
        model: getActiveModel(),
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000), // 60s timeout
    });

    if (!response.ok) {
      log.warn(`Relevant files API failed with status ${response.status}`);
      return [];
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = safeJsonParse<{ relevantFiles: GoalConditionedContext["relevantFiles"] }>(content);
    if (!parsed || !Array.isArray(parsed.relevantFiles)) {
      log.warn("Relevant files API returned invalid JSON.");
      return [];
    }

    // Ensure paths actually exist in the provided list
    const validFiles = parsed.relevantFiles.filter(f => allFiles.includes(f.path));
    log.info(`Identified ${validFiles.length} relevant files for active goals.`);
    return validFiles;

  } catch (error) {
    log.error(`Error identifying relevant files: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Biases file selection by injecting goal-relevant files.
 *
 * @param allFiles List of all files.
 * @param relevantFiles List of relevant files with scores.
 * @param count Number of files to select.
 * @returns Array of selected file paths.
 */
export function selectGoalBiasedFiles(
  allFiles: string[],
  relevantFiles: GoalConditionedContext["relevantFiles"],
  count: number
): string[] {
  if (relevantFiles.length === 0) {
    // Fallback to random selection if no goals/relevant files
    const shuffled = [...allFiles].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  const selected = new Set<string>();

  // 1. Always include the top highest-scored relevant files (up to half the requested count)
  const sortedRelevant = [...relevantFiles].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const guaranteedCount = Math.min(Math.floor(count / 2), sortedRelevant.length);
  
  for (let i = 0; i < guaranteedCount; i++) {
    selected.add(sortedRelevant[i].path);
  }

  // 2. Fill the rest with a mix of other relevant files (weighted random) and completely random files
  const remainingFiles = allFiles.filter(f => !selected.has(f));
  const remainingRelevant = sortedRelevant.slice(guaranteedCount).filter(f => !selected.has(f.path));

  while (selected.size < count && remainingFiles.length > 0) {
    // 70% chance to pick from remaining relevant files (if any), 30% chance to pick purely random
    if (remainingRelevant.length > 0 && Math.random() < 0.7) {
      // Weighted random selection based on score
      const totalScore = remainingRelevant.reduce((sum, f) => sum + f.relevanceScore, 0);
      let randomVal = Math.random() * totalScore;
      let pickedIdx = 0;
      for (let i = 0; i < remainingRelevant.length; i++) {
        randomVal -= remainingRelevant[i].relevanceScore;
        if (randomVal <= 0) {
          pickedIdx = i;
          break;
        }
      }
      
      const picked = remainingRelevant[pickedIdx];
      selected.add(picked.path);
      remainingRelevant.splice(pickedIdx, 1);
      
      // Remove from remainingFiles so we don't pick it again
      const idx = remainingFiles.indexOf(picked.path);
      if (idx !== -1) remainingFiles.splice(idx, 1);
    } else {
      // Purely random selection
      const randomIdx = Math.floor(Math.random() * remainingFiles.length);
      selected.add(remainingFiles[randomIdx]);
      remainingFiles.splice(randomIdx, 1);
    }
  }

  return Array.from(selected);
}
