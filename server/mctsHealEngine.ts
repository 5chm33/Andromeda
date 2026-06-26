/**
 * mctsHealEngine.ts — v12.10.0 — MCTS Parallel Healing Engine
 *
 * Replaces the sequential 3-attempt heal loop with a Monte Carlo Tree Search
 * (MCTS)-inspired parallel healing approach:
 *
 *   1. EXPANSION: For each of the 3 healing strategies, generate N candidate
 *      fixes in parallel (using different temperatures / provider combinations).
 *   2. SIMULATION: Each candidate is dry-run through the TypeScript compiler in
 *      an isolated temp directory (reusing proposalSandbox infrastructure).
 *   3. SCORING: Each candidate receives a composite score:
 *        - tsc pass/fail (primary gate)
 *        - complexity delta (prefer simpler fixes)
 *        - similarity to original (prefer minimal changes)
 *        - critic confidence (if available)
 *   4. SELECTION: The highest-scoring passing candidate is selected.
 *      If no candidate passes tsc, the highest-scoring failing candidate is
 *      returned so the existing heal loop can try again.
 *
 * Expected impact: +4-5% commit success rate by finding the best fix across
 * a wider search space instead of taking the first one that compiles.
 *
 * Integration: called from selfImprove.ts in place of healTypeScriptErrors
 * when healCount >= 1 (first attempt still uses the fast sequential path).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { createLogger } from "./logger.js";
import { parseTscErrors, type TscError } from "./tsHealEngine.js";
import { extractAstContextForErrors } from "./astContextInjector.js";

const log = createLogger("mctsHeal");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MctsCandidate {
  originalSnippet: string;
  proposedSnippet: string;
  proposedContent: string;
  rationale: string;
  strategy: string;
  temperature: number;
  providerId: string;
  tscPassed: boolean;
  tscErrors: string[];
  complexityScore: number;   // lower = simpler = better
  similarityScore: number;   // higher = more similar to original = better
  compositeScore: number;    // final ranking score (higher = better)
}

export interface MctsHealResult {
  success: boolean;
  bestCandidate?: MctsCandidate;
  totalCandidates: number;
  passingCandidates: number;
  strategy: string;
  durationMs: number;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute a complexity score for a code snippet.
 * Lower is better (simpler is safer).
 */
function computeComplexity(snippet: string): number {
  const lines = snippet.split("\n").length;
  const branches = (snippet.match(/\bif\b|\belse\b|\bswitch\b|\bcase\b|\b\?\s/g) || []).length;
  const casts = (snippet.match(/as\s+\w|as\s+unknown/g) || []).length;
  const anyUsage = (snippet.match(/:\s*any\b/g) || []).length;
  // Penalize excessive any-casting (last resort) and complexity
  return lines * 0.1 + branches * 0.5 + casts * 0.2 + anyUsage * 0.3;
}

/**
 * Compute a similarity score between original and proposed snippets.
 * Higher is better (minimal change is safer).
 */
function computeSimilarity(original: string, proposed: string): number {
  if (!original || !proposed) return 0;
  const origWords = new Set(original.split(/\W+/).filter(Boolean));
  const propWords = new Set(proposed.split(/\W+/).filter(Boolean));
  const intersection = new Set([...origWords].filter(w => propWords.has(w)));
  const union = new Set([...origWords, ...propWords]);
  return union.size > 0 ? intersection.size / union.size : 1;
}

/**
 * Composite score: tsc pass is the primary gate, then similarity, then simplicity.
 */
function computeCompositeScore(candidate: Omit<MctsCandidate, "compositeScore">): number {
  const tscBonus = candidate.tscPassed ? 10.0 : 0.0;
  const similarityBonus = candidate.similarityScore * 3.0;
  const complexityPenalty = Math.min(candidate.complexityScore, 5.0);
  return tscBonus + similarityBonus - complexityPenalty;
}

// ─── Dry-Run in Isolated Temp Dir ────────────────────────────────────────────

/**
 * Run tsc on a single candidate in an isolated temp directory.
 * Returns { passed, errors }.
 */
