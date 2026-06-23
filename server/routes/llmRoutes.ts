import { validateBody } from "./validate.js";
import { 
  planGenerateSchema, vectorStoreSchema, vectorStoreBatchSchema, 
  vectorSearchSchema, vectorConfigSchema, knowledgeDecisionSchema, 
  knowledgeIssueSchema, knowledgeLearningSchema 
} from "./zodSchemas.js";
import type { Express } from "express";
import { readFileSync } from "fs";
import {
  autoRoute, getRoutingConfig, setRoutingConfig, classifyTask, applyTier, TIER_LABELS,
} from "../llmRouter.js";
import type { ModelTier } from "../llmRouter.js";
import type { RoutingConfig } from "../llmRouter.js";
import {
  vectorSearch, vectorStore, vectorStoreBatch, vectorDelete, vectorReindex,
  vectorStats, hybridSearch, initApiEmbeddings, setEmbeddingProvider, getEmbeddingProvider,
} from "../vectorMemory.js";
import { getManifestPrompt, getFullManifest } from "../manifest.js";
import { getActiveProvider, setActiveProvider, listProviders } from "../llmProvider.js";
import { getContextWindow } from "../modelRegistry.js";
import { setModel } from "../ai.js";
import { generateExecutionPlan } from "../aiPlanning.js";
import rateLimit from "express-rate-limit";

const heavyLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

/**
 * registerLLMRoutes — LLM provider management, routing, vector memory, manifest,
 * model registry, self-knowledge base, and plan mode routes extracted from streamRouter.ts (v6.03).
 */
