/**
 * selfCritiqueAgent.ts — v19.0.0
 *
 * Adversarial post-generation critique with retry loop.
 *
 * This module introduces a self-critique loop that acts as a gatekeeper
 * BEFORE a proposal is submitted for compilation/testing. It evaluates the
 * proposed code changes against the original intent, common pitfalls, and
 * architectural constraints. If the critique identifies flaws, it automatically
 * retries the generation step up to N times.
 */

import { createLogger } from "./logger.js";
import { getActiveModel, getApiKey, getApiUrl, getProviderHeaders } from "./aiTokens.js";
import { safeJsonParse } from "./_core/safeJsonParse.js";

const log = createLogger("selfCritique");

export interface CritiqueResult {
  passed: boolean;
  score: number; // 0.0 to 1.0
  feedback: string[];
  suggestedFixes: string[];
}

/**
 * Critiques a proposed code snippet against the original intent and file context.
 *
 * @param originalSnippet The original code before modification.
 * @param proposedSnippet The proposed new code.
 * @param intent The original intent or goal for the modification.
 * @param fileContext Additional context about the file being modified.
 * @returns A promise resolving to a CritiqueResult.
 */
export async function critiqueProposal(
  originalSnippet: string,
  proposedSnippet: string,
  intent: string,
  fileContext: string
): Promise<CritiqueResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn("No API key configured, skipping critique.");
    return { passed: true, score: 1.0, feedback: [], suggestedFixes: [] };
  }

  const prompt = `You are a strict, senior staff engineer reviewing a proposed code change.
Your goal is to find any logical flaws, edge-case failures, syntax errors, or deviations from the original intent.

Original Code:
\`\`\`typescript
${originalSnippet}
\`\`\`

Proposed Code:
\`\`\`typescript
${proposedSnippet}
\`\`\`

Original Intent:
${intent}

File Context:
${fileContext}

Evaluate the proposed code. Return a JSON object with the following structure:
{
  "passed": boolean (true if the code is solid and ready to merge, false if it has issues),
  "score": number (0.0 to 1.0, where 1.0 is perfect),
  "feedback": string[] (list of specific issues found, or empty if none),
  "suggestedFixes": string[] (list of actionable suggestions to fix the issues, or empty if none)
}

Be extremely critical. If there is any chance of a regression or unhandled edge case, fail it (passed: false).`;

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
        temperature: 0.1, // Low temperature for consistent, analytical critique
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    if (!response.ok) {
      log.warn(`Critique API failed with status ${response.status}`);
      return { passed: true, score: 1.0, feedback: [], suggestedFixes: [] }; // Fail open
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return { passed: true, score: 1.0, feedback: [], suggestedFixes: [] }; // Fail open
    }

    const parsed = safeJsonParse<CritiqueResult>(content);
    if (!parsed) {
      log.warn("Critique API returned invalid JSON.");
      return { passed: true, score: 1.0, feedback: [], suggestedFixes: [] }; // Fail open
    }

    return {
      passed: parsed.passed ?? true,
      score: parsed.score ?? 1.0,
      feedback: parsed.feedback ?? [],
      suggestedFixes: parsed.suggestedFixes ?? [],
    };
  } catch (error) {
    log.error(`Error during critique: ${(error as Error).message}`);
    return { passed: true, score: 1.0, feedback: [], suggestedFixes: [] }; // Fail open
  }
}

/**
 * A higher-order function that wraps a generation function with a critique-and-retry loop.
 *
 * @param generatorFn The function that generates the proposal snippet.
 * @param maxRetries The maximum number of times to retry generation if critique fails.
 * @param originalSnippet The original code.
 * @param intent The original intent.
 * @param fileContext Additional context.
 * @returns A promise resolving to the final (hopefully critiqued and passed) snippet.
 */
export async function generateWithCritiqueLoop(
  generatorFn: (previousFeedback?: string[]) => Promise<string>,
  maxRetries: number,
  originalSnippet: string,
  intent: string,
  fileContext: string
): Promise<{ finalSnippet: string; attempts: number; finalCritique: CritiqueResult }> {
  let currentSnippet = await generatorFn();
  let attempts = 1;
  let previousFeedback: string[] = [];
  let lastCritique: CritiqueResult = { passed: true, score: 1.0, feedback: [], suggestedFixes: [] };

  while (attempts <= maxRetries) {
    lastCritique = await critiqueProposal(originalSnippet, currentSnippet, intent, fileContext);
    
    if (lastCritique.passed) {
      log.info(`Proposal passed critique on attempt ${attempts}. Score: ${lastCritique.score}`);
      return { finalSnippet: currentSnippet, attempts, finalCritique: lastCritique };
    }

    log.info(`Proposal failed critique on attempt ${attempts}. Retrying. Issues: ${lastCritique.feedback.join("; ")}`);
    previousFeedback = [...lastCritique.feedback, ...lastCritique.suggestedFixes];
    
    if (attempts < maxRetries) {
        currentSnippet = await generatorFn(previousFeedback);
    }
    attempts++;
  }

  log.warn(`Max retries (${maxRetries}) reached. Returning last generated snippet despite critique failure.`);
  return { finalSnippet: currentSnippet, attempts: maxRetries, finalCritique: lastCritique };
}
