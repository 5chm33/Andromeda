/**
 * selfImprove.ts — v5.3
 *
 * Self-Improving Codebase Module.
 *
 * Fixed in v5.3: The v5.1 implementation asked DeepSeek to return the ENTIRE
 * improved file as a JSON field, which exceeded max_tokens for large files like
 * ai.ts, causing a silent JSON parse failure. The new approach asks for only
 * the specific changed code block (before/after), which is token-efficient and
 * reliable regardless of file size.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { backgroundSimpleCompletion } from "./llmProvider.js"; // v6.16: route self-improve to cheap background provider (DeepSeek)
import { createLogger } from "./logger.js";
const log = createLogger("selfImprove");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImprovementProposal = {
  id: string;
  targetFile: string;
  title: string;
  rationale: string;
  category: "performance" | "reliability" | "security" | "readability" | "feature";
  impact: "high" | "medium" | "low";
  diff: string;
  originalSnippet: string;
  proposedSnippet: string;
  originalContent: string;
  proposedContent: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "applied";
};

type ProposalStore = {
  proposals: ImprovementProposal[];
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function getProposalStorePath(): string {
  const workspaceDir = path.resolve(getServerDir(), "..", "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_proposals.json");
}

function loadProposals(): ProposalStore {
  const p = getProposalStorePath();
  if (!fs.existsSync(p)) return { proposals: [] };
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as ProposalStore; }
  catch { return { proposals: [] }; }
}

function saveProposals(store: ProposalStore): void {
  fs.writeFileSync(getProposalStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

// ─── Allowed Files ────────────────────────────────────────────────────────────

const ANALYZABLE_FILES = [
  "ai.ts",
  "grounding.ts",
  "browser.ts",
  "workspace.ts",
  "memory.ts",
  "multiAgent.ts",
  "biasDetector.ts",
  "codeIntel.ts",
  "streamRouter.ts",
  "selfImprove.ts",
  "reactEngine.ts",
  "llmProvider.ts",
  "contextManager.ts",
  "adaptiveRouter.ts",
  "selfConsistency.ts",
  "contextBus.ts",
  "manifest.ts",
];

function resolveServerFile(filename: string): string | null {
  const basename = path.basename(filename);
  if (!ANALYZABLE_FILES.includes(basename)) return null;

  // v6.00 FIX: Use canonical path first (Kimi audit — brute-force search may find wrong file in monorepo).
  // Walk up from distDir to find the project root (directory that contains a 'server/' subdirectory).
  const distDir = getServerDir();
  let projectRoot: string | null = null;
  let cur = distDir;
  for (let i = 0; i < 8; i++) {
    const serverSubdir = path.join(cur, "server");
    try {
      if (fs.existsSync(serverSubdir) && fs.statSync(serverSubdir).isDirectory()) {
        projectRoot = cur;
        break;
      }
    } catch (err) { log.caught("skip", err); }
    cur = path.dirname(cur);
  }

  // Try canonical paths first — these are authoritative
  if (projectRoot) {
    const canonical = path.join(projectRoot, "server", basename);
    try { if (fs.existsSync(canonical)) return canonical; } catch (err) { log.caught("skip", err); }
    const canonicalTools = path.join(projectRoot, "server", "tools", basename);
    try { if (fs.existsSync(canonicalTools)) return canonicalTools; } catch (err) { log.caught("skip", err); }
    const canonicalSelf = path.join(projectRoot, "server", "self", basename);
    try { if (fs.existsSync(canonicalSelf)) return canonicalSelf; } catch (err) { log.caught("skip", err); }
  }

  // Fallback: original brute-force search for unusual layouts
  const candidates: string[] = [
    path.join(distDir, basename),
    path.join(path.resolve(distDir, "..", "server"), basename),
    path.join(path.resolve(distDir, "..", "server", "tools"), basename),
    path.join(process.cwd(), "server", basename),
    path.join(process.cwd(), "andromeda", "server", basename),
    path.join(distDir, "..", basename),
  ];
  let current = distDir;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(current, "server", basename));
    candidates.push(path.join(current, basename));
    current = path.dirname(current);
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) { log.caught("skip inaccessible paths", err); }
  }

  return null;
}

// ─── Simple Diff Generator ────────────────────────────────────────────────────

function generateSimpleDiff(original: string, proposed: string, filename: string): string {
  const origLines = original.split("\n");
  const propLines = proposed.split("\n");
  const diff: string[] = [`--- a/${filename}`, `+++ b/${filename}`];

  let i = 0, j = 0;
  let hunkLines: string[] = [];
  let hunkStart = -1;

  const flushHunk = () => {
    if (hunkLines.length > 0) {
      diff.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
      diff.push(...hunkLines);
      hunkLines = [];
      hunkStart = -1;
    }
  };

  while (i < origLines.length || j < propLines.length) {
    const orig = origLines[i];
    const prop = propLines[j];
    if (orig === prop) {
      if (hunkLines.length > 0) {
        hunkLines.push(` ${orig ?? ""}`);
        if (hunkLines.filter(l => !l.startsWith(" ")).length > 0 && hunkLines.length > 6) flushHunk();
      }
      i++; j++;
    } else {
      if (hunkStart === -1) hunkStart = Math.max(0, i - 3);
      if (orig !== undefined) { hunkLines.push(`-${orig}`); i++; }
      if (prop !== undefined) { hunkLines.push(`+${prop}`); j++; }
    }
  }
  flushHunk();
  return diff.join("\n");
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────
// v5.3 Fix: Ask for a specific code SNIPPET change instead of the full file.
// This keeps the response well under max_tokens even for large files.

export async function analyzeAndPropose(
  targetFile: string,
  area?: string
): Promise<ImprovementProposal | null> {
  // v6.15: Use active provider key instead of hardcoded DEEPSEEK_API_KEY
  // This allows OpenRouter (Claude) to be used when LLM_MODEL=openrouter
  const { getProviderApiKey } = await import("./llmProvider.js");
  const activeModel = process.env.LLM_MODEL || "deepseek";
  const apiKey = getProviderApiKey(activeModel) || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY)");

  const filePath = resolveServerFile(targetFile);
  if (!filePath) {
    throw new Error(`File '${targetFile}' is not in the list of analyzable files or does not exist.`);
  }

  const originalContent = fs.readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);

  // v5.31: Dynamic model-aware analysis budget — uses smart chunking for large files
  const { getContextWindow: getCtxWindow } = await import("./modelRegistry.js");
  const analysisCharBudget = Math.floor(getCtxWindow(process.env.LLM_MODEL || process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat") * 3.5 * 0.4); // 40% of context for file content
  let contentForAnalysis: string;
  if (originalContent.length > analysisCharBudget) {
    try {
      const { smartChunkFile } = await import("./fileEngine.js");
      const chunked = smartChunkFile(originalContent, path.basename(filePath), analysisCharBudget);
      contentForAnalysis = chunked.loaded + (chunked.manifest ? `\n\n// ${chunked.manifest}` : "");
    } catch {
      contentForAnalysis = originalContent.slice(0, analysisCharBudget) + "\n\n// ... (file truncated for analysis) ...";
    }
  } else {
    contentForAnalysis = originalContent;
  }

  // v5.25: Inject knowledge base context for informed improvements
  let knowledgeContext = "";
  try {
    const { getImprovementContext } = await import("./selfKnowledgeBase.js");
    knowledgeContext = getImprovementContext(targetFile) || "";
  } catch {
    // Knowledge base not available — proceed without context
  }

  // v5.25 + v5.53: Check memory for previous attempts on this file
  // Searches both vector memory (semantic) and storeMemory audit trail (exact)
  let previousAttempts = "";
  try {
    const { vectorSearch } = await import("./vectorMemory.js");
    const memories = await vectorSearch(`self-modify ${filename}`, 3);
    if (memories && memories.length > 0) {
      previousAttempts = "\n\nPrevious modification attempts on this file (vector search):\n" +
        memories.map((m: any) => `- ${m.content}`).join("\n");
    }
  } catch {
    // Vector memory not available
  }
  // v5.53: Also search the storeMemory audit trail for past applied proposals on this file
  try {
    const { searchMemory } = await import("./memory.js");
    const pastProposals = searchMemory(`self-improve ${filename}`, 5, "project");
    if (pastProposals && pastProposals.length > 0) {
      const pastSummary = pastProposals
        .filter((m: any) => m.content.includes(filename))
        .map((m: any) => m.content.split("\n").slice(0, 3).join(" | "))
        .join("\n");
      if (pastSummary) {
        previousAttempts += `\n\nPreviously applied improvements to this file (do NOT repeat these):\n${pastSummary}`;
      }
    }
  } catch {
    // Memory search not available
  }

  // v6.16: Use cheap background provider (DeepSeek) instead of active provider (OpenRouter/Claude).
  // Self-improvement analysis runs every minute via RecursiveGoals — using Claude would drain credits fast.
  const rawContent = await backgroundSimpleCompletion(
    [
      {
        role: "system",
        content: `You are an expert TypeScript software engineer performing a targeted code improvement.
You will receive source code and must identify the SINGLE BEST improvement to make.
${knowledgeContext ? `\nArchitecture decisions and known issues for this file:\n${knowledgeContext}` : ""}${previousAttempts}

CRITICAL: Return ONLY a JSON object. No markdown. No explanation outside the JSON.
The JSON must contain:
- "title": short title (max 10 words)
- "rationale": 2 sentences explaining the improvement
- "category": one of: performance, reliability, security, readability, feature
- "impact": one of: high, medium, low
- "originalSnippet": the EXACT lines of code to replace (copy verbatim from the file, max 30 lines)
- "proposedSnippet": the improved replacement code (same approximate length)

The originalSnippet MUST be an exact substring of the provided file content.
Keep both snippets SHORT and focused. Do not rewrite the whole file.
Do NOT repeat previous failed attempts.`,
      },
      {
        role: "user",
        content: `Analyze this TypeScript file and propose the single best improvement${area ? ` focusing on: ${area}` : ``}.\n\nFile: ${filename}\n\n\`\`\`typescript\n${contentForAnalysis}\n\`\`\`\n\nReturn ONLY valid JSON.`,
      },
    ],
    { maxTokens: 2000, temperature: 0.3 },
  );

  if (!rawContent) throw new Error("AI returned an empty response");

  // Strip markdown code fences if present
  const jsonStr = rawContent
    .replace(/^```json?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: {
    title: string;
    rationale: string;
    category: ImprovementProposal["category"];
    impact: ImprovementProposal["impact"];
    originalSnippet: string;
    proposedSnippet: string;
  };

  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    // Try to extract JSON from the response if it has surrounding text
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(`Failed to parse AI response as JSON. Raw response: ${rawContent.slice(0, 300)}`);
      }
    } else {
      throw new Error(`AI response was not JSON. Raw response: ${rawContent.slice(0, 300)}`);
    }
  }

  if (!parsed.originalSnippet || !parsed.proposedSnippet || !parsed.title) {
    throw new Error("AI response missing required fields (title, originalSnippet, proposedSnippet)");
  }

  // Apply the snippet replacement to produce the full proposed content
  let proposedContent: string;
  if (originalContent.includes(parsed.originalSnippet)) {
    proposedContent = originalContent.replace(parsed.originalSnippet, parsed.proposedSnippet);
  } else {
    // Snippet not found verbatim — use fuzzy match on trimmed lines
    const origLines = originalContent.split("\n");
    const snippetLines = parsed.originalSnippet.split("\n").map(l => l.trim());
    let matchStart = -1;
    for (let i = 0; i <= origLines.length - snippetLines.length; i++) {
      const window = origLines.slice(i, i + snippetLines.length).map(l => l.trim());
      if (window.join("\n") === snippetLines.join("\n")) { matchStart = i; break; }
    }
    if (matchStart >= 0) {
      const before = origLines.slice(0, matchStart).join("\n");
      const after = origLines.slice(matchStart + snippetLines.length).join("\n");
      proposedContent = [before, parsed.proposedSnippet, after].filter(Boolean).join("\n");
    } else {
      // Can't apply — still save the proposal for display purposes
      proposedContent = originalContent;
    }
  }

  const diff = generateSimpleDiff(originalContent, proposedContent, filename);

  const proposal: ImprovementProposal = {
    id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    targetFile: filename,
    title: parsed.title,
    rationale: parsed.rationale,
    category: parsed.category ?? "readability",
    impact: parsed.impact ?? "medium",
    diff,
    originalSnippet: parsed.originalSnippet,
    proposedSnippet: parsed.proposedSnippet,
    originalContent,
    proposedContent,
    createdAt: Date.now(),
    status: "pending",
  };

  const store = loadProposals();
  store.proposals.push(proposal);
  saveProposals(store);

  return proposal;
}

export async function applyProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
  const store = loadProposals();
  const proposal = store.proposals.find(p => p.id === proposalId);

  if (!proposal) return { success: false, message: "Proposal not found" };
  if (proposal.status !== "pending") return { success: false, message: `Proposal is already ${proposal.status}` };

  // v5.48: Track retry count to prevent infinite retry loops (the OOM crash cause)
  const retryCount = (proposal as any)._retryCount || 0;
  if (retryCount >= 3) {
    proposal.status = "rejected" as any;
    (proposal as any)._failReason = `Max retries (3) exceeded — guard unavailable or path unresolvable`;
    saveProposals(store);
    console.warn(`[SelfImprove] Proposal ${proposalId} marked as rejected after ${retryCount} failed attempts`);
    return { success: false, message: `Proposal rejected after ${retryCount} failed attempts` };
  }

  const filePath = resolveServerFile(proposal.targetFile);
  if (!filePath) return { success: false, message: "Target file no longer accessible" };

  // v5.27: Impact analysis before applying changes
  try {
    const { analyzeImpact } = await import("./dependencyGraph");
    const impact = analyzeImpact(proposal.targetFile);
    if (impact && impact.riskLevel === "critical" && impact.totalAffectedFiles > 10) {
      console.warn(`[SelfImprove] HIGH-RISK: ${proposal.targetFile} affects ${impact.totalAffectedFiles} files`);
      return {
        success: false,
        message: `Blocked: Change to ${proposal.targetFile} affects ${impact.totalAffectedFiles} files (risk: critical). Reduce scope or split into smaller changes.`,
      };
    } else if (impact && impact.riskLevel === "critical") {
      console.warn(`[SelfImprove] Elevated risk for ${proposal.targetFile}: ${impact.totalAffectedFiles} affected files`);
    }
  } catch (impactErr) {
    console.warn("[SelfImprove] Impact analysis unavailable:", (impactErr as Error).message);
  }

  // v5.27: Cross-session learning — check past attempts before applying
  try {
    const { getCrossSessionInsights } = await import("./selfKnowledgeBase");
    const insights = getCrossSessionInsights(proposal.targetFile);
    if (insights.totalAttempts > 3 && insights.successRate < 0.3) {
      console.warn(`[SelfImprove] Low success rate (${(insights.successRate * 100).toFixed(0)}%) for ${proposal.targetFile}. Proceeding with caution.`);
    }
  } catch (err) { log.caught("non-fatal", err); }

  // v5.53: Git pre-apply snapshot — commit current state BEFORE applying so we can always roll back
  try {
    const cwd = path.resolve(getServerDir(), "..");
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Andromeda AI", GIT_AUTHOR_EMAIL: "andromeda@local", GIT_COMMITTER_NAME: "Andromeda AI", GIT_COMMITTER_EMAIL: "andromeda@local" };
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      execSync("git init", { cwd, env: gitEnv, encoding: "utf-8" });
    }
    execSync("git add -A", { cwd, env: gitEnv, encoding: "utf-8" });
    const snapshotMsg = `pre-improvement snapshot: before "${(proposal.title || proposalId).replace(/"/g, "'")}" [${new Date().toISOString()}]`;
    try {
      execSync(`git commit -m "${snapshotMsg}"`, { cwd, env: gitEnv, encoding: "utf-8" });
      console.log(`[SelfImprove] Git snapshot: ${snapshotMsg}`);
    } catch (commitErr: any) {
      if (!String(commitErr.stderr || commitErr.message).includes("nothing to commit")) {
        console.warn("[SelfImprove] Git snapshot warning:", (commitErr as Error).message);
      }
    }
  } catch (snapErr) {
    console.warn("[SelfImprove] Git snapshot unavailable:", (snapErr as Error).message);
  }
  // v5.22: Use the self-test pipeline for safe application
  // Pipeline: backup → apply → typecheck → unittest → healthcheck → commit (or rollback)
  try {
    // Create rollback point first
    const { createRollbackPoint } = await import("./selfRollback") as any;
    createRollbackPoint([proposal.targetFile], `Before proposal ${proposalId}: ${proposal.title || "self-improvement"}`, "self-improve");
  } catch (err) { log.caught("non-fatal", err); }

  try {
    const { guardedApply } = await import("./selfImproveGuard");
    const guardResult = await guardedApply(proposalId);

    if (guardResult.success) {
      proposal.status = "applied";
      saveProposals(store);

      // v6.12: Record applied suggestion in skill graph for learning
      try {
        const { recordAppliedSuggestion } = await import("./skillGraph.js");
        recordAppliedSuggestion();
      } catch { /* skill graph optional */ }

      // v5.25: Record self-modify metrics
      try {
        const { recordMetric } = await import("./selfMonitor.js");
        recordMetric("self_modify_success", 1, `Applied: ${proposal.title}`);
        recordMetric("proposal_quality", 1, `Accepted: ${proposal.targetFile}`);
      } catch (err) { log.caught("non-fatal", err); }

      // v5.27: Record cross-session learning outcome
      try {
        const { recordModificationOutcome } = await import("./selfKnowledgeBase");
        recordModificationOutcome({
          targetFile: proposal.targetFile,
          proposalTitle: proposal.title || proposalId,
          category: proposal.category || "general",
          success: true,
          healthImpact: "improved",
        });
      } catch (err) { log.caught("non-fatal", err); }

      // v5.15: Auto-trigger test generation for the modified file
      try {
        const { generateTests } = await import("./testGenerator");
        const content = fs.readFileSync(filePath, "utf-8");
        const language = filePath.endsWith(".ts") ? "typescript" : "python";
        const tests = generateTests(content, filePath, language);
        if (tests.testCode) {
          const testPath = filePath.replace(/\.(ts|py)$/, `.test.$1`);
          fs.writeFileSync(testPath, tests.testCode, "utf-8");
          console.log(`[SelfImprove] Auto-generated tests: ${path.basename(testPath)} (${tests.functions.length} functions covered)`);
        }
      } catch (testErr) {
        console.warn(`[SelfImprove] Test generation failed (non-fatal):`, (testErr as Error).message);
      }

      // v5.22: Start health monitoring after successful apply
      try {
        const { startHealthWatch } = await import("./selfRollback") as any;
        startHealthWatch(proposalId);
      } catch (err) { log.caught("non-fatal", err); }

      // v5.31: Cross-session learning via systemMemory
      try {
        const { recordSystemLearning } = await import("./systemMemory");
        recordSystemLearning({
          category: "modification",
          title: `Applied: ${proposal.title}`,
          content: `Successfully applied improvement to ${proposal.targetFile}: ${proposal.title}`,
          context: `category: ${proposal.category || "unknown"}, impact: ${proposal.impact || "unknown"}`,
          confidence: 0.9,
          applicableTo: [proposal.targetFile],
        });
      } catch (err) { log.caught("non-fatal", err); }

      return {
        success: true,
        message: guardResult.message || `Applied successfully via guard. Backup: ${guardResult.backup?.id || "created"}`,
      };
    } else {
       // v5.25: Record failure metrics
      try {
        const { recordMetric } = await import("./selfMonitor.js");
        recordMetric("self_modify_success", 0, `Rejected: ${proposal.title}`);
        recordMetric("self_modify_rollback", 1, `Guard rejected: ${proposal.targetFile}`);
        recordMetric("proposal_quality", 0, `Rejected: ${proposal.targetFile}`);
      } catch (err) { log.caught("non-fatal", err); }

      // v5.27: Record cross-session learning for failures
      try {
        const { recordModificationOutcome } = await import("./selfKnowledgeBase");
        recordModificationOutcome({
          targetFile: proposal.targetFile,
          proposalTitle: proposal.title || proposalId,
          category: proposal.category || "general",
          success: false,
          rollbackReason: guardResult.message || "Guard rejected",
          healthImpact: "degraded",
        });
      } catch (err) { log.caught("non-fatal", err); }

      return {
        success: false,
        message: guardResult.message || "Guard rejected the proposal (syntax check or test failure)",
      };
    }
  } catch (guardErr) {
    // v5.29: NEVER fall back to direct apply — queue for retry when guard is available
    // v5.48: Increment retry count to prevent infinite loops
    (proposal as any)._retryCount = ((proposal as any)._retryCount || 0) + 1;
    if ((proposal as any)._retryCount >= 3) {
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = `Guard unavailable after ${(proposal as any)._retryCount} attempts: ${(guardErr as Error).message}`;
      console.warn(`[SelfImprove] Proposal ${proposalId} permanently rejected after ${(proposal as any)._retryCount} guard failures`);
    } else {
      console.warn("[SelfImprove] Guard unavailable. Queuing proposal for retry:", (guardErr as Error).message);
      proposal.status = "pending" as any; // Keep as pending for retry
    }
    saveProposals(store);

    // Record the failure in system memory
    try {
      const { recordAction } = await import("./selfModel");
      recordAction("Guard unavailable — proposal queued", `Proposal ${proposalId} waiting for guard`);
    } catch (err) { log.caught("non-fatal", err); }

    return {
      success: false,
      message: `Guard unavailable — proposal ${proposalId} queued for retry when guard is restored`,
    };
  }
}

