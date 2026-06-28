/**
 * Andromeda v5.28 — Self-Model (Runtime Meta-Cognitive State)
 *
 * Provides a live, queryable model of Andromeda's current state:
 * - What capabilities are available and their health
 * - What goals are active and their progress
 * - Current resource usage (tokens, memory, API calls)
 * - Recent activity and performance trends
 *
 * This enables Andromeda to answer "what am I?" and "what can I do?"
 * without scanning all files — it's a cached, real-time self-representation.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { getContextWindow } from "./modelRegistry";
import { join } from "path";

// v6.03: Read version from package.json to prevent version drift
function readPackageVersion(): string {
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}
const PACKAGE_VERSION = readPackageVersion();

// v5.29: Static imports for capability discovery (dynamic import/require doesn't work in esbuild bundle)
import * as _selfHeal from "./selfHeal";
import * as _selfModify from "./selfModify";
import * as _selfImprove from "./selfImprove";
import * as _recursiveGoals from "./recursiveGoals";
import * as _streamIntegrityMonitor from "./streamIntegrityMonitor";
import * as _tokenBudgetManager from "./tokenBudgetManager";
import * as _hotReload from "./hotReload";
import * as _gracefulDegradation from "./gracefulDegradation";
import * as _recursionGuard from "./recursionGuard";
import * as _skillGraph from "./skillGraph";
import * as _consensusEngine from "./consensusEngine";
import * as _continuousImprover from "./continuousImprover";
import * as _selfMonitor from "./selfMonitor";
import * as _selfKnowledgeBase from "./selfKnowledgeBase";
// v5.34: Lazy import to break circular dependency (autonomyOrchestrator ↔ selfModel)
let _autonomyOrchestrator: any = null;
async function getAutonomyOrchestrator() {
  if (!_autonomyOrchestrator) {
    _autonomyOrchestrator = await import("./autonomyOrchestrator");
  }
  return _autonomyOrchestrator;
}
import * as _sandboxManager from "./sandboxManager";
import * as _multiAgent from "./multiAgent";
import * as _memory from "./memory";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CapabilityStatus {
  name: string;
  module: string;
  enabled: boolean;
  health: "healthy" | "degraded" | "unavailable";
  lastChecked: number;
  description: string;
}

export interface ActiveGoal {
  id: string;
  title: string;
  status: string;
  progress: number; // 0-100
  startedAt: number;
}

export interface ResourceUsage {
  tokensUsedToday: number;
  tokenBudgetRemaining: number;
  apiCallsToday: number;
  memoryEntriesCount: number;
  activeConnections: number;
}

export interface PerformanceTrend {
  metric: string;
  direction: "improving" | "stable" | "degrading";
  value: number;
  baseline: number;
}

export interface SelfModelState {
  version: string;
  identity: string;
  uptime: number;
  lastUpdated: number;
  capabilities: CapabilityStatus[];
  activeGoals: ActiveGoal[];
  resources: ResourceUsage;
  trends: PerformanceTrend[];
  recentActions: Array<{ action: string; timestamp: number; result: string }>;
  currentModel: string;
  contextWindow: number;
}

// ── State ───────────────────────────────────────────────────────────────────

const DATA_PATH = join(process.cwd(), "data", "self_model.json");
const startTime = Date.now();

let state: SelfModelState = {
  version: PACKAGE_VERSION, // v6.03: dynamic from package.json (was hardcoded "5.92")
  identity: "Andromeda — Autonomous Self-Improving AI System",
  uptime: 0,
  lastUpdated: Date.now(),
  capabilities: [],
  activeGoals: [],
  resources: {
    tokensUsedToday: 0,
    tokenBudgetRemaining: 0,
    apiCallsToday: 0,
    memoryEntriesCount: 0,
    activeConnections: 0,
  },
  trends: [],
  recentActions: [],
  currentModel: process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat",
  contextWindow: getContextWindow(process.env.LLM_MODEL || process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat"),
};

// ── Persistence ─────────────────────────────────────────────────────────────

function loadState(): void {
  try {
    if (existsSync(DATA_PATH)) {
      const raw = readFileSync(DATA_PATH, "utf-8");
      try {
        const saved = JSON.parse(raw);
        state = { ...state, ...saved };
      } catch {
        console.warn("[SelfModel] Corrupted state file, starting fresh");
      }
    }
  } catch { /* start fresh */ }
}

function saveState(): void {
  try {
    writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
  } catch { /* non-critical */ }
}

// ── Capability Discovery ────────────────────────────────────────────────────