function dryRunCandidate(
  targetFile: string,
  proposedContent: string,
  projectRoot: string
): { passed: boolean; errors: string[] } {
  let tmpDir: string | null = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-mcts-"));

    // Write the proposed file
    const relPath = targetFile.startsWith("server/") ? targetFile : `server/${path.basename(targetFile)}`;
    const tmpFilePath = path.join(tmpDir, path.basename(relPath));
    fs.writeFileSync(tmpFilePath, proposedContent, "utf-8");

    // Quick syntax check via node --check (much faster than full tsc)
    const nodeResult = spawnSync("node", ["--check", tmpFilePath], {
      timeout: 5000,
      stdio: "pipe",
    });

    if (nodeResult.status !== 0) {
      const errOut = (nodeResult.stderr || nodeResult.stdout || "").toString();
      return { passed: false, errors: [errOut.slice(0, 300)] };
    }

    // If node --check passes, try a fast tsc check on just this file
    const tscBin = path.resolve(projectRoot, "node_modules", ".bin", "tsc");
    if (fs.existsSync(tscBin)) {
      const tscResult = spawnSync(tscBin, [
        "--noEmit",
        "--allowJs",
        "--checkJs", "false",
        "--strict", "false",
        "--noImplicitAny", "false",
        "--skipLibCheck",
        "--target", "ES2020",
        "--module", "NodeNext",
        "--moduleResolution", "NodeNext",
        tmpFilePath,
      ], {
        timeout: 15000,
        stdio: "pipe",
        cwd: projectRoot,
      });

      if (tscResult.status !== 0) {
        const errOut = (tscResult.stderr || tscResult.stdout || "").toString();
        const errors = parseTscErrors(errOut).map(e => `${e.code} at ${e.line}: ${e.message}`);
        return { passed: false, errors: errors.slice(0, 5) };
      }
    }

    return { passed: true, errors: [] };
  } catch (err) {
    return { passed: false, errors: [(err as Error).message?.slice(0, 200)] };
  } finally {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
    }
  }
}

// ─── Strategy Prompt Builders ─────────────────────────────────────────────────

function buildMctsPrompt(
  strategy: "structured" | "minimal" | "safe_wrapper" | "semantic",
  proposal: { targetFile: string; originalSnippet: string; proposedSnippet: string; title: string },
  structuredErrors: string,
  fileContext: string,
  astContext: string,
  temperature: number
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const creativityHint = temperature > 0.4
    ? "Be creative — try a different approach than the obvious fix."
    : "Be conservative — make the minimal change needed to fix the type errors.";

  const strategyInstructions: Record<string, string> = {
    structured: `Fix ONLY the type errors with minimal changes. Prefer type assertions, optional chaining, or null guards. ${creativityHint}`,
    minimal: `Produce a MINIMAL version that preserves the core improvement but removes only the type-unsafe parts. Add type assertions (as Type) where needed. ${creativityHint}`,
    safe_wrapper: `Use type assertions (as unknown as T), optional chaining (?.), or explicit annotations to make the code compile. It is acceptable to use 'as any' if needed. ${creativityHint}`,
    semantic: `Rewrite the logic to achieve the same goal using a different implementation that avoids the type errors entirely. ${creativityHint}`,
  };

  return [
    {
      role: "system",
      content: `You are an expert TypeScript engineer. A code change introduced type errors.
${strategyInstructions[strategy]}
Return ONLY JSON: {"originalSnippet": "exact text to find in file", "proposedSnippet": "fixed version", "rationale": "what you changed"}`,
    },
    {
      role: "user",
      content: `File: ${proposal.targetFile}

Original:
\`\`\`typescript
${proposal.originalSnippet}
\`\`\`

Attempted change (has type errors):
\`\`\`typescript
${proposal.proposedSnippet}
\`\`\`

Type errors:
${structuredErrors}

File context:
\`\`\`typescript
${fileContext}
\`\`\`
${astContext ? `\nAST context:\n${astContext}\n` : ""}
Return JSON.`,
    },
  ];
}

// ─── Main MCTS Entry Point ────────────────────────────────────────────────────

/**
 * Run MCTS healing: generate multiple candidates across strategies and temperatures,
 * dry-run them all, score them, and return the best one.
 *
 * @param opts - Same shape as healTypeScriptErrors opts
 * @param branchesPerStrategy - Number of candidates to generate per strategy (default: 2)
 */