export function registerLLMRoutes(app: Express) {
  // ─── LLM Provider Management ──────────────────────────────────────────────
  app.get("/api/llm/providers", (req, res) => {
    res.json({ providers: listProviders(), active: getActiveProvider() });
  });
  app.post("/api/llm/providers/active", (req, res) => {
    const { providerId } = req.body;
    if (!providerId) return res.status(400).json({ error: "providerId required" });
    setActiveProvider(providerId);
    res.json({ success: true, active: getActiveProvider() });
  });

  // ─── LLM Auto-Routing ─────────────────────────────────────────────────────
  app.post("/api/llm/auto-route", (req, res) => {
    const { query, hasImages } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    const decision = autoRoute(query, hasImages);
    res.json(decision);
  });
  app.get("/api/llm/routing-config", (req, res) => res.json(getRoutingConfig()));
  app.post("/api/llm/routing-config", (req, res) => {
    const config = req.body as Partial<RoutingConfig>;
    setRoutingConfig(config);
    res.json({ success: true, config: getRoutingConfig() });
  });
  app.get("/api/llm/tiers", (req, res) => res.json({ tiers: TIER_LABELS }));
  app.post("/api/llm/tier", (req, res) => {
    const { tier } = req.body as { tier: ModelTier };
    if (!tier || !["auto", "fast", "coding", "max"].includes(tier)) {
      res.status(400).json({ error: "tier must be one of: auto, fast, coding, max" });
      return;
    }
    const providerId = applyTier(tier);
    res.json({ success: true, tier, providerId, active: getActiveProvider() });
  });
  app.post("/api/llm/classify", (req, res) => {
    const { query, hasImages } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    const result = classifyTask(query, hasImages);
    res.json(result);
  });

  // ─── Vector Memory ────────────────────────────────────────────────────────
  app.post("/api/vector/store", validateBody(vectorStoreSchema), async (req, res) => {
    try {
      const { id, text } = req.body;
      if (!id || !text) return res.status(400).json({ error: "id and text required" });
      await vectorStore(id, text);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.post("/api/vector/store-batch", validateBody(vectorStoreBatchSchema), async (req, res) => {
    try {
      const { entries } = req.body;
      if (!entries || !Array.isArray(entries)) return res.status(400).json({ error: "entries array required" });
      await vectorStoreBatch(entries);
      res.json({ success: true, count: entries.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.post("/api/vector/search", validateBody(vectorSearchSchema), async (req, res) => {
    try {
      const { query, limit, minScore } = req.body;
      if (!query) return res.status(400).json({ error: "query required" });
      const results = await vectorSearch(query, limit ?? 5, minScore ?? 0.3);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.post("/api/vector/hybrid-search", validateBody(vectorSearchSchema), async (req, res) => {
    try {
      const { query, limit, minScore } = req.body;
      if (!query) return res.status(400).json({ error: "query required" });
      const results = await hybridSearch(query, limit ?? 5, minScore ?? 0.2);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.delete("/api/vector/:id", (req, res) => {
    const deleted = vectorDelete(req.params.id);
    res.json({ success: deleted });
  });
  app.post("/api/vector/reindex", async (req, res) => {
    try {
      const result = await vectorReindex();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
  app.get("/api/vector/stats", (req, res) => res.json(vectorStats()));
  app.post("/api/vector/config", validateBody(vectorConfigSchema), (req, res) => {
    try {
      const { provider, apiUrl, apiKey, model } = req.body;
      if (provider === "api" && apiUrl && apiKey) {
        initApiEmbeddings(apiUrl, apiKey, model);
      } else if (provider === "local-hash") {
        setEmbeddingProvider("local-hash");
      }
      res.json({ success: true, activeProvider: getEmbeddingProvider() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Self-Manifest ────────────────────────────────────────────────────────
  app.get("/api/manifest", (req, res) => res.json(getFullManifest()));
  app.get("/api/manifest/prompt", (req, res) => res.json({ prompt: getManifestPrompt() }));

  // ─── Model Registry & LLM Self-Optimization ──────────────────────────────
  app.get("/api/models/registry", async (req, res) => {
    try {
      const { listModels } = await import("../modelRegistry.js");
      const filter = req.query as any;
      res.json({ models: listModels(filter) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/models/:modelId/spec", async (req, res) => {
    try {
      const { getModelSpec } = await import("../modelRegistry.js");
      const spec = getModelSpec(req.params.modelId);
      if (!spec) return res.status(404).json({ error: "Model not found" });
      res.json(spec);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/models/optimal-config", async (req, res) => {
    try {
      const { getOptimalConfig } = await import("../modelRegistry.js");
      const { taskType, constraints } = req.body || {};
      if (!taskType) return res.status(400).json({ error: "'taskType' required" });
      res.json(getOptimalConfig(taskType, constraints));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/models/performance", async (req, res) => {
    try {
      const { getPerformanceStats } = await import("../modelRegistry.js");
      const filter = req.query as any;
      res.json(getPerformanceStats(filter));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/models/record-performance", async (req, res) => {
    try {
      const { recordPerformance } = await import("../modelRegistry.js");
      recordPerformance(req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Self-Knowledge Base ──────────────────────────────────────────────────
  app.get("/api/knowledge/summary", async (_req, res) => {
    try {
      const { getKnowledgeBaseSummary } = await import("../selfKnowledgeBase.js");
      res.json(getKnowledgeBaseSummary());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/knowledge/decisions", async (req, res) => {
    try {
      const { listDecisions } = await import("../selfKnowledgeBase.js");
      const status = req.query.status as any;
      res.json({ decisions: listDecisions(status) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/knowledge/decisions", validateBody(knowledgeDecisionSchema), async (req, res) => {
    try {
      const { recordDecision } = await import("../selfKnowledgeBase.js");
      const decision = recordDecision(req.body);
      res.json(decision);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/knowledge/issues", async (req, res) => {
    try {
      const { getOpenIssues } = await import("../selfKnowledgeBase.js");
      const filter = req.query as any;
      res.json({ issues: getOpenIssues(filter) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/knowledge/issues", validateBody(knowledgeIssueSchema), async (req, res) => {
    try {
      const { reportIssue } = await import("../selfKnowledgeBase.js");
      const issue = reportIssue(req.body);
      res.json(issue);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/knowledge/learnings", async (req, res) => {
    try {
      const { queryLearnings, getSuccessPatterns, getAntiPatterns } = await import("../selfKnowledgeBase.js");
      const q = req.query.q as string;
      const category = req.query.category as string;
      if (category === "antipattern") return res.json({ learnings: getAntiPatterns() });
      if (category === "success") return res.json({ learnings: getSuccessPatterns() });
      res.json({ learnings: q ? queryLearnings(q) : [] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/knowledge/learnings", validateBody(knowledgeLearningSchema), async (req, res) => {
    try {
      const { recordLearning } = await import("../selfKnowledgeBase.js");
      const entry = recordLearning(req.body);
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/knowledge/capabilities", async (req, res) => {
    try {
      const { getCapabilities } = await import("../selfKnowledgeBase.js");
      const status = req.query.status as string | undefined;
      res.json({ capabilities: getCapabilities(status as any) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/knowledge/context", async (req, res) => {
    try {
      const { getImprovementContext } = await import("../selfKnowledgeBase.js");
      const module = req.query.module as string | undefined;
      res.json({ context: getImprovementContext(module) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Plan Mode ────────────────────────────────────────────────────────────
  app.post("/api/plan/generate", heavyLimiter, validateBody(planGenerateSchema), async (req, res) => {
    const { goal, model } = req.body as { goal: string; model?: string };
    if (!goal?.trim()) { res.status(400).json({ error: "goal is required" }); return; }
    if (model) setModel(model);
    try {
      const plan = await generateExecutionPlan(goal.trim());
      res.json(plan);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Self-Awareness Report ────────────────────────────────────────────────
  app.get("/api/self/status", async (_req, res) => {
    try {
      const tools = (await import("../tools/index.js")).getAllTools();
      const toolNames = (await import("../tools/toolRegistry.js")).listToolNames();
      const goals = (await import("../goalManager.js")).listGoals();
      const braveConfigured = !!process.env.BRAVE_SEARCH_API_KEY;
      const searxngConfigured = !!process.env.SEARXNG_URL;
      const llmProvider = process.env.LLM_BASE_URL || "https://api.deepseek.com";
      const llmModel = process.env.LLM_DEFAULT_MODEL || "deepseek/deepseek-chat";
      const memoryDir = process.env.WORKSPACE_ROOT || "workspace";
      const { existsSync } = await import("fs");
      const { join } = await import("path");
      const andromedaMdExists = existsSync(join(process.cwd(), "ANDROMEDA.md"));
      let dockerAvailable = false;
      try {
        const { checkDockerAvailability } = await import("../tools/dockerSandbox.js");
        dockerAvailable = await checkDockerAvailability();
      } catch { /* docker not available */ }
      // Read version from package.json
      let version = "6.03.0";
      try { version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version; } catch {}
      const report = {
        version,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        subsystems: {
          llm: {
            provider: llmProvider,
            model: llmModel,
            reasonerModel: process.env.LLM_REASONER_MODEL || "deepseek/deepseek-r1",
            maxOutputTokens: parseInt(process.env.LLM_MAX_TOKENS || "32000"),
            contextWindow: getContextWindow(llmModel),
          },
          search: { braveConfigured, searxngConfigured, fallbackEnabled: braveConfigured && searxngConfigured },
          memory: { andromedaMdExists, workspaceDir: memoryDir },
          tools: {
            count: tools.length,
            names: toolNames,
            byCategory: {
              code: (await import("../tools/toolRegistry.js")).getToolsByCategory("code").length,
              search: (await import("../tools/toolRegistry.js")).getToolsByCategory("search").length,
              browser: (await import("../tools/toolRegistry.js")).getToolsByCategory("browser").length,
              filesystem: (await import("../tools/toolRegistry.js")).getToolsByCategory("filesystem").length,
              analysis: (await import("../tools/toolRegistry.js")).getToolsByCategory("analysis").length,
              system: (await import("../tools/toolRegistry.js")).getToolsByCategory("system").length,
              sandbox: (await import("../tools/toolRegistry.js")).getToolsByCategory("sandbox").length,
            },
          },
          docker: { available: dockerAvailable },
          goals: {
            total: goals.length,
            active: goals.filter((g: any) => g.status === "active").length,
            completed: goals.filter((g: any) => g.status === "completed").length,
          },
        },
        capabilities: [
          "web_search", "deep_research", "code_execution", "file_analysis",
          "image_generation", "multi_agent", "self_improvement", "mcp_support",
          "vector_memory", "goal_management", "task_decomposition",
          "auto_continuation", "self_healing", "autonomous_testing",
          "git_ops", "dependency_management", "plan_mode",
        ],
        limitations: [
          dockerAvailable ? null : "docker_sandbox_unavailable",
          !braveConfigured ? "brave_search_not_configured" : null,
          !andromedaMdExists ? "no_persistent_memory_file" : null,
        ].filter(Boolean),
        health: {
          status: "operational",
          memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          memoryLimitMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        },
      };
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── System Self-Test & Self-Heal ─────────────────────────────────────────
  app.post("/api/system/self-test", async (req, res) => {
    try {
      const { runAllTests: runTests, runTypeCheck } = await import("../tools/selfTestRunner.js");
      const workspaceDir = process.cwd();
      const filter = req.body?.filter || "*";
      const [testResults, typeCheck] = await Promise.all([
        runTests(workspaceDir, filter),
        runTypeCheck(workspaceDir),
      ]);
      res.json({ tests: testResults, typeCheck, overall: testResults.failed === 0 && typeCheck.success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/system/self-heal", async (req, res) => {
    try {
      const { selfHeal } = await import("../tools/selfTestRunner.js");
      const workspaceDir = process.cwd();
      const result = await selfHeal(workspaceDir);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
