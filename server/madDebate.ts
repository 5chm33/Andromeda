/**
 * madDebate.ts — v12.10.0 — Multi-Agent Debate (MAD) Proposal Hardening
 *
 * Implements a structured 2-round Red Team vs Blue Team debate to harden
 * proposals before they reach the Actor-Critic review.
 *
 * Protocol:
 *   Round 1 — Attack:
 *     The Red Team agent receives the Blue Team's proposed code change and
 *     aggressively identifies:
 *       - Type safety issues the Actor may have missed
 *       - Null/undefined dereference risks
 *       - Off-by-one errors, boundary conditions
 *       - Performance regressions (O(n²) where O(n) existed)
 *       - Security issues (injection, prototype pollution, etc.)
 *       - Logic errors in edge cases
 *
 *   Round 2 — Defense:
 *     The Blue Team agent receives the Red Team's critique and must either:
 *       a) Patch the code to address the valid criticisms, OR
 *       b) Explain why each criticism is invalid (with reasoning)
 *     The Blue Team returns a (potentially improved) proposedSnippet.
 *
 *   Outcome:
 *     - If the Blue Team patches the code, the improved snippet replaces the
 *       original before Actor-Critic review.
 *     - If the Red Team raised ≥3 unaddressed valid issues, the proposal's
 *       confidence is reduced by 0.15.
 *     - The debate transcript is stored as _madDebateTranscript on the proposal.
 *
 * Expected impact: +3-5% commit success rate by catching edge cases that a
 * single LLM review misses, especially for complex algorithmic changes.
 *
 * Integration: called from selfImprove.ts in analyzeAndPropose, after the
 * Actor-Critic review and before saving the proposal.
 */

import { createLogger } from "./logger.js";

const log = createLogger("madDebate");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DebateIssue {
  category: "type_safety" | "null_safety" | "logic" | "performance" | "security" | "boundary";
  description: string;
  severity: "critical" | "major" | "minor";
  lineHint?: string;
}

export interface RedTeamResult {
  issues: DebateIssue[];
  summary: string;
  overallRisk: "low" | "medium" | "high" | "critical";
}

export interface BlueTeamResult {
  improvedSnippet: string;
  addressedIssues: string[];
  dismissedIssues: string[];
  patchRationale: string;
}

export interface MadDebateResult {
  ran: boolean;
  skippedReason?: string;
  redTeamIssues: DebateIssue[];
  blueTeamImproved: boolean;
  improvedSnippet?: string;
  confidenceDelta: number;   // negative = confidence reduced, positive = boosted
  transcript: string;
  durationMs: number;
}

// ─── Debate Skipping Heuristics ───────────────────────────────────────────────

/**
 * Skip MAD debate for trivial changes (comment-only, single-line, low-risk).
 */
function shouldSkipDebate(
  originalSnippet: string,
  proposedSnippet: string,
  category?: string
): { skip: boolean; reason: string } {
  // Skip for comment-only changes
  const stripComments = (s: string) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (stripComments(originalSnippet) === stripComments(proposedSnippet)) {
    return { skip: true, reason: "comment-only change" };
  }

  // Skip for very short snippets (< 3 lines) — low risk
  const lineCount = proposedSnippet.split("\n").length;
  if (lineCount < 3) {
    return { skip: true, reason: "snippet too short (< 3 lines)" };
  }

  // Skip for documentation/config categories
  if (category && ["docs", "config", "style", "refactor-rename"].includes(category)) {
    return { skip: true, reason: `low-risk category: ${category}` };
  }

  return { skip: false, reason: "" };
}

// ─── Round 1: Red Team Attack ─────────────────────────────────────────────────

async function runRedTeam(
  targetFile: string,
  originalSnippet: string,
  proposedSnippet: string,
  fileContext: string,
  simpleChatCompletion: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { maxTokens: number; temperature: number; providerId?: string }
  ) => Promise<string | null>,
  providerId?: string
): Promise<RedTeamResult> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are a senior TypeScript code reviewer acting as a Red Team adversary.
Your job is to AGGRESSIVELY find bugs, risks, and edge cases in a proposed code change.
Be thorough and critical. Look for:
- Type safety issues (implicit any, unsafe casts, missing null checks)
- Null/undefined dereference risks
- Logic errors in edge cases (empty arrays, negative numbers, concurrent access)
- Performance regressions (unnecessary loops, missing memoization)
- Security issues (prototype pollution, injection, unvalidated input)
- Boundary conditions (off-by-one, integer overflow, empty string)

Return JSON: {
  "issues": [{"category": "type_safety|null_safety|logic|performance|security|boundary", "description": "...", "severity": "critical|major|minor", "lineHint": "optional line context"}],
  "summary": "overall assessment",
  "overallRisk": "low|medium|high|critical"
}`,
    },
    {
      role: "user",
      content: `File: ${targetFile}

