import { validateBody } from "./validate.js";
import { 
  rollbackCreateSchema, selfModifySchema, selfModifyBatchSchema 
} from "./zodSchemas.js";
import type { Express } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { getAllTools } from "../tools/index.js";
import { getMemoryStats } from "../memory.js";
import { getActiveProvider } from "../llmProvider.js";
import { isMonitorRunning, getHealthReport } from "../selfMonitor.js";
import { listToolNames, getToolsByCategory } from "../tools/toolRegistry.js";

/**
 * registerSystemRoutes — Runtime, health, hot-reload, self-heal, self-modify,
 * introspection, diagnostics, and config endpoints extracted from streamRouter.ts (v6.03).
 *
 * Covers ~1,165 lines previously inline in streamRouter.ts.
 */
export function registerSystemRoutes(app: Express) {
  // ─── v5.16: Runtime Config Endpoints ─────────────────────────────────────────
  app.get("/api/config", async (_req, res) => {
    try {
      const { getPublicConfig } = await import("../runtimeConfig.js");
      res.json(getPublicConfig());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/config", async (req, res) => {
    try {
      const { saveConfig, getPublicConfig } = await import("../runtimeConfig.js");
      const updates = req.body;
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object" });
      }
      saveConfig(updates, "user");
      res.json({ success: true, config: getPublicConfig() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/config/reset", async (_req, res) => {
    try {
      const { resetConfig, getPublicConfig } = await import("../runtimeConfig.js");
      resetConfig();
      res.json({ success: true, config: getPublicConfig() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.16: Auto-Apply Endpoints ────────────────────────────────────────────
  app.get("/api/self-improve/auto-apply/status", async (_req, res) => {
    try {
      const { getAutoApplyStatus } = await import("../selfImprove.js");
      res.json(getAutoApplyStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-improve/auto-apply/config", async (req, res) => {
    try {
      const { setAutoApplyConfig } = await import("../selfImprove.js");
      const updates = req.body;
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object" });
      }
      const config = setAutoApplyConfig(updates);
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-improve/auto-apply/run", async (_req, res) => {
    try {
      const { autoApplyHighConfidence } = await import("../selfImprove.js");
      const results = await autoApplyHighConfidence();
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.16: Self-Documentation Updater ──────────────────────────────────────
  app.post("/api/self-improve/document", async (req, res) => {
    try {
      const { listProposals } = await import("../selfImprove.js");
      // updateSelfDocumentation was removed; return current proposals as documentation context
      const proposals = listProposals();
      res.json({ proposals, version: req.body?.version || "6.03.0" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.17: Hot-Reload Module ─────────────────────────────────────────────
  app.get("/api/hot-reload/status", async (_req, res) => {
    try {
      const { getHotReloadStatus } = await import("../hotReload.js");
      res.json(getHotReloadStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/hot-reload/module", async (req, res) => {
    try {
      const { hotReloadModule } = await import("../hotReload.js");
      const { moduleName } = req.body || {};
      if (!moduleName) return res.status(400).json({ error: "'moduleName' required" });
      const result = await hotReloadModule(moduleName);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/hot-reload/modified", async (_req, res) => {
    try {
      const { hotReloadModified } = await import("../hotReload.js");
      const results = await hotReloadModified();
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/hot-reload/graceful-restart", async (req, res) => {
    try {
      const { gracefulRestart } = await import("../hotReload.js");
      const result = await gracefulRestart(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.17: Self-Healing Loop ─────────────────────────────────────────────
  app.get("/api/self-heal/status", async (_req, res) => {
    try {
      const { getHealStatus } = await import("../selfHeal.js");
      res.json(getHealStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-heal/start", async (_req, res) => {
    try {
      const { startHealLoop } = await import("../selfHeal.js");
      res.json(startHealLoop());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-heal/stop", async (_req, res) => {
    try {
      const { stopHealLoop } = await import("../selfHeal.js");
      res.json(stopHealLoop());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-heal/run-once", async (_req, res) => {
    try {
      const { runHealCycleOnce } = await import("../selfHeal.js");
      const result = await runHealCycleOnce();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-heal/config", async (req, res) => {
    try {
      const { setHealConfig } = await import("../selfHeal.js");
      res.json(setHealConfig(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-heal/reset-circuit-breaker", async (_req, res) => {
    try {
      const { resetCircuitBreaker } = await import("../selfHeal.js");
      res.json(resetCircuitBreaker());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/self-heal/health-checks", async (_req, res) => {
    try {
      const { runAllHealthChecks } = await import("../selfHeal.js");
      const results = await runAllHealthChecks();
      res.json({ checks: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.22: Self-Test Pipeline Routes ─────────────────────────────────────
  app.get("/api/pipeline/status", async (_req, res) => {
    try {
      const { getPipelineStatus } = await import("../selfTestPipeline.js");
      res.json(getPipelineStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/pipeline/run", async (req, res) => {
    try {
      const { runPipeline } = await import("../selfTestPipeline.js");
      const result = await runPipeline(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/pipeline/validate", async (req, res) => {
    try {
      const { validateProposal } = await import("../selfTestPipeline.js");
      const result = validateProposal(req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/pipeline/config", async (req, res) => {
    try {
      const { setPipelineConfig } = await import("../selfTestPipeline.js");
      res.json(setPipelineConfig(req.body || {}));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.22: Rollback System Routes ────────────────────────────────────────
  app.get("/api/rollback/status", async (_req, res) => {
    try {
      const { getRollbackStatus } = await import("../selfRollback.js");
      res.json(getRollbackStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/rollback/create", validateBody(rollbackCreateSchema), async (req, res) => {
    try {
      const { createRollbackPoint } = await import("../selfRollback.js");
      const { files, label } = req.body || {};
      res.json(await createRollbackPoint(files || [], label));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/rollback/restore/:pointId", async (req, res) => {
    try {
      const { rollbackTo } = await import("../selfRollback.js");
      res.json(await rollbackTo(req.params.pointId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/rollback/restore-latest", async (_req, res) => {
    try {
      const { rollbackToLatest } = await import("../selfRollback.js");
      res.json(await rollbackToLatest());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/rollback/diff/:pointId", async (req, res) => {
    try {
      const { diffWithPoint } = await import("../selfRollback.js");
      res.json(diffWithPoint(req.params.pointId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/rollback/cleanup", async (_req, res) => {
    try {
      const { cleanupOldPoints } = await import("../selfRollback.js");
      res.json(cleanupOldPoints());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.22: Dependency Graph Routes ───────────────────────────────────────
  app.get("/api/deps/stats", async (_req, res) => {
    try {
      const { getGraphStats, isStale } = await import("../dependencyGraph.js");
      res.json({ ...getGraphStats(), stale: isStale() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/deps/build", async (_req, res) => {
    try {
      const { buildGraph } = await import("../dependencyGraph.js");
      const stats = await buildGraph();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/deps/impact/:file", async (req, res) => {
    try {
      const { analyzeImpact } = await import("../dependencyGraph.js");
      const filePath = decodeURIComponent(req.params.file);
      res.json(analyzeImpact(filePath));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/deps/tree/:file", async (req, res) => {
    try {
      const { getDependencyTree } = await import("../dependencyGraph.js");
      const filePath = decodeURIComponent(req.params.file);
      res.json(getDependencyTree(filePath));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/deps/importance", async (_req, res) => {
    try {
      const { getFilesByImportance } = await import("../dependencyGraph.js");
      res.json(getFilesByImportance());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/deps/circular", async (_req, res) => {
    try {
      const { findCircularDeps } = await import("../dependencyGraph.js");
      res.json(findCircularDeps());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.23: Self-Modification API ─────────────────────────────────────────
  app.post("/api/self-modify", validateBody(selfModifySchema), async (req, res) => {
    try {
      const { selfModify } = await import("../selfModify.js");
      const result = await selfModify(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-modify/batch", validateBody(selfModifyBatchSchema), async (req, res) => {
    try {
      const { selfModifyBatch } = await import("../selfModify.js");
      const result = await selfModifyBatch(req.body.requests || []);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/self-modify/stats", async (_req, res) => {
    try {
      const { getModificationStats } = await import("../selfModify.js");
      res.json(getModificationStats());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-modify/rollback/:backupId", async (req, res) => {
    try {
      const { restoreFromBackup } = await import("../selfModify.js");
      const result = restoreFromBackup(req.params.backupId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/self-modify/enable", async (req, res) => {
    try {
      const { setEnabled, isEnabled } = await import("../selfModify.js");
      setEnabled(req.body.enabled !== false);
      res.json({ enabled: isEnabled() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.23: Self-Introspection API ────────────────────────────────────────
  app.get("/api/introspect", async (_req, res) => {
    try {
      const { introspectSelf } = await import("../selfIntrospect.js");
      const report = await introspectSelf();
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/introspect/quick", async (_req, res) => {
    try {
      const { getQuickStats } = await import("../selfIntrospect.js");
      res.json(getQuickStats());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.53: Runtime Introspection Endpoints ──────────────────────────────
  app.get("/api/runtime/snapshot", async (_req, res) => {
    try {
      const { getOrchestratorStats } = await import("../autonomyOrchestrator.js");
      const { getRouterStats } = await import("../adaptiveRouter.js");
      const { getMonitorSummary } = await import("../selfMonitor.js");
      const { getImproverStats } = await import("../continuousImprover.js");
      const { getAuditLog } = await import("../selfImproveGuard.js");
      const orchestratorStats = getOrchestratorStats();
      const providerStats = getRouterStats?.() ?? {};
      const monitorStats = getMonitorSummary?.() ?? {};
      const improverStats = getImproverStats?.() ?? {};
      const guardStats = { recentAudit: getAuditLog?.(5) ?? [] };
      const memUsage = process.memoryUsage();
      res.json({
        pid: process.pid,
        uptime: Math.round(process.uptime()),
        memory: {
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
          externalMB: Math.round(memUsage.external / 1024 / 1024),
        },
        providerRouting: providerStats,
        monitoring: monitorStats,
        continuousImprover: improverStats,
        recursionGuard: guardStats,
        orchestrator: orchestratorStats,
        nodeVersion: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/runtime/tool-stats", async (_req, res) => {
    try {
      let toolStats: any = {};
      try { const m = await import("../transactionLog.js"); toolStats = (m as any).getToolStats?.() ?? {}; } catch {}
      res.json({ toolStats, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/constitution", async (_req, res) => {
    try {
      const { readFileSync, existsSync } = await import("fs");
      const { resolve, dirname } = await import("path");
      const { fileURLToPath } = await import("url");
      const serverDir = dirname(fileURLToPath(import.meta.url));
      const candidates = [
        resolve(serverDir, "..", "..", "andromeda-constitution.json"),
        resolve(serverDir, "..", "andromeda-constitution.json"),
        resolve(process.cwd(), "andromeda-constitution.json"),
      ];
      const constitutionPath = candidates.find(p => existsSync(p));
      if (!constitutionPath) return res.status(404).json({ error: "Constitution not found" });
      res.json(JSON.parse(readFileSync(constitutionPath, "utf-8")));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/runtime/boot-status", async (_req, res) => {
    try {
      const { readFileSync, existsSync } = await import("fs");
      const { join } = await import("path");
      const andDir = join(process.cwd(), ".andromeda");
      const bootCount = existsSync(join(andDir, ".boot_count")) ? parseInt(readFileSync(join(andDir, ".boot_count"), "utf-8") || "0") : 0;
      const crashFlagExists = existsSync(join(andDir, ".boot_crash_flag"));
      res.json({
        bootCount,
        crashGuardActive: crashFlagExists,
        andDir,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/module/reload", async (req, res) => {
    try {
      const { module: moduleName } = req.body || {};
      if (!moduleName) {
        return res.status(400).json({ error: "module name required" });
      }
      const resolvedPath = require.resolve(moduleName);
      if (resolvedPath && require.cache[resolvedPath]) {
        delete require.cache[resolvedPath];
      }
      Object.keys(require.cache).forEach(key => {
        const cached = require.cache[key];
        if (cached && cached.children && cached.children.some((c: any) => c.id === resolvedPath)) {
          delete require.cache[key];
        }
      });
      console.log(`[HotReload] Module cache cleared: ${moduleName}`);
      res.json({ success: true, module: moduleName, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/server/restart", async (_req, res) => {
    try {
      const { writeFileSync } = await import("fs");
      const { join } = await import("path");
      const restartFlag = join(process.cwd(), ".andromeda", ".restart_requested");
      writeFileSync(restartFlag, new Date().toISOString());
      res.json({ success: true, message: "Restart scheduled. Server will restart in 2 seconds." });
      setTimeout(() => {
        console.log("[Server] Graceful restart initiated by self-modification system");
        process.exit(0);
      }, 2000);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── v5.68: Self-Diagnostic Dashboard ────────────────────────────────────
  app.get("/api/self/diagnostic", async (_req, res) => {
    try {
      const { getAllTools } = await import("../tools/toolRegistry.js");
      const { getLastQualityReport } = await import("../codeQualityMonitor.js");
      const { getLastDocReport } = await import("../docGenerator.js");
      const { readdirSync, statSync } = await import("fs");
      const { join } = await import("path");
      const { execSync } = await import("child_process");
      const tools = getAllTools();
      const qualityReport = getLastQualityReport?.();
      const docReport = getLastDocReport?.();
      const memStats = getMemoryStats();
      const daemons = [
        "ContextCompressionDaemon", "CodebaseAnalyzer", "DependencyAuditor",
        "TestCoverageAnalyzer", "BenchmarkRunner", "CodeQualityMonitor",
        "DocGenerator", "ContinuousImprover",
      ];
      const serverDir = join(process.cwd(), "server");
      let sourceFiles = 0;
      let totalLines = 0;
      try {
        const walk = (dir: string) => {
          for (const entry of readdirSync(dir)) {
            if (entry === "node_modules") continue;
            const full = join(dir, entry);
            const stat = statSync(full);
            if (stat.isDirectory()) walk(full);
            else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
              sourceFiles++;
              const content = readFileSync(full, "utf8");
              totalLines += content.split("\n").length;
            }
          }
        };
        walk(serverDir);
      } catch { /* ignore */ }
      let tsStatus = "unknown";
      let tsErrors = 0;
      try {
        execSync("npx tsc --noEmit", { cwd: process.cwd(), timeout: 30_000, stdio: "pipe" });
        tsStatus = "clean";
      } catch (e) {
        tsStatus = "errors";
        const output = ((e as any).stderr?.toString() || "");
        tsErrors = (output.match(/error TS/g) || []).length;
      }
      let supervisorStatus: any = null;
      let continuityReport: any = null;
      let failureStats: any = null;
      let testStats: any = null;
      try { const { getSupervisorStatus } = await import("../safetySupervisor.js"); supervisorStatus = getSupervisorStatus(); } catch {}
      try { const { verifyContinuity } = await import("../identityManifest.js"); continuityReport = verifyContinuity(); } catch {}
      try { const { getFailureStats } = await import("../failurePatternMemory.js"); failureStats = getFailureStats(); } catch {}
      try { const { getTestStats } = await import("../selfTestGenerator.js"); testStats = getTestStats(); } catch {}
      // Read version from package.json (v6.03: no more hardcoded version)
      let version = "6.03.0";
      try { version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version; } catch {}
      res.json({
        version,
        timestamp: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
        autonomyLevel: "L5 (full autonomous self-modification)",
        codebase: { sourceFiles, totalLines, tsStatus, tsErrors },
        tools: {
          total: tools.length,
          names: tools.map((t: any) => t.name),
          selfModificationTools: tools.filter((t: any) =>
            t.name.startsWith("self_") || t.name === "verify_file_integrity" || t.name === "self_atomic_modify"
          ).map((t: any) => t.name),
        },
        memory: memStats,
        quality: qualityReport ? {
          score: qualityReport.overallScore,
          trend: qualityReport.trend,
          proposals: qualityReport.refactoringProposals.length,
          lastRun: new Date(qualityReport.timestamp).toISOString(),
        } : null,
        documentation: docReport ? {
          totalModules: docReport.totalModules,
          documentedModules: docReport.documentedModules,
          undocumentedExports: docReport.undocumentedExports.length,
          architectureUpdated: docReport.architectureUpdated,
        } : null,
        daemons: daemons.map(name => ({ name, status: "registered" })),
        capabilities: {
          chunkedWrites: true,
          fileIntegrityVerification: true,
          atomicMultiFileModification: true,
          inProcessTypeScriptCheck: tsStatus !== "unknown",
          memorySearch: true,
          selfReview: true,
          continuousImprovement: true,
          contextCompression: true,
          persistentContextStore: true,
          safetySupervisor: supervisorStatus !== null,
          twoPhaseCommit: true,
          failurePatternMemory: failureStats !== null,
          identityManifest: continuityReport !== null,
          selfTestGeneration: testStats !== null,
        },
        safety: { supervisor: supervisorStatus, continuity: continuityReport, failures: failureStats, tests: testStats },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── /api/health — Comprehensive Subsystem Health Check (v5.68) ──────────
  app.get("/api/health", async (_req, res) => {
    const startTime = Date.now();
    const checks: Array<{ subsystem: string; status: "ok" | "warn" | "fail"; latencyMs?: number; detail?: string }> = [];
    try {
      const provider = getActiveProvider();
      checks.push({ subsystem: "llm_provider", status: provider ? "ok" : "warn", detail: provider ? `Active: ${provider}` : "No active provider" });
    } catch (e) {
      checks.push({ subsystem: "llm_provider", status: "fail", detail: String(e).slice(0, 100) });
    }
    try {
      const stats = getMemoryStats() as Record<string, unknown>;
      checks.push({ subsystem: "memory", status: "ok", detail: `${(stats as any).total ?? 0} entries` });
    } catch (e) {
      checks.push({ subsystem: "memory", status: "fail", detail: String(e).slice(0, 100) });
    }
    try {
      const tools = getAllTools();
      checks.push({ subsystem: "tool_registry", status: tools.length > 0 ? "ok" : "warn", detail: `${tools.length} tools registered` });
    } catch (e) {
      checks.push({ subsystem: "tool_registry", status: "fail", detail: String(e).slice(0, 100) });
    }
    try {
      const monitorRunning = isMonitorRunning();
      const monitorHealth = getHealthReport();
      checks.push({ subsystem: "self_monitor", status: monitorRunning ? "ok" : "warn", detail: monitorRunning ? `Running, health: ${JSON.stringify(monitorHealth).slice(0, 80)}` : "Not running" });
    } catch (e) {
      checks.push({ subsystem: "self_monitor", status: "warn", detail: String(e).slice(0, 100) });
    }
    try {
      const braveConfigured = !!process.env.BRAVE_SEARCH_API_KEY;
      checks.push({ subsystem: "search", status: braveConfigured ? "ok" : "warn", detail: braveConfigured ? "Brave Search configured" : "No Brave key — using SearXNG fallback" });
    } catch (e) {
      checks.push({ subsystem: "search", status: "warn", detail: String(e).slice(0, 100) });
    }
    try {
      const { checkDockerAvailability } = await import("../tools/dockerSandbox.js");
      const dockerAvail = await checkDockerAvailability();
      checks.push({ subsystem: "sandbox_docker", status: dockerAvail ? "ok" : "warn", detail: dockerAvail ? "Docker available" : "Docker unavailable (local fallback active)" });
    } catch (e) {
      checks.push({ subsystem: "sandbox_docker", status: "warn", detail: String(e).slice(0, 100) });
    }
    try {
      const { getImproverStats } = await import("../continuousImprover.js");
      const stats = getImproverStats?.();
      checks.push({ subsystem: "continuous_improver", status: stats ? "ok" : "warn", detail: stats ? `Cycles: ${stats.totalCycles ?? 0}, applied: ${stats.totalApplied ?? 0}` : "Stats unavailable" });
    } catch (e) {
      checks.push({ subsystem: "continuous_improver", status: "warn", detail: "Not running or unavailable" });
    }
    try {
      const { getHealStatus } = await import("../selfHeal.js");
      const healStatus = getHealStatus();
      checks.push({ subsystem: "self_heal", status: healStatus?.running ? "ok" : "warn", detail: healStatus ? `Running: ${healStatus.running}, failures: ${healStatus.consecutiveFailures ?? 0}` : "Not running" });
    } catch (e) {
      checks.push({ subsystem: "self_heal", status: "warn", detail: "Not running or unavailable" });
    }
    try {
      const { getFailureStats } = await import("../failurePatternMemory.js");
      const failStats = getFailureStats();
      checks.push({ subsystem: "failure_pattern_memory", status: "ok", detail: `${failStats?.totalFailures ?? 0} recorded failures` });
    } catch (e) {
      checks.push({ subsystem: "failure_pattern_memory", status: "warn", detail: String(e).slice(0, 100) });
    }
    try {
      const { getWorkspaceDir } = await import("../workspace.js");
      const wsDir = getWorkspaceDir();
      const testFile = wsDir + "/.health_check_" + Date.now() + ".tmp";
      const { writeFileSync, unlinkSync } = await import("fs");
      writeFileSync(testFile, "ok");
      unlinkSync(testFile);
      checks.push({ subsystem: "filesystem", status: "ok", detail: `Read/write OK at ${wsDir}` });
    } catch (e) {
      checks.push({ subsystem: "filesystem", status: "fail", detail: String(e).slice(0, 100) });
    }
    try {
      const { execSync: execS } = await import("child_process");
      const { resolve: pathRes } = await import("path");
      const pkgRoot = pathRes(process.cwd());
      const auditStart = Date.now();
      try {
        execS("npm audit --json --audit-level=high 2>/dev/null", { cwd: pkgRoot, timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });
        checks.push({ subsystem: "npm_audit", status: "ok", latencyMs: Date.now() - auditStart, detail: "No high/critical vulnerabilities" });
      } catch (auditErr: any) {
        const auditOutput = auditErr?.stdout?.toString() ?? "";
        let vulnCount = 0;
        try { vulnCount = JSON.parse(auditOutput)?.metadata?.vulnerabilities?.high ?? 0; } catch {}
        checks.push({ subsystem: "npm_audit", status: vulnCount > 0 ? "warn" : "ok", latencyMs: Date.now() - auditStart, detail: vulnCount > 0 ? `${vulnCount} high vulnerabilities found` : "Audit completed" });
      }
    } catch (e) {
      checks.push({ subsystem: "npm_audit", status: "warn", detail: "npm audit unavailable" });
    }
    const totalMs = Date.now() - startTime;
    const failCount = checks.filter(c => c.status === "fail").length;
    const warnCount = checks.filter(c => c.status === "warn").length;
    const okCount = checks.filter(c => c.status === "ok").length;
    const overallStatus = failCount > 0 ? "degraded" : warnCount > 3 ? "fair" : "healthy";
    // Read version from package.json
    let version = "6.03.0";
    try { version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")).version; } catch {}
    res.json({
      version,
      timestamp: new Date().toISOString(),
      overallStatus,
      summary: { ok: okCount, warn: warnCount, fail: failCount, totalChecks: checks.length, totalMs },
      checks,
    });
  });
}