const CAPABILITY_MAP: Array<{ name: string; module: string; description: string }> = [
  { name: "Self-Healing", module: "selfHeal", description: "Detects and recovers from runtime errors automatically" },
  { name: "Self-Modification", module: "selfModify", description: "Modifies own source code with safety checks" },
  { name: "Self-Improvement", module: "selfImprove", description: "Analyzes code and generates improvement proposals" },
  { name: "Goal Management", module: "recursiveGoals", description: "Tracks and executes hierarchical goals" },
  { name: "Stream Integrity", module: "streamIntegrityMonitor", description: "Detects truncated or incomplete outputs" },
  { name: "Token Budget", module: "tokenBudgetManager", description: "Manages token allocation across sessions" },
  { name: "Hot Reload", module: "hotReload", description: "Reloads modified modules without restart" },
  { name: "Graceful Degradation", module: "gracefulDegradation", description: "Falls back gracefully when APIs fail" },
  { name: "Recursion Guard", module: "recursionGuard", description: "Prevents runaway self-modification loops" },
  { name: "Skill Graph", module: "skillGraph", description: "Learns error→fix patterns across sessions" },
  { name: "Consensus Engine", module: "consensusEngine", description: "Multi-model voting for critical decisions" },
  { name: "Continuous Improvement", module: "continuousImprover", description: "Periodic autonomous improvement cycles" },
  { name: "Code Execution", module: "sandboxManager", description: "Sandboxed code execution for safety" },
  { name: "Multi-Agent", module: "multiAgent", description: "Spawns specialist agents for complex tasks" },
  { name: "Memory System", module: "memory", description: "Persistent memory storage and retrieval" },
  { name: "Self-Monitoring", module: "selfMonitor", description: "Tracks performance metrics and health" },
  { name: "Knowledge Base", module: "selfKnowledgeBase", description: "Stores architectural decisions and learnings" },
  { name: "Autonomy Orchestrator", module: "autonomyOrchestrator", description: "Coordinates all autonomous subsystems" },
];

async function discoverCapabilities(): Promise<CapabilityStatus[]> {
  // v5.35: Eagerly load autonomyOrchestrator for capability discovery
  const orchMod = await getAutonomyOrchestrator().catch(() => ({}));

  // v5.29: Use direct static imports — dynamic import/require doesn't work in esbuild bundle
  const moduleRegistry: Record<string, { mod: any; check: string }> = {
    selfHeal: { mod: _selfHeal, check: "getHealStatus" },
    selfModify: { mod: _selfModify, check: "getModifyStats" },
    selfImprove: { mod: _selfImprove, check: "analyzeAndPropose" },
    recursiveGoals: { mod: _recursiveGoals, check: "listMetaGoals" },
    streamIntegrityMonitor: { mod: _streamIntegrityMonitor, check: "checkCompleteness" },
    tokenBudgetManager: { mod: _tokenBudgetManager, check: "allocateTokens" },
    hotReload: { mod: _hotReload, check: "hotReloadModule" },
    gracefulDegradation: { mod: _gracefulDegradation, check: "getDegradationStats" },
    recursionGuard: { mod: _recursionGuard, check: "enterRecursion" },
    skillGraph: { mod: _skillGraph, check: "getGraphStats" },
    consensusEngine: { mod: _consensusEngine, check: "getConsensusStats" },
    continuousImprover: { mod: _continuousImprover, check: "getImproverStats" },
    selfMonitor: { mod: _selfMonitor, check: "getHealthReport" },
    selfKnowledgeBase: { mod: _selfKnowledgeBase, check: "recordLearning" },
    autonomyOrchestrator: { mod: orchMod, check: "getOrchestratorStats" },
    sandboxManager: { mod: _sandboxManager, check: "initSandbox" },
    multiAgent: { mod: _multiAgent, check: "runTeamAgent" },
    memory: { mod: _memory, check: "storeMemory" },
  };

  const capabilities: CapabilityStatus[] = [];
  for (const cap of CAPABILITY_MAP) {
    const entry = moduleRegistry[cap.module];
    let available = false;
    if (entry) {
      try {
        available = typeof entry.mod[entry.check] === "function";
      } catch { available = false; }
    }
    capabilities.push({
      name: cap.name,
      module: cap.module,
      enabled: available,
      health: available ? "healthy" : "unavailable",
      lastChecked: Date.now(),
      description: cap.description,
    });
  }
  return capabilities;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full current self-model state.
 */
export function getSelfModel(): SelfModelState {
  state.uptime = Date.now() - startTime;
  state.lastUpdated = Date.now();
  return { ...state };
}

/**
 * Get a natural-language summary of current capabilities.
 */
export function describeSelf(): string {
  const healthy = state.capabilities.filter(c => c.health === "healthy").length;
  const total = state.capabilities.length;
  const activeGoals = state.activeGoals.filter(g => g.status === "active").length;

  return [
    `I am ${state.identity} (v${state.version}).`,
    `Running for ${Math.round(state.uptime / 60000)} minutes.`,
    `${healthy}/${total} capabilities active and healthy.`,
    `${activeGoals} goals currently being pursued.`,
    `Using model: ${state.currentModel} (${state.contextWindow} token context).`,
    `Recent actions: ${state.recentActions.slice(-3).map(a => a.action).join(", ") || "none"}`,
  ].join("\n");
}

/**
 * Record an action taken by the system.
 */
export function recordAction(action: string, result: string): void {
  state.recentActions.push({ action, timestamp: Date.now(), result });
  // Keep last 50 actions
  if (state.recentActions.length > 50) {
    state.recentActions = state.recentActions.slice(-50);
  }
  saveState();
}

/**
 * Update resource usage metrics.
 */
export function updateResources(updates: Partial<ResourceUsage>): void {
  state.resources = { ...state.resources, ...updates };
}

/**
 * Update active goals from goal system.
 */
export function updateGoals(goals: ActiveGoal[]): void {
  state.activeGoals = goals;
}

/**
 * Update performance trends.
 */
export function updateTrends(trends: PerformanceTrend[]): void {
  state.trends = trends;
}

/**
 * Full refresh of the self-model — queries all subsystems.
 */
export async function refreshSelfModel(): Promise<SelfModelState> {
  try {
    // Discover capabilities
    state.capabilities = await discoverCapabilities();

    // Get goals from recursiveGoals (using static import)
    try {
      const goals = _recursiveGoals.listMetaGoals({ status: "active" });
      state.activeGoals = goals
        .slice(0, 10)
        .map((g: any) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          progress: g.subGoals?.length > 0
            ? Math.round(g.subGoals.filter((s: any) => s.status === "completed").length / g.subGoals.length * 100)
            : 0,
          startedAt: g.createdAt,
        }));
    } catch { /* goals not available */ }

    // Get model info
    try {
      state.currentModel = process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat";
      state.contextWindow = getContextWindow(state.currentModel);
    } catch { /* use defaults */ }

    // Get resource usage
    try {
      const report = _selfMonitor.getHealthReport();
      state.resources.apiCallsToday = report.totalSamples || 0;
    } catch { /* non-critical */ }

    state.uptime = Date.now() - startTime;
    state.lastUpdated = Date.now();

    // v5.34: Validate self-model consistency
    const validation = validateSelfModel();
    if (!validation.valid) {
      console.warn(`[SelfModel] Validation warnings: ${validation.issues.join("; ")}`);
    }

    saveState();
    return state;
  } catch (err) {
    console.error(`[SelfModel] refreshSelfModel failed:`, err);
    // Return current state as fallback
    return state;
  }
}