export function rejectProposal(proposalId: string): boolean {
  const store = loadProposals();
  const proposal = store.proposals.find(p => p.id === proposalId);
  if (!proposal) return false;
  proposal.status = "rejected";
  saveProposals(store);
  return true;
}

export function listProposals(statusFilter?: ImprovementProposal["status"]): ImprovementProposal[] {
  const store = loadProposals();
  const proposals = statusFilter
    ? store.proposals.filter(p => p.status === statusFilter)
    : store.proposals;
  return proposals.sort((a, b) => b.createdAt - a.createdAt);
}

export function getAnalyzableFiles(): string[] {
  return ANALYZABLE_FILES.filter(f => resolveServerFile(f) !== null);
}

// ─── v5.16: Auto-Apply Mode + GitOps Integration ─────────────────────────────

/**
 * Auto-apply configuration — controls autonomous self-improvement behavior.
 * When enabled, proposals with confidence >= threshold are applied automatically
 * without human approval, then committed via git.
 */
export interface AutoApplyConfig {
  enabled: boolean;
  confidenceThreshold: number; // 0-100, default 90
  maxAutoAppliesPerHour: number; // safety limit
  requireTypeCheck: boolean; // must pass tsc before committing
  commitToGit: boolean; // auto-commit applied changes
  branchStrategy: "main" | "feature-branch"; // commit to main or create feature branches
}

