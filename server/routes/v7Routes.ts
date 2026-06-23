/**
 * v7Routes.ts — v7.0
 *
 * Production-hardened API endpoints for Andromeda v7.0:
 *
 *   GET  /api/watchdog/status          — self-healing watchdog status
 *   POST /api/watchdog/check           — trigger immediate health check
 *   GET  /api/telemetry/metrics        — raw telemetry samples
 *   GET  /api/telemetry/summary        — aggregated performance summary
 *   GET  /api/v7/capabilities          — full capability manifest (SOTA comparison)
 *   GET  /api/v7/roadmap               — v6.0 → v7.0 roadmap with completion status
 */

import { Router, type Request, type Response } from "express";
import { getWatchdogStatus, triggerHealthCheck } from "../watchdog.js";
import { getTelemetrySummary, getRawSamples } from "../telemetry.js";
import { requireOperator, requireAdmin } from "../rbac.js";

export const v7Router = Router();

// ── Watchdog ───────────────────────────────────────────────────────────────────

v7Router.get("/watchdog/status", requireOperator, (_req: Request, res: Response) => {
  res.json(getWatchdogStatus());
});

v7Router.post("/watchdog/check", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const status = await triggerHealthCheck();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Telemetry ──────────────────────────────────────────────────────────────────

v7Router.get("/telemetry/summary", requireOperator, (_req: Request, res: Response) => {
  res.json(getTelemetrySummary());
});

v7Router.get("/telemetry/metrics", requireOperator, (_req: Request, res: Response) => {
  res.json(getRawSamples());
});

// ── Capability Manifest ────────────────────────────────────────────────────────

v7Router.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    version: "7.0.0",
    codename: "Andromeda",
    releaseDate: "2026-06-04",
    capabilities: [
      // ── Core RSI ────────────────────────────────────────────────────────────
      { id: "rsi_core",              category: "self_improvement", name: "Recursive Self-Improvement Engine",       since: "v5.75", status: "production" },
      { id: "self_improve",          category: "self_improvement", name: "Proposal Generation & Auto-Apply",        since: "v5.80", status: "production" },
      { id: "safety_supervisor",     category: "safety",           name: "Constitutional Safety Supervisor",        since: "v5.90", status: "production" },
      { id: "eval_framework",        category: "evaluation",       name: "50-Task Benchmark Eval Framework",        since: "v6.00", status: "production" },
      // ── v6.36 ────────────────────────────────────────────────────────────────
      { id: "goal_discovery",        category: "autonomy",         name: "Unsupervised Goal Discovery from Evals",  since: "v6.36", status: "production" },
      { id: "meta_learning",         category: "self_improvement", name: "Meta-Learning (weak-category bias)",      since: "v6.36", status: "production" },
      { id: "learned_constraints",   category: "safety",           name: "Constitutional AI Expansion",             since: "v6.36", status: "production" },
      { id: "context_persistence",   category: "memory",           name: "Cross-Session Context Persistence",       since: "v6.36", status: "production" },
      // ── v6.37 ────────────────────────────────────────────────────────────────
      { id: "postgres_adapter",      category: "infrastructure",   name: "Postgres Adapter with Auto-Migration",    since: "v6.37", status: "production" },
      { id: "streaming_eval",        category: "evaluation",       name: "Streaming Eval via SSE",                  since: "v6.37", status: "production" },
      { id: "goal_decomposition",    category: "autonomy",         name: "Goal Decomposition (DiscoveredGoal→MetaGoal)", since: "v6.37", status: "production" },
      { id: "kubernetes",            category: "infrastructure",   name: "Kubernetes Manifests + HPA",              since: "v6.37", status: "production" },
      { id: "auto_deploy",           category: "infrastructure",   name: "GitHub Actions Auto-Deploy (GHCR+k8s)",   since: "v6.37", status: "production" },
      // ── v6.38 ────────────────────────────────────────────────────────────────
      { id: "rbac",                  category: "security",         name: "Role-Based Access Control (6 roles)",     since: "v6.38", status: "production" },
      { id: "multi_tenant",          category: "security",         name: "Multi-Tenant Isolation + Quota Mgmt",     since: "v6.38", status: "production" },
      { id: "audit_log",             category: "security",         name: "Structured Audit Log (append-only JSONL)", since: "v6.38", status: "production" },
      // ── v6.39 ────────────────────────────────────────────────────────────────
      { id: "federated_learning",    category: "distributed",      name: "Federated Learning (multi-node RSI sync)", since: "v6.39", status: "production" },
      { id: "gossip_protocol",       category: "distributed",      name: "Gossip Protocol (push+pull sync)",         since: "v6.39", status: "production" },
      { id: "federated_averaging",   category: "distributed",      name: "Federated Averaging (weighted scores)",    since: "v6.39", status: "production" },
      // ── v6.40 ────────────────────────────────────────────────────────────────
      { id: "adaptive_eval",         category: "evaluation",       name: "Adaptive Eval (LLM-generated benchmarks)", since: "v6.40", status: "production" },
      { id: "dynamic_difficulty",    category: "evaluation",       name: "Dynamic Difficulty Scaling",               since: "v6.40", status: "production" },
      { id: "benchmark_evolution",   category: "evaluation",       name: "Benchmark Evolution (retire/promote)",     since: "v6.40", status: "production" },
      { id: "gap_analysis",          category: "evaluation",       name: "Eval Gap Analysis",                        since: "v6.40", status: "production" },
      // ── v7.0 ─────────────────────────────────────────────────────────────────
      { id: "watchdog",              category: "reliability",      name: "Self-Healing Watchdog (auto-recovery)",    since: "v7.0",  status: "production" },
      { id: "telemetry",             category: "observability",    name: "Performance Telemetry (p50/p95/p99)",      since: "v7.0",  status: "production" },
      { id: "capability_manifest",   category: "observability",    name: "Capability Manifest API",                  since: "v7.0",  status: "production" },
    ],
    capabilityCount: 28,
    categories: ["self_improvement", "safety", "evaluation", "autonomy", "memory", "infrastructure", "security", "distributed", "reliability", "observability"],
  });
});

