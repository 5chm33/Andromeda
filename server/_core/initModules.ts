/**
 * initModules.ts — v7.0.1
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
  // ── v9.14: SQLite persistence layer init (replaces JSON flat files) ──────────
  try {
    const { getDb, migrateFromJson } = await import("../andromedaDb.js");
    getDb(); // Initialize the database and create tables
    migrateFromJson(); // One-time migration from JSON flat files
    console.log("[AndromedaDb] SQLite persistence layer initialized");
  } catch (err) {
    console.warn("[AndromedaDb] Init failed (non-fatal):", err);
  }

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

  // ── v6.40: Adaptive eval init (LLM-generated benchmarks) ─────────────────
  import("../adaptiveEval.js").then(m => {
    m.initAdaptiveEval();
  }).catch(err => console.warn("[AdaptiveEval] Init failed (non-fatal):", err));

  // ── v7.0: Watchdog (self-healing) + Telemetry (performance) ─────────────────
  import("../watchdog.js").then(m => {
    m.initWatchdog();
    console.log("[Watchdog] Self-healing watchdog initialized");
  }).catch(err => console.warn("[Watchdog] Init failed (non-fatal):", err));

  import("../telemetry.js").then(m => {
    m.initTelemetry();
    console.log("[Telemetry] Performance telemetry initialized");
  }).catch(err => console.warn("[Telemetry] Init failed (non-fatal):", err));

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
    // v9.7.0: Lower threshold from 'critical' to 'high' so proposals touching
    // core files (memory.ts, selfImprove.ts, guardedApply) require consensus
    m.initConsensusEngine({ requireForRiskLevel: "high" });
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
  //   1. OpenRouter key → OpenRouter text-embedding-3-small (works with Kimi/OpenRouter/DeepSeek setups)
  //   2. OpenAI key (must start with sk-) → OpenAI text-embedding-3-small
  //   3. DeepSeek key only → local hash fallback (DeepSeek has no /embeddings endpoint)
  //   4. No keys → local hash fallback
  // Note: placeholder values like 'your_openai_api_key_here' are automatically skipped.
  import("../vectorMemory").then(m => {
    const rawOpenaiKey = process.env.OPENAI_API_KEY ?? "";
    const rawOpenrouterKey = process.env.OPENROUTER_API_KEY ?? "";
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const embModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
    // Skip placeholder values
    const isPlaceholder = (k: string) => !k || k.includes("your_") || k === "test-stub";
    const openrouterKey = isPlaceholder(rawOpenrouterKey) ? undefined : rawOpenrouterKey;
    // OpenAI keys must start with 'sk-' to be valid
    const openaiKey = !isPlaceholder(rawOpenaiKey) && rawOpenaiKey.startsWith("sk-") ? rawOpenaiKey : undefined;
    if (openrouterKey) {
      // OpenRouter is preferred — works with Claude, DeepSeek, Kimi setups and supports embeddings.
      m.initApiEmbeddings("https://openrouter.ai/api/v1/embeddings", openrouterKey, embModel);
      console.log(`[VectorMemory] v7.2: Real embeddings active — OpenRouter ${embModel} (semantic search enabled)`);
    } else if (openaiKey) {
      m.initApiEmbeddings("https://api.openai.com/v1/embeddings", openaiKey, embModel);
      console.log(`[VectorMemory] v7.2: Real embeddings active — OpenAI ${embModel}`);
    } else if (deepseekKey && !isPlaceholder(deepseekKey)) {
      // DeepSeek does not expose an embeddings endpoint
      console.log("[VectorMemory] v7.2: DeepSeek has no embeddings endpoint — using local hash fallback");
    } else {
      console.log("[VectorMemory] v7.2: No embedding API key found — using local hash fallback");
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
            console.log(`[AutoBaseline] v7.0: Valid baseline exists (${pct.toFixed(1)}%) — skipping auto-capture`);
            return;
          }
          console.log(`[AutoBaseline] v7.0: Stored baseline score is ${pct.toFixed(1)}% (< 5%) — likely a failed run. Re-running baseline capture...`);
        } catch {
          // Can't parse stored baseline — re-run to be safe
        }
      }
      console.log("[AutoBaseline] v7.0: No valid baseline found — running quick eval to establish starting score...");
      const { runEvaluation, EVAL_TASKS } = await import("../evalFramework.js");
      const { simpleChatCompletion } = await import("../llmProvider.js");
      // Build identity system prompt so auto-baseline uses the same grounded agent as the standalone runner
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
      const identityPrompt = `You are Andromeda, an autonomous recursive self-improving AI agent (version ${pkg.version}). You are NOT ChatGPT, GPT-4, Claude, or Gemini. You are Andromeda AI. Your working directory is ${process.cwd()}. Today's date is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. You have tools: read_file, write_file, web_search, execute_code, memory_search, memory_store, list_files, git_log, run_shell. Answer factually and specifically — do NOT say you cannot access files or don't know your version.`;
      const runAgent = async (prompt: string, maxTokens: number, timeoutMs: number): Promise<string> => {
        const result = await Promise.race([
          simpleChatCompletion([{ role: "system", content: identityPrompt }, { role: "user", content: prompt }], { maxTokens }),
          new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
        ]);
        return result as string;
      };
      // Quick mode: only easy tasks to minimize token cost
      const easyIds = EVAL_TASKS.filter(t => t.difficulty === "easy").map(t => t.id);
      const run = await runEvaluation(runAgent, easyIds);
      fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
      fs.writeFileSync(baselineFile, JSON.stringify({ ...run, storedAt: Date.now(), autoCapture: true }, null, 2));
      console.log(`[AutoBaseline] v7.0: Baseline captured — score: ${run.percentage.toFixed(1)}% (${run.passed}/${run.passed + run.failed} tasks passed)`);

      // Auto-enable RSI now that we have a baseline to improve against
      const { enableRSI } = await import("../rsiEngine.js");
      enableRSI({
        intervalMs: 5 * 60 * 1000,  // v11.290.0: 5-minute cycles (was 6h — too slow for testing)
        maxAutoApplyPerCycle: 3,     // v11.290.0: 3 auto-applied changes per cycle (was 2)
        minConfidenceThreshold: 0.7, // v11.290.0: Lower threshold slightly (was 0.8) to allow more proposals through
      });
      console.log("[AutoBaseline] v7.0: RSI auto-enabled — 5-minute improvement cycles started");
    } catch (err) {
      console.warn("[AutoBaseline] v7.0: Auto-baseline failed (non-fatal):", err);
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

  // ── v7.1: Auto-rebuild (post-improvement zero-touch operation) ───────────────
  import("../autoRebuild.js").then(m => {
    m.initAutoRebuild();
    console.log("[AutoRebuild] Post-improvement auto-rebuild initialized");
  }).catch(err => console.warn("[AutoRebuild] Init failed (non-fatal):", err));

  // ── v7.1: RLHF collector (human feedback loop) ───────────────────────────────
  import("../rlhfCollector.js").then(m => {
    m.initRlhfCollector();
    console.log("[RLHF] Feedback collector initialized");
  }).catch(err => console.warn("[RLHF] Init failed (non-fatal):", err));

  // ── v7.1: PR generator (automated pull requests from proposals) ──────────────
  import("../prGenerator.js").then(m => {
    m.initPRGenerator();
    console.log("[PRGenerator] Automated PR generator initialized");
  }).catch(err => console.warn("[PRGenerator] Init failed (non-fatal):", err));

  // ── v7.1: Knowledge transfer (cross-agent learning) ──────────────────────────
  import("../knowledgeTransfer.js").then(m => {
    m.initKnowledgeTransfer();
    console.log("[KnowledgeTransfer] Cross-agent knowledge transfer initialized");
  }).catch(err => console.warn("[KnowledgeTransfer] Init failed (non-fatal):", err));

  // ── v9.15: Visual grounding tools (Playwright annotated screenshots) ─────────
  import("../tools/visualGroundingTool.js").then(m => {
    m.registerVisualGroundingTools();
    console.log("[VisualGrounding] Playwright visual grounding tools registered (visual_screenshot, visual_full_page, visual_click_index, visual_save_screenshot)");
  }).catch(err => console.warn("[VisualGrounding] Tool registration failed (non-fatal):", err));

  // ── v9.15: Filesystem watcher (chokidar OS-level file events) ────────────────
  import("../fsWatcher.js").then(m => {
    m.initFsWatcher();
    // Auto-watch the project source directory for RSI-aware file change tracking
    const projectDir = process.cwd();
    m.startWatch({
      id: "project-root",
      directory: projectDir,
      patterns: ["**/*.ts", "**/*.tsx", "**/*.js"],
      ignorePatterns: [],
      recursive: true,
      notifyRsi: true,
    });
    console.log(`[FsWatcher] Filesystem event monitoring started on ${projectDir}`);
  }).catch(err => console.warn("[FsWatcher] Init failed (non-fatal):", err));

  // ── v9.16: Phase 3a — Self-distillation (RLHF → DPO dataset export) ────────────────────
  // The selfDistillation module is stateless (no init needed) but we log its availability.
  import("../selfDistillation.js").then(() => {
    console.log("[SelfDistillation] Phase 3a: DPO dataset export pipeline ready");
  }).catch(err => console.warn("[SelfDistillation] Module load failed (non-fatal):", err));

  // ── v9.16: Phase 3b — Local LoRA fine-tuning pipeline ──────────────────────────────
  import("../localLora.js").then(() => {
    console.log("[LocalLoRA] Phase 3b: Local LoRA fine-tuning pipeline ready");
  }).catch(err => console.warn("[LocalLoRA] Module load failed (non-fatal):", err));

  // ── v9.16.2: Phase 4a — RLAIF Judge (AI generates its own DPO pairs) ─────────────────
  import("../rlaifJudge.js").then(() => {
    console.log("[RLAIF] Phase 4a: RLAIF Judge ready — AI-generated DPO pairs enabled");
  }).catch(err => console.warn("[RLAIF] Module load failed (non-fatal):", err));

  // ── v9.16.2: Phase 4b — Evolutionary Search over RSI engine ──────────────────────────
  import("../evolutionarySearch.js").then(() => {
    console.log("[Evolution] Phase 4b: Evolutionary search engine ready");
  }).catch(err => console.warn("[Evolution] Module load failed (non-fatal):", err));

  // ── v9.16.2: Phase 5a — Native VLM integration ───────────────────────────────────────
  import("../nativeVlm.js").then(() => {
    console.log("[NativeVLM] Phase 5a: Native vision-language model integration ready");
  }).catch(err => console.warn("[NativeVLM] Module load failed (non-fatal):", err));

  // ── v9.16.2: Phase 5b — Algorithmic Self-Discovery engine ────────────────────────────
  import("../algorithmicDiscovery.js").then(() => {
    console.log("[AlgoDiscovery] Phase 5b: Algorithmic self-discovery engine ready");
  }).catch(err => console.warn("[AlgoDiscovery] Module load failed (non-fatal):", err));

  // ── v9.16.2: Phase 5c — Continuous unsupervised fine-tuning scheduler ────────────────
  import("../continuousFineTuning.js").then(() => {
    console.log("[ContinuousFineTuning] Phase 5c: Nightly RLAIF→LoRA pipeline ready");
  }).catch(err => console.warn("[ContinuousFineTuning] Module load failed (non-fatal):", err));

  // ── v10.0.0: Phase 1 — Cost-aware model routing ──────────────────────────────────────
  import("../costOptimizer.js").then(({ initCostOptimizer }) => {
    initCostOptimizer();
    console.log("[CostOptimizer] Phase 1: Cost-aware model routing initialized");
  }).catch(err => console.warn("[CostOptimizer] Module load failed (non-fatal):", err));

  // ── v10.0.0: Phase 2 — Swarm specialist voting ───────────────────────────────────────
  import("../swarmSpecialistVoting.js").then(({ initSwarmSpecialistVoting }) => {
    initSwarmSpecialistVoting();
    console.log("[SwarmVoting] Phase 2: Specialist voting system initialized");
  }).catch(err => console.warn("[SwarmVoting] Module load failed (non-fatal):", err));

  // ── v10.0.0: Phase 2 — Long-term memory consolidation ───────────────────────────────
  import("../longTermMemoryConsolidation.js").then(({ initLongTermMemoryConsolidation }) => {
    initLongTermMemoryConsolidation();
    console.log("[LongTermMemory] Phase 2: Long-term pattern memory initialized");
  }).catch(err => console.warn("[LongTermMemory] Module load failed (non-fatal):", err));

  // ── v10.0.0: Phase 3 — Algorithmic discovery v2 ─────────────────────────────────────
  import("../algorithmicDiscoveryV2.js").then(({ initAlgorithmicDiscoveryV2 }) => {
    initAlgorithmicDiscoveryV2();
    console.log("[AlgoDiscoveryV2] Phase 3: Algorithmic discovery v2 initialized");
  }).catch(err => console.warn("[AlgoDiscoveryV2] Module load failed (non-fatal):", err));

  // ── v10.0.0: Phase 3 — Cross-domain adapter ─────────────────────────────────────────
  import("../crossDomainAdapter.js").then(({ initCrossDomainAdapter }) => {
    initCrossDomainAdapter();
    console.log("[CrossDomain] Phase 3: Cross-domain RSI adapter initialized");
  }).catch(err => console.warn("[CrossDomain] Module load failed (non-fatal):", err));

  // ── v10.1.0: Q1 2027 — Ollama auto-setup (zero-cost local LLM) ──────────────────────
  import("../ollamaAutoSetup.js").then(({ initOllamaAutoSetup }) => {
    initOllamaAutoSetup();
    console.log("[OllamaAutoSetup] Q1 2027: Local LLM auto-detection initialized");
  }).catch(err => console.warn("[OllamaAutoSetup] Module load failed (non-fatal):", err));

  // ── v10.1.0: Q3 2026 — Robotics/IoT cross-domain adapter ────────────────────────────
  import("../roboticsIoTAdapter.js").then(({ initRoboticsIoTAdapter }) => {
    initRoboticsIoTAdapter();
    console.log("[RoboticsIoT] Q3 2026: Physical world actuation adapter initialized");
  }).catch(err => console.warn("[RoboticsIoT] Module load failed (non-fatal):", err));

  // ── v10.1.0: Q4 2026 — Open-ended novelty search engine ─────────────────────────────
  import("../noveltySearchEngine.js").then(({ initNoveltySearchEngine }) => {
    initNoveltySearchEngine();
    console.log("[NoveltySearch] Q4 2026: Open-ended capability discovery initialized");
  }).catch(err => console.warn("[NoveltySearch] Module load failed (non-fatal):", err));

  // ── v10.1.0: Q4 2026 — Zero-shot cross-domain transfer engine ───────────────────────
  import("../zeroShotTransferEngine.js").then(({ initZeroShotTransferEngine }) => {
    initZeroShotTransferEngine();
    console.log("[ZeroShotTransfer] Q4 2026: Cross-domain knowledge transfer initialized");
  }).catch(err => console.warn("[ZeroShotTransfer] Module load failed (non-fatal):", err));
  // ── v11.1.0: Behavioral Regression Engine — CI Stage 2.5 ─────────────────────────────
  import("../behavioralRegressionEngine.js").then(({ initBehavioralRegressionEngine }) => {
    initBehavioralRegressionEngine();
    console.log("[BehavioralRegression] v11.1.0: CI Stage 2.5 behavioral contract guard initialized");
  }).catch(err => console.warn("[BehavioralRegression] Module load failed (non-fatal):", err));
  // ── v11.1.0: RAG Context Optimizer — enriches RSI proposals with behavioral context ──
  import("../ragContextOptimizer.js").then(({ initRagContextOptimizer }) => {
    initRagContextOptimizer();
    console.log("[RagContext] v11.1.0: RSI proposal context enrichment initialized");
  }).catch(err => console.warn("[RagContext] Module load failed (non-fatal):", err));
  // ── v11.1.0: Hybrid Cost Router — 3-tier local/cheap/premium model routing ────────────
  import("../hybridCostRouter.js").then(({ initHybridCostRouter }) => {
    initHybridCostRouter();
    console.log("[HybridCostRouter] v11.1.0: 3-tier model routing initialized");
  }).catch(err => console.warn("[HybridCostRouter] Module load failed (non-fatal):", err));
  // ── v11.6.0: Capability Bootstrapper — detects and fills capability gaps via LLM ────
  import("../capabilityBootstrapper.js").then(({ startCapabilityBootstrapper }) => {
    startCapabilityBootstrapper();
    console.log("[CapabilityBootstrapper] v11.6.0: Autonomous capability gap detection initialized");
  }).catch(err => console.warn("[CapabilityBootstrapper] Module load failed (non-fatal):", err));
  // ── v11.6.0: Cross-Instance RLHF — reports DPO pair stats from RSI proposal history ─
  if (process.env.CROSS_INSTANCE_RLHF !== "false") {
    import("../crossInstanceRlhf.js").then(({ getRlhfStats }) => {
      const stats = getRlhfStats();
      console.log(`[CrossInstanceRlhf] v11.6.0: RLHF store initialized — ${stats.totalEvaluations} evaluations, ${stats.hackingAttempts} hacking attempts detected (${(stats.hackingRate * 100).toFixed(1)}% rate)`);
    }).catch(err => console.warn("[CrossInstanceRlhf] Module load failed (non-fatal):", err));
  }
  // ── v11.6.0: Edge LLM Router — routes cheap tasks to local Ollama, saves API costs ──
  import("../edgeLLMRouter.js").then(({ isOllamaAvailable }) => {
    isOllamaAvailable().then(available => {
      if (available) {
        console.log("[EdgeLLMRouter] v11.6.0: Local Ollama detected — edge routing enabled");
      } else {
        console.log("[EdgeLLMRouter] v11.6.0: Ollama not available — all requests routed to cloud");
      }
    }).catch(() => {});
  }).catch(err => console.warn("[EdgeLLMRouter] Module load failed (non-fatal):", err));
}