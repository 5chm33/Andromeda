/**
 * initModules.ts — v6.39
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Handles all async module initialization in dependency order.
 * Grouped by version milestone for traceability.
 *
 * v6.24 changes:
 * - Embedding init: use OpenRouter when DeepSeek is the LLM (DeepSeek has no /embeddings endpoint)
 * - Auto-baseline: capture eval baseline on first startup if none exists
 * - RSI auto-enable: enable RSI automatically after baseline is captured
 */

import { initGoalPersistence } from "../goalManager";

export async function initModules(): Promise<void> {
  // ── v6.30: RSI DB migration (idempotent — creates rsi_proposals/cycles/eval tables) ─
  import("../rsiDb.js").then(m => m.runRsiDbMigration()).catch(err =>
    console.warn("[RsiDb] Migration failed (non-fatal):", err)
  );

  // ── v6.37: Postgres migration (runs only if POSTGRES_URL is set) ───────────────
  if (process.env.POSTGRES_URL) {
    import("../dbPostgres.js").then(m => m.runPgMigrations()).catch(err =>
      console.warn("[Postgres] Migration failed (non-fatal):", err)
    );
  }

  // ── v6.38: Tenant manager + audit log init ───────────────────────────────
  import("../tenantManager.js").then(m => {
    m.initTenantManager();
    console.log("[TenantManager] Multi-tenant isolation initialized");
  }).catch(err => console.warn("[TenantManager] Init failed (non-fatal):", err));
  import("../auditLog.js").then(m => {
    m.loadAuditFromDisk(500);
    console.log("[AuditLog] Audit log initialized");
  }).catch(err => console.warn("[AuditLog] Init failed (non-fatal):", err));

  // ── v6.39: Federated learning init (multi-node RSI sync) ─────────────────
  import("../federatedLearning.js").then(m => {
    m.initFederatedLearning();
  }).catch(err => console.warn("[FederatedLearning] Init failed (non-fatal):", err));

  // ── v6.36: Cross-session context persistence — restore context bus state from disk ─
  import("../contextBus.js").then(m => {
    const count = m.loadPersistedBus();
    if (count > 0) console.log(`[ContextBus] Restored ${count} context entries from previous session`);
  }).catch(err => console.warn("[ContextBus] loadPersistedBus failed (non-fatal):", err));

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

  // ── v6.24: Real embedding API auto-init ──────────────────────────────────────
  // Priority order:
  //   1. OpenAI key → OpenAI text-embedding-3-small (best quality, $0.02/M tokens)
  //   2. OpenRouter key → OpenRouter text-embedding-3-small (same model, via proxy)
  //      This is the primary path when DeepSeek is the LLM — DeepSeek has no /embeddings endpoint.
  //   3. DeepSeek key only → local hash fallback (free, offline, lower quality)
  //   4. No keys → local hash fallback
  import("../vectorMemory").then(m => {
    const openaiKey = process.env.OPENAI_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const embModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    if (openaiKey) {
      m.initApiEmbeddings("https://api.openai.com/v1/embeddings", openaiKey, embModel);
      console.log(`[VectorMemory] v6.24: Real embeddings active — OpenAI ${embModel}`);
    } else if (openrouterKey) {
      // v6.24: OpenRouter supports text-embedding-3-small via their unified API.
      // This is the correct path when DeepSeek is the primary LLM.
      m.initApiEmbeddings("https://openrouter.ai/api/v1/embeddings", openrouterKey, embModel);
      console.log(`[VectorMemory] v6.24: Real embeddings active — OpenRouter ${embModel} (semantic search enabled)`);
    } else if (deepseekKey) {
      // DeepSeek does not expose an embeddings endpoint
      console.log("[VectorMemory] v6.24: DeepSeek has no embeddings endpoint — using local hash fallback");
    } else {
      console.log("[VectorMemory] v6.24: No embedding API key found — using local hash fallback");
    }
  }).catch(err => console.warn("[VectorMemory] Embedding init failed:", err));

  // ── v6.24: Auto-baseline + RSI auto-enable ────────────────────────────────────
  // On first startup (no baseline file exists), run a quick eval to establish the
  // starting score, then automatically enable RSI so it can begin improving.
  // This removes the manual 3-step setup and makes RSI self-starting.
  // Delay 30s to let the server fully initialize before running eval.
  setTimeout(async () => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const baselineFile = path.join(process.cwd(), "data", "eval_baseline.json");
      if (fs.existsSync(baselineFile)) {
        // v6.34: Also re-run if the stored baseline has a suspiciously low score
        // (< 5%) — this catches the case where a previous run failed with 401 errors
        // and wrote a garbage baseline that would prevent RSI from ever improving.
        try {
          const stored = JSON.parse(fs.readFileSync(baselineFile, "utf-8"));
          const pct = typeof stored.percentage === "number" ? stored.percentage : 0;
          if (pct >= 5) {
            console.log(`[AutoBaseline] v6.34: Valid baseline exists (${pct.toFixed(1)}%) — skipping auto-capture`);
            return;
          }
          console.log(`[AutoBaseline] v6.34: Stored baseline score is ${pct.toFixed(1)}% (< 5%) — likely a failed run. Re-running baseline capture...`);
        } catch {
          // Can't parse stored baseline — re-run to be safe
        }
      }
      console.log("[AutoBaseline] v6.34: No valid baseline found — running quick eval to establish starting score...");
      const { runEvaluation, EVAL_TASKS } = await import("../evalFramework.js");
      const { simpleChatCompletion } = await import("../llmProvider.js");
      const runAgent = async (prompt: string, maxTokens: number, timeoutMs: number): Promise<string> => {
        const result = await Promise.race([
          simpleChatCompletion([{ role: "user", content: prompt }], { maxTokens }),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
        ]);
        return result as string;
      };
      // Quick mode: only easy tasks to minimize token cost
      const easyIds = EVAL_TASKS.filter(t => t.difficulty === "easy").map(t => t.id);
      const run = await runEvaluation(runAgent, easyIds);
      fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
      fs.writeFileSync(baselineFile, JSON.stringify({ ...run, storedAt: Date.now(), autoCapture: true }, null, 2));
      console.log(`[AutoBaseline] v6.24: Baseline captured — score: ${run.percentage.toFixed(1)}% (${run.passed}/${run.passed + run.failed} tasks passed)`);

      // Auto-enable RSI now that we have a baseline to improve against
      const { enableRSI } = await import("../rsiEngine.js");
      enableRSI({
        intervalMs: 6 * 60 * 60 * 1000,  // 6-hour cycles
        maxAutoApplyPerCycle: 2,           // conservative: max 2 auto-applied changes per cycle
      });
      console.log("[AutoBaseline] v6.24: RSI auto-enabled — 6-hour improvement cycles started");
    } catch (err) {
      console.warn("[AutoBaseline] v6.24: Auto-baseline failed (non-fatal):", err);
    }
  }, 30_000);

  // ── v6.32: Episodic memory consolidation ─────────────────────────────────
  import("../episodicConsolidation.js").then(m => {
    m.initEpisodicConsolidation();
  }).catch(err => console.warn("[EpisodicConsolidate] Init failed (non-fatal):", err));

  // ── v6.32: RSI persistent auto-trigger scheduler ────────────────────────────
  import("../rsiScheduler.js").then(m => {
    m.initRsiScheduler();
    console.log("[RsiScheduler] RSI auto-trigger scheduler initialized");
  }).catch(err => console.warn("[RsiScheduler] Init failed (non-fatal):", err));

  // ── v6.35: Load previously synthesized tools from disk ──────────────────────
  import("../toolSynthesis.js").then(m => {
    m.loadSynthesizedTools()
      .then(() => console.log("[ToolSynthesis] Synthesized tools reloaded"))
      .catch((err: unknown) => console.warn("[ToolSynthesis] Load failed (non-fatal):", err));
  }).catch((err: unknown) => console.warn("[ToolSynthesis] Module load failed (non-fatal):", err));

  // ── v5.33: Degradation watch ──────────────────────────────────────────────────
  import("../selfRollback").then(m => {
    m.startDegradationWatch();
    console.log("[Rollback] Degradation watch started");
  }).catch(() => {});
}