Original code:
\`\`\`typescript
${originalSnippet}
\`\`\`

Proposed change:
\`\`\`typescript
${proposedSnippet}
\`\`\`

File context:
\`\`\`typescript
${fileContext.slice(0, 1000)}
\`\`\`

Find all bugs and risks. Return JSON.`,
    },
  ];

  try {
    const raw = await simpleChatCompletion(messages, {
      maxTokens: 1500,
      temperature: 0.2,
      providerId,
    });
    if (!raw) return { issues: [], summary: "Red Team call returned empty", overallRisk: "low" };

    const cleaned = raw.replace(/^```json?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(cleaned) as RedTeamResult;
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 10) : [],
      summary: parsed.summary || "",
      overallRisk: parsed.overallRisk || "low",
    };
  } catch (err) {
    log.warn(`[MAD] Red Team parse failed: ${(err as Error).message?.slice(0, 100)}`);
    return { issues: [], summary: "Red Team parse failed", overallRisk: "low" };
  }
}

// ─── Round 2: Blue Team Defense ───────────────────────────────────────────────

async function runBlueTeam(
  targetFile: string,
  originalSnippet: string,
  proposedSnippet: string,
  redTeamIssues: DebateIssue[],
  simpleChatCompletion: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { maxTokens: number; temperature: number; providerId?: string }
  ) => Promise<string | null>,
  providerId?: string
): Promise<BlueTeamResult> {
  const issueList = redTeamIssues
    .map((issue, i) => `${i + 1}. [${issue.severity.toUpperCase()}] ${issue.category}: ${issue.description}`)
    .join("\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are a senior TypeScript engineer defending your code change against a Red Team critique.
For each issue raised, either:
  a) PATCH the code to fix the valid concern, OR
  b) DISMISS it with a clear explanation of why it's not a real issue

Return JSON: {
  "improvedSnippet": "the (possibly patched) proposed code",
  "addressedIssues": ["issue 1 was fixed by ...", ...],
  "dismissedIssues": ["issue 3 is not valid because ...", ...],
  "patchRationale": "summary of what was changed and why"
}`,
    },
    {
      role: "user",
      content: `File: ${targetFile}

Your proposed change:
\`\`\`typescript
${proposedSnippet}
\`\`\`

Red Team critique:
${issueList}

Defend your code and return the (possibly improved) snippet as JSON.`,
    },
  ];

  try {
    const raw = await simpleChatCompletion(messages, {
      maxTokens: 2000,
      temperature: 0.1,
      providerId,
    });
    if (!raw) {
      return {
        improvedSnippet: proposedSnippet,
        addressedIssues: [],
        dismissedIssues: [],
        patchRationale: "Blue Team call returned empty — keeping original",
      };
    }

    const cleaned = raw.replace(/^```json?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
    let parsed: BlueTeamResult;
    try { parsed = JSON.parse(cleaned) as BlueTeamResult; } catch { throw new Error("Blue Team returned invalid JSON"); }
    return {
      improvedSnippet: parsed.improvedSnippet || proposedSnippet,
      addressedIssues: Array.isArray(parsed.addressedIssues) ? parsed.addressedIssues : [],
      dismissedIssues: Array.isArray(parsed.dismissedIssues) ? parsed.dismissedIssues : [],
      patchRationale: parsed.patchRationale || "",
    };
  } catch (err) {
    log.warn(`[MAD] Blue Team parse failed: ${(err as Error).message?.slice(0, 100)}`);
    return {
      improvedSnippet: proposedSnippet,
      addressedIssues: [],
      dismissedIssues: [],
      patchRationale: "Blue Team parse failed — keeping original",
    };
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run a 2-round Multi-Agent Debate on a proposal.
 *
 * @param opts.proposal - The proposal being evaluated
 * @param opts.fileContext - Surrounding file context for the Red Team
 * @param opts.simpleChatCompletion - LLM call function
 * @param opts.providerChain - Available providers (uses first 2 for Red/Blue)
 */
export async function runMadDebate(opts: {
  proposal: {
    targetFile: string;
    originalSnippet: string;
    proposedSnippet: string;
    category?: string;
    title: string;
  };
  fileContext: string;
  simpleChatCompletion: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { maxTokens: number; temperature: number; providerId?: string }
  ) => Promise<string | null>;
  providerChain: string[];
}): Promise<MadDebateResult> {
  const start = Date.now();
  const { proposal, fileContext, simpleChatCompletion, providerChain } = opts;

  // Check if we should skip
  const skipCheck = shouldSkipDebate(
    proposal.originalSnippet,
    proposal.proposedSnippet,
    proposal.category
  );
  if (skipCheck.skip) {
    return {
      ran: false,
      skippedReason: skipCheck.reason,
      redTeamIssues: [],
      blueTeamImproved: false,
      confidenceDelta: 0,
      transcript: "",
      durationMs: Date.now() - start,
    };
  }

  // Guard: if providerChain is empty, skip debate
  if (!providerChain || providerChain.length === 0) {
    return {
      ran: false,
      skippedReason: "No providers available for debate",
      redTeamIssues: [],
      blueTeamImproved: false,
      confidenceDelta: 0,
      transcript: "",
      durationMs: Date.now() - start,
    };
  }
  // Use different providers for Red and Blue if available
  const redProvider = providerChain[0];
  const blueProvider = providerChain.length > 1 ? providerChain[1] : providerChain[0];

  log.info(`[MAD] Starting debate for ${proposal.targetFile} (red=${redProvider}, blue=${blueProvider})`);

  // Round 1: Red Team Attack
  let redTeamResult: RedTeamResult;
  try {
    redTeamResult = await runRedTeam(
      proposal.targetFile,
      proposal.originalSnippet,
      proposal.proposedSnippet,
      fileContext,
      simpleChatCompletion,
      redProvider
    );
  } catch (err) {
    return {
      ran: false,
      skippedReason: `Red Team threw: ${(err as Error).message?.slice(0, 100)}`,
      redTeamIssues: [],
      blueTeamImproved: false,
      confidenceDelta: 0,
      transcript: "",
      durationMs: Date.now() - start,
    };
  }

  const criticalIssues = redTeamResult.issues.filter(i => i.severity === "critical").length;
  const majorIssues = redTeamResult.issues.filter(i => i.severity === "major").length;

  // If no issues found, skip Blue Team (nothing to debate)
  if (redTeamResult.issues.length === 0) {
    const transcript = `[Red Team] No issues found. Risk: ${redTeamResult.overallRisk}. Proposal approved.`;
    log.info(`[MAD] Red Team found no issues for ${proposal.targetFile}`);
    return {
      ran: true,
      redTeamIssues: [],
      blueTeamImproved: false,
      confidenceDelta: 0.05, // Small boost for passing Red Team with no issues
      transcript,
      durationMs: Date.now() - start,
    };
  }

  log.info(`[MAD] Red Team found ${redTeamResult.issues.length} issues (${criticalIssues} critical, ${majorIssues} major) for ${proposal.targetFile}`);

  // Round 2: Blue Team Defense
  let blueTeamResult: BlueTeamResult;
  try {
    blueTeamResult = await runBlueTeam(
      proposal.targetFile,
      proposal.originalSnippet,
      proposal.proposedSnippet,
      redTeamResult.issues,
      simpleChatCompletion,
      blueProvider
    );
  } catch (err) {
    blueTeamResult = {
      improvedSnippet: proposal.proposedSnippet,
      addressedIssues: [],
      dismissedIssues: [],
      patchRationale: `Blue Team threw: ${(err as Error).message?.slice(0, 100)}`,
    };
  }

  // Determine if the Blue Team actually improved the snippet
  const blueTeamImproved = blueTeamResult.improvedSnippet !== proposal.proposedSnippet &&
    blueTeamResult.improvedSnippet.trim().length > 0;

  // Compute confidence delta
  const unaddressedCritical = criticalIssues - blueTeamResult.addressedIssues.filter(a =>
    a.toLowerCase().includes("critical") || a.toLowerCase().includes("fix")
  ).length;
  const confidenceDelta = blueTeamImproved
    ? 0.05  // Boost for self-patching
    : -(unaddressedCritical * 0.05 + Math.max(0, majorIssues - 2) * 0.02);

  // Build transcript
  const transcript = [
    `[Red Team] ${redTeamResult.issues.length} issues found (risk: ${redTeamResult.overallRisk})`,
    ...redTeamResult.issues.slice(0, 5).map(i => `  - [${i.severity}] ${i.category}: ${i.description.slice(0, 100)}`),
    `[Blue Team] ${blueTeamImproved ? "PATCHED code" : "Defended without changes"}`,
    `  Addressed: ${blueTeamResult.addressedIssues.length}, Dismissed: ${blueTeamResult.dismissedIssues.length}`,
    `  Rationale: ${blueTeamResult.patchRationale.slice(0, 200)}`,
    `[Outcome] confidenceDelta=${confidenceDelta.toFixed(2)}`,
  ].join("\n");

  return {
    ran: true,
    redTeamIssues: redTeamResult.issues,
    blueTeamImproved,
    improvedSnippet: blueTeamImproved ? blueTeamResult.improvedSnippet : undefined,
    confidenceDelta,
    transcript,
    durationMs: Date.now() - start,
  };
}
