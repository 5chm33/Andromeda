/**
 * selfImprove.ts — v6.28
 *
 * v6.28 RSI Fixes:
 *   A1 — Proposal deduplication: hash(targetFile + title) prevents the same fix
 *        being regenerated every cycle (was 45% of all proposals).
 *   A2 — Confidence scoring: LLM now rates each proposal 0.0–1.0; the
 *        confidenceThreshold filter in autoApplyHighConfidence() actually works.
 *   A3 — Constitution-aware generation: forbidden files and forbidden patterns
 *        from andromeda-constitution.json are injected into the system prompt so
 *        the LLM never generates proposals that will be immediately blocked.
 *   A4 — File-aware generation: the actual current file content is read BEFORE
 *        generating the diff, eliminating hallucinated import paths.
 *   A5 — Env/key validation on startup: warns clearly if no LLM key is present
 *        so the 2% baseline issue (401 on every eval task) is caught immediately.
 *
 * Previous fixes retained:
 *   v5.3  — snippet-only diffs (token-efficient for large files)
 *   v5.22 — guarded apply pipeline (backup → apply → typecheck → rollback)
 *   v5.25 — knowledge base context injection
 *   v5.27 — cross-session learning / impact analysis
 *   v5.50 — auto-apply enabled by default with rate limiter
 *   v6.00 — canonical path resolution (Kimi audit fix)
 *   v6.16 — background DeepSeek provider for cheap analysis cycles
 */

import { smartChunkFile } from "./fileEngineChunking.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { createLogger } from "./logger.js";

const log = createLogger("selfImprove");

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * v6.29: A secondary file change that is part of a multi-file proposal.
 * When a function signature changes, callers in other files must also be updated.
 * All secondary changes are applied atomically with the primary change — if any
 * secondary change fails the entire proposal is rolled back.
 */
export type SecondaryFileChange = {
  targetFile: string;
  originalSnippet: string;
  proposedSnippet: string;
  originalContent: string;
  proposedContent: string;
  rationale: string;
};

export type ImprovementProposal = {
  id: string;
  targetFile: string;
  title: string;
  rationale: string;
  category: "performance" | "reliability" | "security" | "readability" | "feature";
  impact: "high" | "medium" | "low";
  /** v6.28 A2: LLM self-rated confidence 0.0–1.0. Used by the RSI threshold filter. */
  confidence: number;
  diff: string;
  originalSnippet: string;
  proposedSnippet: string;
  originalContent: string;
  proposedContent: string;
  createdAt: number;
  status: "pending" | "approved" | "rejected" | "applied";
  /** v6.29: Optional secondary file changes applied atomically with the primary change. */
  secondaryChanges?: SecondaryFileChange[];
};

type ProposalStore = {
  proposals: ImprovementProposal[];
};

// ─── v6.28 A1: Deduplication hash set ────────────────────────────────────────
// Keyed by "targetFile::title" — prevents the same fix being regenerated every
// cycle. Populated from the persisted store on first load; updated on insert.

const _seenProposalHashes = new Set<string>();

function proposalHash(targetFile: string, title: string): string {
  return `${path.basename(targetFile)}::${title.toLowerCase().trim()}`;
}

function initSeenHashes(store: ProposalStore): void {
  if (_seenProposalHashes.size > 0) return; // already initialised
  for (const p of store.proposals) {
    _seenProposalHashes.add(proposalHash(p.targetFile, p.title));
  }
}

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
  try {
    const store = JSON.parse(fs.readFileSync(p, "utf-8")) as ProposalStore;
    initSeenHashes(store); // v6.28 A1: seed dedup set from persisted store
    return store;
  } catch { return { proposals: [] }; }
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

  if (projectRoot) {
    const canonical = path.join(projectRoot, "server", basename);
    try { if (fs.existsSync(canonical)) return canonical; } catch (err) { log.caught("skip", err); }
    const canonicalTools = path.join(projectRoot, "server", "tools", basename);
    try { if (fs.existsSync(canonicalTools)) return canonicalTools; } catch (err) { log.caught("skip", err); }
    const canonicalSelf = path.join(projectRoot, "server", "self", basename);
    try { if (fs.existsSync(canonicalSelf)) return canonicalSelf; } catch (err) { log.caught("skip", err); }
  }

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