// ── Roadmap ────────────────────────────────────────────────────────────────────

v7Router.get("/roadmap", (_req: Request, res: Response) => {
  res.json({
    project: "Andromeda",
    goal: "State-of-the-art recursive self-improving AI agent capable of continuous autonomous improvement",
    milestones: [
      { version: "v5.75", theme: "RSI Engine Foundation",              status: "complete", highlights: ["RSI engine", "proposal generation", "eval framework"] },
      { version: "v5.80", theme: "Self-Modification & Safety",         status: "complete", highlights: ["selfModify", "safetySupervisor", "circuit breakers"] },
      { version: "v5.90", theme: "Autonomy & Goal Management",         status: "complete", highlights: ["recursiveGoals", "autoGoalSuggester", "autonomyOrchestrator"] },
      { version: "v6.00", theme: "Multi-Agent & Knowledge Systems",    status: "complete", highlights: ["multiAgentImprover", "unifiedKnowledge", "skillGraph"] },
      { version: "v6.10", theme: "Context & Memory Architecture",      status: "complete", highlights: ["tieredContextManager", "systemMemory", "contextBus"] },
      { version: "v6.20", theme: "Consensus & Consistency",            status: "complete", highlights: ["consensusEngine", "selfConsistency", "adaptiveRouter"] },
      { version: "v6.30", theme: "Continuous Improvement Pipeline",    status: "complete", highlights: ["continuousImprover", "transactionLog", "hotReload"] },
      { version: "v6.36", theme: "Unsupervised Learning & Constitutional AI", status: "complete", highlights: ["evalGoalDiscovery", "meta-learning", "learnedConstraints", "context persistence"] },
      { version: "v6.37", theme: "Production Infrastructure",          status: "complete", highlights: ["Postgres", "streaming eval", "goal decomposition", "k8s", "auto-deploy"] },
      { version: "v6.38", theme: "Security & Multi-Tenancy",           status: "complete", highlights: ["RBAC (6 roles)", "multi-tenant isolation", "audit log"] },
      { version: "v6.39", theme: "Federated Multi-Node Learning",      status: "complete", highlights: ["federated learning", "gossip protocol", "federated averaging"] },
      { version: "v6.40", theme: "Adaptive Evaluation",                status: "complete", highlights: ["LLM-generated benchmarks", "dynamic difficulty", "benchmark evolution"] },
      { version: "v7.0",  theme: "Production-Hardened Integration",    status: "complete", highlights: ["self-healing watchdog", "performance telemetry", "capability manifest", "full SOTA assessment"] },
    ],
    nextHorizon: {
      version: "v7.1+",
      theme: "Continuous Autonomous Operation",
      plannedFeatures: [
        "Real-time eval streaming to frontend dashboard",
        "Automated PR generation for self-improvements",
        "Cross-agent knowledge transfer (Andromeda ↔ external agents)",
        "Reinforcement learning from human feedback (RLHF) integration",
        "Autonomous capability gap closure (no human intervention required)",
      ],
    },
  });
});
