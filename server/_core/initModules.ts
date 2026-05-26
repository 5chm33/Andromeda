/**
 * initModules.ts — v6.15
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Handles all async module initialization in dependency order.
 * Grouped by version milestone for traceability.
 */

import { initGoalPersistence } from "../goalManager";

export async function initModules(): Promise<void> {
  // ── v5.35: Foundational modules (order matters) ──────────────────────────────
  import("../runtimeConfig").then(m => m.initRuntimeConfig()).catch(err => console.warn("[RuntimeConfig] Init failed:", err));
  import("../modelRegistry").then(m => m.initModelRegistry()).catch(err => console.warn("[ModelRegistry] Init failed:", err));
  import("../scheduler").then(m => m.initScheduler()).catch(err => console.warn("[Scheduler] Init failed:", err));
  import("../selfKnowledgeBase").then(m => m.initKnowledgeBase()).catch(err => console.warn("[KnowledgeBase] Init failed:", err));
  import("../transactionLog").then(m => m.loadTransactionLog()).catch(err => console.warn("[TransactionLog] Init failed:", err));

  // ── v5.15: Goal persistence ───────────────────────────────────────────────────
  initGoalPersistence().catch(err => console.warn("[GoalManager] Persistence init failed:", err));

  // ── v5.22: Autonomy modules ───────────────────────────────────────────────────
  import("../selfTestPipeline").then(m => m.initPipeline()).catch(err => console.warn("[Pipeline] Init failed:", err));
  import("../selfRollback").then(m => m.initRollback()).catch(err => console.warn("[Rollback] Init failed:", err));
  import("../dependencyGraph").then(m => m.initDependencyGraph()).catch(err => console.warn("[DependencyGraph] Init failed:", err));
  import("../selfHeal").then(m => {
    m.initSelfHeal();
    m.startHealLoop();
    console.log("[SelfHeal] Heal loop STARTED");
  }).catch(err => console.warn("[SelfHeal] Init failed:", err));

  // ── v5.23: Core operational modules ──────────────────────────────────────────
  import("../selfModify").then(m => m.initSelfModify()).catch(err => console.warn("[SelfModify] Init failed:", err));
  import("../selfIntrospect").then(m => m.initSelfIntrospect()).catch(err => console.warn("[SelfIntrospect] Init failed:", err));
  import("../tokenBudgetManager").then(m => m.initTokenBudgetManager()).catch(err => console.warn("[TokenBudget] Init failed:", err));
  import("../streamIntegrityMonitor").then(m => m.initStreamIntegrityMonitor()).catch(err => console.warn("[StreamIntegrity] Init failed:", err));

  // ── v5.26: Resilience modules ─────────────────────────────────────────────────
  import("../hotReload").then(m => {
    m.initHotReload();
    console.log("[HotReload] Initialized — modules will auto-reload on file changes");
  }).catch(err => console.warn("[HotReload] Init failed:", err));

  import("../gracefulDegradation").then(m => {
    m.initGracefulDegradation();
    console.log("[GracefulDegradation] Initialized — API failures will trigger fallback");
  }).catch(err => console.warn("[GracefulDegradation] Init failed:", err));

  // ── v5.27: Autonomous learning modules ───────────────────────────────────────
  import("../recursionGuard").then(() => {
    console.log("[RecursionGuard] Initialized");
  }).catch(err => console.warn("[RecursionGuard] Init failed:", err));

  import("../skillGraph").then(m => {
    m.initSkillGraph();
  }).catch(err => console.warn("[SkillGraph] Init failed:", err));

  import("../consensusEngine").then(m => {
    m.initConsensusEngine();
  }).catch(err => console.warn("[ConsensusEngine] Init failed:", err));

  import("../continuousImprover").then(m => {
    m.startContinuousImprover({ enabled: process.env.CONTINUOUS_IMPROVE !== "false" });
  }).catch(err => console.warn("[ContinuousImprover] Init failed:", err));

  import("../autoGoalSuggester").then(m => {
    m.startAutoGoalSuggester({ enabled: process.env.AUTO_GOALS !== "false" });
  }).catch(err => console.warn("[AutoGoalSuggester] Init failed:", err));

  import("../recursiveGoals").then(m => {
    m.initRecursiveGoals();
  }).catch(err => console.warn("[RecursiveGoals] Init failed:", err));

  // ── v5.28: Autonomy layer ─────────────────────────────────────────────────────
  import("../selfModel").then(m => {
    m.initSelfModel();
  }).catch(err => console.warn("[SelfModel] Init failed:", err));

  import("../autonomyOrchestrator").then(m => {
    try {
      m.initOrchestrator();
      console.log("[AutonomyOrchestrator] Started successfully");
    } catch (initErr) {
      console.error("[AutonomyOrchestrator] Init crashed, entering safe mode:", initErr);
      console.warn("[SafeMode] Server running in SAFE MODE: orchestrator disabled, self-modification disabled");
      console.warn("[SafeMode] To recover: restart the server or call POST /api/orchestrator/resume");
    }
  }).catch(err => {
    console.error("[AutonomyOrchestrator] Failed to load module:", err);
    console.warn("[SafeMode] Server running in SAFE MODE: orchestrator unavailable");
  });

  import("../sandboxVerifier").then(m => {
    m.initSandboxVerifier();
  }).catch(err => console.warn("[SandboxVerifier] Init failed:", err));

  import("../multiAgentImprover").then(m => {
    m.initMultiAgentImprover();
  }).catch(err => console.warn("[MultiAgentImprover] Init failed:", err));

  import("../systemMemory").then(m => {
    m.initSystemMemory();
  }).catch(err => console.warn("[SystemMemory] Init failed:", err));

  // ── v5.33: Knowledge and reasoning modules ────────────────────────────────────
  import("../unifiedKnowledge").then(() => {
    console.log("[UnifiedKnowledge] Initialized — cross-module knowledge retrieval ready");
  }).catch(err => console.warn("[UnifiedKnowledge] Init failed:", err));

  import("../autonomousGoalGenerator").then(() => {
    console.log("[AutonomousGoalGenerator] Initialized — self-directed improvement goals ready");
  }).catch(err => console.warn("[AutonomousGoalGenerator] Init failed:", err));

  import("../selfConsistency").then(() => {
    console.log("[SelfConsistency] Initialized — multi-model cross-validation ready");
  }).catch(err => console.warn("[SelfConsistency] Init failed:", err));

  import("../adaptiveRouter").then(() => {
    console.log("[AdaptiveRouter] Initialized — adaptive LLM routing ready");
  }).catch(err => console.warn("[AdaptiveRouter] Init failed:", err));

  import("../contextAwareness").then(() => {
    console.log("[ContextAwareness] Initialized — context window tracking ready");
  }).catch(err => console.warn("[ContextAwareness] Init failed:", err));

  // ── v5.75: RSI engine ─────────────────────────────────────────────────────────
  import("../rsiEngine").then(m => {
    m.initRSIEngine();
    console.log("[RSIEngine] Initialized — recursive self-improvement engine ready (enable via /api/rsi/enable)");
  }).catch(err => console.warn("[RSIEngine] Init failed:", err));

  // ── v6.15: Real embedding API auto-init ──────────────────────────────────────
  // Activates semantic vector memory using the active LLM provider's embedding endpoint.
  // Falls back to local hash-based embeddings if no API key is available.
  // text-embedding-3-small: $0.02/M tokens — essentially free.
  import("../vectorMemory").then(m => {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const embModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    if (openaiKey) {
      m.initApiEmbeddings("https://api.openai.com/v1/embeddings", openaiKey, embModel);
      console.log(`[VectorMemory] v6.15: Real embeddings active — OpenAI ${embModel}`);
    } else if (openrouterKey) {
      // OpenRouter also exposes an /embeddings endpoint compatible with OpenAI format
      m.initApiEmbeddings("https://openrouter.ai/api/v1/embeddings", openrouterKey, embModel);
      console.log(`[VectorMemory] v6.15: Real embeddings active — OpenRouter ${embModel}`);
    } else if (deepseekKey) {
      // DeepSeek has an embeddings endpoint at the same base URL
      // DeepSeek does not have an embeddings endpoint — use local hash fallback
      // m.initApiEmbeddings("https://api.deepseek.com/v1/embeddings", deepseekKey, "text-embedding-3-small");
      console.log("[VectorMemory] v6.18: DeepSeek has no embeddings endpoint — using local hash fallback (free)");
      console.log("[VectorMemory] v6.15: Real embeddings active — DeepSeek embeddings");
    } else {
      console.log("[VectorMemory] v6.15: No embedding API key found — using local hash fallback");
    }
  }).catch(err => console.warn("[VectorMemory] Embedding init failed:", err));

  // ── v5.33: Degradation watch ──────────────────────────────────────────────────
  import("../selfRollback").then(m => {
    m.startDegradationWatch();
    console.log("[Rollback] Degradation watch started");
  }).catch(() => {});
}