// ─── v6.28 A3: Constitution loader ───────────────────────────────────────────
// Reads andromeda-constitution.json once and caches it.
// Returns the forbidden files list and forbidden patterns list so they can be
// injected into the LLM system prompt BEFORE generation.

let _constitutionForPromptCache: { files: string[]; patterns: string[] } | null = null;

function getConstitutionConstraints(): { files: string[]; patterns: string[] } {
  if (_constitutionForPromptCache) return _constitutionForPromptCache;
  const candidates = [
    path.resolve(getServerDir(), "..", "andromeda-constitution.json"),
    path.resolve(getServerDir(), "..", "..", "andromeda-constitution.json"),
    path.resolve(process.cwd(), "andromeda-constitution.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const c = JSON.parse(fs.readFileSync(p, "utf-8")) as any;
        _constitutionForPromptCache = {
          files: c.forbiddenModifications?.files || [],
          patterns: c.forbiddenModifications?.patterns || [],
        };
        return _constitutionForPromptCache;
      }
    } catch { /* try next */ }
  }
  _constitutionForPromptCache = { files: [], patterns: [] };
  return _constitutionForPromptCache;
}

// ─── v6.28 A5: Env / key validation ──────────────────────────────────────────
// Called once on module load. Logs a clear warning if no LLM key is available
// so the "2% baseline from 401 errors" problem is caught immediately.

(function validateEnvKeys(): void {
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasKimi = !!process.env.KIMI_API_KEY;

  if (!hasDeepSeek && !hasOpenRouter && !hasAnthropic && !hasKimi) {
    log.warn(
      "⚠️  [v6.28 A5] No LLM API key found in environment. " +
      "Set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, or KIMI_API_KEY. " +
      "RSI proposal generation and eval baseline will fail with 401 errors until a key is set."
    );
  } else {
    const active: string[] = [];
    if (hasDeepSeek) active.push("DeepSeek");
    if (hasOpenRouter) active.push("OpenRouter");
    if (hasAnthropic) active.push("Anthropic");
    if (hasKimi) active.push("Kimi");
    log.info(`[v6.28 A5] LLM keys present: ${active.join(", ")} ✓`);
  }
})();

// ─── Unified Diff Generator (v6.33) ──────────────────────────────────────────────
// Uses the `diff` package (Myers algorithm) for proper unified diffs.
// Falls back to the simple line-by-line diff if the package is unavailable.

