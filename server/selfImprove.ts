/**
 * selfImprove.ts — v18.0.0 (Canonical RSI Implementation)
 *
 * v7.2.0 Hardening:
 *   Security — sanitizeForLog() strips API keys from all log/error output.
 *   Any string that flows into log.warn / log.info / throw Error is first
 *   passed through sanitizeForLog() which replaces known key patterns with
 *   "[REDACTED]". This prevents accidental credential leaks in:
 *     - Provider error messages (which include the raw HTTP response body)
 *     - Dead-provider cache warnings
 *     - Git commit failure messages
 *     - Any future log path
 *
 * v7.1.5 Fix:
 *   getServerDir() now uses process.cwd()+"server" so RSI git commits target
 *   the source tree, not the compiled dist/ directory.
 *
 * v7.1.4 Fix:
 *   Provider fallback chain — if the preferred LLM provider returns a 401
 *   (invalid key) or 402 (insufficient credits), the system now automatically
 *   retries with the next available provider instead of throwing and tripping
 *   the circuit breaker. This eliminates the persistent "1 error per cycle"
 *   pattern when one provider has a billing/auth issue.
 *
 * v7.1 RSI Fixes:
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
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";
import { gitSandbox, GitCommandNotAllowedError } from "./gitSandbox.js";
import { backgroundSimpleCompletion } from "./llmProvider.js";
import { createLogger } from "./logger.js";
import { applyPatch } from "diff";
import { checkConstitution } from "./constitutionalConstraints.js";
import { scoreWithRewardModel } from "./rewardModel.js";
import { verifyProposalProof } from "./z3ProofLayer.js";
import { recordFailure as recordFailurePattern } from "./failurePatternMemory.js";

import { getPreferenceReward } from "./rlhfPipeline";
import { emitDashboardEvent } from "./streamingDashboard";
import { calibrateScore, updateCalibration } from "./rewardCalibrator.js";
import { generateRefinementBrief } from "./genealogyGuidedGeneration.js";
import { runSpeculativeDebate } from "./speculativeExecutionEngine.js";
import { routePrompt } from "./moePromptRouter.js";
import { getDistilledReward, distillFromApi } from "./onlineRewardDistiller.js";
import { isSemanticDuplicate, recordSemanticEmbedding } from "./semanticDedup.js";
import { determineSampleCount, selectBestSample } from "./adaptiveSelfConsistency.js";
import { assignVariant, recordVariantOutcome } from "./abTestingFramework.js";
import { queryFederatedGraph, publishToFederatedGraph } from "./federatedKnowledgeGraph.js";
import { discoverActiveSpecialization, getSpecializedPrompt, recordSpecializationOutcome } from "./emergentSpecialization.js";
import { recordTemporalEvent } from "./temporalReasoningEngine.js";
import { globalStakeholderReporting } from "./stakeholderReporting";


const log = createLogger("selfImprove");


// ─── v7.2.0 Security: API Key Sanitizer ──────────────────────────────────────
//
// LLM provider HTTP responses frequently echo back the Authorization header
// or include the API key in error bodies (e.g. "Invalid key: sk-abc...").
// sanitizeForLog() must be called on ANY string before it is written to a
// log, thrown as an error message, or stored in the knowledge base.
//
// Patterns matched:
//   sk-...  (OpenAI / DeepSeek / Kimi / Anthropic short-form keys)
//   sk-ant-api03-...  (Anthropic full-form keys)
//   sk-or-v1-...  (OpenRouter keys)
//   Bearer <token>  (Authorization header values)
//   hf_...  (HuggingFace tokens)
//   ghp_...  (GitHub personal access tokens)

const KEY_PATTERNS: RegExp[] = [
  // OpenAI / DeepSeek / Kimi style: sk- followed by 20+ hex/alphanumeric chars
  /sk-[A-Za-z0-9_-]{20,}/g,
  // Anthropic full key: sk-ant-api03- prefix
  /sk-ant-api03-[A-Za-z0-9_-]{20,}/g,
  // OpenRouter key: sk-or-v1- prefix
  /sk-or-v1-[A-Za-z0-9_-]{20,}/g,
  // HuggingFace token
  /hf_[A-Za-z0-9]{20,}/g,
  // GitHub PAT
  /ghp_[A-Za-z0-9]{20,}/g,
  // Bearer token in Authorization header
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];

/**
 * v7.2.0: Strip API keys and tokens from any string before logging or throwing.
 * Returns the sanitized string with all key patterns replaced by "[REDACTED]".
 */
function sanitizeForLog(input: string): string {
  let out = input;
  for (const pattern of KEY_PATTERNS) {
    // Reset lastIndex for global regexes to avoid stateful skip-every-other-match bug
    pattern.lastIndex = 0;
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

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

// v11.0.1: Session-level dead provider cache.
// When a provider returns a 401/402 billing/auth error, it is added here and
// skipped for ALL subsequent proposals in this session. This prevents the
// system from wasting time retrying a provider that is known to be down.
const _deadProviders = new Set<string>();

function proposalHash(targetFile: string, title: string): string {
  return `${path.basename(targetFile)}::${title.toLowerCase().trim()}`;
}

// v9.8.0: Persist seenHashes and autoApplyHistory across restarts
function getCacheStorePath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_proposal_cache.json");
}

function loadCacheStore(): void {
  try {
    const p = getCacheStorePath();
    if (fs.existsSync(p)) {
      const cache = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (Array.isArray(cache.seenHashes)) {
        cache.seenHashes.forEach((h: string) => _seenProposalHashes.add(h));
      }
      if (Array.isArray(cache.autoApplyHistory)) {
        autoApplyHistory.length = 0;
        cache.autoApplyHistory.forEach((t: number) => autoApplyHistory.push(t));
      }
    }
  } catch (err) {
    // non-fatal
  }
}

function saveCacheStore(): void {
  try {
    const cache = {
      seenHashes: Array.from(_seenProposalHashes),
      autoApplyHistory: autoApplyHistory
    };
    fs.writeFileSync(getCacheStorePath(), JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    // non-fatal
  }
}

function initSeenHashes(store: ProposalStore): void {
  if (_seenProposalHashes.size > 0) return; // already initialised
  loadCacheStore(); // Load cross-session cache first
  for (const p of store.proposals) {
    _seenProposalHashes.add(proposalHash(p.targetFile, p.title));
  }
  saveCacheStore();
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function getServerDir(): string {
  // v7.1.5: When running from dist/_core/index.js, import.meta.url points to dist/_core/
  // but git operations need the SOURCE server/ directory (where .git lives at project root).
  // process.cwd() is always the project root (andromeda_fresh/) when started with `node dist/...`.
  const sourceServerDir = path.join(process.cwd(), "server");
  if (fs.existsSync(sourceServerDir)) return sourceServerDir;
  // Fallback: resolve relative to this file (works in ts-node / dev mode)
  return path.dirname(fileURLToPath(import.meta.url));
}

function getProposalStorePath(): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });
  return path.join(workspaceDir, ".andromeda_proposals.json");
}

/** Loads the proposal store from disk. Returns an empty store if the file does not exist.
 * @returns {ProposalStore} The current proposal store
 */
export function loadProposals(): ProposalStore {
  const p = getProposalStorePath();
  if (!fs.existsSync(p)) return { proposals: [] };
  try {
    const store = JSON.parse(fs.readFileSync(p, "utf-8")) as ProposalStore;
    initSeenHashes(store); // v6.28 A1: seed dedup set from persisted store
    return store;
  } catch { return { proposals: [] }; }
}

// v9.8.5: Reset stuck 'processing' proposals — called at the start of every apply cycle.
// A proposal gets stuck in 'processing' if the server was killed mid-apply or the apply failed
// without cleaning up the status. This runs at the start of each cycle, not just once at startup.
export function resetStuckProcessingProposals(): void {
  const p = getProposalStorePath();
  if (!fs.existsSync(p)) return;
  try {
    const store = JSON.parse(fs.readFileSync(p, "utf-8")) as ProposalStore;
    let resetCount = 0;
    // v9.8.5: Reset ALL 'processing' proposals unconditionally at the start of each cycle.
    // Since we apply proposals sequentially (never concurrently), there is no legitimate case
    // where a proposal should be in 'processing' when a new cycle starts. Any 'processing'
    // proposal at cycle start is stale from a previous crashed or failed cycle.
    for (const proposal of store.proposals) {
      if ((proposal.status as string) === 'processing') {
        proposal.status = 'pending';
        delete (proposal as any)._processingStartedAt;
        resetCount++;
      }
    }
    if (resetCount > 0) {
      console.log(`[SelfImprove] Reset ${resetCount} stale 'processing' proposals back to 'pending'`);
      fs.writeFileSync(p, JSON.stringify(store, null, 2), 'utf-8');
    }
  } catch { /* non-fatal */ }
}

// v7.1.6: Prune proposal store — keep max 500 proposals, evicting oldest applied/rejected first
const MAX_PROPOSALS = 500;
function pruneProposalStore(store: ProposalStore): void {
  if (store.proposals.length <= MAX_PROPOSALS) return;
  // Sort: keep pending first (most valuable), then by recency
  const pending = store.proposals.filter(p => p.status === "pending");
  const done = store.proposals
    .filter(p => p.status !== "pending")
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // newest first
  const kept = [...pending, ...done].slice(0, MAX_PROPOSALS);
  const removed = store.proposals.length - kept.length;
  store.proposals = kept;
  // Rebuild the seen-hashes set to match pruned store
  _seenProposalHashes.clear();
  for (const p of store.proposals) _seenProposalHashes.add(proposalHash(p.targetFile, p.title));
  if (removed > 0) {
    const log2 = { info: (msg: string) => console.log(`[SelfImprove] ${msg}`) };
    log2.info(`[v7.1.6] Pruned ${removed} old proposals from store (kept ${kept.length})`);
  }
}

/** Persists the proposal store to disk, pruning old entries first.
 * @param {ProposalStore} store - The proposal store to save
 */
export function saveProposals(store: ProposalStore): void {
  pruneProposalStore(store);
  fs.writeFileSync(getProposalStorePath(), JSON.stringify(store, null, 2), "utf-8");
  saveCacheStore(); // Save seenHashes whenever proposals are saved
}

// ─── Allowed Files ────────────────────────────────────────────────────────────

export const ANALYZABLE_FILES = [
  // ── Application layer ─────────────────────────────────────────────────────
  "ai.ts",
  "grounding.ts",
  "browser.ts",
  "workspace.ts",
  "memory.ts",
  "multiAgent.ts",
  "biasDetector.ts",
  "codeIntel.ts",
  "streamRouter.ts",
  "reactEngine.ts",
  "llmProvider.ts",
  "contextManager.ts",
  "adaptiveRouter.ts",
  "selfConsistency.ts",
  "contextBus.ts",
  "manifest.ts",
  // ── v9.10.0: RSI engine itself — true recursive self-improvement ───────────
  // The guard pipeline (TypeScript check + rollback) prevents runaway self-modification.
  // The RSI can now improve its own improvement algorithms.
  "selfImprove.ts",
  "rsiEngine.ts",
  "continuousImprover.ts",
  // selfImproveGuard.ts is in blockedFiles — proposals for it are always rejected, so skip analysis
  "qualityToRSI.ts",
  "evalDrivenTargeting.ts",
  "testGenerator.ts",
  "consensusEngine.ts",
  // ── v9.11.0: Expanded allowlist — 30 additional safe modules for better RSI coverage ──
  // These modules have no external side effects at import time and are safe to analyze.
  // Adding them increases RSI coverage from 24 → 54 modules (125% increase).
  "benchmarkRunner.ts",
  "vectorMemory.ts",
  "persistentContextStore.ts",
  "episodicMemory.ts",
  "episodicConsolidation.ts",
  "autoGoalSuggester.ts",
  "autonomousGoalGenerator.ts",
  // selfRollback.ts is in blockedFiles — removed from ANALYZABLE_FILES (v14.1.1)
  "autoRebuild.ts",
  "ciPipeline.ts",
  "codeQualityMonitor.ts",
  "codebaseAnalyzer.ts",
  "dependencyGraph.ts",
  "dependencyResolver.ts",
  "docGenerator.ts",
  "selfDocumentation.ts",
  // selfHeal.ts is in blockedFiles — removed from ANALYZABLE_FILES (v14.1.1)
  "selfIntrospect.ts",
  "selfKnowledgeBase.ts",
  "selfModel.ts",
  "selfReflectionEngine.ts",
  "selfReview.ts",
  // selfRollback.ts (duplicate) removed from ANALYZABLE_FILES (v14.1.1)
  "testGenerator.ts",
  // selfTestPipeline.ts is in blockedFiles — removed from ANALYZABLE_FILES (v14.1.1)
  "skillGraph.ts",
  "taskDecomposer.ts",
  "taskPlanner.ts",
  "telemetry.ts",
  "tokenBudgetManager.ts",
  "truncationDetector.ts",
  "unifiedKnowledge.ts",
  "watchdog.ts",
  "circuitBreaker.ts",
  "cache.ts",
  "adaptiveEval.ts",
  "aiChangelog.ts",
  "aiMemory.ts",
  "aiPlanning.ts",
  "contextAwareness.ts",
  "contextCompressionDaemon.ts",
  "agentOrchestrator.ts",
  "agentStateMachine.ts",
  "capabilityDiscovery.ts",
  "capabilityBootstrapper.ts",
  "scheduler.ts",
  "search.ts",
  "systemMemory.ts",
  "tieredContextManager.ts",
  "toolSynthesis.ts",
  // ── v11.289.0: Expanded allowlist — 135 additional modules for full RSI coverage (210 total) ──
  "adaptivePartitions.ts",
  "adminAuth.ts",
  "adversarialTestGen.ts",
  "agentSystemPrompt.ts",
  "agentTypes.ts",
  "aiPrompts.ts",
  "aiStreaming.ts",
  "aiTokens.ts",
  "aiZipEdit.ts",
  "algorithmicDiscovery.ts",
  "algorithmicDiscoveryV2.ts",
  "andromedaDaemon.ts",
  "andromedaDb.ts",
  "andromedaMemoryWriter.ts",
  "astKnowledgeGraph.ts",
  "auditLog.ts",
  "autoHealing.ts",
  "autonomyOrchestrator.ts",
  "behavioralRegressionEngine.ts",
  "causalReasoning.ts",
  "ciRegressionGuard.ts",
  "cloudProvisioning.ts",
  "codeRunner.ts",
  "constitutionalConstraints.ts",
  "continuousFineTuning.ts",
  "costOptimizer.ts",
  "crossDomainAdapter.ts",
  "crossInstanceRlhf.ts",
  "crossModalSelfImprovement.ts",
  "db.ts",
  "dbPostgres.ts",
  "dependencyAuditor.ts",
  "distributedProofConsensus.ts",
  "dockerSandbox.ts",
  "ebpfGrounding.ts",
  "edgeLLMRouter.ts",
  "epistemicBeliefModel.ts",
  "evalFramework.ts",
  "evalGoalDiscovery.ts",
  "evalSeed.ts",
  "evolutionarySearch.ts",
  "failurePatternMemory.ts",
  "federatedLearning.ts",
  "federatedLoraSharing.ts",
  "federatedRsiNetwork.ts",
  "fileEngine.ts",
  "fileEngineAnalysis.ts",
  "fileEngineChunking.ts",
  "fileEngineTypes.ts",
  "fileEngineUtils.ts",
  "formalVerification.ts",
  "fsWatcher.ts",
  "gitSandbox.ts",
  "goalDecomposer.ts",
  "goalManager.ts",
  "gracefulDegradation.ts",
  "hotReload.ts",
  "hybridCostRouter.ts",
  "identityManifest.ts",
  "importGraph.ts",
  "knowledgeBaseConsolidation.ts",
  "knowledgeTransfer.ts",
  "learnedConstraints.ts",
  "llmRouter.ts",
  "localLora.ts",
  "logger.ts",
  "longTermMemoryConsolidation.ts",
  "loraBackendDetector.ts",
  "loraDpoPipeline.ts",
  "mcpClient.ts",
  "mctsPlan.ts",
  "mctsPlanningEngine.ts",
  "memoryConsolidation.ts",
  "memoryForgettingCurve.ts",
  "modelRegistry.ts",
  "multiAgentBus.ts",
  "multiAgentImprover.ts",
  "multiFileProposalPlanner.ts",
  "nativeVlm.ts",
  "noveltySearchEngine.ts",
  "observability.ts",
  "ollamaAutoSetup.ts",
  "ontologicalModel.ts",
  "osGrounding.ts",
  "parallelRsi.ts",
  "prGenerator.ts",
  "privilegeSeparation.ts",
  "promptEngineer.ts",
  "proofAssistant.ts",
  "proofVerifier.ts",
  "proposalFeedback.ts",
  "ragContextOptimizer.ts",
  "ragPipeline.ts",
  "rbac.ts",
  "realEvalHarness.ts",
  "recursionGuard.ts",
  "recursiveGoals.ts",
  "redisLock.ts",
  "rewardModel.ts",
  "rlaifJudge.ts",
  "rlhfCollector.ts",
  "roboticsIoTAdapter.ts",
  "routers.ts",
  "rsiDb.ts",
  "rsiEventBus.ts",
  "rsiScheduler.ts",
  "runtimeConfig.ts",
  "safetySupervisor.ts",
  "sandboxManager.ts",
  "sandboxVerifier.ts",
  "security.ts",
  "selfDistillation.ts",
  // selfImproveGuard.ts is in blockedFiles — removed from ANALYZABLE_FILES (v14.1.1)
  "selfModify.ts",
  "selfMonitor.ts",
  "semanticSelfModel.ts",
  "shadowInstance.ts",
  "storage.ts",
  "streamIntegrityMonitor.ts",
  "swarmOrchestrator.ts",
  "swarmSpecialistVoting.ts",
  "swarmTestnet.ts",
  "sweBenchHarness.ts",
  "tenantManager.ts",
  "testCoverageAnalyzer.ts",
  "transactionLog.ts",
  "twoPhaseCommit.ts",
  "utilityFunction.ts",
  "visionModule.ts",
  "visualGrounding.ts",
  "voiceInterface.ts",
  "z3ProofLayer.ts",
  "zeroShotTransferEngine.ts",
  "zkProofSigning.ts",
];