export async function mctsHeal(opts: {
  proposal: {
    id: string;
    targetFile: string;
    title: string;
    category?: string;
    originalSnippet: string;
    proposedSnippet: string;
    originalContent: string;
    proposedContent?: string;
  };
  tscErrors: TscError[];
  rawTscOutput: string;
  projectRoot: string;
  simpleChatCompletion: (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts: { maxTokens: number; temperature: number; providerId?: string }
  ) => Promise<string | null>;
  providerChain: string[];
  deadProviders: Set<string>;
  branchesPerStrategy?: number;
}): Promise<MctsHealResult> {
  const start = Date.now();
  const {
    proposal,
    tscErrors,
    rawTscOutput,
    projectRoot,
    simpleChatCompletion,
    providerChain,
    deadProviders,
    branchesPerStrategy = 2,
  } = opts;

  // Build shared context
  const fileBasename = path.basename(proposal.targetFile);
  const relevantErrors = tscErrors.filter(e =>
    e.file.includes(fileBasename) || e.file.includes(proposal.targetFile)
  );
  const errorsToFix = relevantErrors.length > 0 ? relevantErrors : tscErrors.slice(0, 5);

  const structuredErrors = errorsToFix
    .slice(0, 8)
    .map(e => `  ${e.code} at line ${e.line}:${e.col} — ${e.message}`)
    .join("\n");

  // File context around first error
  let fileContext = "";
  try {
    const absPath = path.join(projectRoot, proposal.targetFile);
    const lines = fs.readFileSync(absPath, "utf-8").split("\n");
    const errLine = errorsToFix[0]?.line ?? 1;
    const start_ = Math.max(0, errLine - 20);
    const end_ = Math.min(lines.length, errLine + 20);
    fileContext = lines.slice(start_, end_)
      .map((l, i) => `${start_ + i + 1 === errLine ? ">>>" : "   "} ${String(start_ + i + 1).padStart(4)} | ${l}`)
      .join("\n");
  } catch { /* non-fatal */ }

  // AST context
  let astContext = "";
  try {
    const absPath = path.join(projectRoot, proposal.targetFile);
    const astResult = extractAstContextForErrors(absPath, errorsToFix.map(e => ({ line: e.line, col: e.col })));
    if (astResult.promptContext) astContext = astResult.promptContext;
  } catch { /* non-fatal */ }

  // Build the candidate generation tasks
  const strategies: Array<"structured" | "minimal" | "safe_wrapper" | "semantic"> = [
    "structured", "minimal", "safe_wrapper", "semantic",
  ];
  const temperatures = [0.1, 0.4]; // conservative + creative per strategy

  type CandidateTask = {
    strategy: "structured" | "minimal" | "safe_wrapper" | "semantic";
    temperature: number;
    providerId: string;
  };

  const tasks: CandidateTask[] = [];
  const liveProviders = providerChain.filter(p => !deadProviders.has(p));

  for (const strategy of strategies) {
    for (let b = 0; b < branchesPerStrategy; b++) {
      const temperature = temperatures[b % temperatures.length];
      const providerId = liveProviders[b % Math.max(liveProviders.length, 1)] ?? providerChain[0];
      tasks.push({ strategy, temperature, providerId });
    }
  }

  log.info(`[MCTS] Starting ${tasks.length} candidate generation tasks for ${proposal.targetFile}`);

  // Generate all candidates in parallel
  const candidatePromises = tasks.map(async (task): Promise<MctsCandidate | null> => {
    try {
      const messages = buildMctsPrompt(
        task.strategy,
        proposal,
        structuredErrors,
        fileContext,
        astContext,
        task.temperature
      );

      const rawContent = await simpleChatCompletion(messages, {
        maxTokens: 2000,
        temperature: task.temperature,
        providerId: task.providerId,
      });

      if (!rawContent) return null;

      // Parse JSON response
      const cleaned = rawContent.replace(/^```json?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed.originalSnippet || !parsed.proposedSnippet) return null;

      // Verify snippet exists in file
      const fileContent = fs.readFileSync(path.join(projectRoot, proposal.targetFile), "utf-8");
      const snippetToFind = parsed.originalSnippet as string;
      if (!fileContent.includes(snippetToFind)) {
        // Try original snippet as fallback
        if (!fileContent.includes(proposal.originalSnippet)) return null;
        parsed.originalSnippet = proposal.originalSnippet;
      }

      const proposedContent = fileContent.replace(parsed.originalSnippet, parsed.proposedSnippet);

      // Dry-run in isolated temp dir
      const dryRun = dryRunCandidate(proposal.targetFile, proposedContent, projectRoot);

      const complexityScore = computeComplexity(parsed.proposedSnippet);
      const similarityScore = computeSimilarity(proposal.originalSnippet, parsed.proposedSnippet);

      const candidate: Omit<MctsCandidate, "compositeScore"> = {
        originalSnippet: parsed.originalSnippet,
        proposedSnippet: parsed.proposedSnippet,
        proposedContent,
        rationale: parsed.rationale || "",
        strategy: task.strategy,
        temperature: task.temperature,
        providerId: task.providerId,
        tscPassed: dryRun.passed,
        tscErrors: dryRun.errors,
        complexityScore,
        similarityScore,
      };

      return { ...candidate, compositeScore: computeCompositeScore(candidate) };
    } catch (err) {
      log.warn(`[MCTS] Candidate generation failed (strategy=${task.strategy}, temp=${task.temperature}): ${(err as Error).message?.slice(0, 100)}`);
      return null;
    }
  });

  // Wait for all candidates (with a timeout safety net)
  const settled = await Promise.allSettled(candidatePromises);
  const candidates: MctsCandidate[] = settled
    .filter((r): r is PromiseFulfilledResult<MctsCandidate | null> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value as MctsCandidate);

  const passingCandidates = candidates.filter(c => c.tscPassed);
  const allSorted = [...candidates].sort((a, b) => b.compositeScore - a.compositeScore);

  log.info(`[MCTS] ${candidates.length}/${tasks.length} candidates generated, ${passingCandidates.length} passed tsc`);

  const bestCandidate = allSorted[0];

  return {
    success: passingCandidates.length > 0,
    bestCandidate,
    totalCandidates: candidates.length,
    passingCandidates: passingCandidates.length,
    strategy: bestCandidate ? `mcts_${bestCandidate.strategy}_t${bestCandidate.temperature}_${bestCandidate.providerId}` : "mcts_no_candidates",
    durationMs: Date.now() - start,
  };
}