function generateSimpleDiff(original: string, proposed: string, filename: string): string {
  try {
    // v6.33: Proper Myers unified diff with 3-line context
    const { createTwoFilesPatch } = require("diff");
    const patch = createTwoFilesPatch(
      `a/${filename}`,
      `b/${filename}`,
      original,
      proposed,
      "",
      "",
      { context: 3 }
    );
    return patch.trim();
  } catch {
    // Fallback: simple line-by-line diff
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
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────
// v5.3:  Ask for a specific code SNIPPET change (token-efficient for large files).
// v6.28: A2 — LLM rates its own confidence; A3 — constitution constraints in prompt;
//         A4 — actual file content read before generating diff.

export async function analyzeAndPropose(
  targetFile: string,
  area?: string
): Promise<ImprovementProposal | null> {
  // v6.15: Use active provider key instead of hardcoded DEEPSEEK_API_KEY
  const { getProviderApiKey } = await import("./llmProvider.js");
  const activeModel = process.env.LLM_MODEL || "deepseek";
  const apiKey = getProviderApiKey(activeModel) || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY)");

  // v6.28 A4: Resolve the actual source file path FIRST so we read the real
  // current content — not a stale snapshot — before generating any diff.
  const filePath = resolveServerFile(targetFile);
  if (!filePath) {
    throw new Error(`File '${targetFile}' is not in the list of analyzable files or does not exist.`);
  }

  // v6.28 A4: Read the CURRENT file content from disk (not from any cache).
  const originalContent = fs.readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);

  // v6.28 A1: Dedup check — skip if we already have a pending/applied proposal
  // with the same (file, title) hash. Title is unknown until after LLM call, so
  // we check AFTER parsing but BEFORE saving. The hash set is also checked here
  // against the persisted store to catch cross-restart duplicates.
  const store = loadProposals();
  const existingPendingForFile = store.proposals.filter(
    p => p.targetFile === filename && (p.status === "pending" || p.status === "applied")
  ).length;
  if (existingPendingForFile >= 5) {
    log.info(`[A1 dedup] Skipping ${filename} — already has ${existingPendingForFile} pending/applied proposals`);
    return null;
  }

  // v5.31: Dynamic model-aware analysis budget
  const { getContextWindow: getCtxWindow } = await import("./modelRegistry.js");
  const analysisCharBudget = Math.floor(
    getCtxWindow(process.env.LLM_MODEL || process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat") * 3.5 * 0.4
  );
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

  // v6.31: Build import graph context — find all callers of exported symbols in this file
  // so the LLM can propose secondary changes that update callers automatically.
  let importGraphContext = "";
  try {
    const { findSymbolUsages, getExportedSymbols } = await import("./importGraph.js");
    const exportedSymbols = await getExportedSymbols(filePath);
    if (exportedSymbols.length > 0) {
      const usageLines: string[] = [];
      for (const sym of exportedSymbols.slice(0, 5)) { // limit to 5 symbols to keep prompt size manageable
        const usages = await findSymbolUsages(filePath, sym);
        if (usages.length > 0) {
          usageLines.push(`  - ${sym}: used in ${usages.slice(0, 3).map((u: string) => path.basename(u)).join(", ")}${usages.length > 3 ? ` (+${usages.length - 3} more)` : ""}`);
        }
      }
      if (usageLines.length > 0) {
        importGraphContext = `\n\nIMPORT GRAPH — exported symbols from this file and where they are used:\n${usageLines.join("\n")}\nIf you change a function signature, add secondaryChanges entries for each caller file.`;
      }
    }
  } catch {
    // importGraph not available — proceed without it
  }

  // v6.28 A3: Load constitution constraints and inject into the system prompt.
  // This means the LLM will never propose touching forbidden files or inserting
  // forbidden patterns — so proposals won't be immediately blocked by the guard.
  const constitution = getConstitutionConstraints();
  const constitutionBlock = constitution.files.length > 0 || constitution.patterns.length > 0
    ? `\n\nCONSTITUTION CONSTRAINTS (you MUST NOT violate these):\n` +
      (constitution.files.length > 0
        ? `- NEVER propose changes to these files: ${constitution.files.join(", ")}\n`
        : "") +
      (constitution.patterns.length > 0
        ? `- NEVER include these patterns in proposedSnippet: ${constitution.patterns.join(" | ")}\n`
        : "")
    : "";

  // v6.16: Use cheap background provider (DeepSeek) for analysis cycles.
  // v6.28 A2: Added "confidence" field to the JSON schema so the LLM self-rates
  //           each proposal 0.0–1.0. This makes the confidenceThreshold filter work.
  // v6.33: Multi-model routing — route by proposal area:
  //   security / architecture → Claude via OpenRouter (best reasoning)
  //   performance / feature    → Kimi k2.6 (best coding model)
  //   reliability / readability → DeepSeek (cheap, reliable)
  function pickProviderForArea(area?: string): string | undefined {
    if (!area) return undefined; // let backgroundSimpleCompletion use its default
    const a = area.toLowerCase();
    if (a.includes("security") || a.includes("architect") || a.includes("design")) {
      return process.env.OPENROUTER_API_KEY ? "anthropic" : undefined;
    }
    if (a.includes("performance") || a.includes("feature") || a.includes("optim")) {
      return process.env.KIMI_API_KEY ? "kimi" : undefined;
    }
    // reliability, readability, general → DeepSeek
    return process.env.DEEPSEEK_API_KEY ? "deepseek" : undefined;
  }
  const { simpleChatCompletion } = await import("./llmProvider.js");
  const routedProvider = pickProviderForArea(area);
  const rawContent = await simpleChatCompletion(
    [
      {
        role: "system",
        content: `You are an expert TypeScript software engineer performing a targeted code improvement.
You will receive source code and must identify the SINGLE BEST improvement to make.
${knowledgeContext ? `\nArchitecture decisions and known issues for this file:\n${knowledgeContext}` : ""}${previousAttempts}${constitutionBlock}${importGraphContext}

CRITICAL: Return ONLY a JSON object. No markdown. No explanation outside the JSON.
The JSON must contain:
- "title": short title (max 10 words)
- "rationale": 2 sentences explaining the improvement
- "category": one of: performance, reliability, security, readability, feature
- "impact": one of: high, medium, low
- "confidence": a float 0.0–1.0 representing how confident you are this improvement is correct, safe, and will pass a TypeScript type-check (1.0 = certain, 0.5 = unsure)
- "originalSnippet": the EXACT lines of code to replace (copy verbatim from the file, max 30 lines)
- "proposedSnippet": the improved replacement code (same approximate length)
- "secondaryChanges": (optional) array of {"file": "relative/path.ts", "originalSnippet": "...", "proposedSnippet": "..."} for caller files that must be updated atomically

The originalSnippet MUST be an exact substring of the provided file content.
Keep both snippets SHORT and focused. Do not rewrite the whole file.
Do NOT repeat previous failed attempts.
Do NOT include any forbidden patterns listed above.`,
      },
      {
        role: "user",
        content: `Analyze this TypeScript file and propose the single best improvement${area ? ` focusing on: ${area}` : ``}.\n\nFile: ${filename}\n\n\`\`\`typescript\n${contentForAnalysis}\n\`\`\`\n\nReturn ONLY valid JSON.`,
      },
    ],
    { maxTokens: 2000, temperature: 0.3, providerId: routedProvider },
  );

  if (!rawContent) throw new Error("AI returned an empty response");

  const jsonStr = rawContent
    .replace(/^```json?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: {
    title: string;
    rationale: string;
    category: ImprovementProposal["category"];
    impact: ImprovementProposal["impact"];
    confidence?: number;
    originalSnippet: string;
    proposedSnippet: string;
  };

  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
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

  // v6.28 A1: Dedup check on title — skip if we already have this exact proposal
  const hash = proposalHash(filename, parsed.title);
  if (_seenProposalHashes.has(hash)) {
    log.info(`[A1 dedup] Skipping duplicate proposal for ${filename}: "${parsed.title}"`);
    return null;
  }

  // v6.28 A2: Normalise confidence to 0.0–1.0 (LLM sometimes returns 0–100)
  let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.7;
  if (confidence > 1.0) confidence = confidence / 100;
  confidence = Math.max(0, Math.min(1, confidence));

  // v6.28 A4: Apply the snippet replacement using the CURRENT file content
  // (already read from disk above — not a stale snapshot).
  let proposedContent: string;
  if (originalContent.includes(parsed.originalSnippet)) {
    proposedContent = originalContent.replace(parsed.originalSnippet, parsed.proposedSnippet);
  } else {
    // Fuzzy match on trimmed lines
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
      // Snippet not found — lower confidence and still save for display
      confidence = Math.min(confidence, 0.3);
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
    confidence,
    diff,
    originalSnippet: parsed.originalSnippet,
    proposedSnippet: parsed.proposedSnippet,
    originalContent,
    proposedContent,
    createdAt: Date.now(),
    status: "pending",
  };

  // v6.28 A1: Register in dedup hash set before saving
  _seenProposalHashes.add(hash);

  store.proposals.push(proposal);
  saveProposals(store);

  log.info(`[v6.28] New proposal for ${filename}: "${proposal.title}" (confidence=${confidence.toFixed(2)}, impact=${proposal.impact})`);

  return proposal;
}

export async function applyProposal(proposalId: string): Promise<{ success: boolean; message: string }> {
  const store = loadProposals();
  const proposal = store.proposals.find(p => p.id === proposalId);

  if (!proposal) return { success: false, message: "Proposal not found" };
  if (proposal.status !== "pending") return { success: false, message: `Proposal is already ${proposal.status}` };

  // v5.48: Track retry count to prevent infinite retry loops
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

  // v5.53: Git pre-apply snapshot
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
  try {
    const { createRollbackPoint } = await import("./selfRollback") as any;
    createRollbackPoint([proposal.targetFile], `Before proposal ${proposalId}: ${proposal.title || "self-improvement"}`, "self-improve");
  } catch (err) { log.caught("non-fatal", err); }

  try {
    const { guardedApply } = await import("./selfImproveGuard");
    const guardResult = await guardedApply(proposalId);

    if (guardResult.success) {
      proposal.status = "applied";

      // v6.29: Apply secondary file changes atomically.
      // If any secondary change fails, roll back ALL secondary writes and mark
      // the proposal as rejected so the primary change is also reverted.
      if (proposal.secondaryChanges && proposal.secondaryChanges.length > 0) {
        const writtenSecondary: Array<{ path: string; original: string }> = [];
        let secondaryFailed = false;
        let secondaryError = "";

        for (const change of proposal.secondaryChanges) {
          const secPath = resolveServerFile(change.targetFile);
          if (!secPath) {
            secondaryFailed = true;
            secondaryError = `Secondary file not found: ${change.targetFile}`;
            break;
          }
          try {
            const currentContent = fs.readFileSync(secPath, "utf-8");
            writtenSecondary.push({ path: secPath, original: currentContent });
            fs.writeFileSync(secPath, change.proposedContent, "utf-8");
            log.info(`[v6.29 multi-file] Applied secondary change to ${change.targetFile}`);
          } catch (secErr) {
            secondaryFailed = true;
            secondaryError = `Failed to write ${change.targetFile}: ${(secErr as Error).message}`;
            break;
          }
        }

        if (secondaryFailed) {
          // Roll back all secondary writes
          for (const { path: p, original } of writtenSecondary) {
            try { fs.writeFileSync(p, original, "utf-8"); } catch { /* best effort */ }
          }
          // Also roll back the primary change
          if (proposal.originalContent) {
            try { fs.writeFileSync(filePath, proposal.originalContent, "utf-8"); } catch { /* best effort */ }
          }
          proposal.status = "rejected" as any;
          (proposal as any)._failReason = `Multi-file rollback: ${secondaryError}`;
          saveProposals(store);
          return { success: false, message: `Multi-file apply rolled back: ${secondaryError}` };
        }
      }

      saveProposals(store);

      try {
        const { recordAppliedSuggestion } = await import("./skillGraph.js");
        recordAppliedSuggestion();
      } catch { /* skill graph optional */ }

      try {
        const { recordMetric } = await import("./selfMonitor.js");
        recordMetric("self_modify_success", 1, `Applied: ${proposal.title}`);
        recordMetric("proposal_quality", 1, `Accepted: ${proposal.targetFile}`);
      } catch (err) { log.caught("non-fatal", err); }

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

      try {
        const { startHealthWatch } = await import("./selfRollback") as any;
        startHealthWatch(proposalId);
      } catch (err) { log.caught("non-fatal", err); }

      try {
        const { recordSystemLearning } = await import("./systemMemory");
        recordSystemLearning({
          category: "modification",
          title: `Applied: ${proposal.title}`,
          content: `Successfully applied improvement to ${proposal.targetFile}: ${proposal.title}`,
          context: `category: ${proposal.category || "unknown"}, impact: ${proposal.impact || "unknown"}, confidence: ${(proposal.confidence ?? 0).toFixed(2)}`,
          confidence: 0.9,
          applicableTo: [proposal.targetFile],
        });
      } catch (err) { log.caught("non-fatal", err); }

      return {
        success: true,
        message: guardResult.message || `Applied successfully via guard. Backup: ${guardResult.backup?.id || "created"}`,
      };
    } else {
      try {
        const { recordMetric } = await import("./selfMonitor.js");
        recordMetric("self_modify_success", 0, `Rejected: ${proposal.title}`);
        recordMetric("self_modify_rollback", 1, `Guard rejected: ${proposal.targetFile}`);
        recordMetric("proposal_quality", 0, `Rejected: ${proposal.targetFile}`);
      } catch (err) { log.caught("non-fatal", err); }

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
    (proposal as any)._retryCount = ((proposal as any)._retryCount || 0) + 1;
    if ((proposal as any)._retryCount >= 3) {
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = `Guard unavailable after ${(proposal as any)._retryCount} attempts: ${(guardErr as Error).message}`;
      console.warn(`[SelfImprove] Proposal ${proposalId} permanently rejected after ${(proposal as any)._retryCount} guard failures`);
    } else {
      console.warn("[SelfImprove] Guard unavailable. Queuing proposal for retry:", (guardErr as Error).message);
      proposal.status = "pending" as any;
    }
    saveProposals(store);

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
  confidenceThreshold: number; // 0-100, default 75
  maxAutoAppliesPerHour: number; // safety limit
  requireTypeCheck: boolean; // must pass tsc before committing
  commitToGit: boolean; // auto-commit applied changes
  branchStrategy: "main" | "feature-branch"; // commit to main or create feature branches
}

// v5.50: Auto-apply is now ENABLED by default.
const DEFAULT_AUTO_APPLY_CONFIG: AutoApplyConfig = {
  enabled: true,
  confidenceThreshold: 75,
  maxAutoAppliesPerHour: 8,
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
  merged.confidenceThreshold = Math.max(50, Math.min(100, merged.confidenceThreshold));
  merged.maxAutoAppliesPerHour = Math.max(1, Math.min(20, merged.maxAutoAppliesPerHour));
  fs.writeFileSync(getAutoApplyConfigPath(), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

// ─── Auto-Apply Rate Limiter ─────────────────────────────────────────────────

const autoApplyHistory: number[] = [];

function canAutoApply(config: AutoApplyConfig): boolean {
  const oneHourAgo = Date.now() - 3600_000;
  while (autoApplyHistory.length > 0 && autoApplyHistory[0] < oneHourAgo) {
    autoApplyHistory.shift();
  }
  return autoApplyHistory.length < config.maxAutoAppliesPerHour;
}

function recordAutoApply(): void {
  autoApplyHistory.push(Date.now());
}

// ─── GitOps Integration ──────────────────────────────────────────────────────

function gitCommitSelfImprovement(
  targetFile: string,
  summary: string,
  branchStrategy: "main" | "feature-branch"
): { success: boolean; message: string } {
  const cwd = path.resolve(getServerDir(), "..");
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Andromeda AI",
    GIT_AUTHOR_EMAIL: "andromeda@local",
    GIT_COMMITTER_NAME: "Andromeda AI",
    GIT_COMMITTER_EMAIL: "andromeda@local",
  };

  try {
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      execSync("git init", { cwd, env: gitEnv, encoding: "utf-8" });
      execSync("git add -A", { cwd, env: gitEnv, encoding: "utf-8" });
      execSync('git commit --allow-empty -m "Initial commit by Andromeda"', { cwd, env: gitEnv, encoding: "utf-8" });
    }

    if (branchStrategy === "feature-branch") {
      const branchName = `self-improve/${Date.now()}-${path.basename(targetFile).replace(/\./g, "-")}`;
      try {
        execSync(`git checkout -b ${branchName}`, { cwd, env: gitEnv, encoding: "utf-8" });
      } catch {
        // Branch might already exist
      }
    }

    const relativeFile = path.relative(cwd, targetFile);
    execSync(`git add "${relativeFile}"`, { cwd, env: gitEnv, encoding: "utf-8" });

    const testFile = targetFile.replace(/\.(ts|py)$/, `.test.$1`);
    if (fs.existsSync(testFile)) {
      const relativeTest = path.relative(cwd, testFile);
      execSync(`git add "${relativeTest}"`, { cwd, env: gitEnv, encoding: "utf-8" });
    }

    const commitMsg = `Andromeda self-improvement: ${path.basename(targetFile)} — ${summary}`.replace(/"/g, '\\"');
    const result = execSync(`git commit -m "${commitMsg}"`, { cwd, env: gitEnv, encoding: "utf-8" });

    return { success: true, message: result.trim() };
  } catch (err: any) {
    const errMsg = err.stderr?.toString?.() || err.message || String(err);
    if (errMsg.includes("nothing to commit")) {
      return { success: true, message: "No changes to commit (already committed)" };
    }
    return { success: false, message: `Git commit failed: ${errMsg}` };
  }
}

// ─── TypeScript Check (for auto-apply safety) ────────────────────────────────

function runTypeCheck(): { success: boolean; errors: string[] } {
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
 *
 * v6.28: Uses the LLM-rated `confidence` field (0.0–1.0) directly when available,
 * falling back to the heuristic scoreProposal() for legacy proposals without it.
 * The confidenceThreshold config value is now compared against a 0–100 scale in
 * both cases (confidence * 100 for new proposals, raw score for legacy ones).
 */
export async function autoApplyHighConfidence(): Promise<AutoApplyResult[]> {
  const config = getAutoApplyConfig();
  const results: AutoApplyResult[] = [];

  if (!config.enabled) {
    return [{ proposalId: "", targetFile: "", title: "", applied: false, committed: false, typeCheckPassed: null, message: "Auto-apply is disabled" }];
  }

  const store = loadProposals();

  function scoreProposal(p: ImprovementProposal): number {
    // v6.28 A2: Use LLM confidence when available (0.0–1.0 → 0–100)
    if (typeof p.confidence === "number" && p.confidence > 0) {
      return Math.round(p.confidence * 100);
    }
    // Legacy heuristic for proposals generated before v6.28
    let score = 0;
    if (p.impact === "high") score += 40;
    else if (p.impact === "medium") score += 20;
    else score += 10;
    if (p.category === "reliability") score += 25;
    else if (p.category === "security") score += 30;
    else if (p.category === "performance") score += 20;
    else if (p.category === "readability") score += 15;
    else score += 10;
    const diffLines = (p.diff || "").split("\n").length;
    if (diffLines < 10) score += 20;
    else if (diffLines < 30) score += 10;
    else score += 5;
    if (p.proposedContent && p.proposedContent.length < p.originalContent.length * 0.5) {
      score -= 30;
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

    let typeCheckPassed: boolean | null = null;
    if (config.requireTypeCheck) {
      const tc = runTypeCheck();
      typeCheckPassed = tc.success;

      if (!tc.success) {
        const filePath = resolveServerFile(proposal.targetFile);
        if (filePath && proposal.originalContent) {
          fs.writeFileSync(filePath, proposal.originalContent, "utf-8");
          proposal.status = "pending";
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

    let committed = false;
    if (config.commitToGit) {
      const filePath = resolveServerFile(proposal.targetFile);
      if (filePath) {
        const gitResult = gitCommitSelfImprovement(filePath, proposal.title, config.branchStrategy);
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

    try {
      const { storeMemory } = await import("./memory.js");
      const memContent = [
        `[Self-Improve] Applied: ${proposal.title}`,
        `File: ${proposal.targetFile}`,
        `Category: ${proposal.category} | Impact: ${proposal.impact} | Confidence: ${(proposal.confidence ?? 0).toFixed(2)}`,
        `Rationale: ${proposal.rationale}`,
        `TypeCheck: ${typeCheckPassed === true ? "passed" : typeCheckPassed === false ? "failed" : "skipped"}`,
        `Committed: ${committed}`,
        `AppliedAt: ${new Date().toISOString()}`,
      ].join("\n");
      storeMemory(memContent, "project", ["self-improve", proposal.category, proposal.targetFile]);
    } catch (memErr) {
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
    p => p.status === "pending" && (p.confidence ?? 0) >= config.confidenceThreshold / 100
  ).length;

  return {
    config,
    recentApplies,
    remainingBudget: Math.max(0, config.maxAutoAppliesPerHour - recentApplies),
    pendingHighConfidence,
  };
}