// v5.50: Auto-apply is now ENABLED by default.
// Risk gating (low/medium/high) provides the safety layer instead of disabling entirely.
// The monitoring -> auto-fix loop requires this to be on to close the loop.
const DEFAULT_AUTO_APPLY_CONFIG: AutoApplyConfig = {
  enabled: true,  // v5.50: enabled by default
  confidenceThreshold: 75, // v5.50: lowered from 90 to 75 for more responsive self-improvement
  maxAutoAppliesPerHour: 8, // v5.50: increased from 5 to 8


  requireTypeCheck: true,
  commitToGit: true,
  branchStrategy: "main",
};

function getAutoApplyConfigPath(): string {
  const workspaceDir = path.resolve(getServerDir(), "..", "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_auto_apply.json");
}

export function getAutoApplyConfig(): AutoApplyConfig {
  const configPath = getAutoApplyConfigPath();
  if (!fs.existsSync(configPath)) return { ...DEFAULT_AUTO_APPLY_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return { ...DEFAULT_AUTO_APPLY_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_AUTO_APPLY_CONFIG };
  }
}

export function setAutoApplyConfig(updates: Partial<AutoApplyConfig>): AutoApplyConfig {
  const current = getAutoApplyConfig();
  const merged: AutoApplyConfig = { ...current, ...updates };

  // Validate bounds
  merged.confidenceThreshold = Math.max(50, Math.min(100, merged.confidenceThreshold));
  merged.maxAutoAppliesPerHour = Math.max(1, Math.min(20, merged.maxAutoAppliesPerHour));

  fs.writeFileSync(getAutoApplyConfigPath(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// ─── Auto-Apply Rate Limiter ─────────────────────────────────────────────────

const autoApplyHistory: number[] = []; // timestamps of recent auto-applies

function canAutoApply(config: AutoApplyConfig): boolean {
  const oneHourAgo = Date.now() - 3600_000;
  // Prune old entries
  while (autoApplyHistory.length > 0 && autoApplyHistory[0] < oneHourAgo) {
    autoApplyHistory.shift();
  }
  return autoApplyHistory.length < config.maxAutoAppliesPerHour;
}

function recordAutoApply(): void {
  autoApplyHistory.push(Date.now());
}

// ─── GitOps Integration ──────────────────────────────────────────────────────

/**
 * Commit a self-improvement change via git.
 * Uses the same git primitives as tools/gitOps.ts but called programmatically.
 */
function gitCommitSelfImprovement(
  targetFile: string,
  summary: string,
  branchStrategy: "main" | "feature-branch"
): { success: boolean; message: string } {
  // v5.29: execSync imported at module level
  const cwd = path.resolve(getServerDir(), "..");

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Andromeda AI",
    GIT_AUTHOR_EMAIL: "andromeda@local",
    GIT_COMMITTER_NAME: "Andromeda AI",
    GIT_COMMITTER_EMAIL: "andromeda@local",
  };

  try {
    // Ensure git repo exists
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      execSync("git init", { cwd, env: gitEnv, encoding: "utf-8" });
      execSync("git add -A", { cwd, env: gitEnv, encoding: "utf-8" });
      execSync('git commit --allow-empty -m "Initial commit by Andromeda"', { cwd, env: gitEnv, encoding: "utf-8" });
    }

    // Feature branch strategy
    if (branchStrategy === "feature-branch") {
      const branchName = `self-improve/${Date.now()}-${path.basename(targetFile).replace(/\./g, "-")}`;
      try {
        execSync(`git checkout -b ${branchName}`, { cwd, env: gitEnv, encoding: "utf-8" });
      } catch {
        // Branch might already exist, just continue on current branch
      }
    }

    // Stage the changed file
    const relativeFile = path.relative(cwd, targetFile);
    execSync(`git add "${relativeFile}"`, { cwd, env: gitEnv, encoding: "utf-8" });

    // Also stage any auto-generated test files
    const testFile = targetFile.replace(/\.(ts|py)$/, `.test.$1`);
    if (fs.existsSync(testFile)) {
      const relativeTest = path.relative(cwd, testFile);
      execSync(`git add "${relativeTest}"`, { cwd, env: gitEnv, encoding: "utf-8" });
    }

    // Commit with descriptive message
    const commitMsg = `Andromeda self-improvement: ${path.basename(targetFile)} — ${summary}`.replace(/"/g, '\\"');
    const result = execSync(`git commit -m "${commitMsg}"`, { cwd, env: gitEnv, encoding: "utf-8" });

    return { success: true, message: result.trim() };
  } catch (err: any) {
    const errMsg = err.stderr?.toString?.() || err.message || String(err);
    // "nothing to commit" is not a real error
    if (errMsg.includes("nothing to commit")) {
      return { success: true, message: "No changes to commit (already committed)" };
    }
    return { success: false, message: `Git commit failed: ${errMsg}` };
  }
}

// ─── TypeScript Check (for auto-apply safety) ────────────────────────────────

function runTypeCheck(): { success: boolean; errors: string[] } {
  // v5.29: execSync imported at module level
  const cwd = path.resolve(getServerDir(), "..");

  try {
    execSync("npx tsc --noEmit 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 });
    return { success: true, errors: [] };
  } catch (err: any) {
    const output = err.stdout?.toString?.() || err.stderr?.toString?.() || "";
    const errors = output.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 20);
    return { success: false, errors };
  }
}

// ─── Core Auto-Apply Function ────────────────────────────────────────────────

export interface AutoApplyResult {
  proposalId: string;
  targetFile: string;
  title: string;
  applied: boolean;
  committed: boolean;
  typeCheckPassed: boolean | null;
  message: string;
}

/**
 * Scans pending proposals and automatically applies those meeting the confidence threshold.
 * Returns a summary of all auto-applied changes.
 *
 * Safety features:
 * - Rate limited (configurable max per hour)
 * - Optional TypeScript check before committing
 * - Git commit with descriptive message
 * - Auto-rollback on type check failure
 */
export async function autoApplyHighConfidence(): Promise<AutoApplyResult[]> {
  const config = getAutoApplyConfig();
  const results: AutoApplyResult[] = [];

  if (!config.enabled) {
    return [{ proposalId: "", targetFile: "", title: "", applied: false, committed: false, typeCheckPassed: null, message: "Auto-apply is disabled" }];
  }

  const store = loadProposals();

  // v5.30: Proper scoring function — uses multiple heuristics instead of just impact field
  function scoreProposal(p: ImprovementProposal): number {
    let score = 0;
    // Impact weight
    if (p.impact === "high") score += 40;
    else if (p.impact === "medium") score += 20;
    else score += 10;
    // Category weight — reliability and security fixes are more confident
    if (p.category === "reliability") score += 25;
    else if (p.category === "security") score += 30;
    else if (p.category === "performance") score += 20;
    else if (p.category === "readability") score += 15;
    else score += 10;
    // Diff size — smaller diffs are safer
    const diffLines = (p.diff || "").split("\n").length;
    if (diffLines < 10) score += 20;
    else if (diffLines < 30) score += 10;
    else score += 5;
    // Penalize if proposed content looks truncated
    if (p.proposedContent && p.proposedContent.length < p.originalContent.length * 0.5) {
      score -= 30; // Likely truncated
    }
    return Math.max(0, Math.min(100, score));
  }

  const pendingHighConfidence = store.proposals
    .filter(p => p.status === "pending")
    .map(p => ({ proposal: p, score: scoreProposal(p) }))
    .filter(({ score }) => score >= config.confidenceThreshold)
    .sort((a, b) => b.score - a.score)
    .map(({ proposal }) => proposal);

  if (pendingHighConfidence.length === 0) {
    return [{ proposalId: "", targetFile: "", title: "", applied: false, committed: false, typeCheckPassed: null, message: "No high-confidence pending proposals" }];
  }

  for (const proposal of pendingHighConfidence) {
    if (!canAutoApply(config)) {
      results.push({
        proposalId: proposal.id,
        targetFile: proposal.targetFile,
        title: proposal.title,
        applied: false,
        committed: false,
        typeCheckPassed: null,
        message: `Rate limit reached (${config.maxAutoAppliesPerHour}/hour)`,
      });
      break;
    }

    // Apply via the standard guarded path
    const applyResult = await applyProposal(proposal.id);

    if (!applyResult.success) {
      results.push({
        proposalId: proposal.id,
        targetFile: proposal.targetFile,
        title: proposal.title,
        applied: false,
        committed: false,
        typeCheckPassed: null,
        message: `Apply failed: ${applyResult.message}`,
      });
      continue;
    }

    recordAutoApply();

    // Optional type check
    let typeCheckPassed: boolean | null = null;
    if (config.requireTypeCheck) {
      const tc = runTypeCheck();
      typeCheckPassed = tc.success;

      if (!tc.success) {
        // Rollback: re-write original content
        const filePath = resolveServerFile(proposal.targetFile);
        if (filePath && proposal.originalContent) {
          fs.writeFileSync(filePath, proposal.originalContent, "utf-8");
          proposal.status = "pending"; // Reset status
          saveProposals(store);
        }

        results.push({
          proposalId: proposal.id,
          targetFile: proposal.targetFile,
          title: proposal.title,
          applied: false,
          committed: false,
          typeCheckPassed: false,
          message: `Applied but type check failed — rolled back. Errors: ${tc.errors.slice(0, 3).join("; ")}`,
        });
        continue;
      }
    }

    // Git commit if enabled
    let committed = false;
    if (config.commitToGit) {
      const filePath = resolveServerFile(proposal.targetFile);
      if (filePath) {
        const gitResult = gitCommitSelfImprovement(
          filePath,
          proposal.title,
          config.branchStrategy
        );
        committed = gitResult.success;
      }
    }

    results.push({
      proposalId: proposal.id,
      targetFile: proposal.targetFile,
      title: proposal.title,
      applied: true,
      committed,
      typeCheckPassed,
      message: `Auto-applied successfully${committed ? " and committed to git" : ""}`,
    });

    // v5.50: Self-improvement memory logging.
    // Record every successfully applied proposal as a persistent memory entry.
    // This allows future analysis calls to avoid repeating the same change,
    // and provides a searchable audit trail of all autonomous modifications.
    try {
      const { storeMemory } = await import("./memory.js");
      const memContent = [
        `[Self-Improve] Applied: ${proposal.title}`,
        `File: ${proposal.targetFile}`,
        `Category: ${proposal.category} | Impact: ${proposal.impact}`,
        `Rationale: ${proposal.rationale}`,
        `TypeCheck: ${typeCheckPassed === true ? "passed" : typeCheckPassed === false ? "failed" : "skipped"}`,
        `Committed: ${committed}`,
        `AppliedAt: ${new Date().toISOString()}`,
      ].join("\n");
      storeMemory(memContent, "project", ["self-improve", proposal.category, proposal.targetFile]);
    } catch (memErr) {
      // Non-fatal — memory logging failure should not block the apply result
      console.warn("[SelfImprove] Memory logging failed:", (memErr as Error).message);
    }
  }

  return results;
}

/**
 * Get a summary of auto-apply activity for monitoring.
 */
export function getAutoApplyStatus(): {
  config: AutoApplyConfig;
  recentApplies: number;
  remainingBudget: number;
  pendingHighConfidence: number;
} {
  const config = getAutoApplyConfig();
  const oneHourAgo = Date.now() - 3600_000;
  const recentApplies = autoApplyHistory.filter(t => t >= oneHourAgo).length;
  const store = loadProposals();
  const pendingHighConfidence = store.proposals.filter(
    p => p.status === "pending" && p.impact === "high"
  ).length;

  return {
    config,
    recentApplies,
    remainingBudget: Math.max(0, config.maxAutoAppliesPerHour - recentApplies),
    pendingHighConfidence,
  };
}
