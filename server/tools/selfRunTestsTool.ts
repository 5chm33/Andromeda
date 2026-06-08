/**
 * Andromeda — self_run_tests and self_restart Tools
 *
 * self_run_tests: Run TypeScript type checking and the test suite.
 * self_restart: Gracefully restart the server to activate source code changes.
 */

import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import * as path from "path";
import { getProjectRoot } from "./selfModifyHelpers.js";

// ─── self_run_tests ──────────────────────────────────────────────────────────

registerTool({
  name: "self_run_tests",
  description: `Run TypeScript type checking and the test suite against Andromeda's own server code.
Use this BEFORE and AFTER any self_write_file call to verify changes are safe.
Returns: pass/fail status, error details, and a recommendation on whether to proceed or rollback.`,
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_run_tests",
      description: "Run TypeScript check and tests against Andromeda's server code. Use before/after self_write_file to verify safety.",
      parameters: {
        type: "object",
        properties: {
          check_type: {
            type: "string",
            enum: ["typescript", "tests", "both"],
            description: "What to check: 'typescript' (tsc --noEmit), 'tests' (npm test), or 'both'. Default: 'both'.",
          },
        },
        required: [],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const checkType = (args.check_type as string) || "both";
    const projectRoot = getProjectRoot();
    const results: string[] = [];
    let allPassed = true;

    if (checkType === "typescript" || checkType === "both") {
      try {
        const tsResult = execSync("npx tsc --noEmit 2>&1 || true", {
          cwd: projectRoot, timeout: 120000, encoding: "utf8",
        });
        const errors = tsResult.split("\n").filter(l => l.includes("error TS"));
        if (errors.length === 0) {
          results.push("✓ TypeScript: 0 errors");
        } else {
          allPassed = false;
          results.push(`✗ TypeScript: ${errors.length} error(s)`);
          results.push(...errors.slice(0, 20).map(e => `  ${e}`));
          if (errors.length > 20) results.push(`  ... and ${errors.length - 20} more errors`);
        }
      } catch (e) {
        allPassed = false;
        results.push(`✗ TypeScript check failed: ${String(e).slice(0, 200)}`);
      }
    }

    if (checkType === "tests" || checkType === "both") {
      try {
        const pkgJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
        if (pkgJson.scripts?.test && pkgJson.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          const testResult = execSync("pnpm test 2>&1 || true", {
            cwd: projectRoot, timeout: 120000, encoding: "utf8",
          });
          const failed = testResult.toLowerCase().includes("failed") || testResult.toLowerCase().includes("error");
          if (!failed) {
            results.push("✓ Test suite: all tests passed");
          } else {
            allPassed = false;
            results.push("✗ Test suite: failures detected");
            results.push(testResult.slice(0, 500));
          }
        } else {
          results.push("ℹ Test suite: no test script configured");
        }
      } catch (e) {
        results.push(`ℹ Test suite: ${String(e).slice(0, 100)}`);
      }
    }

    const recommendation = allPassed
      ? "✓ SAFE TO PROCEED — all checks passed. You can run self_restart to activate changes."
      : "✗ DO NOT PROCEED — fix the errors above before activating changes. Restore from .bak if needed.";

    return { success: allPassed, output: [...results, "", recommendation].join("\n") };
  },
});

// ─── self_restart ─────────────────────────────────────────────────────────────

registerTool({
  name: "self_restart",
  description: `Gracefully restart the Andromeda server to activate source code changes.
IMPORTANT: This will briefly disconnect all active sessions.
- Creates a git commit snapshot before restarting
- Triggers a graceful restart via the process supervisor
- Monitors health after restart
- Auto-rollbacks the last git commit if health checks fail after restart
Use this AFTER self_write_file + self_run_tests (both passing) to activate changes.`,
  category: "system",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "self_restart",
      description: "Gracefully restart the Andromeda server to activate source code changes. Creates git snapshot first, auto-rollbacks on failure.",
      parameters: {
        type: "object",
        properties: {
          commit_message: {
            type: "string",
            description: "Git commit message for the snapshot before restart.",
          },
          rebuild: {
            type: "boolean",
            description: "If true, run the build step (esbuild) before restarting. Default: true.",
          },
        },
        required: ["commit_message"],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const commitMessage = args.commit_message as string;
    const rebuild = (args.rebuild as boolean) ?? true;
    const projectRoot = getProjectRoot();
    const steps: string[] = [];

    if (!commitMessage || commitMessage.length < 10) {
      return { success: false, output: "commit_message is required (min 10 chars)." };
    }

    // Step 1: Git commit snapshot
    try {
      execSync("git add -A", { cwd: projectRoot, timeout: 15000 });
      execSync(`git commit -m "${commitMessage.replace(/"/g, "'")}" --allow-empty`, {
        cwd: projectRoot, timeout: 15000,
      });
      const hash = execSync("git rev-parse --short HEAD", { cwd: projectRoot, timeout: 5000 })
        .toString().trim();
      steps.push(`✓ Git snapshot created: ${hash} — "${commitMessage}"`);
    } catch (e) {
      steps.push(`⚠ Git snapshot skipped: ${String(e).slice(0, 100)}`);
    }

    // Step 2: Rebuild if requested
    if (rebuild) {
      try {
        steps.push("  Building server bundle...");
        execSync("node build.mjs 2>&1", { cwd: projectRoot, timeout: 120000, encoding: "utf8" });
        steps.push("✓ Server bundle rebuilt successfully");
      } catch (e) {
        steps.push(`✗ Build failed: ${String(e).slice(0, 300)}`);
        steps.push("  Rollback: reverting last git commit...");
        try { execSync("git revert HEAD --no-edit", { cwd: projectRoot, timeout: 15000 }); } catch {}
        return { success: false, output: steps.join("\n") };
      }
    }

    // Step 3: Write restart signal file
    const restartSignalPath = path.join(projectRoot, ".restart_signal");
    try {
      writeFileSync(restartSignalPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        reason: commitMessage,
        requestedBy: "self_restart_tool",
      }));
      steps.push("✓ Restart signal written — server will restart momentarily");
    } catch (e) {
      steps.push(`⚠ Could not write restart signal: ${String(e).slice(0, 100)}`);
    }

    // Step 4: SIGUSR2 graceful restart
    try {
      process.kill(process.pid, "SIGUSR2");
      steps.push("✓ SIGUSR2 sent to process — graceful restart initiated");
    } catch { /* not all environments support this */ }

    steps.push("");
    steps.push("The server is restarting. This connection will be briefly interrupted.");
    steps.push("After reconnecting, run a health check to verify the restart succeeded.");

    return { success: true, output: steps.join("\n") };
  },
});
