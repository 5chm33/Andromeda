/**
 * selfImprovementTools.ts — Andromeda v5.97
 *
 * Registers the new self-improvement tools from server/self/:
 *
 * 1. self_smoke_test        — Run 6 structural smoke tests after any modification
 * 2. self_behavioral_test   — Run 8 behavioral regression tests
 * 3. self_compile_pipeline  — Run the full 6-stage self-compilation pipeline
 * 4. self_benchmark_suite   — Run the benchmark suite and detect regressions
 * 5. self_dep_upgrade       — Scan and safely upgrade npm dependencies
 * 6. self_dep_graph         — Build and analyze the dependency graph
 * 7. self_chunked_write     — Write large files in chunks (prevents truncation)
 */

import { registerTool } from "./toolRegistry.js";
import type { ToolResult } from "./toolRegistry.js";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";

function getServerDir(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    if (path.basename(here) === "dist" || path.basename(here) === "build") {
      const serverSibling = path.resolve(here, "..", "server");
      if (fs.existsSync(serverSibling)) return serverSibling;
    }
    if (path.basename(here) === "tools") return path.resolve(here, "..");
    return path.resolve(here);
  } catch {
    return path.resolve(process.cwd(), "server");
  }
}

// ─── Tool 1: Smoke Tests ─────────────────────────────────────────────────────

