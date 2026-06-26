/**
 * selfAwareness.ts — Self-Awareness Tools for Andromeda
 * v5.14: Implements get_own_capabilities and run_self_diagnosis
 *
 * These tools allow the AI agent to query its own system state,
 * capabilities, and run health diagnostics — enabling true self-awareness.
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { getAllTools } from "./toolRegistry";
import { getDb } from "../db";
import { checkDockerAvailability } from "./dockerSandbox";
import {   writeFileSync, unlinkSync, readdirSync, statSync } from "fs";
import { join as joinPath } from "path";
import { execSync } from "child_process";
import * as osModule from "os";

// ─── get_own_capabilities ──────────────────────────────────────────────────

registerTool({
  name: "get_own_capabilities",
  description: "Query Andromeda's own system capabilities, configuration, health status, available tools, and version information. Use this to understand what you can and cannot do.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "get_own_capabilities",
      description: "Query Andromeda's own system capabilities, configuration, health status, available tools, and version information.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["all", "tools", "providers", "memory", "search", "sandbox", "version"],
            description: "Which section of capabilities to return. Use 'all' for complete overview.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const section = (args.section as string) || "all";

    const capabilities: Record<string, unknown> = {};

    if (section === "all" || section === "version") {
      capabilities.version = {
        name: "Andromeda",
        version: "5.14.0",
        architecture: "Full-stack AI research agent platform",
        runtime: "Node.js + Express + tRPC + React + Vite",
        database: "MySQL via drizzle-orm (optional, graceful fallback)",
      };
    }

    if (section === "all" || section === "tools") {
      const allTools = getAllTools();
      capabilities.tools = {
        totalCount: allTools.length,
        categories: {
          code: allTools.filter(t => t.category === "code").map(t => t.name),
          search: allTools.filter(t => t.category === "search").map(t => t.name),
          browser: allTools.filter(t => t.category === "browser").map(t => t.name),
          filesystem: allTools.filter(t => t.category === "filesystem").map(t => t.name),
          analysis: allTools.filter(t => t.category === "analysis").map(t => t.name),
          system: allTools.filter(t => t.category === "system").map(t => t.name),
          sandbox: allTools.filter(t => t.category === "sandbox").map(t => t.name),
          mcp: allTools.filter(t => t.category === "mcp").map(t => t.name),
        },
        safetyLevels: {
          safe: allTools.filter(t => t.safety === "safe").length,
          moderate: allTools.filter(t => t.safety === "moderate").length,
          dangerous: allTools.filter(t => t.safety === "dangerous").length,
        },
      };
    }

    if (section === "all" || section === "providers") {
      capabilities.llmProviders = {
        primary: {
          name: "DeepSeek",
          model: process.env.LLM_DEFAULT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek/deepseek-chat",
          configured: !!process.env.DEEPSEEK_API_KEY,
        },
        secondary: {
          name: "Gemini",
          model: process.env.LLM_DEFAULT_MODEL || "gemini-2.5-flash",
          configured: !!process.env.GEMINI_API_KEY,
        },
        r1Reasoning: {
          name: "DeepSeek R1",
          model: process.env.LLM_REASONING_MODEL || "deepseek/deepseek-r1",
          configured: !!process.env.DEEPSEEK_API_KEY,
        },
      };
    }

    if (section === "all" || section === "memory") {
      capabilities.memory = {
        vectorSearch: true,
        keywordSearch: true,
        longTermMemory: true,
        consolidation: true,
        goalManagement: true,
        contextBus: true,
        andromedaMd: true, // ANDROMEDA.md project memory
      };
    }

    if (section === "all" || section === "search") {
      capabilities.search = {
        brave: {
          configured: !!process.env.BRAVE_SEARCH_API_KEY,
          type: "primary",
        },
        searxng: {
          configured: true,
          type: "fallback",
          url: process.env.SEARXNG_URL || "http://localhost:8080",
        },
        deepResearch: true,
        subQueryDecomposition: true,
      };
    }

    if (section === "all" || section === "sandbox") {
      const dockerAvailable = await checkDockerAvailability();
      capabilities.sandbox = {
        docker: {
          available: dockerAvailable,
          image: "node:20-slim",
          timeout: "30s",
        },
        localFallback: true,
        codeExecution: {
          javascript: true,
          typescript: true,
          python: !!process.env.PYTHON_PATH || true,
          bash: true,
        },
        fileEditing: {
          multiPassEngine: true,
          maxFiles: 2000,
          maxZipSize: "100MB",
          truncationDetection: true,
          autoCompletion: true,
        },
      };
    }

    capabilities.selfImprovement = {
      analyzeAndPropose: true,
      guardedApply: true,
      rollback: true,
      testGeneration: true,
      codeReview: true,
      selfRollbackOnFailure: true, // v5.14
    };

    capabilities.multiAgent = {
      orchestrator: true,
      teamAgent: true,
      taskDecomposer: true,
      mcpClient: true,
    };

    return {
      success: true,
      output: JSON.stringify(capabilities, null, 2),
    };
  },
});

// ─── run_self_diagnosis ────────────────────────────────────────────────────

registerTool({
  name: "run_self_diagnosis",
  description: "Run comprehensive system health checks and return a diagnostic report. Tests database, LLM connectivity, search, Docker, memory, and file system access.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "run_self_diagnosis",
      description: "Run comprehensive system health checks and return a diagnostic report.",
      parameters: {
        type: "object",
        properties: {
          checks: {
            type: "array",
            items: { type: "string", enum: ["database", "llm", "search", "docker", "filesystem", "memory", "all"] },
            description: "Which checks to run. Defaults to 'all'.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    const checks = (args.checks as string[]) || ["all"];
    const runAll = checks.includes("all");
    const results: Array<{ check: string; status: "ok" | "warn" | "fail"; latencyMs?: number; detail?: string }> = [];
    const startTime = Date.now();

    // Database check
    if (runAll || checks.includes("database")) {
      const dbStart = Date.now();
      try {
        const db = await getDb();
        if (db) {
          results.push({ check: "database", status: "ok", latencyMs: Date.now() - dbStart, detail: "MySQL connection pool active" });
        } else {
          results.push({ check: "database", status: "warn", detail: "Database not configured (running in fallback mode)" });
        }
      } catch (e) {
        results.push({ check: "database", status: "fail", latencyMs: Date.now() - dbStart, detail: `Connection failed: ${String(e)}` });
      }
    }

    // LLM check
    if (runAll || checks.includes("llm")) {
      const llmStart = Date.now();
      try {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
          results.push({ check: "llm_deepseek", status: "fail", detail: "DEEPSEEK_API_KEY not configured" });
        } else {
          const response = await fetch("https://api.deepseek.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) {
            results.push({ check: "llm_deepseek", status: "ok", latencyMs: Date.now() - llmStart, detail: "API reachable" });
          } else {
            results.push({ check: "llm_deepseek", status: "warn", latencyMs: Date.now() - llmStart, detail: `API returned ${response.status}` });
          }
        }
      } catch (e) {
        results.push({ check: "llm_deepseek", status: "fail", latencyMs: Date.now() - llmStart, detail: `Unreachable: ${String(e)}` });
      }
    }

    // Search check
    if (runAll || checks.includes("search")) {
      const searchStart = Date.now();
      try {
        const braveKey = process.env.BRAVE_SEARCH_API_KEY;
        if (!braveKey) {
          results.push({ check: "search_brave", status: "warn", detail: "BRAVE_SEARCH_API_KEY not configured (will use SearXNG only)" });
        } else {
          results.push({ check: "search_brave", status: "ok", detail: "API key configured" });
        }

        // Test SearXNG
        const searxUrl = process.env.SEARXNG_URL || "http://localhost:8080";
        try {
          const searxResp = await fetch(`${searxUrl}/search?q=test&format=json`, {
            signal: AbortSignal.timeout(5000),
          });
          if (searxResp.ok) {
            results.push({ check: "search_searxng", status: "ok", latencyMs: Date.now() - searchStart, detail: `Reachable at ${searxUrl}` });
          } else {
            results.push({ check: "search_searxng", status: "warn", latencyMs: Date.now() - searchStart, detail: `Returned ${searxResp.status}` });
          }
        } catch {
          results.push({ check: "search_searxng", status: "warn", detail: `Unreachable at ${searxUrl}` });
        }
      } catch (e) {
        results.push({ check: "search", status: "fail", detail: String(e) });
      }
    }

    // Docker check
    if (runAll || checks.includes("docker")) {
      try {
        const dockerAvail = await checkDockerAvailability();
        results.push({
          check: "docker",
          status: dockerAvail ? "ok" : "warn",
          detail: dockerAvail ? "Docker available for code execution" : "Docker not available (using local fallback)",
        });
      } catch (e) {
        results.push({ check: "docker", status: "warn", detail: `Check failed: ${String(e)}` });
      }
    }

    // Filesystem check
    if (runAll || checks.includes("filesystem")) {
try {
        const testDir = ctx.workspaceDir || "/tmp";
        const testFile = joinPath(testDir, `.andromeda_health_${Date.now()}.tmp`);
        writeFileSync(testFile, "health_check");
        unlinkSync(testFile);
        results.push({ check: "filesystem", status: "ok", detail: `Read/write access to ${testDir}` });
      } catch (e) {
        results.push({ check: "filesystem", status: "fail", detail: `No write access: ${String(e)}` });
      }
    }

    // Memory check
    if (runAll || checks.includes("memory")) {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      const status = heapUsedMB > 500 ? "warn" : "ok";
      results.push({
        check: "memory",
        status,
        detail: `Heap: ${heapUsedMB}/${heapTotalMB}MB, RSS: ${rssMB}MB${status === "warn" ? " (high usage)" : ""}`,
      });
    }

    const totalTime = Date.now() - startTime;
    const okCount = results.filter(r => r.status === "ok").length;
    const warnCount = results.filter(r => r.status === "warn").length;
    const failCount = results.filter(r => r.status === "fail").length;

    const report = {
      timestamp: new Date().toISOString(),
      totalChecks: results.length,
      passed: okCount,
      warnings: warnCount,
      failures: failCount,
      overallHealth: failCount > 0 ? "degraded" : warnCount > 2 ? "fair" : "healthy",
      totalDiagnosisTimeMs: totalTime,
      results,
    };

    return {
      success: true,
      output: JSON.stringify(report, null, 2),
    };
  },
});

// ─── get_system_context ────────────────────────────────────────────────────
// Inspired by Claude Code's context.ts — provides runtime context to the agent

registerTool({
  name: "get_system_context",
  description: "Get current system context: working directory, OS info, git status, recent files, and environment. Helps the agent understand its operating environment.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "get_system_context",
      description: "Get current system context including working directory, OS, git status, and environment.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
const context: Record<string, unknown> = {
      os: {
        platform: osModule.platform(),
        arch: osModule.arch(),
        hostname: osModule.hostname(),
        uptime: `${Math.round(osModule.uptime() / 60)} minutes`,
        freeMemory: `${Math.round(osModule.freemem() / 1024 / 1024)}MB`,
        cpus: osModule.cpus().length,
      },
      workingDirectory: ctx.workspaceDir,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    };

    // Git status (if in a git repo)
    try {
      const gitBranch = execSync("git branch --show-current", { cwd: ctx.workspaceDir, timeout: 5000 }).toString().trim();
      const gitStatus = execSync("git status --porcelain", { cwd: ctx.workspaceDir, timeout: 5000 }).toString().trim();
      const gitLog = execSync("git log --oneline -5", { cwd: ctx.workspaceDir, timeout: 5000 }).toString().trim();
      context.git = {
        branch: gitBranch,
        uncommittedChanges: gitStatus.split("\n").filter(Boolean).length,
        recentCommits: gitLog.split("\n"),
      };
    } catch {
      context.git = { status: "not a git repository" };
    }

    // Recent files in workspace
    try {
      const files = readdirSync(ctx.workspaceDir)
        .map(f => {
          try {
            const stat = statSync(joinPath(ctx.workspaceDir, f));
            return { name: f, isDir: stat.isDirectory(), modified: stat.mtime.toISOString(), size: stat.size };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
        .slice(0, 20);
      context.recentFiles = files;
    } catch {
      context.recentFiles = [];
    }

    return {
      success: true,
      output: JSON.stringify(context, null, 2),
    };
  },
});

// ─── self_awareness (alias for get_own_capabilities) ──────────────────────
// v5.68: The model sometimes hallucinates "self_awareness" as a tool name
// (confusing the "### Self-Awareness" section header with a tool name).
// This alias gracefully redirects to get_own_capabilities so the agent
// doesn't get stuck when it uses the wrong name.
registerTool({
  name: "self_awareness",
  description: "Alias for get_own_capabilities. Query Andromeda's own system capabilities, available tools, health status, and version information. NOTE: prefer get_own_capabilities directly.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_awareness",
      description: "Alias for get_own_capabilities. Query Andromeda's own system capabilities, available tools, health status, and version information.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What aspect to query (e.g. 'full system state', 'available tools', 'version'). Optional.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (_args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    // Delegate to get_own_capabilities with section="all"
    const { executeTool } = await import("./index");
    return executeTool("get_own_capabilities", { section: "all" }, ctx);
  },
});

// ─── list_codebase_files (alias for tree_view) ────────────────────────────
// v5.68: The model sometimes hallucinates "list_codebase_files" as a tool name.
// This alias gracefully redirects to tree_view so the agent doesn't get stuck.
registerTool({
  name: "list_codebase_files",
  description: "Alias for tree_view. Show directory tree structure of the codebase with all files and folders. NOTE: prefer tree_view or list_directory directly.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "list_codebase_files",
      description: "Alias for tree_view. Show directory tree structure of the codebase with all files and folders.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path to list. Defaults to current workspace.",
          },
          depth: {
            type: "number",
            description: "Maximum depth to traverse. Defaults to 4.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> => {
    // v5.80: PATH TRANSLATION — redirect hallucinated src/ paths to the real server/ directory.
    // The model often calls list_codebase_files({ path: 'src' }) because it was trained on
    // projects with src/ layouts. We silently redirect to the actual server source directory.
    const { getServerDir } = await import("../workspace");
    const serverDir = getServerDir();
    const projectRoot = require("path").resolve(serverDir, "..");

    let translatedArgs = { ...args };
    const rawPath = String(args.path ?? "");

    // Map of hallucinated path prefixes → real paths
    const pathTranslations: Array<[RegExp, string]> = [
      [/^src\/?$/, serverDir],                          // src → server/
      [/^src\//, serverDir + "/"],                     // src/foo → server/foo
      [/^\/app\/src\/?$/, serverDir],                  // /app/src → server/
      [/^\/app\/src\//, serverDir + "/"],              // /app/src/foo → server/foo
      [/^\/app\/?$/, projectRoot],                     // /app → project root
      [/^\/app\/server\/?$/, serverDir],               // /app/server → server/
      [/^\/app\/server\//, serverDir + "/"],           // /app/server/foo → server/foo
      [/^server\/?$/, serverDir],                      // server → server/ (absolute)
      [/^\.$/, serverDir],                             // . → server/ (when called from self-improve context)
    ];

    if (rawPath) {
      for (const [pattern, replacement] of pathTranslations) {
        if (pattern.test(rawPath)) {
          const realPath = rawPath.replace(pattern, replacement);
          translatedArgs = { ...args, path: realPath };
          console.log(`[list_codebase_files] PATH TRANSLATION (v5.80): '${rawPath}' → '${realPath}'`);
          break;
        }
      }
    } else {
      // No path specified — default to server directory
      translatedArgs = { ...args, path: serverDir };
    }

    // Delegate to tree_view with the translated path
    const { executeTool } = await import("./index");
    const result = await executeTool("tree_view", translatedArgs, ctx);

    // Prepend a note if we did a translation
    if (translatedArgs.path !== args.path || !args.path) {
      const note = `[PATH TRANSLATION (v5.80): Redirected '${rawPath || "(none)"}' → server source directory at: ${translatedArgs.path}]\n\n`;
      return { ...result, output: note + (result.output ?? "") };
    }
    return result;
  },
});