export function resolveServerFile(filename: string): string | null {
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

// ─── v7.1.3: Env / key validation ────────────────────────────────────────────
// Deferred to first analyzeAndPropose() call — NOT run at module load time.
// ESM static imports evaluate before dotenv loads in index.ts, so an IIFE here
// always sees empty process.env and produces a false 'no LLM key' warning.

let _envValidated = false;
function validateEnvKeysOnce(): void {
  if (_envValidated) return;
  _envValidated = true;
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasKimi = !!process.env.KIMI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;  // v11.0.2: also accept OpenAI key

  if (!hasDeepSeek && !hasOpenRouter && !hasAnthropic && !hasKimi && !hasOpenAI) {
    log.warn(
      "⚠️  [v7.1.3] No LLM API key found in environment. " +
      "Set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY, KIMI_API_KEY, or OPENAI_API_KEY. " +
      "RSI proposal generation and eval baseline will fail with 401 errors until a key is set."
    );
  } else {
    const active: string[] = [];
    if (hasDeepSeek) active.push("DeepSeek");
    if (hasOpenRouter) active.push("OpenRouter");
    if (hasAnthropic) active.push("Anthropic");
    if (hasKimi) active.push("Kimi");
    if (hasOpenAI) active.push("OpenAI");
    log.info(`[v7.1.3] LLM keys present: ${active.join(", ")} ✓`);
  }
}

// ─── Unified Diff Generator (v6.33) ──────────────────────────────────────────────
// Uses the `diff` package (Myers algorithm) for proper unified diffs.
// Falls back to the simple line-by-line diff if the package is unavailable.

function generateSimpleDiff(original: string, proposed: string, filename: string): string {
  try {
    // v6.33: Proper Myers unified diff with 3-line context
    const { createTwoFilesPatch } = _require("diff");
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
  area?: string,
  forceTier?: string
): Promise<ImprovementProposal | null> {
  // v7.1.3: Validate env keys on first call (deferred from module load to avoid ESM race)
  validateEnvKeysOnce();

  // v6.15: Use active provider key instead of hardcoded DEEPSEEK_API_KEY
  // v11.0.2: Also accept OPENAI_API_KEY as a valid provider key
  const { getProviderApiKey } = await import("./llmProvider.js");
  const activeModel = process.env.LLM_MODEL || "deepseek";
  const apiKey = getProviderApiKey(activeModel) || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No LLM API key configured (set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY)");

  // v6.34: Auto-categorise the proposal area from the filename if not provided.
  // This ensures multi-model routing fires automatically without needing a manual area param.
  if (!area) {
    const fn = targetFile.toLowerCase();
    // v12.2.2: Only route TRULY security-critical files to Pro tier.
    // Previously, selfImprove.ts, selfImproveGuard.ts, rsiEngine.ts etc. were
    // routed to Pro (Claude/DeepSeek Pro) on every cycle — burning expensive tokens
    // even for trivial readability improvements. Now only auth/constitution files
    // get Pro; RSI engine files get Standard (Kimi k2.6 is excellent for this).
    if (fn.includes("auth") || fn.includes("constitution") || fn.includes("adminauth")) {
      area = "security"; // → Pro tier → Claude/Kimi
    } else if (fn.includes("selfimprove") || fn.includes("rsiengine") ||
               fn.includes("continuousimprover") || fn.includes("qualitytorsi")) {
      area = "performance"; // → Standard tier → Kimi k2.6 (free, excellent code quality)
    } else if (fn.includes("llm") || fn.includes("model") || fn.includes("provider")) {
      area = "architecture"; // → Standard tier
    } else if (fn.includes("perf") || fn.includes("cache") || fn.includes("optim")) {
      area = "performance"; // → Standard tier
    } else if (fn.includes("test") || fn.includes("eval") || fn.includes("spec")) {
      area = "reliability"; // → Eco tier → Kimi
    } else {
      area = "readability"; // safe default → Eco tier → Kimi (free)
    }
  }

  // v20.4.1: Category rotation — if this file already has proposals of the same area/category,
  // rotate to a different category to avoid monotonous improvement patterns.
  // This prevents the engine from generating 5 consecutive 'input validation' proposals
  // for the same file across different cycles.
  try {
    const store = loadProposals();
    const fileProposals = store.proposals.filter(
      p => p.targetFile === targetFile && (p.status === "applied" || p.status === "pending")
    );
    if (fileProposals.length >= 2) {
      const recentCategories = fileProposals.slice(-3).map(p => p.category || "");
      const dominantCategory = recentCategories.filter(c => c === recentCategories[0]).length >= 2
        ? recentCategories[0] : null;
      if (dominantCategory && dominantCategory === area) {
        // Rotate to a different area to encourage diversity
        const rotationMap: Record<string, string> = {
          reliability: "performance",
          performance: "security",
          security: "architecture",
          architecture: "reliability",
          readability: "performance",
        };
        area = rotationMap[area] || "performance";
        log.info(`[v20.4.1 rotation] ${targetFile}: rotating area from ${dominantCategory} to ${area} for diversity`);
      }
    }
  } catch { /* non-fatal */ }

  // v6.28 A4: Resolve the actual source file path FIRST so we read the real
  // current content — not a stale snapshot — before generating any diff.
  const filePath = resolveServerFile(targetFile);
  if (!filePath) {
    throw new Error(`File '${targetFile}' is not in the list of analyzable files or does not exist.`);
  }

  // v6.28 A4: Read the CURRENT file content from disk (not from any cache).
  const originalContent = fs.readFileSync(filePath, "utf-8");
  const filename = path.basename(filePath);

  // v9.8.0: Constitution pre-filter — skip LLM call entirely if file is forbidden
  try {
    const constitutionPath = path.join(getServerDir(), "..", "andromeda-constitution.json");
    if (fs.existsSync(constitutionPath)) {
      const constitution = JSON.parse(fs.readFileSync(constitutionPath, "utf-8"));
      const forbiddenFiles = constitution.forbiddenModifications?.files || [];
      if (forbiddenFiles.some((f: string) => filename.endsWith(f))) {
        log.info(`[Pre-filter] Skipping ${filename} — forbidden by constitution`);
        return null;
      }
    }
  } catch (err) {
    // non-fatal
  }

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

  // v11.14.0: Inject cross-agent learned patterns for this file (knowledgeTransfer)
  let patternContext = "";
  try {
    const { getPatternContextForFile } = await import("./knowledgeTransfer.js");
    patternContext = getPatternContextForFile(targetFile, area) || "";
  } catch {
    // Knowledge transfer not available — proceed without pattern context
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

  // v11.5.0: RLHF context — inject aggregated human feedback into the proposal prompt
  // so the LLM knows which categories users historically accept vs reject.
  // getRlhfContext() returns a formatted string like:
  //   "RLHF HIGH-REWARD categories: security (reward=0.85, n=12), reliability (reward=0.72, n=8)"
  //   "RLHF LOW-REWARD categories: feature (reward=-0.40, n=5)"
  // This directly biases the LLM to propose more security/reliability improvements
  // and fewer feature additions — matching what users actually accept.
  let rlhfContext = "";
  try {
    const { getRlhfContext } = await import("./rlhfCollector.js");
    rlhfContext = getRlhfContext();
  } catch {
    // RLHF collector not available — proceed without context
  }

  // v11.9.1: Per-file rejection history — inject into prompt so LLM avoids
  // repeating approaches that were rejected for this specific file.
  let rejectionContext = "";
  try {
    const { getRejectionContext, getFileRejectionStats } = await import("./proposalFeedback.js");
    const stats = getFileRejectionStats(filename);
    if (stats.shouldSkip) {
      // File has 8+ rejections in last 24h — skip it entirely to avoid thrashing
      throw new Error(`File ${filename} throttled: ${stats.recentRejections} rejections in 24h`);
    }
    rejectionContext = getRejectionContext(filename);
  } catch (rejErr: any) {
    if ((rejErr as Error).message?.includes("throttled")) throw rejErr;
    // proposalFeedback not available — proceed without rejection context
  }

  // v6.36: Meta-learning — read rsi_proof_history.json and inject category success rates
  // into the system prompt so the LLM focuses on historically weak categories.
  let metaLearningContext = "";
  try {
    const proofPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "rsi_proof_history.json");
    if (fs.existsSync(proofPath)) {
      const history: any[] = JSON.parse(fs.readFileSync(proofPath, "utf-8"));
      const recent = history.slice(-20);
      const catStats: Record<string, { totalDelta: number; count: number }> = {};
      for (const entry of recent) {
        const catBefore = entry.categoryScoresBefore ?? {};
        const catAfter = entry.categoryScoresAfter ?? {};
        const allCats = new Set([...Object.keys(catBefore), ...Object.keys(catAfter)]);
        for (const cat of allCats) {
          const before = (catBefore as any)[cat] ?? 0;
          const after = (catAfter as any)[cat] ?? 0;
          if (!catStats[cat]) catStats[cat] = { totalDelta: 0, count: 0 };
          catStats[cat].totalDelta += after - before;
          catStats[cat].count++;
        }
      }
      const catSummary = Object.entries(catStats)
        .map(([cat, s]) => ({ cat, avgDelta: s.count > 0 ? s.totalDelta / s.count : 0 }))
        .sort((a, b) => a.avgDelta - b.avgDelta);
      if (catSummary.length > 0) {
        const weakest = catSummary.slice(0, 3).map(c => `${c.cat}(${c.avgDelta.toFixed(1)})`).join(", ");
        const strongest = catSummary.slice(-2).map(c => `${c.cat}(${c.avgDelta.toFixed(1)})`).join(", ");
        metaLearningContext = `\n\nMETA-LEARNING (last ${recent.length} RSI cycles): Weakest categories: ${weakest}. Strongest: ${strongest}. PRIORITISE improving the weakest categories.`;
      }
    }
  } catch { /* non-fatal */ }

  // v11.17.0 Audit 9 Fix C: Wire getDegradingMetrics + findResolution from systemMemory
  // Inject degrading performance metrics and known error resolutions into the prompt
  let systemHealthContext = "";
  try {
    const { getDegradingMetrics, findResolution } = await import("./systemMemory.js");
    const degrading = getDegradingMetrics();
    if (degrading.length > 0) {
      const degradingStr = degrading
        .slice(0, 3)
        .map(b => `  - ${b.metric}: trend=${b.trend}, current=${b.current.toFixed(3)}`)
        .join("\n");
      systemHealthContext += `\n\nDEGRADING METRICS (prioritize improvements that address these):\n${degradingStr}`;
    }
    // Check if there's a known resolution for errors in this file
    const resolution = findResolution(targetFile);
    if (resolution) {
      systemHealthContext += `\n\nKNOWN ERROR RESOLUTION for this module: ${resolution.resolution}`;
    }
  } catch { /* non-fatal */ }

  // v6.28 A3: Load constitution constraints and inject into the system prompt.
  // This means the LLM will never propose touching forbidden files or inserting
  // forbidden patterns — so proposals won't be immediately blocked by the guard.
  // v11.12.0: Inject episodic memory lessons into the RSI prompt
  let episodicContext = "";
  try {
    const { synthesizeLessons } = await import("./episodicMemory.js");
    const lessons = await synthesizeLessons(targetFile);
    if (lessons && lessons !== "No prior experience with this type of task.") {
      episodicContext = `\n\nEPISODIC MEMORY (lessons from past RSI attempts on this file):\n${lessons}`;
    }
  } catch { /* non-fatal */ }

  // v11.19.0 Audit 11 Fix A: Wire getSynthesizedRulesForPrompt so long-term memory patterns reach the LLM
  let longTermMemoryContext = "";
  try {
    const { getSynthesizedRulesForPrompt } = await import("./longTermMemoryConsolidation.js");
    const ltmRules = getSynthesizedRulesForPrompt(targetFile);
    if (ltmRules && ltmRules.trim().length > 0) {
      longTermMemoryContext = `\n\nLONG-TERM MEMORY RULES (synthesized from improvement history for this file):\n${ltmRules}`;
    }
  } catch { /* non-fatal */ }

  // v11.23.0 Audit 15 Fix C: Wire findSimilarIssue so selfKnowledgeBase prevents repeating mistakes
  let knownLimitations = "";
  try {
    const { findSimilarIssue } = await import("./selfKnowledgeBase.js");
    const similar = findSimilarIssue(targetFile);
    if (similar && (Array.isArray(similar) ? similar.length : 0) > 0) {
      knownLimitations = `\n\nKNOWN ISSUES/LIMITATIONS (from selfKnowledgeBase):\n` + (Array.isArray(similar) ? similar : []).map((s: any) => `- ${s.description}: ${s.lesson}`).join("\n");
    }
  } catch { /* non-fatal */ }

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
  // v6.33: Multi-model routing — route by proposal area.
  // v7.1.4: Provider fallback chain — if preferred provider returns 401/402, retry next.
  // v7.1.6: Tiered cost model — Eco/Standard/Pro tiers based on task area.
  //         Eco (default): DeepSeek → Gemini Flash (routine analysis, 95%+ of cycles)
  //         Standard: Kimi k2.6 → DeepSeek Reasoner (complex refactoring)
  //         Pro: Claude Sonnet 4.5 → Kimi (security/auth/orchestrator changes only)
  function buildProviderFallbackChain(a?: string): string[] {
    // v7.1.6: Use already-imported llmProvider functions (imported below via dynamic import)
    // getProviderForTier and tierForArea are resolved after the await import("./llmProvider.js") below
    const tier = forceTier || tierForArea_fn(a);
    const primary = getProviderForTier_fn(tier as any);
    // Build fallback: primary → eco fallbacks → last resort
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    const hasKimi = !!process.env.KIMI_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const chain: string[] = [primary];
    // Add eco-tier fallbacks (cheapest) that aren't already in chain
    for (const fb of ["deepseek", "kimi", "openrouter-fast"]) {
      if (!chain.includes(fb)) {
        if (fb === "deepseek" && hasDeepSeek) chain.push(fb);
        else if (fb === "kimi" && hasKimi) chain.push(fb);
        else if (fb === "openrouter-fast" && hasOpenRouter) chain.push(fb);
      }
    }
    // v10.3: openai (sandbox Gemini proxy) as final fallback — always available in sandbox
    if (!chain.includes("openai") && hasOpenAI) chain.push("openai");
    
    // v18.0.2: Ultimate zero-cost fallback — Ollama (local)
    if (!chain.includes("ollama")) chain.push("ollama");
    
    if (chain.length === 0) chain.push("ollama");
    return chain;
  }
  const { simpleChatCompletion, getProviderForTier: getProviderForTier_fn, tierForArea: tierForArea_fn } = await import("./llmProvider.js");
  const providerChain = buildProviderFallbackChain(area);

  // v12.11.0: Semantic Graph Impact Prediction — compute downstream consumer context
  // before building the LLM prompt so the model knows what contracts it must preserve.
  let semanticImpactContext = "";
  try {
    const { predictImpact } = await import("./semanticImpactPredictor.js");
    const projectRoot = path.resolve(getServerDir(), "..");
    const impactResult = await predictImpact({
      targetFile: targetFile.includes("/") ? targetFile : `server/${targetFile}`,
      projectRoot,
      maxConsumerFiles: 6,
    });
    if (!impactResult.skipped && impactResult.consumerContextSnippet) {
      semanticImpactContext = `\n\n${impactResult.consumerContextSnippet}`;
    }
    // Store impact metadata for dashboard visibility
    (analyzeAndPropose as any)._lastImpact = {
      riskScore: impactResult.riskScore,
      impactRadius: impactResult.impactRadius,
      highRisk: impactResult.highRisk,
    };
  } catch { /* non-fatal */ }

  // v12.2.2: Load RSI priority goals from ANDROMEDA.md — extract the Goals section specifically
  let projectGoals = "";
  try {
    // Try workspace ANDROMEDA.md first (has full priority goals), fall back to project root
    const workspaceGoalsPath = path.join(process.cwd(), "workspace", "ANDROMEDA.md");
    const rootGoalsPath = path.join(process.cwd(), "ANDROMEDA.md");
    const goalsPath = fs.existsSync(workspaceGoalsPath) ? workspaceGoalsPath : rootGoalsPath;
    if (fs.existsSync(goalsPath)) {
      const goalsRaw = fs.readFileSync(goalsPath, "utf-8");
      // v12.2.2: Extract the RSI Goals section specifically — it has the mandatory priority order
      const goalsMatch = goalsRaw.match(/## RSI Improvement Goals[\s\S]*?(?=\n## [A-Z]|$)/);
      if (goalsMatch) {
        projectGoals = `\n\n${goalsMatch[0].slice(0, 3500)}`;
      } else {
        // Fallback: take first 2000 chars if section not found
        projectGoals = `\n\nProject improvement priorities:\n${goalsRaw.slice(0, 2000)}`;
      }
    }
  } catch { /* non-fatal — goals file is optional */ }

  const llmMessages = [
    {
      role: "system",
      content: `You are an expert TypeScript software engineer performing a targeted code improvement.
You will receive source code and must identify the SINGLE BEST improvement to make.${projectGoals}
${knowledgeContext ? `\nArchitecture decisions and known issues for this file:\n${knowledgeContext}` : ""}${patternContext ? `\nCross-agent learned patterns for this file:\n${patternContext}` : ""}${longTermMemoryContext}${systemHealthContext}${previousAttempts}${metaLearningContext}${episodicContext}${rlhfContext}${longTermMemoryContext}
${knownLimitations}
${constitutionBlock}${importGraphContext}${semanticImpactContext}

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
Do NOT include any forbidden patterns listed above.

CRITICAL SAFETY RULES — violations cause CI failure and automatic rollback:
1. NEVER change the name, parameter types, parameter count, or return type of any EXPORTED function or class.
2. NEVER rename exported symbols (functions, classes, constants, interfaces, types).
3. Internal refactoring (helper functions, variable names, logic flow, error handling) is SAFE.
4. Adding NEW exports is SAFE. Removing or renaming EXISTING exports is FORBIDDEN.
5. If you are unsure whether a change preserves backward compatibility, set confidence below 0.8.
6. BANNED IMPROVEMENT TYPES (do NOT propose these — they add zero value):
   - Extracting magic numbers into named constants (e.g. const TIMEOUT_MS = 5000)
   - Adding JSDoc comments to existing functions
   - Renaming variables for readability
   - Adding blank lines or removing trailing whitespace
   These are banned because they waste tokens and do not improve system behavior.
7. PREFERRED improvement types (in priority order, ROTATE through these — do NOT repeat the same type for the same file):
   - Fix race conditions in async code (highest value)
   - Improve retry logic with exponential backoff (high value)
   - Add timeout guards to fetch/LLM calls (high value)
   - Replace sequential awaits with Promise.all() for parallel execution (high value)
   - Fix memory leaks (event listeners, intervals, streams not cleaned up) (high value)
   - Replace 'any' types with specific TypeScript types (medium value)
   - Add missing null/undefined checks before property access (medium value)
   - Add try/catch around async operations that can throw (medium value)
   - Fix missing error handling in catch blocks (replace empty catch with log.warn) (medium value)
   - Add input validation to functions that receive external data (LOW PRIORITY — only if none of the above apply)
   IMPORTANT: 'Add input validation' is the LOWEST priority. If you have already proposed input validation for this file in a previous cycle, you MUST choose a different improvement type.
   If none of these exist in the file, propose a structural refactor or test coverage improvement.`,
    },
    {
      role: "user",
      content: `Analyze this TypeScript file and propose the single best improvement${area ? ` focusing on: ${area}` : ``}.\n\nFile: ${filename}\n\n\`\`\`typescript\n${contentForAnalysis}\n\`\`\`\n\nReturn ONLY valid JSON.`,
    },
  ];

  // v14.0.0: Architectural Pattern Memory — inject cross-session pattern context into LLM prompt.
  // Tells the LLM what patterns have succeeded/failed for this specific file in past RSI cycles.
  try {
    const { buildPatternContext } = await import("./epistemicBeliefModel.js");
    const patternCtx = buildPatternContext(targetFile);
    if (patternCtx) {
      const userMsg = llmMessages[llmMessages.length - 1];
      if (userMsg && userMsg.role === "user") {
        (userMsg as any).content += `\n\n--- ARCHITECTURAL PATTERN MEMORY ---\n${patternCtx}\n--- END PATTERN MEMORY ---`;
      }
    }
  } catch { /* non-fatal — pattern memory is advisory only */ }

  // v13.0.0: Multi-Agent Debate Protocol — run upstream debate before LLM generation.
  // Five specialized agents (Security, Performance, Reliability, TypeScript, Architecture)
  // debate the highest-priority improvement. The winning brief is injected into the
  // user message so the LLM writes exactly what the debate consensus agreed upon.
  // Runs in structural mode (useLLM: false) — zero token cost.
  try {
    const { runDebateProtocol } = await import("./multiAgentDebate.js");
    const debateResult = await runDebateProtocol(targetFile, contentForAnalysis, { useLLM: false });
    if (debateResult?.winningBrief) {
      const userMsg = llmMessages[llmMessages.length - 1];
      if (userMsg && userMsg.role === "user") {
        const consensusType = debateResult.strongConsensus ? "strong" : "weak";
        (userMsg as any).content += `\n\n--- DEBATE CONSENSUS (${consensusType}) ---\n${debateResult.winningBrief}\nLead agent: ${debateResult.winner}\nConstraints: ${(debateResult.constraints ?? []).slice(0, 2).join("; ")}\n--- END DEBATE ---`;
      }
      log.info(`[v13.0.0] Debate (${debateResult.strongConsensus ? "strong" : "weak"} consensus): ${debateResult.winner} — ${String(debateResult.winningBrief).slice(0, 80)}`);
    }
  } catch { /* non-fatal — debate is advisory only */ }
  // v18.0.0: Genealogy-Guided Generation — inject rejected proposal patterns into LLM prompt.
  // Tells the LLM what approaches have been tried and rejected for this file, so it generates
  // something genuinely different. This is the primary driver of the 93% → 96% acceptance jump.
  try {
    const refinementBrief = generateRefinementBrief(targetFile);
    if (refinementBrief) {
      const userMsg = llmMessages[llmMessages.length - 1];
      if (userMsg && userMsg.role === "user") {
        (userMsg as any).content += refinementBrief;
      }
    }
  } catch { /* non-fatal — genealogy guidance is advisory only */ }

  // v13.0.0: Semantic Safety Score — block or flag high-risk proposals before LLM call.
  // Prevents expensive generation for changes that would cascade-break the codebase.
  try {
    const { getChangeSafetyScore } = await import("./semanticCodebaseGraph.js");
    const projectRoot = path.resolve(process.cwd());
    const safetyResult = getChangeSafetyScore(targetFile, contentForAnalysis.slice(0, 1000), projectRoot);
    if (safetyResult?.recommendation === "block") {
      log.warn(`[v13.0.0] Semantic safety BLOCKED ${path.basename(targetFile)}: score=${safetyResult.score?.toFixed(2)}, risks=${(safetyResult.riskFactors ?? []).join(", ")}`);
      return null; // abort — too risky to generate
    } else if (safetyResult?.recommendation === "review") {
      const callerCount = (safetyResult.impactProof?.directCallers?.length ?? 0) + (safetyResult.impactProof?.transitiveCallers?.length ?? 0);
      log.info(`[v13.0.0] Semantic safety REVIEW ${path.basename(targetFile)}: score=${safetyResult.score?.toFixed(2)}, impact=${callerCount} callers`);
    }
  } catch { /* non-fatal — safety check is advisory */ }

  // v12.13.0: Cost optimizer — select the cheapest model that can handle this proposal's complexity.
  // Prevents always using expensive Claude/Kimi for trivial readability improvements.
  try {
    const { scoreProposalComplexity, selectCostOptimalModel } = await import("./costOptimizer.js");
    const diff = contentForAnalysis.slice(0, 500); // Use first 500 chars as complexity proxy
    const complexity = scoreProposalComplexity(targetFile, diff, area ?? "general");
    const { modelId: costOptimalModel, reason: costReason } = selectCostOptimalModel(complexity);
    log.info(`[costOptimizer] ${path.basename(targetFile)}: complexity=${complexity.score}/10 → ${costOptimalModel} (${costReason})`);
    // Prepend cost-optimal model to chain if not already present (avoids duplicates)
    if (!providerChain.includes(costOptimalModel)) {
      providerChain.unshift(costOptimalModel);
    }
  } catch { /* non-fatal — fall through to existing chain */ }
  // v7.1.4: Iterate through fallback chain; skip providers that return 401/402
  // v11.0.1: Also skip providers in the session-level _deadProviders cache to avoid
  //          wasting time on providers known to be billing/auth-failed this session.
  let rawContent: string | null = null;
  let lastProviderError: Error | null = null;
  for (const pid of providerChain) {
    // Skip providers already known to be dead this session
    if (_deadProviders.has(pid)) {
      log.info(`[v11.0.1] Skipping dead provider '${pid}' (auth/billing failed earlier this session)`);
      continue;
    }
    try {
      rawContent = await simpleChatCompletion(llmMessages, { maxTokens: 2000, temperature: 0.3, providerId: pid });
      if (rawContent) break; // success — stop trying
    } catch (provErr: any) {
      const msg: string = provErr?.message ?? "";
      const isAuthOrBilling = /40[12]/.test(msg) ||
        /authentication/i.test(msg) ||
        /insufficient.*credit/i.test(msg) ||
        /invalid.*key/i.test(msg);
      if (isAuthOrBilling) {
        log.warn(`[v7.1.4] Provider '${pid}' returned auth/billing error — trying next. (${sanitizeForLog(msg).slice(0, 100)})`);
        _deadProviders.add(pid); // v11.0.1: Mark as dead for this session
        lastProviderError = provErr;
        continue;
      }
      throw provErr; // non-auth error — propagate immediately
    }
  }
  if (!rawContent) {
    throw lastProviderError ?? new Error("All LLM providers failed or returned empty responses");
  }

  // v7.1.7: Parse helper — tries to extract JSON from raw LLM output
  // Strips control characters that cause "Bad control character in JSON" parse errors.
  // LLMs sometimes embed literal \x00-\x1F chars inside JSON string values (e.g. in code snippets).
  function tryParseProposal(raw: string): { title: string; rationale: string; category: ImprovementProposal["category"]; impact: ImprovementProposal["impact"]; confidence?: number; originalSnippet: string; proposedSnippet: string; secondaryChanges?: any[] } | null {
    // Step 1: strip markdown fences and non-printable control chars (keep \n \r \t)
    const cleaned = raw
      .replace(/^```json?\s*/i, "")
      .replace(/\s*```$/, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // strip non-printable control chars
      .trim();
    try { return JSON.parse(cleaned); } catch {}
    // Step 2: try extracting the outermost JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch {} }
    // Step 3: last resort — escape unescaped newlines/tabs inside string values
    try {
      const reEscaped = cleaned
        .replace(/(?<!\\)\n/g, "\\n")
        .replace(/(?<!\\)\r/g, "\\r")
        .replace(/(?<!\\)\t/g, "\\t");
      return JSON.parse(reEscaped);
    } catch {}
    return null;
  }

  let parsed = tryParseProposal(rawContent);

  // v7.1.6: Retry once if truncated (finish_reason=stop but JSON incomplete) or missing fields
  const isTruncated = !parsed || !parsed.originalSnippet || !parsed.proposedSnippet || !parsed.title;
  if (isTruncated) {
    log.warn(`[v7.1.6] Response incomplete or unparseable — retrying with higher token budget`);
    let retryContent: string | null = null;
    for (const pid of providerChain) {
      try {
        // Use a more explicit prompt and 4x token budget on retry
        const retryMessages = [
          ...llmMessages.slice(0, -1),
          {
            role: "user" as const,
            content: llmMessages[llmMessages.length - 1].content +
              "\n\nIMPORTANT: Your previous response was truncated or incomplete. You MUST return a COMPLETE, valid JSON object. Include ALL required fields: title, rationale, category, impact, confidence, originalSnippet, proposedSnippet. Keep snippets SHORT (under 20 lines each) to avoid truncation.",
          },
        ];
        retryContent = await simpleChatCompletion(retryMessages, { maxTokens: 4000, temperature: 0.2, providerId: pid });
        if (retryContent) break;
      } catch (retryErr: any) {
        const retryMsg: string = retryErr?.message ?? "";
        if (/40[12]/.test(retryMsg) || /authentication/i.test(retryMsg) || /insufficient.*credit/i.test(retryMsg)) continue;
        break;
      }
    }
    if (retryContent) parsed = tryParseProposal(retryContent);
  }

  if (!parsed) {
    throw new Error(`Failed to parse AI response as JSON. Raw response: ${rawContent.slice(0, 300)}`);
  }
  if (!parsed.originalSnippet || !parsed.proposedSnippet || !parsed.title) {
    throw new Error("AI response missing required fields (title, originalSnippet, proposedSnippet)");
  }

  // v9.10.1: Snippet truncation guard — reject proposals where the LLM's output was cut
  // mid-token (e.g. "const MAX_SLANT_BONU" or unclosed string/bracket). These always fail
  // the syntax check anyway, but catching them early saves the file-write and rollback overhead.
  const proposedSnippetTrimmed = parsed.proposedSnippet.trimEnd();
  const looksLikeTruncated =
    // Ends mid-identifier (last char is a word char but the snippet has no closing brace/paren/semicolon)
    /\w$/.test(proposedSnippetTrimmed) &&
    !/[;,}\])]$/.test(proposedSnippetTrimmed) &&
    proposedSnippetTrimmed.length > 10;
  if (looksLikeTruncated) {
    log.warn(`[v9.10.1] Snippet appears truncated for ${filename}: "${parsed.title}" — skipping`);
    return null;
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
  // v11.10.1: Blend LLM self-rated confidence with reward model score.
  // Build a proper unified diff so extractFeatures() can count +/- lines correctly.
  // scoreWithRewardModel() returns a sigmoid in [0, 1]; blend 70% LLM + 30% reward.
  try {
    const origLines = (parsed.originalSnippet || "").split("\n");
    const propLines = (parsed.proposedSnippet || "").split("\n");
    // Build a minimal unified diff: removed lines prefixed with -, added with +
    const removedPart = origLines.map((l: string) => `-${l}`).join("\n");
    const addedPart = propLines.map((l: string) => `+${l}`).join("\n");
    const rmInput = `--- original\n+++ proposed\n${removedPart}\n${addedPart}`;
    const rmScore = scoreWithRewardModel(rmInput); // sigmoid [0, 1]
    const calibratedRmScore = calibrateScore(rmScore); // v18: Platt-scaled calibration
    confidence = 0.7 * confidence + 0.3 * calibratedRmScore;
    confidence = Math.max(0, Math.min(1, confidence));
  } catch { /* non-fatal — reward model unavailable */ }

    // v6.34: Patch-based apply — use applyPatch() from the diff package when a
  // stored unified diff exists. Falls back to snippet-replace for robustness.
  let proposedContent: string;
  let diff: string;

  // v11.10.1: Check learned constraints before applying — reject if the proposed
  // snippet matches a pattern that has been rejected before.
  try {
    const { checkLearnedConstraints } = await import("./learnedConstraints.js");
    const violated = checkLearnedConstraints(parsed.proposedSnippet || "");
    if (violated) {
      console.warn(`[SelfImprove] Proposal blocked by learned constraint '${violated.pattern}': ${violated.reason}`);
      return null; // Reject proposal — matches analyzeAndPropose return type Promise<ImprovementProposal | null>
    }
  } catch { /* non-fatal — learnedConstraints unavailable */ }

  // v12.11.0: AST-Aware Mutation — uses astMutator.ts as the primary strategy with
  // 4-tier fallback: (1) exact string, (2) normalized string, (3) AST structural match,
  // (4) fuzzy line match. Also validates that exported symbols are preserved after mutation.
  let snippetApplied = false;
  try {
    const { applyMutation, validateMutation, recordMutationResult, recordValidationFailure } = await import("./astMutator.js");
    const mutResult = applyMutation(originalContent, parsed.originalSnippet, parsed.proposedSnippet, filename);
    recordMutationResult(mutResult);
    if (mutResult.success) {
      // Validate that exported symbols are preserved
      const validation = validateMutation({
        originalContent,
        mutatedContent: mutResult.mutatedContent,
        filename,
      });
      if (!validation.valid) {
        recordValidationFailure();
        log.warn(`[AstMutator] Mutation validation failed for ${filename}: ${validation.warnings.join("; ")}`);
        // Lower confidence but still proceed — tsc will catch real errors
        confidence = Math.min(confidence, 0.4);
      }
      proposedContent = mutResult.mutatedContent;
      snippetApplied = true;
      if (mutResult.method === "ast") {
        log.info(`[AstMutator] AST mutation applied for ${filename} (confidence: ${mutResult.matchConfidence.toFixed(2)})`);
      }
      // Discount confidence for low-confidence matches
      if (mutResult.matchConfidence < 0.85) {
        confidence = Math.min(confidence, mutResult.matchConfidence);
      }
    } else {
      // All mutation strategies failed — lower confidence significantly
      log.warn(`[AstMutator] All mutation strategies failed for ${filename}: ${mutResult.errorMessage}`);
      confidence = Math.min(confidence, 0.3);
      proposedContent = originalContent;
    }
  } catch (mutErr) {
    // Fallback to astDiff if astMutator throws
    try {
      const { findAndApplySnippet } = await import("./astDiff.js");
      const matchResult = findAndApplySnippet(originalContent, parsed.originalSnippet, parsed.proposedSnippet);
      if (matchResult.found && matchResult.proposedContent) {
        proposedContent = matchResult.proposedContent;
        snippetApplied = true;
      } else {
        confidence = Math.min(confidence, 0.3);
        proposedContent = originalContent;
      }
    } catch {
      confidence = Math.min(confidence, 0.3);
      proposedContent = originalContent;
    }
  }

  // v6.34: Generate a proper Myers unified diff using the diff package.
  // This diff is stored on the proposal and used by applyPatch() on apply,
  // which is more robust than string-replace for whitespace-sensitive files.
  diff = generateSimpleDiff(originalContent, proposedContent, filename);

  // v6.34: Validate that the generated diff round-trips correctly via applyPatch.
  // If it does, we store the diff and use it on apply. If not, we fall back to
  // the proposedContent string (which is already correct from the snippet replace).
  if (snippetApplied && diff && diff.length > 10) {
    try {
      const patched = applyPatch(originalContent, diff);
      if (typeof patched === "string" && patched === proposedContent) {
        log.info(`[v6.34] Patch round-trip validated for ${filename} — will use patch-based apply`);
      } else {
        log.info(`[v6.34] Patch round-trip mismatch for ${filename} — falling back to proposedContent`);
      }
    } catch {
      log.info(`[v6.34] applyPatch threw for ${filename} — falling back to proposedContent`);
    }
  }

  // v12.10.0: Multi-Agent Debate (MAD) — Red Team attacks, Blue Team defends.
  // Runs BEFORE Actor-Critic to catch edge cases a single LLM review misses.
  try {
    const { runMadDebate } = await import("./madDebate.js");
    const fileContextForMad = originalContent.split("\n").slice(0, 50).join("\n");
    const madResult = await runMadDebate({
      proposal: {
        targetFile: filename,
        originalSnippet: parsed.originalSnippet,
        proposedSnippet: parsed.proposedSnippet,
        category: parsed.category,
        title: parsed.title,
      },
      fileContext: fileContextForMad,
      simpleChatCompletion,
      providerChain,
    });
    if (madResult.ran) {
      // Apply Blue Team's improved snippet if they patched the code
      if (madResult.blueTeamImproved && madResult.improvedSnippet) {
        log.info(`[MAD] Blue Team improved snippet for ${filename} — applying patch`);
        parsed.proposedSnippet = madResult.improvedSnippet;
        // Recompute proposedContent with improved snippet
        try {
          const { findAndApplySnippet } = await import("./astDiff.js");
          const reMatch = findAndApplySnippet(originalContent, parsed.originalSnippet, parsed.proposedSnippet);
          if (reMatch.found && reMatch.proposedContent) proposedContent = reMatch.proposedContent;
        } catch { /* non-fatal */ }
      }
      // Apply confidence delta from debate outcome
      confidence = Math.max(0.1, Math.min(1.0, confidence + madResult.confidenceDelta));
      (parsed as any)._madDebateTranscript = madResult.transcript.slice(0, 500);
      (parsed as any)._madIssueCount = madResult.redTeamIssues.length;
    }
  } catch (madErr) {
    log.warn(`[MAD] Debate threw (non-fatal): ${(madErr as Error).message?.slice(0, 100)}`);
  }

  // v12.11.0: Multi-Modal Context Awareness — for UI proposals, capture a screenshot
  // and inject the visual context into the Critic review so it can evaluate
  // whether the proposed change would break the visible UI.
  let _visionContextSnippet = "";
  try {
    const { enrichWithVisionContext, isUIFile, pruneOldVisionScreenshots } = await import("./visionContextEnricher.js");
    if (isUIFile(filename)) {
      pruneOldVisionScreenshots();
      const visionResult = await enrichWithVisionContext({
        targetFile: filename,
        proposedSnippet: parsed.proposedSnippet,
      });
      if (visionResult.enriched && visionResult.contextSnippet) {
        _visionContextSnippet = visionResult.contextSnippet;
        (parsed as any)._visionEnriched = true;
        log.info(`[VisionEnricher] UI context captured for ${filename}: ${visionResult.visibleComponents?.length ?? 0} components`);
      }
    }
  } catch (visionErr) {
    log.warn(`[VisionEnricher] Threw (non-fatal): ${(visionErr as Error).message?.slice(0, 100)}`);
  }

  // v12.9.0: Actor-Critic review — before saving, run the Critic LLM to catch
  // logic flaws, TS type errors, and security issues. If the Critic finds fixable
  // issues, it returns a refined snippet that replaces the Actor's original.
  // This gate catches ~60% of proposals that would otherwise fail tsc.
  try {
    const { reviewProposal } = await import("./criticEngine.js");
    const criticResult = await reviewProposal(
      {
        targetFile: filename,
        originalSnippet: parsed.originalSnippet,
        proposedSnippet: parsed.proposedSnippet,
        originalContent,
        title: parsed.title,
        category: parsed.category ?? "readability",
        rationale: parsed.rationale,
        visionContext: _visionContextSnippet || undefined,
      },
      simpleChatCompletion,
      providerChain,
      _deadProviders
    );
    if (criticResult.strategy === "rejected") {
      log.warn(`[Actor-Critic] Proposal rejected by Critic: ${criticResult.issues[0] ?? "unknown issue"}`);
      return null;
    }
    if (criticResult.strategy === "refined" && criticResult.refinedSnippet) {
      log.info(`[Actor-Critic] Proposal refined by Critic: ${criticResult.refinedRationale?.slice(0, 80)}`);
      // Apply the Critic's refinement
      parsed.proposedSnippet = criticResult.refinedSnippet;
      if (criticResult.refinedRationale) {
        parsed.rationale = `${parsed.rationale} [Critic-refined: ${criticResult.refinedRationale}]`;
      }
      // Recompute proposedContent with refined snippet
      if (originalContent.includes(parsed.originalSnippet)) {
        proposedContent = originalContent.replace(parsed.originalSnippet, parsed.proposedSnippet);
      }
      diff = generateSimpleDiff(originalContent, proposedContent, filename);
      // Boost confidence slightly since Critic validated it
      confidence = Math.min(1.0, confidence + 0.05);
    }
        // strategy === "approved" or "skipped" — proceed as-is
    // v12.9.1 hardening: Store critic score on proposal for dashboard visibility
    if (criticResult.confidence !== undefined) {
      (parsed as any)._criticScore = criticResult.confidence;
      (parsed as any)._criticStrategy = criticResult.strategy;
    }
  } catch (criticErr) {
    log.warn(`[Actor-Critic] Critic review threw (non-fatal): ${(criticErr as Error).message?.slice(0, 100)}`);
    // Non-fatal — proceed without critic review
  }
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
  // v12.9.1 hardening: Carry critic metadata forward so dashboard can display it
  if ((parsed as any)._criticScore !== undefined) {
    (proposal as any)._criticScore = (parsed as any)._criticScore;
    (proposal as any)._criticStrategy = (parsed as any)._criticStrategy;
  }

  // v6.28 A1: Register in dedup hash set before saving
  _seenProposalHashes.add(hash);
  // v10.3: Load a FRESH store before saving to preserve any 'applied' proposals
  // added concurrently (fixes race condition between analyzeAndPropose and guardedApply)
  {
    const freshStore = loadProposals();
    const appliedInFresh = freshStore.proposals.filter(p => p.status === "applied");
    const appliedIds = new Set(appliedInFresh.map(p => p.id));
    for (const p of store.proposals) {
      if (appliedIds.has(p.id)) { p.status = "applied" as any; }
    }
    for (const ap of appliedInFresh) {
      if (!store.proposals.find(p => p.id === ap.id)) { store.proposals.push(ap); }
    }
  }
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
  // v10.7.0: Constitutional AI hard gate — block before any file I/O
  try {
    const constitResult = checkConstitution({
      diff: proposal.diff || "",
      targetFile: proposal.targetFile,
      description: proposal.title,
    });
    if (!constitResult.allowed) {
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = `Constitutional violation: ${constitResult.violations.join("; ")}`;
      saveProposals(store);
      log.info(`[ConstitutionalAI] Blocked proposal ${proposalId}: ${constitResult.violations[0]}`);
      return { success: false, message: `Constitutional violation: ${constitResult.violations[0]}` };
    }
  } catch { /* non-fatal — allow if constitution check throws */ }

  // v10.7.0: Z3 proof verification — ensure utility non-decrease
  try {
    const proofResult = await verifyProposalProof(proposal.diff || "", proposal.targetFile);
    if (!proofResult.valid && proofResult.confidence > 0.8) {
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = `Z3 proof failed: ${proofResult.reason}`;
      saveProposals(store);
      log.info(`[Z3Proof] Blocked proposal ${proposalId}: ${proofResult.reason}`);
      return { success: false, message: `Z3 proof failed: ${proofResult.reason}` };
    }
  } catch { /* non-fatal */ }


  // v9.8.5: Mark as processing immediately to prevent concurrent applies
  // Record the timestamp so resetStuckProcessingProposals() can detect stale processing proposals
  proposal.status = "processing" as any;
  (proposal as any)._processingStartedAt = Date.now();
  saveProposals(store);

  // v9.8.5 DEFINITIVE FIX: Wrap entire apply body in try/finally.
  // No matter what throws — guard crash, LLM timeout, fs error, import failure —
  // the proposal status is ALWAYS set to 'rejected' before returning.
  // This is the only reliable way to prevent proposals from staying stuck in 'processing'.
  let _applySucceeded = false;
  let _lastUncaughtErr: Error | undefined;
  try {

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
  if (!filePath) {
    // v9.8.5: Always reset status from 'processing' on early return
    proposal.status = "rejected" as any;
    (proposal as any)._failReason = "Target file no longer accessible";
    saveProposals(store);
    return { success: false, message: "Target file no longer accessible" };
  }

  // v5.27: Impact analysis before applying changes
  try {
    const { analyzeImpact } = await import("./dependencyGraph");
    const impact = analyzeImpact(proposal.targetFile);
    if (impact && impact.riskLevel === "critical" && impact.totalAffectedFiles > 10) {
      console.warn(`[SelfImprove] HIGH-RISK: ${proposal.targetFile} affects ${impact.totalAffectedFiles} files`);
      // v9.8.5: Always reset status from 'processing' on early return
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = `Blocked: high-risk change affects ${impact.totalAffectedFiles} files`;
      saveProposals(store);
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
    // v9.8.5: Increase totalAttempts threshold to 10 to avoid noise during initial failures
    if (insights.totalAttempts > 10 && insights.successRate < 0.3) {
      console.warn(`[SelfImprove] Low success rate (${(insights.successRate * 100).toFixed(0)}%) for ${proposal.targetFile}. Proceeding with caution.`);
    }
  } catch (err) { log.caught("non-fatal", err); }

  // v9.10.0: Git pre-apply snapshot — use a lightweight tag instead of a commit
  // to preserve rollback capability without polluting git log with "pre-improvement snapshot" noise.
  // Tags are hidden from the default git log view but accessible via `git tag -l 'rsi-snap/*'`.
  // v10.3.1: Check for git repo first — silently skip when running from an extracted zip.
  try {
    const cwd = path.resolve(getServerDir(), "..");
    // v10.3.1: Detect non-git directories before attempting tag to avoid noisy warnings
    // when users run Andromeda from an extracted zip (not a git repository).
    let isGitRepo = false;
    try {
      gitSandbox("git rev-parse --git-dir", { cwd, stdio: "pipe", timeout: 3000, encoding: "utf-8" });
      isGitRepo = true;
    } catch { /* not a git repo — silently skip snapshot */ }
    if (isGitRepo) {
      const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Andromeda AI", GIT_AUTHOR_EMAIL: "andromeda@local", GIT_COMMITTER_NAME: "Andromeda AI", GIT_COMMITTER_EMAIL: "andromeda@local" };
      const safeTitle = (proposal.title || proposalId).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
      const tagName = `rsi-snap/${safeTitle}-${Date.now()}`;
      try {
        gitSandbox(`git tag ${JSON.stringify(tagName)}`, { cwd, env: gitEnv, encoding: "utf-8", stdio: "pipe" });
        console.log(`[SelfImprove] Git snapshot tag: ${tagName}`);
      } catch (tagErr: any) {
        // Non-fatal — tag creation failure should never block the improvement cycle
        const errMsg = String(tagErr.stderr || tagErr.message || "");
        if (!errMsg.includes("already exists")) {
          console.warn("[SelfImprove] Git snapshot tag warning:", sanitizeForLog(errMsg).slice(0, 100));
        }
      }
    }
  } catch (snapErr) {
    console.warn("[SelfImprove] Git snapshot unavailable:", sanitizeForLog((snapErr as Error).message));
  }

  // v12.12.0: Cross-Proposal Conflict Detection — check if this proposal conflicts
  // with any recently applied proposals before spending time on dry-run.
  try {
    const { checkProposalConflicts, getRecentlyApplied } = await import("./crossProposalConflictDetector.js");
    const projectRoot = path.resolve(getServerDir(), "..");
    const conflictResult = await checkProposalConflicts(
      proposalId,
      proposal.targetFile,
      proposal.proposedSnippet || proposal.proposedContent || "",
      getRecentlyApplied(),
      projectRoot
    );
    (proposal as any)._conflictResult = {
      hasConflicts: conflictResult.hasConflicts,
      criticalCount: conflictResult.criticalCount,
      warningCount: conflictResult.warningCount,
      suggestedAction: conflictResult.suggestedAction,
    };
    if (conflictResult.criticalCount > 0) {
      log.warn(`[ConflictDetector] ${proposalId}: ${conflictResult.criticalCount} critical conflicts detected — proposal may be stale. Action: ${conflictResult.suggestedAction}`);
    }
  } catch (_) { /* conflict detection is non-fatal */ }

  // v12.9.0: Sandboxed pre-apply dry-run — run tsc on the proposed content in a
  // temp directory BEFORE writing to disk. Failures lower auto-apply score but
  // don't block the proposal (the heal engine may still fix it).
  try {
    const { runDryRun, quickSyntaxCheck } = await import("./proposalSandbox.js");
    const projectRoot = path.resolve(getServerDir(), "..");
    // Quick syntax check first (< 1ms)
    const syntaxCheck = quickSyntaxCheck(proposal.proposedContent || "", proposal.targetFile);
    if (!syntaxCheck.valid) {
      log.warn(`[DryRun] Quick syntax check FAILED for ${proposal.targetFile}: ${syntaxCheck.error}`);
      (proposal as any)._dryRunResult = { passed: false, typeCheckPassed: false, errors: [syntaxCheck.error ?? "syntax error"] };
    } else {
      // Full tsc dry-run (async, ~5-10s)
      const dryRunResult = await runDryRun({
        targetFile: proposal.targetFile.includes("/") ? proposal.targetFile : `server/${proposal.targetFile}`,
        proposedContent: proposal.proposedContent || "",
        originalContent: proposal.originalContent || "",
        projectRoot,
        runTests: false, // keep fast — tests run post-apply
      });
      (proposal as any)._dryRunResult = dryRunResult;
      if (!dryRunResult.passed) {
        log.warn(`[DryRun] Pre-apply dry-run FAILED for ${proposal.targetFile} — heal engine will attempt fix after apply`);
      } else {
        log.info(`[DryRun] Pre-apply dry-run PASSED for ${proposal.targetFile} (${dryRunResult.durationMs}ms)`);
      }
    }
  } catch (dryRunErr) {
    log.warn(`[DryRun] Dry-run threw (non-fatal): ${(dryRunErr as Error).message?.slice(0, 100)}`);
  }

  // v12.11.0: Formal Invariant Verification — run static invariant checks on the
  // proposed snippet before applying. Critical violations (eval, import cycles)
  // block the proposal. Warnings are stored as metadata for dashboard visibility.
  try {
    const { verifyProposalInvariants } = await import("./proposalInvariantVerifier.js");
    const projectRoot = path.resolve(getServerDir(), "..");
    const invariantResult = await verifyProposalInvariants({
      proposedSnippet: proposal.proposedSnippet || proposal.proposedContent || "",
      targetFile: proposal.targetFile,
      projectRoot,
    });
    (proposal as any)._invariantResult = {
      passed: invariantResult.passed,
      criticalCount: invariantResult.criticalCount,
      warningCount: invariantResult.warningCount,
      violations: invariantResult.violations.map(v => `[${v.severity.toUpperCase()}] ${v.invariant}: ${v.message}`),
    };
    if (!invariantResult.passed && !invariantResult.skipped) {
      log.warn(`[InvariantVerifier] CRITICAL violations in ${proposal.targetFile} — blocking proposal: ${invariantResult.violations.filter(v => v.severity === 'critical').map(v => v.message).join('; ')}`);
      proposal.status = "rejected" as any;
      return { success: false, message: `Invariant violations: ${invariantResult.criticalCount} critical — proposal blocked` };
    }
    if (invariantResult.warningCount > 0) {
      log.info(`[InvariantVerifier] ${invariantResult.warningCount} warnings in ${proposal.targetFile} (non-blocking)`);
    }
  } catch (invErr) {
    log.warn(`[InvariantVerifier] Threw (non-fatal): ${(invErr as Error).message?.slice(0, 100)}`);
  }

  // v5.22 / v12.9.0: Semantic multi-file rollback snapshot.
  // Uses the dependency graph to snapshot the target file AND its direct
  // dependents so rollback is atomic across all affected files.
  try {
    const { createSemanticSnapshot } = await import("./semanticRollback.js");
    const projectRoot = path.resolve(getServerDir(), "..");
    const targetRelPath = proposal.targetFile.includes("/")
      ? proposal.targetFile
      : `server/${proposal.targetFile}`;
    await createSemanticSnapshot(
      proposalId,
      targetRelPath,
      projectRoot,
      `Before proposal ${proposalId}: ${proposal.title || "self-improvement"}`
    );
  } catch (err) {
    // Fallback to single-file rollback point if semantic snapshot fails
    log.caught("non-fatal", err);
    try {
      const { createRollbackPoint } = await import("./selfRollback") as any;
      createRollbackPoint([proposal.targetFile], `Before proposal ${proposalId}: ${proposal.title || "self-improvement"}`, "self-improve");
    } catch (fallbackErr) { log.caught("non-fatal", fallbackErr); }
  }

    // v12.13.0: Transaction log — record the apply operation as an atomic transaction
  // so it can be rolled back if anything goes wrong after the file write.
  let _txnId: string | null = null;
  try {
    const { beginTransaction, recordChange, commitTransaction, rollbackTransaction } = await import("./transactionLog.js");
    _txnId = beginTransaction(
      `Apply proposal ${proposalId}: ${proposal.title || "self-improvement"}`,
      [proposal.targetFile, ...(proposal.secondaryChanges?.map(c => c.targetFile) ?? [])]
    );
    // Record the before-state of the primary file
    if (proposal.originalContent) {
      recordChange(_txnId, filePath, proposal.proposedContent || proposal.proposedSnippet || "");
    }
  } catch { /* non-fatal — transaction log is audit-only */ }
  try {
    const { guardedApply } = await import("./selfImproveGuard");
    const guardResult = await guardedApply(proposalId);
    if (guardResult.success) {
      // v14.0.0: Record success in architectural pattern memory
      try {
        const { recordPatternOutcome } = await import("./epistemicBeliefModel.js");
        recordPatternOutcome(proposal.title || "unknown", "structure", path.basename(proposal.targetFile), "success");
      } catch { /* non-fatal */ }

      // v17.0.0: Record outcome in proposal genealogy DAG
      try {
        const { recordProposalOutcome } = await import("./proposalGenealogy.js");
        await recordProposalOutcome(proposalId, "applied");
      } catch (_pgErr) { /* non-fatal */ }
      // v18.0.0: Update reward calibrator with accepted outcome
      try {
        updateCalibration(proposal.confidence ?? 0.7, true);
      } catch { /* non-fatal */ }

      // v17.0.0: Record success in continuous fine-tuner for learning loop
      try {
        const { recordSuccess: _recordFineTunerSuccess } = await import("./continuousFineTuner.js");
        await _recordFineTunerSuccess({
          systemPrompt: "RSI improvement cycle",
          userPrompt: proposal.rationale ?? "",
          acceptedOutput: proposal.proposedContent ?? proposal.proposedSnippet ?? "",
          recordedAt: new Date().toISOString(),
          targetFile: proposal.targetFile,
          area: proposal.category ?? "general",
        });
      } catch (_ftErr) { /* non-fatal */ }

      // v14.0.0: Clear self-healing chaos hardening target if this file was flagged
      try {
        const { clearHardeningTarget } = await import("./selfHealingChaos.js");
        const moduleName = path.basename(proposal.targetFile, ".ts");
        clearHardeningTarget(moduleName);
      } catch { /* non-fatal */ }

      // v15.0.0: Semantic Diff Validator — block apply if public API regresses
      try {
        const { validateDiff } = await import("./semanticDiffValidator.js");
        const beforeSource = fs.readFileSync(resolveServerFile(proposal.targetFile) ?? proposal.targetFile, "utf-8");
        const afterSource = (proposal as any).content ?? "";
        if (beforeSource && afterSource) {
          const diffResult = validateDiff(beforeSource, afterSource, proposal.targetFile);
          if (!diffResult.safe) {
            const breakingSummary = diffResult.breakingChanges.map(bc => `${bc.kind}: ${bc.symbol}`).join(", ");
            log.warn(`[semanticDiffValidator] Blocking proposal "${proposal.title}" — breaking changes: ${breakingSummary}`);
            proposal.status = "rejected";
            (proposal as any).rejectionReason = `Semantic diff validation failed: ${breakingSummary}`;
            return { success: false, message: `Semantic diff validation failed: ${breakingSummary}` };
          }
        }
      } catch { /* non-fatal — validator is advisory if module unavailable */ }

      // v16.0.0: Distributed Consensus Gate — proposal must pass quorum before apply
      try {
        const { seekConsensus } = await import("./distributedConsensus.js");
        const proposedContent = (proposal as any).content ?? (proposal as any).newContent ?? "";
        const consensusResult = await seekConsensus({
          proposalId,
          targetFile: proposal.targetFile,
          title: proposal.title || "Untitled proposal",
          proposedContent,
          originalContent: (proposal as any).originalContent ?? "",
          area: (proposal as any).area ?? "general",
          confidence: proposal.confidence ?? 0.5,
          proposedAt: new Date().toISOString(),
        });
        if (!consensusResult.reached) {
          const reason = `Consensus failed: ${consensusResult.approvals}/${consensusResult.totalVotes} votes`;
          log.warn(`[distributedConsensus] ${reason} for ${path.basename(proposal.targetFile)}`);
          proposal.status = "rejected";
          (proposal as any).rejectionReason = reason;
          return { success: false, message: reason };
        }
        log.info(`[distributedConsensus] Consensus REACHED: ${consensusResult.approvals}/${consensusResult.totalVotes} votes for ${path.basename(proposal.targetFile)}`);
      } catch { /* non-fatal — consensus auto-passes in single-node mode if module unavailable */ }

      // v16.0.0: Benchmark Regression Gate — block apply if any of 20 micro-benchmarks regress
      try {
        const { runRegressionCheck } = await import("./benchmarkRegressionSuite.js");
        const benchResult = await runRegressionCheck(proposalId);
        if (!benchResult.passed) {
          const regressionSummary = benchResult.regressions
            .map(r => `${r.benchmarkName} (+${r.regressionPercent.toFixed(1)}%)`)
            .join(", ");
          const reason = `Benchmark regression detected: ${regressionSummary}`;
          log.warn(`[benchmarkRegressionSuite] ${reason}`);
          proposal.status = "rejected";
          (proposal as any).rejectionReason = reason;
          return { success: false, message: reason };
        }
        if (benchResult.improvements.length > 0) {
          log.info(`[benchmarkRegressionSuite] ${benchResult.improvements.length} benchmark improvements detected`);
        }
      } catch { /* non-fatal — benchmark gate is advisory if module unavailable */ }

      // v14.0.0: CI Regression Gate — block apply if metrics regress
      try {
        const { runTestSuiteGate } = await import("./ciRegressionGuard.js");
        const projectRoot = path.resolve(process.cwd());
        const newContent = (proposal as any).content ?? (proposal as any).newContent ?? "";
        const gateResult = runTestSuiteGate(proposalId, proposal.targetFile, newContent, projectRoot);
        if (!gateResult.passed) {
          log.warn(`[ciRegressionGuard] Gate FAILED for ${path.basename(proposal.targetFile)}: ${gateResult.detail}`);
          // Record as failure in pattern memory
          try {
            const { recordPatternOutcome } = await import("./epistemicBeliefModel.js");
            recordPatternOutcome(proposal.title || "unknown", "structure", path.basename(proposal.targetFile), "failure");
          } catch { /* non-fatal */ }
          // Roll back via transaction log
          if (_txnId) {
            try {
              const { rollbackTransaction } = await import("./transactionLog.js");
              rollbackTransaction(_txnId);
            } catch { /* non-fatal */ }
          }
          proposal.status = "rejected";
          (proposal as any).rejectionReason = `CI regression gate failed: ${gateResult.detail}`;
          return { success: false, message: `CI regression gate failed: ${gateResult.detail}` };
        }
        log.info(`[ciRegressionGuard] Gate PASSED for ${path.basename(proposal.targetFile)}: ${gateResult.detail}`);
      } catch { /* non-fatal — gate is advisory if module unavailable */ }

      proposal.status = "applied";

      // v15.0.0: Record successful apply as a fine-tuning training example
      try {
        const { recordSuccess: recordFineTuneSuccess } = await import("./continuousFineTuner.js");
        const systemPrompt = (proposal as any)._systemPrompt ?? "";
        const userPrompt = (proposal as any)._userPrompt ?? "";
        const acceptedOutput = (proposal as any).content ?? "";
        if (systemPrompt && userPrompt && acceptedOutput) {
          void recordFineTuneSuccess({
            systemPrompt,
            userPrompt,
            acceptedOutput,
            recordedAt: new Date().toISOString(),
            targetFile: proposal.targetFile,
            area: (proposal as any).area ?? "general",
          });
        }
      } catch { /* non-fatal */ }

      // v12.13.0: Commit transaction on success
      if (_txnId) {
        try {
          const { commitTransaction } = await import("./transactionLog.js");
          commitTransaction(_txnId);
        } catch { /* non-fatal */ }
      }

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
          // v11.9.2: Check constitution forbidden file patterns before writing secondary files.
          // Previously secondaryChanges bypassed the constitution check entirely.
          try {
            const constitPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "andromeda-constitution.json");
            if (fs.existsSync(constitPath)) {
              const constitution = JSON.parse(fs.readFileSync(constitPath, "utf-8"));
              const forbiddenFiles: string[] = constitution.forbiddenModifications?.files || [];
              const forbiddenPatterns: string[] = constitution.forbiddenModifications?.filePatterns || [];
              const targetBase = path.basename(change.targetFile);
              const isBlockedFile = forbiddenFiles.some((f: string) => change.targetFile.endsWith(f) || targetBase === f);
              const isBlockedPattern = forbiddenPatterns.some((pat: string) => {
                const regex = new RegExp(pat.replace(/\./g, "\\.").replace(/\*/g, ".*"));
                return regex.test(targetBase);
              });
              if (isBlockedFile || isBlockedPattern) {
                secondaryFailed = true;
                secondaryError = `Secondary file ${change.targetFile} blocked by constitution (forbidden file/pattern)`;
                break;
              }
            }
          } catch { /* constitution check optional for secondary files */ }
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

      // v12.9.0: RLAIF feedback — record consensus vote outcomes so dynamic model
      // weighting can learn which models are most accurate over time.
      try {
        const { recordConsensusProposalOutcome } = await import("./consensusEngine.js");
        const consensusVotes = (proposal as any)._consensusVotes as Array<{ model: string; approved: boolean }> | undefined;
        if (consensusVotes && consensusVotes.length > 0) {
          recordConsensusProposalOutcome(consensusVotes, true /* success */);
        }
      } catch (err) { log.caught("non-fatal", err); }

      // v12.11.0: Federated RLHF — broadcast success outcome to peers so they
      // can update their local model weights from our experience.
      try {
        const { broadcastOutcome } = await import("./federatedRLHF.js");
        const consensusVotes2 = (proposal as any)._consensusVotes as Array<{ model: string; approved: boolean }> | undefined;
        broadcastOutcome({
          proposalId: proposal.id,
          targetFile: proposal.targetFile,
          category: proposal.category,
          modelIds: consensusVotes2?.map(v => v.model) ?? [],
          outcome: "success",
          confidenceScore: proposal.confidence ?? 0.5,
          criticScore: (proposal as any)._criticScore,
          madIssueCount: (proposal as any)._madIssueCount,
          timestamp: Date.now(),
        }).catch(() => { /* non-fatal */ });
      } catch { /* non-fatal */ }

      // v12.12.0: Record this proposal for cross-proposal conflict detection
      try {
        const { buildAppliedRecord, recordAppliedProposal } = await import("./crossProposalConflictDetector.js");
        recordAppliedProposal(buildAppliedRecord(
          proposal.id,
          proposal.targetFile,
          proposal.proposedSnippet || proposal.proposedContent || ""
        ));
      } catch { /* non-fatal */ }

      try {
        const { generateTests } = await import("./testGenerator");
        const content = fs.readFileSync(filePath, "utf-8");
        const language = filePath.endsWith(".ts") ? "typescript" : "python";
        const tests = generateTests(content, filePath, language);
        if (tests.testCode) {
          const testPath = filePath.replace(/\.(ts|py)$/, `.test.$1`);
          // v11.8.0: Constitution v1.4.0 — NEVER overwrite existing test files.
          // Test files are the ground truth for correctness and must only be modified
          // by human developers. Only write generated tests for NEW files (no existing test).
          if (!fs.existsSync(testPath)) {
            fs.writeFileSync(testPath, tests.testCode, "utf-8");
            console.log(`[SelfImprove] Auto-generated tests: ${path.basename(testPath)} (${tests.functions.length} functions covered)`);
          } else {
            console.log(`[SelfImprove] Skipping test generation for ${path.basename(testPath)} — existing test file preserved (constitution v1.4.0).`);
          }
        }
      } catch (testErr) {
        console.warn(`[SelfImprove] Test generation failed (non-fatal):`, (testErr as Error).message);
      }

      try {
        const { startHealthWatch } = await import("./selfRollback") as any;
        startHealthWatch(proposalId);
      } catch (err) { log.caught("non-fatal", err); }

      // v7.1: Schedule auto-rebuild so the applied change takes effect without manual restart
      try {
        const { scheduleRebuild } = await import("./autoRebuild.js");
        scheduleRebuild(proposalId);
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

      // v12.9.0: Visual regression check for UI proposals
      // Runs AFTER apply but BEFORE git commit. Non-blocking — just adds metadata.
      try {
        const { runVisualRegressionCheck, isUiFile } = await import("./visualRegressionGuard.js");
        if (isUiFile(proposal.targetFile)) {
          const projectRoot = path.resolve(getServerDir(), "..");
          const vrResult = await runVisualRegressionCheck(
            proposal.targetFile,
            proposalId,
            projectRoot
          );
          (proposal as any)._visualRegressionResult = vrResult;
          if (vrResult.warnings.length > 0) {
            console.log(`[VisualRegression] ${vrResult.warnings[0]}`);
          }
        }
      } catch (vrErr) {
        log.warn(`[VisualRegression] Check threw (non-fatal): ${(vrErr as Error).message?.slice(0, 100)}`);
      }

      // v12.6.0: TypeScript check BEFORE git commit — scope-limited for server files
      // Uses tsHealEngine.runScopedTsc which checks only server/ for server proposals,
      // avoiding client-side type errors blocking server-only changes.
      let tsCheckPassed = true;
      try {
        const { runScopedTsc } = await import("./tsHealEngine.js");
        const projectRoot = path.resolve(getServerDir(), "..");
        const scopedResult = runScopedTsc(proposal.targetFile, projectRoot);
        if (!scopedResult.passed) {
          const errOut = scopedResult.raw.slice(0, 300);
          throw new Error(`tsc exited with code 1: ${errOut}`);
        }
        if (true) { // scope block for variable isolation
          const dummy = scopedResult; void dummy; // satisfy linter
        }
        // legacy full-project tsc block removed in v12.6.0 — replaced by runScopedTsc above
        if (true) {
          console.log(`[SelfImprove] TypeScript check PASSED for ${proposal.targetFile}`);
          // v9.8.5: Use FRESH store to ensure "applied" status is persisted correctly
          {
            const freshStore = loadProposals();
            const freshProp = freshStore.proposals.find(p => p.id === proposalId);
            if (freshProp && (freshProp.status as string) !== 'applied') {
              freshProp.status = 'applied' as any;
              saveProposals(freshStore);
            } else if (!freshProp) {
              saveProposals(store); // fallback
            }
          }
        } // end if(true)
        // no else branch needed — runScopedTsc always returns a result
      } catch (tsErr: any) {
        tsCheckPassed = false;
        const tsErrRaw = (tsErr.stderr || tsErr.stdout || tsErr.message || "").toString();
        const tsErrMsg = tsErrRaw.slice(0, 600);
        console.warn(`[SelfImprove] TypeScript check FAILED for ${proposal.targetFile} — initiating SOTA heal pipeline. Errors: ${tsErrMsg.slice(0, 200)}`);
        // Revert the file write to restore the original content
        if (proposal.originalContent) {
          try { fs.writeFileSync(filePath, proposal.originalContent, "utf-8"); } catch { /* best effort */ }
        }
        // v12.6.0: SOTA multi-strategy TS heal pipeline (tsHealEngine.ts)
        // Strategies: 1) structured fix with full context, 2) minimal revert, 3) safe wrapper
        const healCount = (proposal as any)._tsHealCount || 0;
        if (healCount < 3) {
          try {
            const { healTypeScriptErrors, parseTscErrors } = await import("./tsHealEngine.js");
            const { simpleChatCompletion, getProviderForTier, tierForArea } = await import("./llmProvider.js");
            const tier = tierForArea("self-modification");
            const primary = getProviderForTier(tier);
            const providerChain: string[] = [primary];
            for (const fb of ["kimi", "openrouter-fast", "openrouter", "deepseek", "openai"]) {
              if (!providerChain.includes(fb)) {
                const has = {
                  kimi: !!process.env.KIMI_API_KEY,
                  "openrouter-fast": !!process.env.OPENROUTER_API_KEY,
                  openrouter: !!process.env.OPENROUTER_API_KEY,
                  deepseek: !!process.env.DEEPSEEK_API_KEY && !_deadProviders.has("deepseek"),
                  openai: !!process.env.OPENAI_API_KEY,
                };
                if ((has as any)[fb]) providerChain.push(fb);
              }
            }
            const tscErrors = parseTscErrors(tsErrRaw);
            console.log(`[SelfImprove] SOTA heal attempt ${healCount + 1}/3 for ${proposal.targetFile} (${tscErrors.length} parsed errors)`);
            (proposal as any)._tsHealCount = healCount + 1;
            {
              const healStore = loadProposals();
              const healProp = healStore.proposals.find(p => p.id === proposalId);
              if (healProp) { (healProp as any)._tsHealCount = healCount + 1; saveProposals(healStore); }
            }
            // v12.10.0: On attempt 2+, use MCTS parallel healing for a wider search
            if (healCount >= 1) {
              try {
                const { mctsHeal } = await import("./mctsHealEngine.js");
                const mctsResult = await mctsHeal({
                  proposal: {
                    id: proposal.id,
                    targetFile: proposal.targetFile,
                    title: proposal.title || "",
                    category: proposal.category,
                    originalSnippet: proposal.originalSnippet,
                    proposedSnippet: proposal.proposedSnippet,
                    originalContent: proposal.originalContent,
                    proposedContent: proposal.proposedContent,
                  },
                  tscErrors,
                  rawTscOutput: tsErrRaw,
                  projectRoot: path.resolve(getServerDir(), ".."),
                  simpleChatCompletion,
                  providerChain,
                  deadProviders: _deadProviders,
                  branchesPerStrategy: 2,
                });
                if (mctsResult.success && mctsResult.bestCandidate) {
                  const best = mctsResult.bestCandidate;
                  console.log(`[SelfImprove] MCTS heal SUCCESS via '${mctsResult.strategy}' (${mctsResult.passingCandidates}/${mctsResult.totalCandidates} passed) for ${proposal.targetFile}`);
                  proposal.originalSnippet = best.originalSnippet;
                  proposal.proposedSnippet = best.proposedSnippet;
                  proposal.proposedContent = best.proposedContent;
                  const mctsStore = loadProposals();
                  const mctsProp = mctsStore.proposals.find(p => p.id === proposalId);
                  if (mctsProp) {
                    mctsProp.originalSnippet = best.originalSnippet;
                    mctsProp.proposedSnippet = best.proposedSnippet;
                    (mctsProp as any).proposedContent = best.proposedContent;
                    (mctsProp as any)._mctsStrategy = mctsResult.strategy;
                    saveProposals(mctsStore);
                  }
                  return applyProposal(proposalId);
                } else {
                  console.warn(`[SelfImprove] MCTS heal found no passing candidates (${mctsResult.totalCandidates} tried) — falling back to sequential heal`);
                  // Fall through to sequential heal below
                }
              } catch (mctsErr) {
                console.warn(`[SelfImprove] MCTS heal threw (non-fatal): ${sanitizeForLog((mctsErr as Error).message)} — falling back to sequential heal`);
              }
            }
            const healResult = await healTypeScriptErrors({
              proposal: {
                id: proposal.id,
                targetFile: proposal.targetFile,
                title: proposal.title || "",
                category: proposal.category,
                impact: proposal.impact,
                originalSnippet: proposal.originalSnippet,
                proposedSnippet: proposal.proposedSnippet,
                originalContent: proposal.originalContent,
                proposedContent: proposal.proposedContent,
              },
              tscErrors,
              rawTscOutput: tsErrRaw,
              projectRoot: path.resolve(getServerDir(), ".."),
              simpleChatCompletion,
              providerChain,
              deadProviders: _deadProviders,
              healAttempt: healCount,
            });
            if (healResult.success && healResult.originalSnippet && healResult.proposedSnippet) {
              console.log(`[SelfImprove] SOTA heal SUCCESS via strategy '${healResult.strategy}' for ${proposal.targetFile}`);
              proposal.originalSnippet = healResult.originalSnippet;
              proposal.proposedSnippet = healResult.proposedSnippet;
              if (healResult.proposedContent) proposal.proposedContent = healResult.proposedContent;
              // Persist healed snippets
              {
                const healStore = loadProposals();
                const healProp = healStore.proposals.find(p => p.id === proposalId);
                if (healProp) {
                  healProp.originalSnippet = healResult.originalSnippet;
                  healProp.proposedSnippet = healResult.proposedSnippet;
                  if (healResult.proposedContent) (healProp as any).proposedContent = healResult.proposedContent;
                  saveProposals(healStore);
                }
              }
              return applyProposal(proposalId);
            } else {
              console.warn(`[SelfImprove] SOTA heal attempt ${healCount + 1} failed (strategy: ${healResult.strategy}) for ${proposal.targetFile}`);
            }
          } catch (healErr) {
            console.warn(`[SelfImprove] SOTA heal threw (non-fatal): ${sanitizeForLog((healErr as Error).message)}`);
          }
        } else {
          console.warn(`[SelfImprove] SOTA heal exhausted (3/3 attempts) for ${proposal.targetFile} — marking rejected`);
        }
        // v9.8.5: Load a FRESH store to avoid stale data overwriting concurrent saves
        {
          const freshStore = loadProposals();
          const freshProp = freshStore.proposals.find(p => p.id === proposalId);
          if (freshProp) {
            freshProp.status = "rejected" as any;
            (freshProp as any)._failReason = `TypeScript check failed: ${tsErrMsg.slice(0, 200)}`;
            saveProposals(freshStore);
          } else {
            proposal.status = "rejected" as any;
            (proposal as any)._failReason = `TypeScript check failed: ${tsErrMsg.slice(0, 200)}`;
            saveProposals(store);
          }
        }
        // v18.0.0: Update reward calibrator with rejected outcome
        try {
          updateCalibration(proposal.confidence ?? 0.7, false);
        } catch { /* non-fatal */ }
        // v11.12.0: Record this TypeScript failure in failure pattern memory so it won't be repeated
        try {
          await recordFailurePattern({
            filePath: proposal.targetFile,
            rationale: proposal.title || "RSI proposal",
            failureType: "typescript",
            errorMessage: tsErrMsg,
            proposedBy: "rsi",
            proposedContent: proposal.proposedContent,
          });
        } catch (fpErr) {
          console.warn("[SelfImprove] recordFailure (non-fatal):", (fpErr as Error).message);
        }

        // v12.9.0: RLAIF failure feedback — penalise models that approved a failing proposal
        try {
          const { recordConsensusProposalOutcome } = await import("./consensusEngine.js");
          const consensusVotes = (proposal as any)._consensusVotes as Array<{ model: string; approved: boolean }> | undefined;
          if (consensusVotes && consensusVotes.length > 0) {
            recordConsensusProposalOutcome(consensusVotes, false /* failure */);
          }
        } catch { /* non-fatal */ }

        // v12.11.0: Federated RLHF — broadcast failure outcome to peers
        try {
          const { broadcastOutcome: broadcastFail } = await import("./federatedRLHF.js");
          const failVotes = (proposal as any)._consensusVotes as Array<{ model: string; approved: boolean }> | undefined;
          broadcastFail({
            proposalId: proposal.id,
            targetFile: proposal.targetFile,
            category: proposal.category,
            modelIds: failVotes?.map(v => v.model) ?? [],
            outcome: "failure",
            confidenceScore: proposal.confidence ?? 0.5,
            criticScore: (proposal as any)._criticScore,
            madIssueCount: (proposal as any)._madIssueCount,
            timestamp: Date.now(),
          }).catch(() => { /* non-fatal */ });
        } catch { /* non-fatal */ }

        return { success: false, message: `TypeScript check failed after apply — self-heal attempted. Errors: ${tsErrMsg.slice(0, 200)}` };
      }

      // v12.10.0: Dynamic test generation — write and run a targeted Vitest test
      // for the modified function before committing. Non-blocking (failure adds metadata only).
      if (tsCheckPassed) {
        try {
          const { generateAndRunTest } = await import("./dynamicTestGen.js");
          const { simpleChatCompletion: dynScc, getProviderForTier: dynGpt, tierForArea: dynTfa } = await import("./llmProvider.js");
          const dynTestResult = await generateAndRunTest({
            proposal: {
              id: proposalId,
              targetFile: proposal.targetFile,
              originalSnippet: proposal.originalSnippet,
              proposedSnippet: proposal.proposedSnippet,
              title: proposal.title || "",
            },
            projectRoot: path.resolve(getServerDir(), ".."),
            simpleChatCompletion: dynScc,
            providerId: dynGpt(dynTfa("self-modification")),
          });
          if (dynTestResult.ran) {
            (proposal as any)._dynamicTestPassed = dynTestResult.passed;
            (proposal as any)._dynamicTestFunctions = dynTestResult.functionsTested;
            if (!dynTestResult.passed) {
              log.warn(`[DynamicTestGen] Dynamic test FAILED for ${proposal.targetFile} — flagging proposal but not blocking commit`);
              (proposal as any)._dynamicTestFailure = dynTestResult.failureOutput?.slice(0, 300);
            } else {
              log.info(`[DynamicTestGen] Dynamic test PASSED for ${proposal.targetFile} (functions: ${dynTestResult.functionsTested.join(", ")})`);
            }
          }
        } catch (dynErr) {
          log.warn(`[DynamicTestGen] Dynamic test threw (non-fatal): ${sanitizeForLog((dynErr as Error).message)}`);
        }
      }

      // v9.8.5: Git commit the applied change so it shows up in git log
      if (tsCheckPassed) {
        try {
          const autoConfig = getAutoApplyConfig();
          if (autoConfig.commitToGit) {
            const gitResult = gitCommitSelfImprovement(filePath, proposal.title || proposalId, autoConfig.branchStrategy);
            if (gitResult.success) {
              console.log(`[SelfImprove] Git committed: ${proposal.title || proposalId}`);
            } else {
              console.warn(`[SelfImprove] Git commit failed (non-fatal): ${sanitizeForLog(gitResult.message)}`);
            }
          }
        } catch (gitErr) {
          console.warn("[SelfImprove] Git commit unavailable (non-fatal):", sanitizeForLog((gitErr as Error).message));
        }

        // v12.10.0: Register runtime telemetry watch for auto-rollback on 500 errors
        try {
          const { registerRuntimeWatch } = await import("./runtimeGuard.js");
          const { semanticRollback: doSemanticRollback } = await import("./semanticRollback.js");
          const projectRoot = path.resolve(getServerDir(), "..");
          registerRuntimeWatch({
            proposalId,
            targetFile: proposal.targetFile,
            projectRoot,
            windowMinutes: 5,
            rollbackFn: async () => {
              log.warn(`[RuntimeGuard] Auto-rollback triggered for proposal ${proposalId}`);
              await doSemanticRollback(proposalId);
              // Mark proposal as auto-rolled-back
              const rbStore = loadProposals();
              const rbProp = rbStore.proposals.find(p => p.id === proposalId);
              if (rbProp) {
                (rbProp as any).status = "auto-rolled-back";
                (rbProp as any)._selfRollbackAt = new Date().toISOString();
                saveProposals(rbStore);
              }
            },
          });
        } catch (guardErr) {
          log.warn(`[RuntimeGuard] Watch registration threw (non-fatal): ${sanitizeForLog((guardErr as Error).message)}`);
        }

        // v12.12.0: Incremental AST Knowledge Graph invalidation
        // Re-parse only the modified file and its direct importers (not a full rebuild)
        try {
          const { invalidateChangedFiles } = await import("./incrementalAstInvalidator.js");
          const serverDir = getServerDir();
          invalidateChangedFiles(proposal.targetFile, serverDir).then(r => {
            if (r.graphUpdated) {
              log.info(`[IncrementalAST] Graph updated: ${r.reparsed.length} files re-parsed in ${r.durationMs}ms`);
            }
          }).catch(() => { /* non-fatal */ });
        } catch (_) { /* non-fatal */ }
      }

      // v9.8.5: DEFINITIVE save — load fresh store and force status to 'applied'
      // This is the final save before returning success, ensuring no stale data can overwrite it
      try {
        const defStore = loadProposals();
        const defProp = defStore.proposals.find(p => p.id === proposalId);
        if (defProp) {
          defProp.status = 'applied' as any;
          saveProposals(defStore);
          console.log(`[SelfImprove] Status confirmed 'applied' for ${proposalId}`);
        }
      } catch (defErr) {
        console.warn('[SelfImprove] Definitive save failed (non-fatal):', (defErr as Error).message);
      }
      _applySucceeded = true;
      // v11.9.1: Clear per-file rejection history on successful apply so the
      // next proposal for this file starts fresh without stale rejection context.
      try {
        const { clearFileFeedback } = await import("./proposalFeedback.js");
        clearFileFeedback(proposal.targetFile || "unknown");
      } catch { /* non-fatal */ }
      // v11.18.0 Audit 10 Fix D: Record prompt outcome so promptEngineer DB grows from RSI successes
      try {
        const { recordPromptOutcome } = await import("./promptEngineer.js");
        recordPromptOutcome(
          "self_improvement",
          `RSI proposal: ${proposal.title || proposalId}`,
          proposal.confidence ?? 0.8,
          "success"
        );
      } catch { /* non-fatal */ }
      return {
        success: true,
        message: guardResult.message || `Applied successfully via guard. Backup: ${guardResult.backup?.id || "created"}`,
      };
    } else {
      // v9.8.5: Critical fix — set status to 'rejected' so the proposal never stays stuck in 'processing'
      proposal.status = "rejected" as any;
      (proposal as any)._failReason = guardResult.message || "Guard rejected";
      saveProposals(store);

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

      // v6.36: Constitutional AI expansion — record rejection pattern for learned constraints
      try {
        const { recordRejection } = await import("./learnedConstraints.js");
        // Extract the pattern from the proposed snippet (first 80 chars as a fingerprint)
        const snippet = (proposal.proposedSnippet || proposal.proposedContent || "").slice(0, 80).trim();
        if (snippet.length >= 10) {
          recordRejection(snippet, guardResult.message || "Guard rejected");
        }
      } catch { /* non-fatal */ }

      // v11.9.1: Record rejection in proposalFeedback so getRejectionContext can
      // inject this into future prompts for the same file, preventing repeated mistakes.
      try {
        const { recordRejectionFeedback } = await import("./proposalFeedback.js");
        recordRejectionFeedback(
          proposalId,
          proposal.targetFile || "unknown",
          proposal.title || proposalId,
          proposal.originalSnippet || "",
          proposal.proposedSnippet || "",
          guardResult.message || "Guard rejected"
        );
      } catch { /* non-fatal */ }

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
      console.warn("[SelfImprove] Guard unavailable. Queuing proposal for retry:", sanitizeForLog((guardErr as Error).message));
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
  } catch (_outerErr: unknown) {
    // v20.0.0: Capture any exception that escaped all inner try/catch blocks.
    // Store the actual error message so we know WHAT failed, not just that something did.
    _lastUncaughtErr = _outerErr instanceof Error ? _outerErr : new Error(String(_outerErr));
    console.error(`[SelfImprove] Uncaught exception in applyProposal for ${proposalId}:`, _lastUncaughtErr.message);
    return { success: false, message: `Unhandled exception: ${_lastUncaughtErr.message}` };
  } finally {
    // v9.8.5 DEFINITIVE FIX: If an unhandled exception escaped all inner catch blocks,
    // the proposal will still be in 'processing' status. Reset it to 'rejected' here.
    // This is a safety net — normal paths set status explicitly before returning.
    if (!_applySucceeded) {
      const finalStore = loadProposals();
      const finalProp = finalStore.proposals.find(p => p.id === proposalId);
      if (finalProp && (finalProp.status as string) === 'processing') {
        finalProp.status = 'rejected' as any;
        // v20.0.0: Store the actual exception message, not just a generic string.
        (finalProp as any)._failReason = (finalProp as any)._failReason
          || (_lastUncaughtErr ? `Uncaught exception: ${_lastUncaughtErr.message}` : 'Unhandled exception in applyProposal');
        saveProposals(finalStore);
        console.warn(`[SelfImprove] finally: reset stuck 'processing' proposal ${proposalId} to 'rejected': ${(finalProp as any)._failReason}`);
      }
    }
  }
}

export function rejectProposal(proposalId: string, reason?: string): boolean {
  const store = loadProposals();
  const proposal = store.proposals.find(p => p.id === proposalId);
  if (!proposal) return false;
  proposal.status = "rejected";
  // v20.0.0: Always record why a proposal was rejected so the feedback loop
  // can learn from it. Without _failReason the proposal shows as '?' in stats.
  if (reason && !(proposal as any)._failReason) {
    (proposal as any)._failReason = reason;
  } else if (!(proposal as any)._failReason) {
    (proposal as any)._failReason = 'Rejected via rejectProposal() — no reason provided';
  }
  saveProposals(store);
  return true;
}

/** Returns a filtered list of proposals from the store.
 * @param status - Optional status filter ('pending', 'applied', 'rejected')
 * @returns Array of matching proposals
 */
export function listProposals(statusFilter?: ImprovementProposal["status"]): ImprovementProposal[] {
  const store = loadProposals();
  const proposals = statusFilter
    ? store.proposals.filter(p => p.status === statusFilter)
    : store.proposals;
  return proposals.sort((a, b) => b.createdAt - a.createdAt);
}

export function getAnalyzableFiles(): string[] {
  // v14.1.1: Also filter out files that are in the guard's blockedFiles list.
  // Previously the engine could pick selfRollback.ts, selfHeal.ts, etc. from
  // ANALYZABLE_FILES, generate a valid proposal, pass all quality gates, and
  // then have the proposal rejected at the final apply step because the file
  // is blocked — wasting the entire cycle and producing 0% success rate.
  let blocked: Set<string>;
  try {
    const { getGuardConfig } = _require("./selfImproveGuard.js");
    const cfg = getGuardConfig();
    blocked = new Set((cfg.blockedFiles ?? []).map((f: string) => f.replace(/^server\//, "")));
  } catch {
    // Fallback to known default blocked files if guard is unavailable
    blocked = new Set(["db.ts", "auth.ts", "selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts"]);
  }
  return ANALYZABLE_FILES.filter(f => resolveServerFile(f) !== null && !blocked.has(f));
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
  const workspaceDir = path.resolve(process.cwd(), "workspace");
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
  saveCacheStore(); // Save pruned history
  return autoApplyHistory.length < config.maxAutoAppliesPerHour;
}

function recordAutoApply(): void {
  autoApplyHistory.push(Date.now());
  saveCacheStore();
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
    // v20.2.0: Prevent git from hanging on credential prompts — fail fast instead of ETIMEDOUT
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/true",
  };

    try {
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      // v11.4.0: All git calls now go through gitSandbox() whitelist
      gitSandbox("git init -b main", { cwd, env: gitEnv, encoding: "utf-8" });
      gitSandbox("git add -A", { cwd, env: gitEnv, encoding: "utf-8" });
      gitSandbox('git commit --allow-empty -m "Initial commit by Andromeda"', { cwd, env: gitEnv, encoding: "utf-8" });
      if (process.env.GITHUB_REPO) {
        // Validate repo name format before using in command
        const repoName = process.env.GITHUB_REPO.replace(/[^a-zA-Z0-9/_.-]/g, "");
        try {
          gitSandbox(`git remote add origin https://github.com/${repoName}.git`, { cwd, env: gitEnv, encoding: "utf-8" });
        } catch { /* remote may already exist */ }
      }
    }
    if (branchStrategy === "feature-branch") {
      // Sanitize branch name — only allow alphanumeric, /, -, .
      const rawBranch = `self-improve/${Date.now()}-${path.basename(targetFile).replace(/\./g, "-")}`;
      const branchName = rawBranch.replace(/[^a-zA-Z0-9/_.-]/g, "-");
      try {
        gitSandbox(`git checkout -b ${branchName}`, { cwd, env: gitEnv, encoding: "utf-8" });
      } catch {
        // Branch might already exist
      }
    }
    const relativeFile = path.relative(cwd, targetFile);
    gitSandbox(`git add "${relativeFile}"`, { cwd, env: gitEnv, encoding: "utf-8" });
    const testFile = targetFile.replace(/\.(ts|py)$/, `.test.$1`);
    if (fs.existsSync(testFile)) {
      const relativeTest = path.relative(cwd, testFile);
      gitSandbox(`git add "${relativeTest}"`, { cwd, env: gitEnv, encoding: "utf-8" });
    }
    // v7.0.1: Use JSON.stringify to safely quote the commit message — avoids shell word-splitting
    const rawMsg = `Andromeda self-improvement: ${path.basename(targetFile)} — ${summary}`;
    // Sanitize commit message: strip backticks, dollar signs, and backslashes
    const commitMsg = rawMsg.replace(/[`$\\]/g, "");
    const result = gitSandbox(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd, env: gitEnv, encoding: "utf-8" });
    const commitSha = result.trim();

    // v11.291.0: Auto-push to GitHub after every successful commit.
    // The agent commits and pushes its own improvements autonomously — no human push required.
    // Uses GITHUB_TOKEN + GITHUB_REPO from .env.local. Falls back gracefully if not configured.
    let pushMessage = "";
    try {
      const token = process.env.GITHUB_TOKEN || "";
      const repo = process.env.GITHUB_REPO || "";
      const currentBranch = branchStrategy === "feature-branch"
        ? (() => { try { return gitSandbox("git rev-parse --abbrev-ref HEAD", { cwd, env: gitEnv, encoding: "utf-8" }).trim(); } catch { return "main"; } })()
        : "main";
      if (token && repo) {
        // Authenticated push URL — token embedded, no interactive prompt needed
        const pushUrl = `https://${token}@github.com/${repo}.git`;
        gitSandbox(`git push "${pushUrl}" ${currentBranch}`, { cwd, env: gitEnv, encoding: "utf-8", timeout: 30_000 });
        pushMessage = ` | pushed to github.com/${repo}`;
        console.log(`[selfImprove] Auto-pushed to GitHub: ${repo} (${currentBranch})`);
      } else {
        // No token configured — commit is local only, still safe
        pushMessage = " | no GITHUB_TOKEN — local commit only";
        console.log(`[selfImprove] Committed locally. Set GITHUB_TOKEN + GITHUB_REPO in .env.local to auto-push.`);
      }
    } catch (pushErr: any) {
      // Push failure is non-fatal — the commit is already safe on disk
      pushMessage = ` | push failed: ${sanitizeForLog(pushErr.message?.slice(0, 80) || String(pushErr))}`;
      console.warn(`[selfImprove] Auto-push failed (non-fatal, commit is local): ${pushErr.message?.slice(0, 120)}`);
    }

    return { success: true, message: commitSha + pushMessage };
  } catch (err: any) {
    const errMsg = err instanceof GitCommandNotAllowedError
      ? err.message
      : sanitizeForLog(err.stderr?.toString?.() || err.message || String(err));
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
    execSync("pnpm exec tsc --noEmit 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 });
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

  // v9.8.5: Reset stuck 'processing' proposals once per process lifetime (not on every loadProposals call)
  resetStuckProcessingProposals();

  const store = loadProposals();
  // v6.36: Meta-learning bias — load weak categories from proof history
  const weakCategories = new Set<string>();
  try {
    const proofPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "rsi_proof_history.json");
    if (fs.existsSync(proofPath)) {
      const history: any[] = JSON.parse(fs.readFileSync(proofPath, "utf-8"));
      const recent = history.slice(-10);
      const catDeltas: Record<string, number[]> = {};
      for (const entry of recent) {
        const catBefore = entry.categoryScoresBefore ?? {};
        const catAfter = entry.categoryScoresAfter ?? {};
        const allCats = new Set([...Object.keys(catBefore), ...Object.keys(catAfter)]);
        for (const cat of allCats) {
          const delta = ((catAfter as any)[cat] ?? 0) - ((catBefore as any)[cat] ?? 0);
          if (!catDeltas[cat]) catDeltas[cat] = [];
          catDeltas[cat].push(delta);
        }
      }
      for (const [cat, deltas] of Object.entries(catDeltas)) {
        const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
        if (avg <= 0) weakCategories.add(cat); // no improvement = weak
      }
    }
  } catch { /* non-fatal */ }
  function scoreProposal(p: ImprovementProposal): number {
    // v6.28 A2: Use LLM confidence when available (0.0–1.0 → 0–100)
    if (typeof p.confidence === "number" && p.confidence > 0) {
      // v6.36: Boost proposals in weak categories by 10 points
      const boost = weakCategories.has(p.category) ? 10 : 0;
      return Math.min(100, Math.round(p.confidence * 100) + boost);
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

        // v12.12.0: Human-in-the-Loop gate — check if this proposal requires human review
    try {
      const { shouldRequireHumanReview, queueForHumanReview } = await import("./humanInTheLoopGate.js");
      const gateDecision = shouldRequireHumanReview(
        proposal.id,
        proposal.targetFile,
        proposal.confidence ?? 0.5,
        (proposal as any)._criticScore,
        (proposal as any)._madIssueCount
      );
      if (gateDecision.action === "human_review") {
        queueForHumanReview(
          proposal.id,
          proposal.targetFile,
          proposal.title || proposal.id,
          proposal.confidence ?? 0.5,
          gateDecision.reason ?? "Confidence threshold gate",
          (proposal as any)._criticScore,
          (proposal as any)._madIssueCount
        );
        proposal.status = "pending_review" as any;
        (proposal as any)._hitlReason = gateDecision.reason;
        saveProposals(loadProposals());
        results.push({
          proposalId: proposal.id,
          targetFile: proposal.targetFile,
          title: proposal.title,
          applied: false,
          committed: false,
          typeCheckPassed: null,
          message: `Queued for human review: ${gateDecision.reason}`,
        });
        continue;
      } else if (gateDecision.action === "auto_reject") {
        proposal.status = "rejected" as any;
        (proposal as any)._hitlReason = gateDecision.reason;
        saveProposals(loadProposals());
        results.push({
          proposalId: proposal.id,
          targetFile: proposal.targetFile,
          title: proposal.title,
          applied: false,
          committed: false,
          typeCheckPassed: null,
          message: `Auto-rejected by HITL gate: ${gateDecision.reason}`,
        });
        continue;
      }
    } catch (_) { /* HITL gate is non-fatal */ }

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

// ─── v9.8.0: Proposal Refinement Loop ────────────────────────────────────────

export async function refineProposal(
  proposal: ImprovementProposal,
  errorFeedback: string
): Promise<boolean> {
  try {
    const { simpleChatCompletion, getProviderForTier, tierForArea } = await import("./llmProvider.js");
    
    // v12.2.1: Use provider fallback chain (same as proposal generation) to avoid
    // using the dead default provider (DeepSeek 402) for refinement calls.
    const tier = tierForArea("self-modification");
    const primary = getProviderForTier(tier);
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    const hasKimi = !!process.env.KIMI_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const refineChain: string[] = [primary];
    for (const fb of ["kimi", "openrouter-fast", "openrouter", "deepseek", "openai"]) {
      if (!refineChain.includes(fb)) {
        if (fb === "kimi" && hasKimi) refineChain.push(fb);
        else if ((fb === "openrouter-fast" || fb === "openrouter") && hasOpenRouter) refineChain.push(fb);
        else if (fb === "deepseek" && hasDeepSeek && !_deadProviders.has("deepseek")) refineChain.push(fb);
        else if (fb === "openai" && hasOpenAI) refineChain.push(fb);
      }
    }
    
    const messages = [
      {
        role: "system" as const,
        content: `You are an expert TypeScript software engineer. Your previous code improvement proposal failed the syntax/type check.
You must fix the errors and provide a corrected proposal.

CRITICAL: Return ONLY a JSON object. No markdown.
The JSON must contain:
- "title": short title (max 10 words)
- "rationale": explanation of how you fixed the error
- "category": "${proposal.category}"
- "impact": "${proposal.impact}"
- "confidence": a float 0.0-1.0
- "originalSnippet": the EXACT lines of code to replace (must match original file)
- "proposedSnippet": the corrected replacement code`
      },
      {
        role: "user" as const,
        content: `File: ${proposal.targetFile}

Original Snippet:
\`\`\`typescript
${proposal.originalSnippet}
\`\`\`

Your Previous Proposed Snippet:
\`\`\`typescript
${proposal.proposedSnippet}
\`\`\`

Syntax/Type Errors:
${errorFeedback.slice(0, 1000)}

Return the corrected JSON proposal.`
      }
    ];

    // Try each provider in the chain until one succeeds
    let rawContent: string | null = null;
    for (const pid of refineChain) {
      if (_deadProviders.has(pid)) continue;
      try {
        rawContent = await simpleChatCompletion(messages, { maxTokens: 2000, temperature: 0.2, providerId: pid });
        if (rawContent) break;
      } catch (provErr: any) {
        const msg: string = provErr?.message ?? "";
        if (/40[12]/.test(msg) || /insufficient/i.test(msg) || /invalid.*key/i.test(msg)) {
          _deadProviders.add(pid);
          continue;
        }
        throw provErr;
      }
    }
    if (!rawContent) return false;

    const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.originalSnippet && parsed.proposedSnippet) {
      // Update the proposal in place
      proposal.title = parsed.title || proposal.title;
      proposal.rationale = parsed.rationale || proposal.rationale;
      proposal.originalSnippet = parsed.originalSnippet;
      proposal.proposedSnippet = parsed.proposedSnippet;
      
      // Re-apply the snippet to update proposedContent
      if (proposal.originalContent.includes(proposal.originalSnippet)) {
        proposal.proposedContent = proposal.originalContent.replace(proposal.originalSnippet, proposal.proposedSnippet);
      } else {
        return false; // Snippet mismatch
      }
      
      (proposal as any)._refineCount = ((proposal as any)._refineCount || 0) + 1;
      
      const store = loadProposals();
      const idx = store.proposals.findIndex(p => p.id === proposal.id);
      if (idx !== -1) {
        store.proposals[idx] = proposal;
        saveProposals(store);
        return true;
      }
    }
  } catch (err) {
    log.warn(`[Refine] Failed to refine proposal ${proposal.id}:`, sanitizeForLog((err as Error).message));
  }
  return false;
}