/**
 * Initialize the self-model on startup.
 * Uses a delayed capability sync to ensure other modules have finished initializing.
 */
export async function initSelfModel(): Promise<void> {
  loadState();
  // Don't discover capabilities immediately — other modules may not be ready yet.
  // Instead, schedule a sync after 10 seconds to give all modules time to init.
  setTimeout(async () => {
    try {
      await syncCapabilitiesFromRuntime();
      console.log("[SelfModel] Capabilities synced from runtime — all modules checked");
    } catch (err) {
      console.warn("[SelfModel] Capability sync failed:", (err as Error).message);
    }
  }, 10_000);

  console.log("[SelfModel] Initialized — capability sync scheduled in 10s");

  // Refresh every 5 minutes
  setInterval(async () => {
    try { await refreshSelfModel(); } catch { /* non-critical */ }
  }, 5 * 60 * 1000);
}

/**
 * Sync capabilities from actual runtime module status.
 * Called after all modules have had time to initialize.
 */
export async function syncCapabilitiesFromRuntime(): Promise<void> {
  state.capabilities = await discoverCapabilities();
  state.version = PACKAGE_VERSION; // v6.03: dynamic from package.json
  state.uptime = Date.now() - startTime;
  state.lastUpdated = Date.now();
  saveState();
}

/**
 * v5.34: Validate self-model internal consistency.
 * Checks that the model's understanding of itself matches reality.
 */
export function validateSelfModel(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check capabilities are populated
  if (!state.capabilities || state.capabilities.length === 0) {
    issues.push("No capabilities discovered");
  }

  // Check for stale data (not updated in 15 minutes)
  if (Date.now() - state.lastUpdated > 15 * 60 * 1000) {
    issues.push(`Self-model is stale (last updated ${Math.round((Date.now() - state.lastUpdated) / 60000)}m ago)`);
  }

  // v6.03: Dynamic version check — reads from package.json via PACKAGE_VERSION
  // No longer checks for a hardcoded major prefix; just verifies version is non-empty.
  if (!state.version || state.version === "unknown") {
    issues.push("Version is unknown — package.json may be missing or unreadable");
  }

  // Check resource usage sanity
  if (state.resources) {
    const _mem = process.memoryUsage().heapUsed / 1024 / 1024;
    // ResourceUsage doesn't track memory directly, but we can check API calls are reasonable
    if (state.resources.apiCallsToday < 0 || state.resources.apiCallsToday > 100000) {
      issues.push(`API calls count looks unreasonable: ${state.resources.apiCallsToday}`);
    }
  }

  // Check that enabled capabilities actually have their modules loaded
  if (state.capabilities) {
    const enabledCaps = state.capabilities.filter((c: any) => c.enabled || c.status === "active");
    if (enabledCaps.length < 10) {
      issues.push(`Only ${enabledCaps.length} capabilities enabled (expected 15+)`);
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Get stats for diagnostics endpoint.
 */
export function getSelfModelStats() {
  return {
    capabilitiesTotal: state.capabilities.length,
    capabilitiesHealthy: state.capabilities.filter(c => c.health === "healthy").length,
    activeGoals: state.activeGoals.length,
    recentActions: state.recentActions.length,
    uptime: Date.now() - startTime,
  };
}