registerTool({
  name: "self_smoke_test",
  category: "system",
  safety: "safe",
  description: "Run 6 structural smoke tests after any self-modification: TypeScript compilation, module imports, tool registry, config files, critical files, circular dependencies. Returns pass/fail with rollback recommendation.",
  definition: {
    type: "function",
    function: {
      name: "self_smoke_test",
      description: "Run structural smoke tests after self-modification to verify the codebase is still sound.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_params, _ctx): Promise<ToolResult> => {
    try {
      const { runSmokeTests } = await import("../self/smoke_test_runner.js");
      const serverDir = getServerDir();
      const result = await runSmokeTests(serverDir);

      let summary = `Smoke Tests: ${result.passed}/${result.totalTests} passed\n\n`;
      for (const t of result.results) {
        summary += `${t.passed ? "✅" : "❌"} ${t.name} (${t.durationMs}ms)\n`;
        if (t.error) summary += `   Error: ${t.error}\n`;
      }

      if (result.rollbackRecommended) {
        summary += `\n⚠️  ROLLBACK RECOMMENDED: ${result.failed} test(s) failed.`;
      } else {
        summary += `\n✅ All smoke tests passed. Changes are safe.`;
      }

      return { success: !result.rollbackRecommended, output: summary };
    } catch (error: any) {
      return { success: false, output: `Smoke test runner failed: ${error.message}` };
    }
  },
});

// ─── Tool 2: Behavioral Tests ────────────────────────────────────────────────

registerTool({
  name: "self_behavioral_test",
  category: "system",
  safety: "safe",
  description: "Run behavioral regression tests to verify core runtime behaviors still work after self-modification. Tests: file IO, code execution, tool discovery, memory, LLM config, web search module.",
  definition: {
    type: "function",
    function: {
      name: "self_behavioral_test",
      description: "Run behavioral regression tests after self-modification.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_params, _ctx): Promise<ToolResult> => {
    try {
      const { runBehavioralTests, formatBehavioralTestResults } = await import("../self/behavioral_tests.js");
      const serverDir = getServerDir();
      const result = await runBehavioralTests(serverDir);
      return {
        success: !result.rollbackRecommended,
        output: formatBehavioralTestResults(result),
      };
    } catch (error: any) {
      return { success: false, output: `Behavioral test runner failed: ${error.message}` };
    }
  },
});

// ─── Tool 3: Compilation Pipeline ────────────────────────────────────────────

registerTool({
  name: "self_compile_pipeline",
  category: "system",
  safety: "safe",
  description: "Run the full 6-stage self-compilation pipeline: pre-build validation, TypeScript check, backup, clean build, post-build verification. Automatically rolls back on failure.",
  definition: {
    type: "function",
    function: {
      name: "self_compile_pipeline",
      description: "Run the full self-compilation pipeline with automatic rollback on failure.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_params, _ctx): Promise<ToolResult> => {
    try {
      const { runSelfCompilation, formatBuildResults } = await import("../self/compilation_pipeline.js");
      const serverDir = getServerDir();
      const result = await runSelfCompilation(serverDir);
      return {
        success: result.success,
        output: formatBuildResults(result),
      };
    } catch (error: any) {
      return { success: false, output: `Compilation pipeline failed: ${error.message}` };
    }
  },
});

// ─── Tool 4: Benchmark Suite ─────────────────────────────────────────────────

registerTool({
  name: "self_benchmark_suite",
  category: "system",
  safety: "safe",
  description: "Run the benchmark suite to measure TypeScript compilation time, lines of code, and TypeScript error count. Compares against historical baselines and reports regressions.",
  definition: {
    type: "function",
    function: {
      name: "self_benchmark_suite",
      description: "Run benchmarks and detect performance regressions against historical baselines.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_params, _ctx): Promise<ToolResult> => {
    try {
      const { runBenchmarks } = await import("../self/benchmark_suite.js");
      const serverDir = getServerDir();
      const result = await runBenchmarks(serverDir);

      let summary = `Benchmarks: ${result.summary.passed}/${result.summary.total} passed\n\n`;
      for (const m of result.metrics) {
        summary += `📊 ${m.name}: ${m.value}${m.unit}\n`;
      }
      if (result.regressions.length > 0) {
        summary += `\n⚠️  ${result.regressions.length} regression(s) detected:\n`;
        for (const r of result.regressions) {
          summary += `  [${r.severity}] ${r.metric}: ${r.changePercent.toFixed(1)}% change\n`;
        }
      }

      return {
        success: result.regressions.filter(r => r.severity === "critical").length === 0,
        output: summary,
      };
    } catch (error: any) {
      return { success: false, output: `Benchmark suite failed: ${error.message}` };
    }
  },
});

// ─── Tool 5: Dependency Upgrade ──────────────────────────────────────────────

registerTool({
  name: "self_dep_upgrade",
  category: "system",
  safety: "moderate",
  description: "Scan for outdated npm dependencies and safely upgrade patch/minor versions. Validates with TypeScript check after each upgrade. Rolls back if validation fails. Use dry_run=true to only scan.",
  definition: {
    type: "function",
    function: {
      name: "self_dep_upgrade",
      description: "Scan and safely upgrade npm dependencies. Validates and rolls back on failure.",
      parameters: {
        type: "object",
        properties: {
          dry_run: {
            type: "boolean",
            description: "If true, only scan and report outdated packages without upgrading",
          },
        },
        required: [],
      },
    },
  },
  execute: async (params: any, _ctx): Promise<ToolResult> => {
    try {
      const { scanOutdatedPackages, runUpgradeSession } = await import("../self/dependency_upgrader.js");
      const serverDir = getServerDir();

      const outdated = await scanOutdatedPackages(serverDir);

      if (params.dry_run || outdated.length === 0) {
        const summary = outdated.length === 0
          ? "All dependencies are up to date."
          : `Found ${outdated.length} outdated packages:\n` + outdated.map((p: any) => `  ${p.name}: ${p.current} → ${p.latest} (${p.releaseType})`).join("\n");
        return { success: true, output: summary };
      }

      const session = await runUpgradeSession(serverDir);
      let summary = `Upgrade Session: ${session.results.filter((r: any) => r.success).length}/${session.results.length} succeeded\n\n`;
      for (const r of session.results as any[]) {
        summary += `${r.success ? "✅" : "❌"} ${r.package}: ${r.from} → ${r.to}\n`;
        if (r.error) summary += `   Error: ${r.error}\n`;
      }
      if (session.rollbackPerformed) summary += "\n⚠️  Rollback was performed due to validation failure.";

      return { success: session.success, output: summary };
    } catch (error: any) {
      return { success: false, output: `Dependency upgrade failed: ${error.message}` };
    }
  },
});

// ─── Tool 6: Dependency Graph ────────────────────────────────────────────────

registerTool({
  name: "self_dep_graph",
  category: "analysis",
  safety: "safe",
  description: "Build and analyze the full dependency graph of the Andromeda codebase. Returns module count, entry points, circular dependencies, orphaned modules, and most-imported modules.",
  definition: {
    type: "function",
    function: {
      name: "self_dep_graph",
      description: "Build and analyze the full dependency graph of the codebase.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (_params, _ctx): Promise<ToolResult> => {
    try {
      const { buildDependencyGraph } = await import("../self/dependency_graph.js");
      const serverDir = getServerDir();
      const graph = await buildDependencyGraph(serverDir);

      let summary = `Dependency Graph Analysis:\n`;
      summary += `  Total modules: ${graph.nodes.size}\n`;
      summary += `  Entry points: ${graph.entryPoints.length}\n`;
      summary += `  Circular dependencies: ${graph.circularDependencies.length}\n`;
      summary += `  Orphaned modules: ${graph.orphanedModules.length}\n\n`;

      summary += `Top 10 most imported modules:\n`;
      let i = 0;
      for (const [modPath, count] of graph.heavilyImportedModules) {
        if (i++ >= 10) break;
        summary += `  ${modPath}: ${count} importers\n`;
      }

      if (graph.circularDependencies.length > 0) {
        summary += `\n⚠️  Circular dependencies detected:\n`;
        for (const cycle of graph.circularDependencies.slice(0, 5)) {
          summary += `  ${cycle.join(" → ")}\n`;
        }
      }

      return { success: true, output: summary };
    } catch (error: any) {
      return { success: false, output: `Dependency graph analysis failed: ${error.message}` };
    }
  },
});

// ─── Tool 7: Chunked Write ───────────────────────────────────────────────────

registerTool({
  name: "self_chunked_write",
  category: "system",
  safety: "moderate",
  description: "Write a large file in chunks to prevent LLM truncation. Use action='begin' to start a session (provide file_path and total_chunks), action='chunk' to add content (provide session_id, chunk_index, content), action='status' to check progress.",
  definition: {
    type: "function",
    function: {
      name: "self_chunked_write",
      description: "Write a large file in chunks to prevent LLM truncation issues.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["begin", "chunk", "status"],
            description: "Action to perform: 'begin' starts a session, 'chunk' adds content, 'status' checks progress",
          },
          file_path: {
            type: "string",
            description: "Relative path to the file (required for 'begin')",
          },
          total_chunks: {
            type: "number",
            description: "Total number of chunks the file will be split into (required for 'begin')",
          },
          session_id: {
            type: "string",
            description: "Session ID returned by 'begin' (required for 'chunk' and 'status')",
          },
          chunk_index: {
            type: "number",
            description: "Zero-based chunk index (required for 'chunk')",
          },
          content: {
            type: "string",
            description: "The chunk content to write (required for 'chunk')",
          },
        },
        required: ["action"],
      },
    },
  },
  execute: async (params: any, _ctx): Promise<ToolResult> => {
    try {
      const { beginWriteSession, writeChunk, getSessionStatus } = await import("../self/chunked_writer.js");
      const serverDir = getServerDir();

      if (params.action === "begin") {
        if (!params.file_path || !params.total_chunks) {
          return { success: false, output: "file_path and total_chunks are required for action='begin'" };
        }
        const sessionId = beginWriteSession(params.file_path, params.total_chunks, serverDir);
        return { success: true, output: `Write session started. session_id: ${sessionId}` };
      }

      if (params.action === "chunk") {
        if (!params.session_id || params.chunk_index === undefined || params.content === undefined) {
          return { success: false, output: "session_id, chunk_index, and content are required for action='chunk'" };
        }
        const session = writeChunk(params.session_id, params.chunk_index, params.content);
        const isDone = session.status === "completed";
        return {
          success: true,
          output: isDone
            ? `File written successfully (${session.receivedChunks}/${session.totalChunks} chunks assembled)`
            : `Chunk ${params.chunk_index + 1}/${session.totalChunks} received. ${session.totalChunks - session.receivedChunks} remaining.`,
        };
      }

      if (params.action === "status") {
        if (!params.session_id) return { success: false, output: "session_id is required for action='status'" };
        const session = getSessionStatus(params.session_id);
        if (!session) return { success: false, output: `Session ${params.session_id} not found or expired.` };
        return {
          success: true,
          output: `Session ${params.session_id}: ${session.status} (${session.receivedChunks}/${session.totalChunks} chunks received)`,
        };
      }

      return { success: false, output: `Unknown action: ${params.action}. Use 'begin', 'chunk', or 'status'.` };
    } catch (error: any) {
      return { success: false, output: `Chunked write failed: ${error.message}` };
    }
  },
});
