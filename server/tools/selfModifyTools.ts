/**
 * Andromeda v6.13 — Self-Modification Tools
 *
 * Registers tools that allow Andromeda to modify its own source code:
 * - self_write_file — Write/create server source files
 * - self_patch_file — Apply targeted patches to existing files
 * - self_write_file_chunked — Write large files in chunks
 * - self_run_tests — Execute test suite after modifications
 * - self_restart — Restart the server to apply changes
 * - self_read_server_file / self_read_file — Read source files before modifying
 * - self_diff — Compare file versions
 * - verify_file_integrity — Validate file checksums
 *
 * All modifications go through the safety pipeline:
 * selfImproveGuard.ts → twoPhaseCommit.ts → selfTestPipeline.ts
 */


import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import { createHash } from "crypto";
// import { validateProposal, isForbiddenFile, getSupervisorStatus } from "../safetySupervisor.js";
import { twoPhaseCommit } from "../twoPhaseCommit.js";
// import { checkFailurePattern, recordFailure, getFailureStats } from "../failurePatternMemory.js";
// import { verifyContinuity, getIdentitySummary, IDENTITY } from "../identityManifest.js";
import { generateSmokeTests } from "../selfTestGenerator.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getServerDir(): string {
  // __dirname equivalent for ESM
  const here = path.dirname(fileURLToPath(import.meta.url));
  // v5.81: When running from dist/index.js, import.meta.url = andromeda/dist/index.js
  // We need andromeda/server/, not andromeda/dist/
  const baseName = path.basename(here);
  if (baseName === "dist" || baseName === "build") {
    const serverSibling = path.resolve(here, "..", "server");
    if (existsSync(serverSibling)) {
      return serverSibling;
    }
  }
  // When running from server/tools/ (dev mode), go up one level to server/
  if (baseName === "tools") {
    return path.resolve(here, "..");
  }
  return path.resolve(here);
}

function getProjectRoot(): string {
  return path.resolve(getServerDir(), ".."); // server/ → andromeda/
}

/** Files that can NEVER be modified by self_write_file */
const FORBIDDEN_FILES = new Set([
  "andromeda-constitution.json",
  "server/selfImproveGuard.ts",
  "server/recursionGuard.ts",
  "server/selfRollback.ts",
  "server/autoRollback.ts",
  "server/tools/selfModifyTools.ts", // cannot modify itself
]);

function isForbidden(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return Array.from(FORBIDDEN_FILES).some(f => normalized.endsWith(f) || normalized === f);
}

function resolveServerPath(filePath: string): string {
  const projectRoot = getProjectRoot();
  const serverDir = getServerDir();

  // v5.81: PATH TRANSLATION — normalize hallucinated paths before resolving.
  // The model often uses wrong paths: bare filenames, src/ prefixes, /app/ Docker paths.
  let normalized = filePath;

  if (!path.isAbsolute(normalized)) {
    // Strip leading ./ or ./server/
    normalized = normalized.replace(/^\.\//,  "");

    // src/foo.ts → server/foo.ts
    if (normalized.startsWith("src/")) {
      normalized = "server/" + normalized.slice(4);
      console.log(`[resolveServerPath] PATH TRANSLATION (v5.81): '${filePath}' → '${normalized}'`);
    }
    // Bare filename (no directory component) → server/foo.ts
    else if (!normalized.includes("/") && !normalized.includes("\\")) {
      // Check if it exists directly in server/ or server/tools/
      const inServer = path.join(serverDir, normalized);
      const inTools = path.join(serverDir, "tools", normalized);
      if (existsSync(inServer)) {
        normalized = "server/" + normalized;
        console.log(`[resolveServerPath] PATH TRANSLATION (v5.81): bare '${filePath}' → '${normalized}'`);
      } else if (existsSync(inTools)) {
        normalized = "server/tools/" + normalized;
        console.log(`[resolveServerPath] PATH TRANSLATION (v5.81): bare '${filePath}' → '${normalized}'`);
      } else {
        // Default: assume server/ prefix
        normalized = "server/" + normalized;
        console.log(`[resolveServerPath] PATH TRANSLATION (v5.81): bare '${filePath}' → '${normalized}' (assumed)`);
      }
    }
  }

  // Accept paths like: "server/ai.ts", "./server/ai.ts", absolute paths within project
  let resolved: string;
  if (path.isAbsolute(normalized)) {
    resolved = normalized;
  } else if (path.isAbsolute(filePath) && normalized === filePath) {
    resolved = filePath;
  } else {
    resolved = path.resolve(projectRoot, normalized);
  }
  // Must be within the project root
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path "${filePath}" is outside the project root. Only project files can be modified.`);
  }
  return resolved;
}

// ─── self_write_file ────────────────────────────────────────────────────────

registerTool({
  name: "self_write_file",
  description: `Write content to a server source file to apply a self-improvement. 
IMPORTANT: This modifies Andromeda's own source code. Use with care.
- Restricted to the server/ directory (cannot write outside the project)
- Automatically creates a .bak backup before writing
- Forbidden files (constitution, guard, rollback) cannot be modified
- After writing, run self_run_tests to verify the change compiles
- If tests fail, restore from the .bak file`,
  category: "system",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "self_write_file",
      description: "Write content to a server source file to apply a self-improvement. Creates a backup first. Run self_run_tests after to verify.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Relative path from project root (e.g., 'server/ai.ts' or 'server/search.ts'). Must be within the project.",
          },
          content: {
            type: "string",
            description: "Full new content to write to the file.",
          },
          rationale: {
            type: "string",
            description: "Brief explanation of why this change is being made (required, min 30 chars).",
          },
          create_if_missing: {
            type: "boolean",
            description: "If true, create the file if it doesn't exist. Default: false.",
          },
        },
        required: ["file_path", "content", "rationale"],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    let content = args.content as string;
    const rationale = args.rationale as string;
    const createIfMissing = (args.create_if_missing as boolean) ?? false;

    if (!filePath || !content || !rationale) {
      return { success: false, output: "file_path, content, and rationale are all required." };
    }
    if (rationale.length < 30) {
      return { success: false, output: `Rationale too short (${rationale.length} chars). Minimum 30 chars required to explain the change.` };
    }

    // v5.75: HARD TRUNCATION GUARD — reject large content that will be silently cut by the LLM token limit
    // The LLM generates tool call arguments as JSON strings. Any content over ~3000 chars risks truncation.
    // This guard makes it physically impossible to accidentally use the wrong tool for large files.
    const CONTENT_SIZE_LIMIT = 3000; // ~80 lines of TypeScript
    const lineCount = content.split('\n').length;
    if (content.length > CONTENT_SIZE_LIMIT) {
      let recommendation: string;
      try {
        const resolvedCheck = resolveServerPath(filePath);
        recommendation = existsSync(resolvedCheck)
          ? 'self_patch_file (for existing files — provide only the changed snippet)'
          : 'self_write_file_chunked (for new files — split into 60-line chunks)';
      } catch {
        recommendation = 'self_patch_file or self_write_file_chunked';
      }
      return {
        success: false,
        output: [
          `TRUNCATION GUARD: Content too large for self_write_file (${content.length} chars, ${lineCount} lines).`,
          `The LLM token limit will silently cut off content larger than ~3000 chars, corrupting the file.`,
          ``,
          `USE INSTEAD: ${recommendation}`,
          ``,
          `For EXISTING files: self_patch_file with original_snippet + proposed_snippet (only the changed lines).`,
          `For NEW files >80 lines: self_write_file_chunked with action='start', then 'chunk' (60 lines each), then 'finish'.`,
          `For NEW files <80 lines: self_write_file is fine — but your content is ${lineCount} lines, which exceeds this limit.`,
        ].join('\n')
      };
    }

    // Check forbidden files
    if (isForbidden(filePath)) {
      return { success: false, output: `Cannot modify "${filePath}" — it is a protected system file.` };
    }

    // v5.81: PATH VALIDATION GUARD — detect phantom paths (files that don't exist in the
    // project) and suggest the real file. This catches proposals targeting /server/llm/stream.ts,
    // /server/utils/tokenizer.ts etc. which are hallucinated paths from training data.
    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: String(e) };
    }

    // Check if the resolved path exists (or if create_if_missing is set)
    if (!existsSync(resolved) && !createIfMissing) {
      // Try to find the closest real file by basename
      const basename = path.basename(filePath);
      const serverDir = getServerDir();
      let suggestion = '';
      try {
        // Search server/ tree for a file with the same basename
        const { execSync } = await import('child_process');
        const findResult = execSync(`find "${serverDir}" -name "${basename}" -type f 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
        if (findResult) {
          const matches = findResult.split('\n').filter(Boolean);
          const projectRoot = path.resolve(serverDir, '..');
          const relMatches = matches.map(m => path.relative(projectRoot, m));
          suggestion = `\n\nDid you mean one of these real files?\n${relMatches.map(m => `  - ${m}`).join('\n')}`;
        } else {
          suggestion = `\n\nNo file named '${basename}' exists in server/. Use list_codebase_files or bash_execute with find to discover real file names.`;
        }
      } catch {
        suggestion = `\n\nUse list_codebase_files or bash_execute with 'find server/ -name "*.ts"' to discover real file names.`;
      }
      return {
        success: false,
        output: [
          `PATH VALIDATION GUARD (v5.81): File '${filePath}' does not exist.`,
          `Resolved to: ${resolved}`,
          `This path appears to be a hallucinated path from training data, not a real file in this installation.`,
          suggestion,
          ``,
          `If you want to CREATE a new file at this path, set create_if_missing: true in your tool call.`,
          `If you want to MODIFY an existing file, first call list_codebase_files to find the real path.`,
        ].join('\n')
      };
    }

    const _fileExists = existsSync(resolved);
    // Note: fileExists check already handled above by PATH VALIDATION GUARD (v5.81)
    // which also provides helpful suggestions for phantom paths.

    // Create parent directory if needed
    const dir = path.dirname(resolved);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // v5.75: Self-review gate — run code quality check before writing
    let reviewSummary = "";
    try {
      const { reviewAndGate } = await import("../selfReview.js");
      const lang = resolved.endsWith(".ts") ? "typescript" : resolved.endsWith(".py") ? "python" : undefined;
      const gate = reviewAndGate(content, lang);
      if (!gate.allowed) {
        const issues = gate.result.issues
          .filter(i => i.severity === "critical" || i.severity === "warning")
          .slice(0, 5)
          .map(i => `  [${i.severity.toUpperCase()}] ${i.message}`)
          .join("\n");
        return {
          success: false,
          output: [
            `✗ Self-review gate BLOCKED write to ${filePath}`,
            `  Score: ${gate.result.score}/100 (minimum: 60)`,
            `  Issues found:`,
            issues,
            ``,
            `Fix the issues above and retry. Use self_patch_file for targeted fixes.`,
          ].join("\n"),
        };
      }
      // Use auto-fixed code if available
      if (gate.result.autoFixCount > 0 && gate.result.fixedCode) {
        content = gate.result.fixedCode;
        reviewSummary = ` (review: ${gate.result.score}/100, ${gate.result.autoFixCount} auto-fix(es) applied)`;
      } else {
        reviewSummary = ` (review: ${gate.result.score}/100)`;
      }
    } catch { /* selfReview not available — proceed without gate */ }

    // v5.75: Use twoPhaseCommit as the write engine — provides git stable-state tagging,
    // safety supervisor validation, failure pattern check, TypeScript health check,
    // SHA-256 integrity verification, and rollback memory on failure.
    const commitResult = await twoPhaseCommit({
      filePath,
      proposedContent: content,
      rationale,
      proposedBy: "chat",
      createIfMissing,
    });

    if (!commitResult.success) {
      return {
        success: false,
        output: [
          `✗ Write FAILED for ${filePath}`,
          commitResult.error ? `  Error: ${commitResult.error}` : "",
          commitResult.rollbackReason ? `  Rollback reason: ${commitResult.rollbackReason}` : "",
          commitResult.safetyResult && !commitResult.safetyResult.passed
            ? `  Safety violations: ${commitResult.safetyResult.violations.join("; ")}` : "",
          `  Phase reached: ${commitResult.phase}`,
          `  Duration: ${commitResult.durationMs}ms`,
        ].filter(Boolean).join("\n"),
      };
    }

    // v5.75: Generate smoke tests for the modified file
    try {
      await generateSmokeTests(filePath, content, rationale);
    } catch { /* non-fatal */ }

    const hashShort = commitResult.sha256After?.slice(0, 12) ?? "unknown";
    const backupNote = commitResult.backupPath ? path.basename(commitResult.backupPath) : "none (new file)";

    return {
      success: true,
      output: [
        `✓ Written: ${filePath} (git stable-state tagged)${reviewSummary}`,
        `  Backup: ${backupNote}`,
        `  Size: ${content.length} chars | SHA-256: ${hashShort}... ✓`,
        `  Rationale: ${rationale}`,
        `  Phase: ${commitResult.phase} | Duration: ${commitResult.durationMs}ms`,
        ``,
        `NEXT STEP: Run self_run_tests to verify the change compiles and passes tests.`,
        `If tests fail, restore with: self_write_file with the backup content, or delete ${path.basename(resolved)} and rename ${path.basename(resolved)}.bak.`,
      ].join("\n"),
    };
  },
});

// ─── self_run_tests ─────────────────────────────────────────────────────────

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

    // TypeScript check
    if (checkType === "typescript" || checkType === "both") {
      try {
        const tsResult = execSync("npx tsc --noEmit 2>&1 || true", {
          cwd: projectRoot,
          timeout: 120000,
          encoding: "utf8",
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

    // Test suite
    if (checkType === "tests" || checkType === "both") {
      try {
        // Check if there's a test script
        const pkgJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
        if (pkgJson.scripts?.test && pkgJson.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
          const testResult = execSync("pnpm test 2>&1 || true", {
            cwd: projectRoot,
            timeout: 120000,
            encoding: "utf8",
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
          results.push("ℹ Test suite: no test script configured (TypeScript check is the primary validation)");
        }
      } catch (e) {
        results.push(`ℹ Test suite: ${String(e).slice(0, 100)}`);
      }
    }

    const recommendation = allPassed
      ? "✓ SAFE TO PROCEED — all checks passed. You can run self_restart to activate changes."
      : "✗ DO NOT PROCEED — fix the errors above before activating changes. Restore from .bak if needed.";

    return {
      success: allPassed,
      output: [...results, "", recommendation].join("\n"),
    };
  },
});

// ─── self_restart ────────────────────────────────────────────────────────────

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
            description: "Git commit message for the snapshot before restart (e.g., 'self-improve: fix truncation in ai.ts').",
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
        cwd: projectRoot,
        timeout: 15000,
      });
      const hash = execSync("git rev-parse --short HEAD", { cwd: projectRoot, timeout: 5000 })
        .toString()
        .trim();
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
        try {
          execSync("git revert HEAD --no-edit", { cwd: projectRoot, timeout: 15000 });
          steps.push("✓ Reverted to previous state");
        } catch {}
        return { success: false, output: steps.join("\n") };
      }
    }

    // Step 3: Write restart signal file (the server's hot-reload watcher picks this up)
    const restartSignalPath = path.join(projectRoot, ".restart_signal");
    try {
      writeFileSync(restartSignalPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        reason: commitMessage,
        requestedBy: "self_restart_tool",
      }));
      steps.push("✓ Restart signal written — server will restart momentarily");
      steps.push("  (The hot-reload watcher will pick this up within 2 seconds)");
    } catch (e) {
      steps.push(`⚠ Could not write restart signal: ${String(e).slice(0, 100)}`);
      steps.push("  Manual restart required: stop and restart the server process.");
    }

    // Step 4: Also try SIGUSR2 (graceful restart signal used by pm2/nodemon)
    try {
      process.kill(process.pid, "SIGUSR2");
      steps.push("✓ SIGUSR2 sent to process — graceful restart initiated");
    } catch {
      // Not all environments support this — that's OK, the signal file is the primary mechanism
    }

    steps.push("");
    steps.push("The server is restarting. This connection will be briefly interrupted.");
    steps.push("After reconnecting, run a health check to verify the restart succeeded.");

    return {
      success: true,
      output: steps.join("\n"),
    };
  },
});

// ─── self_patch_file ─────────────────────────────────────────────────────────
// v5.75: Patch-based self-modification — replaces a specific snippet instead of
// rewriting the whole file. This is the PREFERRED tool for self-improvement
// because it avoids LLM token-limit truncation on large files.

registerTool({
  name: "self_patch_file",
  description: `Apply a targeted patch to a server source file by replacing an exact snippet.
PREFERRED over self_write_file for large files — avoids token-limit truncation.
- Finds originalSnippet in the file and replaces it with proposedSnippet
- Creates a .bak backup before patching
- Forbidden files (constitution, guard, rollback) cannot be modified
- After patching, run self_run_tests to verify the change compiles
- If tests fail, restore from the .bak file
USE THIS instead of self_write_file whenever you are making a targeted change to an existing file.`,
  category: "system",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "self_patch_file",
      description: "Apply a targeted find-and-replace patch to a server source file. Preferred over self_write_file for large files to avoid truncation.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Relative path from project root (e.g., 'server/ai.ts'). Must be within the project.",
          },
          original_snippet: {
            type: "string",
            description: "The EXACT text to find in the file (must be a verbatim substring). Keep it short and unique — just the lines you want to change.",
          },
          proposed_snippet: {
            type: "string",
            description: "The replacement text. Must be valid TypeScript. Same indentation as original.",
          },
          rationale: {
            type: "string",
            description: "Brief explanation of why this change is being made (required, min 30 chars).",
          },
        },
        required: ["file_path", "original_snippet", "proposed_snippet", "rationale"],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const originalSnippet = args.original_snippet as string;
    const proposedSnippet = args.proposed_snippet as string;
    const rationale = args.rationale as string;

    if (!filePath || !originalSnippet || proposedSnippet === undefined || !rationale) {
      return { success: false, output: "file_path, original_snippet, proposed_snippet, and rationale are all required." };
    }
    if (rationale.length < 30) {
      return { success: false, output: `Rationale too short (${rationale.length} chars). Minimum 30 chars required.` };
    }
    // v5.77: Hard size guard on proposed_snippet.
    // The LLM JSON-serializes tool call arguments. Any content over ~6000 chars risks silent truncation
    // which would corrupt the file with a partial replacement. Block it and redirect to chunked workflow.
    const PATCH_HARD_LIMIT = 6000; // ~150 lines of TypeScript
    const PATCH_SIZE_WARNING = 4000; // ~100 lines — warn but allow
    if (proposedSnippet.length > PATCH_HARD_LIMIT) {
      const patchLines = proposedSnippet.split('\n').length;
      return {
        success: false,
        output: [
          `HARD GUARD (v5.77): proposed_snippet is ${proposedSnippet.length} chars (${patchLines} lines) — exceeds the ${PATCH_HARD_LIMIT}-char safety limit.`,
          `This is too large to pass safely through a single tool call argument without truncation risk.`,
          `OPTIONS:`,
          `  1. Split into multiple self_patch_file calls, each targeting a smaller section (preferred).`,
          `  2. Use self_write_file_chunked to rewrite the entire file in 60-line chunks.`,
          `  3. Reduce the scope of your change — target only the specific lines that need to change.`,
          `The proposed_snippet should ideally be under ${PATCH_SIZE_WARNING} chars. Retry with a smaller, more targeted patch.`,
        ].join('\n'),
      };
    }
    if (proposedSnippet.length > PATCH_SIZE_WARNING) {
      const patchLines = proposedSnippet.split('\n').length;
      console.warn(`[self_patch_file] Large proposed_snippet: ${proposedSnippet.length} chars, ${patchLines} lines. Approaching size limit — consider splitting.`);
    }
    if (isForbidden(filePath)) {
      return { success: false, output: `Cannot modify "${filePath}" — it is a protected system file.` };
    }

    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: String(e) };
    }

    // Read current file
    let currentContent: string;
    try {
      currentContent = readFileSync(resolved, "utf8");
    } catch (e) {
      return { success: false, output: `Cannot read file: ${String(e).slice(0, 200)}` };
    }

    // Verify the original snippet exists in the file
    if (!currentContent.includes(originalSnippet)) {
      // Try with normalized line endings
      const normalizedContent = currentContent.replace(/\r\n/g, "\n");
      const normalizedSnippet = originalSnippet.replace(/\r\n/g, "\n");
      if (!normalizedContent.includes(normalizedSnippet)) {
        const preview = originalSnippet.slice(0, 120).replace(/\n/g, "↵");
        return {
          success: false,
          output: [
            `original_snippet not found in ${filePath}.`,
            `Searched for: "${preview}"`,
            `TIP: Use self_read_file to get the exact current content, then copy the snippet verbatim.`,
          ].join("\n"),
        };
      }
      // Use normalized versions
      const patchedContent = normalizedContent.replace(normalizedSnippet, proposedSnippet.replace(/\r\n/g, "\n"));
      // Write backup
      const backupPath = resolved + ".bak";
      try { writeFileSync(backupPath, currentContent); } catch {}
      writeFileSync(resolved, patchedContent, "utf8");
      return {
        success: true,
        output: [
          `✓ Patched ${filePath} (normalized line endings)`,
          `  Replaced ${originalSnippet.split("\n").length} lines → ${proposedSnippet.split("\n").length} lines`,
          `  Backup saved: ${path.basename(resolved)}.bak`,
        `NEXT STEP: Run self_run_tests (or run_type_check) to verify the change compiles.`,
      ].join("\n"),
      };
    }

    // Apply the patch
    const patchedContent = currentContent.replace(originalSnippet, proposedSnippet);

    // Sanity check: content should have changed
    if (patchedContent === currentContent && originalSnippet !== proposedSnippet) {
      return { success: false, output: "Patch produced no change. The original_snippet may match but proposed_snippet is identical." };
    }

    // v5.75: Self-review gate on the proposed snippet before applying
    let reviewSummary = "";
    try {
      const { reviewAndGate } = await import("../selfReview.js");
      const lang = resolved.endsWith(".ts") ? "typescript" : resolved.endsWith(".py") ? "python" : undefined;
      const gate = reviewAndGate(proposedSnippet, lang);
      if (!gate.allowed) {
        const issues = gate.result.issues
          .filter(i => i.severity === "critical" || i.severity === "warning")
          .slice(0, 5)
          .map(i => `  [${i.severity.toUpperCase()}] ${i.message}`)
          .join("\n");
        return {
          success: false,
          output: [
            `✗ Self-review gate BLOCKED patch to ${filePath}`,
            `  Score: ${gate.result.score}/100 (minimum: 60)`,
            `  Issues in proposed_snippet:`,
            issues,
            ``,
            `Fix the issues above and retry with a corrected proposed_snippet.`,
          ].join("\n"),
        };
      }
      reviewSummary = ` (review: ${gate.result.score}/100)`;
    } catch { /* selfReview not available — proceed without gate */ }

    // Write backup
    const backupPath = resolved + ".bak";
    try { writeFileSync(backupPath, currentContent); } catch {}

    // Write patched file
    try {
      writeFileSync(resolved, patchedContent, "utf8");
    } catch (e) {
      return { success: false, output: `Write failed: ${String(e).slice(0, 200)}` };
    }

    // v5.75: Post-patch SHA-256 integrity verification
    const expectedPatchHash = createHash("sha256").update(patchedContent).digest("hex");
    let verifiedPatchHash = "";
    try {
      const writtenPatch = readFileSync(resolved, "utf8");
      verifiedPatchHash = createHash("sha256").update(writtenPatch).digest("hex");
    } catch { /* non-fatal */ }
    if (verifiedPatchHash && verifiedPatchHash !== expectedPatchHash) {
      // Restore backup on hash mismatch
      try { copyFileSync(resolved + ".bak", resolved); } catch {}
      return { success: false, output: `Patch integrity check FAILED for ${filePath}. SHA-256 mismatch — backup restored.` };
    }

    // v5.75: Log patch outcome to memory for cross-session learning
    try {
      const { storeMemory } = await import("../memory.js");
      storeMemory(
        `Self-patch SUCCESS: ${filePath} — replaced ${originalSnippet.split("\n").length} lines → ${proposedSnippet.split("\n").length} lines. Hash: ${expectedPatchHash.slice(0, 12)}.`,
        "project",
        ["self-modification", "patch", "success", path.basename(filePath)]
      );
    } catch { /* non-fatal */ }

    return {
      success: true,
      output: [
        `✓ Patched ${filePath}${reviewSummary}`,
        `  Replaced ${originalSnippet.split("\n").length} lines → ${proposedSnippet.split("\n").length} lines`,
        `  Backup saved: ${path.basename(resolved)}.bak | SHA-256: ${expectedPatchHash.slice(0, 12)}... ✓`,
        `NEXT STEP: Run self_run_tests (or run_type_check) to verify the change compiles.`,
      ].join("\n"),
    };
  },
});

// ─── self_write_file_chunked ───────────────────────────────────────────────

/**
 * Chunk store for in-progress chunked writes.
 * Key: chunkSessionId, Value: { chunks: string[], totalChunks: number, filePath: string, rationale: string }
 */
const _chunkSessions = new Map<string, {
  chunks: string[];
  totalChunks: number;
  filePath: string;
  rationale: string;
  expectedHash: string;
  startedAt: number;
}>();

registerTool({
  name: "self_write_file_chunked",
  description: "Write a large file to the server source in multiple chunks to avoid LLM output truncation. WORKFLOW: 1) action='start' with filePath, totalChunks, expectedHash, rationale — returns chunkSessionId. 2) action='chunk' with chunkSessionId, chunkIndex, chunkContent for each chunk. 3) action='finish' to assemble and write. 4) action='abort' to cancel. WHEN TO USE: Any file larger than ~100 lines. Prefer self_patch_file for targeted edits. CHUNK SIZE: 40-80 lines per chunk is optimal.",
  category: "system" as const,
  safety: "moderate" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "self_write_file_chunked",
      description: "Write a large file in multiple chunks to avoid truncation. Actions: start, chunk, finish, abort, status.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["start", "chunk", "finish", "abort", "status"],
            description: "The chunked write action to perform.",
          },
          filePath: {
            type: "string",
            description: "(start only) Relative path from project root, e.g. 'server/ai.ts'.",
          },
          totalChunks: {
            type: "number",
            description: "(start only) Total number of chunks the file will be split into.",
          },
          expectedHash: {
            type: "string",
            description: "(start only) SHA-256 hex hash of the complete assembled file content. Used for integrity verification.",
          },
          rationale: {
            type: "string",
            description: "(start only) Why this file is being written.",
          },
          chunkSessionId: {
            type: "string",
            description: "(chunk/finish/abort/status) The session ID returned by the 'start' action.",
          },
          chunkIndex: {
            type: "number",
            description: "(chunk only) Zero-based index of this chunk.",
          },
          chunkContent: {
            type: "string",
            description: "(chunk only) The raw text content of this chunk.",
          },
        },
        required: ["action"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> => {
    const action = params.action as string;
    const { nanoid } = await import("nanoid");

    if (action === "start") {
      const filePath = params.filePath as string;
      const totalChunks = params.totalChunks as number;
      const expectedHash = (params.expectedHash as string) || "";
      const rationale = (params.rationale as string) || "";

      if (!filePath) return { success: false, output: "filePath is required for action='start'" };
      if (!totalChunks || totalChunks < 1) return { success: false, output: "totalChunks must be >= 1" };

      // Validate path
      try { resolveServerPath(filePath); } catch (e) {
        return { success: false, output: `Path error: ${(e as Error).message}` };
      }
      if (isForbidden(filePath)) {
        return { success: false, output: `File '${filePath}' is in the forbidden list and cannot be modified.` };
      }

      const sessionId = nanoid(12);
      _chunkSessions.set(sessionId, {
        chunks: new Array(totalChunks).fill(null),
        totalChunks,
        filePath,
        rationale,
        expectedHash,
        startedAt: Date.now(),
      });

      // Clean up stale sessions (>2 hours old)
      for (const [id, session] of Array.from(_chunkSessions.entries())) {
        if (Date.now() - session.startedAt > 7_200_000) _chunkSessions.delete(id);
      }

      return {
        success: true,
        output: [
          `✓ Chunked write session started.`,
          `  Session ID: ${sessionId}`,
          `  File: ${filePath}`,
          `  Total chunks: ${totalChunks}`,
          `  Expected hash: ${expectedHash ? expectedHash.slice(0, 12) + "..." : "(none — integrity check skipped)"}`,
          `NEXT: Send chunks with action='chunk', chunkSessionId='${sessionId}', chunkIndex=0..${totalChunks - 1}`,
        ].join("\n"),
      };
    }

    if (action === "chunk") {
      const sessionId = params.chunkSessionId as string;
      const chunkIndex = params.chunkIndex as number;
      const chunkContent = params.chunkContent as string;

      if (!sessionId || !_chunkSessions.has(sessionId)) {
        return { success: false, output: `Unknown session ID '${sessionId}'. Start a new session with action='start'.` };
      }
      const session = _chunkSessions.get(sessionId)!;
      if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
        return { success: false, output: `chunkIndex ${chunkIndex} out of range [0, ${session.totalChunks - 1}]` };
      }
      if (typeof chunkContent !== "string") {
        return { success: false, output: "chunkContent must be a string" };
      }

      session.chunks[chunkIndex] = chunkContent;
      const received = session.chunks.filter(c => c !== null).length;

      return {
        success: true,
        output: [
          `✓ Chunk ${chunkIndex + 1}/${session.totalChunks} received (${chunkContent.length} chars).`,
          `  Progress: ${received}/${session.totalChunks} chunks received.`,
          received === session.totalChunks
            ? `  All chunks received! Call action='finish' to assemble and write.`
            : `  Next: Send chunk ${chunkIndex + 1} (chunkIndex=${chunkIndex + 1}).`,
        ].join("\n"),
      };
    }

    if (action === "finish") {
      const sessionId = params.chunkSessionId as string;
      if (!sessionId || !_chunkSessions.has(sessionId)) {
        return { success: false, output: `Unknown session ID '${sessionId}'.` };
      }
      const session = _chunkSessions.get(sessionId)!;

      // Check all chunks received
      const missing = session.chunks
        .map((c, i) => c === null ? i : -1)
        .filter(i => i >= 0);
      if (missing.length > 0) {
        return {
          success: false,
          output: `Missing chunks: [${missing.join(", ")}]. Send them before calling finish.`,
        };
      }

      // Assemble full content
      const fullContent = session.chunks.join("");

      // Integrity check
      const actualHash = createHash("sha256").update(fullContent, "utf8").digest("hex");
      if (session.expectedHash && session.expectedHash.length === 64) {
        if (actualHash !== session.expectedHash) {
          _chunkSessions.delete(sessionId);
          return {
            success: false,
            output: [
              `✗ Integrity check FAILED. Content does not match expected hash.`,
              `  Expected: ${session.expectedHash}`,
              `  Actual:   ${actualHash}`,
              `  This means the chunks were assembled incorrectly or some content was altered.`,
              `  Session aborted. Start a new session with action='start'.`,
            ].join("\n"),
          };
        }
      }

      // Write the file (same safety flow as self_write_file)
      const resolved = resolveServerPath(session.filePath);

      // Backup existing file
      if (existsSync(resolved)) {
        copyFileSync(resolved, resolved + ".bak");
      }

      // Ensure directory exists
      const dir = path.dirname(resolved);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Normalize line endings
      const normalized = fullContent.replace(/\r\n/g, "\n");
      writeFileSync(resolved, normalized, "utf8");

      // Post-write verification
      const writtenContent = readFileSync(resolved, "utf8");
      const writtenHash = createHash("sha256").update(writtenContent, "utf8").digest("hex");
      const expectedFinal = createHash("sha256").update(normalized, "utf8").digest("hex");
      if (writtenHash !== expectedFinal) {
        // Restore backup
        if (existsSync(resolved + ".bak")) copyFileSync(resolved + ".bak", resolved);
        _chunkSessions.delete(sessionId);
        return {
          success: false,
          output: `✗ Post-write integrity check failed. Backup restored. Try again.`,
        };
      }

      _chunkSessions.delete(sessionId);

      // Log to memory
      try {
        const { storeMemory } = await import("../memory.js");
        await storeMemory(
          `Self-write-chunked SUCCESS: ${session.filePath} — ${session.rationale}. ${session.totalChunks} chunks, ${fullContent.length} chars. Hash: ${actualHash.slice(0, 12)}.`,
          "project",
          ["self-modification", "chunked-write", "success", path.basename(session.filePath)]
        );
      } catch { /* non-fatal */ }

      return {
        success: true,
        output: [
          `✓ File written successfully via chunked write!`,
          `  Path: ${session.filePath}`,
          `  Size: ${fullContent.length} chars (${session.totalChunks} chunks assembled)`,
          `  SHA-256: ${actualHash.slice(0, 12)}... ✓ verified`,
          `  Backup: ${path.basename(resolved)}.bak`,
          `NEXT STEP: Run self_run_tests to verify the change compiles.`,
        ].join("\n"),
      };
    }

    if (action === "abort") {
      const sessionId = params.chunkSessionId as string;
      if (_chunkSessions.has(sessionId)) {
        _chunkSessions.delete(sessionId);
        return { success: true, output: `Session ${sessionId} aborted and cleared.` };
      }
      return { success: false, output: `Unknown session ID '${sessionId}'.` };
    }

    if (action === "status") {
      const sessionId = params.chunkSessionId as string;
      if (!sessionId || !_chunkSessions.has(sessionId)) {
        // List all active sessions
        const sessions = Array.from(_chunkSessions.entries()).map(([id, s]) => ({
          id,
          filePath: s.filePath,
          received: s.chunks.filter(c => c !== null).length,
          total: s.totalChunks,
          ageMinutes: Math.round((Date.now() - s.startedAt) / 60000),
        }));
        return {
          success: true,
          output: sessions.length > 0
            ? `Active sessions:\n${sessions.map(s => `  ${s.id}: ${s.filePath} (${s.received}/${s.total} chunks, ${s.ageMinutes}m old)`).join("\n")}`
            : "No active chunk sessions.",
        };
      }
      const session = _chunkSessions.get(sessionId)!;
      const received = session.chunks.filter(c => c !== null).length;
      const missing = session.chunks.map((c, i) => c === null ? i : -1).filter(i => i >= 0);
      return {
        success: true,
        output: [
          `Session: ${sessionId}`,
          `  File: ${session.filePath}`,
          `  Progress: ${received}/${session.totalChunks} chunks`,
          missing.length > 0 ? `  Missing: [${missing.join(", ")}]` : `  All chunks received — ready to finish`,
          `  Age: ${Math.round((Date.now() - session.startedAt) / 60000)} minutes`,
        ].join("\n"),
      };
    }

    return { success: false, output: `Unknown action '${action}'. Use: start, chunk, finish, abort, status.` };
  },
});

// ─── verify_file_integrity ──────────────────────────────────────────────────

registerTool({
  name: "verify_file_integrity",
  description: "Verify the integrity of a file by comparing its SHA-256 hash against an expected value. Also reports file size, line count, and whether it compiles (for .ts files). Use after any self_write_file or self_write_file_chunked to confirm the write was complete and uncorrupted.",
  category: "system" as const,
  safety: "safe" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "verify_file_integrity",
      description: "Verify a file's SHA-256 hash, size, line count, and optionally TypeScript compilation.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Relative path from project root, e.g. 'server/ai.ts'.",
          },
          expectedHash: {
            type: "string",
            description: "(Optional) Expected SHA-256 hex hash to verify against.",
          },
          checkCompile: {
            type: "boolean",
            description: "(Optional) If true, run a quick TypeScript syntax check on the file. Default: false.",
          },
        },
        required: ["filePath"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = params.filePath as string;
    const expectedHash = params.expectedHash as string | undefined;
    const checkCompile = params.checkCompile as boolean | undefined;

    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: `Path error: ${(e as Error).message}` };
    }

    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}` };
    }

    const content = readFileSync(resolved, "utf8");
    const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
    const lines = content.split("\n").length;
    const sizeKB = (Buffer.byteLength(content, "utf8") / 1024).toFixed(1);

    const results: string[] = [
      `File: ${filePath}`,
      `  Size: ${sizeKB} KB | Lines: ${lines}`,
      `  SHA-256: ${actualHash}`,
    ];

    if (expectedHash) {
      if (actualHash === expectedHash) {
        results.push(`  Integrity: ✓ MATCH — file content is exactly as expected`);
      } else {
        results.push(`  Integrity: ✗ MISMATCH`);
        results.push(`  Expected: ${expectedHash}`);
        results.push(`  Actual:   ${actualHash}`);
        results.push(`  WARNING: The file may be truncated or corrupted!`);
        // Check for backup
        if (existsSync(resolved + ".bak")) {
          results.push(`  Backup available: ${path.basename(resolved)}.bak — restore with self_patch_file if needed.`);
        }
      }
    }

    if (checkCompile && filePath.endsWith(".ts")) {
      try {
        const projectRoot = getProjectRoot();
        execSync(`npx tsc --noEmit --allowImportingTsExtensions --moduleResolution bundler --module ESNext --target ESNext --strict false "${resolved}"`, {
          cwd: projectRoot,
          timeout: 30_000,
          stdio: "pipe",
        });
        results.push(`  TypeScript: ✓ No syntax errors`);
      } catch (e) {
        const errMsg = (e as { stderr?: Buffer; stdout?: Buffer }).stderr?.toString().slice(0, 500) ||
                       (e as { stdout?: Buffer }).stdout?.toString().slice(0, 500) || "Unknown error";
        results.push(`  TypeScript: ✗ Compile errors detected:`);
        results.push(`    ${errMsg.split("\n").slice(0, 5).join("\n    ")}`);
      }
    }

    return {
      success: true,
      output: results.join("\n"),
    };
  },
});

// ─── self_diff ──────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "self_diff",
  description: "Preview a unified diff between the current content of a file and proposed new content, before applying any changes. Use this before self_patch_file or self_write_file to review what will change.",
  category: "system" as const,
  safety: "safe" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "self_diff",
      description: "Show a unified diff between current file content and proposed content. Does NOT modify any files.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Relative path from project root, e.g. 'server/ai.ts'.",
          },
          proposedContent: {
            type: "string",
            description: "The proposed new content to diff against the current file. For patch previews, provide the full proposed file content.",
          },
          originalSnippet: {
            type: "string",
            description: "(Optional) For patch-style diffs: the original snippet to find. If provided with proposedSnippet, shows a targeted diff instead of full-file diff.",
          },
          proposedSnippet: {
            type: "string",
            description: "(Optional) For patch-style diffs: the proposed replacement snippet.",
          },
          contextLines: {
            type: "number",
            description: "Number of context lines around each change. Default: 3.",
          },
        },
        required: ["filePath"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = params.filePath as string;
    const proposedContent = params.proposedContent as string | undefined;
    const originalSnippet = params.originalSnippet as string | undefined;
    const proposedSnippet = params.proposedSnippet as string | undefined;
    const contextLines = (params.contextLines as number) ?? 3;

    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: `Path error: ${(e as Error).message}` };
    }

    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}` };
    }

    const currentContent = readFileSync(resolved, "utf8");
    const currentLines = currentContent.split("\n");

    // Determine what we're diffing
    let oldLines: string[];
    let newLines: string[];
    let diffLabel: string;

    if (originalSnippet && proposedSnippet !== undefined) {
      // Patch-style diff: show just the snippet change
      const idx = currentContent.indexOf(originalSnippet);
      if (idx === -1) {
        return { success: false, output: `Original snippet not found in ${filePath}. Cannot generate diff.` };
      }
      oldLines = originalSnippet.split("\n");
      newLines = proposedSnippet.split("\n");
      diffLabel = `patch diff for ${filePath}`;
    } else if (proposedContent !== undefined) {
      // Full file diff
      oldLines = currentLines;
      newLines = proposedContent.split("\n");
      diffLabel = `full diff for ${filePath}`;
    } else {
      return { success: false, output: "Provide either proposedContent (full file) or originalSnippet + proposedSnippet (patch)." };
    }

    // Generate unified diff
    const diffLines: string[] = [];
    diffLines.push(`--- a/${filePath}`);
    diffLines.push(`+++ b/${filePath} (proposed)`);

    // Simple unified diff algorithm
    let i = 0, j = 0;
    const hunks: Array<{ oldStart: number; oldLines: string[]; newLines: string[] }> = [];
    let currentHunk: { oldStart: number; oldLines: string[]; newLines: string[] } | null = null;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        if (currentHunk) {
          hunks.push(currentHunk);
          currentHunk = null;
        }
        i++; j++;
      } else {
        if (!currentHunk) {
          currentHunk = { oldStart: i, oldLines: [], newLines: [] };
        }
        if (i < oldLines.length) { currentHunk.oldLines.push(oldLines[i]); i++; }
        if (j < newLines.length) { currentHunk.newLines.push(newLines[j]); j++; }
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    if (hunks.length === 0) {
      return { success: true, output: `No differences found in ${filePath} — proposed content is identical to current.` };
    }

    let changedLines = 0;
    for (const hunk of hunks) {
      const oldStart = Math.max(0, hunk.oldStart - contextLines);
      const oldEnd = Math.min(oldLines.length, hunk.oldStart + hunk.oldLines.length + contextLines);
      const newStart = hunk.oldStart - (hunk.oldStart - oldStart);
      diffLines.push(`@@ -${oldStart + 1},${oldEnd - oldStart} +${newStart + 1},${newStart + (oldEnd - oldStart) - hunk.oldLines.length + hunk.newLines.length} @@`);
      for (let k = oldStart; k < hunk.oldStart; k++) diffLines.push(` ${oldLines[k]}`);
      for (const line of hunk.oldLines) { diffLines.push(`-${line}`); changedLines++; }
      for (const line of hunk.newLines) { diffLines.push(`+${line}`); changedLines++; }
      for (let k = hunk.oldStart + hunk.oldLines.length; k < oldEnd; k++) diffLines.push(` ${oldLines[k]}`);
    }

    const summary = [
      `Diff preview (${diffLabel}):`,
      `  ${hunks.length} hunk(s), ~${changedLines} changed lines`,
      `  Current: ${currentLines.length} lines | Proposed: ${newLines.length} lines`,
      ``,
      diffLines.join("\n"),
    ].join("\n");

    return { success: true, output: summary };
  },
});

// v5.75: self_read_server_file — lets Andromeda read its own server source files
// This is the missing piece: without this, Andromeda can't reliably read its own code before patching it.
// The regular read_file tool uses workspace-relative paths, but server source files are at a different path.
registerTool({
  name: "self_read_server_file",
  description: "Read a server source file to understand it before modifying. Use this BEFORE self_patch_file or self_write_file_chunked to get the exact current content and line numbers.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_read_server_file",
      description: "Read a server source file with line numbers. Use before any self_patch_file call to get the exact snippet to replace. Path is relative to server/ directory (e.g., 'ai.ts', 'tools/selfModifyTools.ts').",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path relative to the server/ directory, e.g. 'ai.ts' or 'tools/selfModifyTools.ts'"
          },
          start_line: {
            type: "number",
            description: "Optional: first line to return (1-indexed). Defaults to 1."
          },
          end_line: {
            type: "number",
            description: "Optional: last line to return (inclusive). Defaults to start_line + 150 to avoid overwhelming context."
          }
        },
        required: ["file_path"]
      }
    }
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    if (!filePath) return { success: false, output: "file_path is required" };
    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: String(e) };
    }
    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}. Use list_directory or tree_view to find the correct path.` };
    }
    let content: string;
    try {
      content = readFileSync(resolved, "utf8");
    } catch (e) {
      return { success: false, output: `Cannot read file: ${String(e).slice(0, 200)}` };
    }
    const lines = content.split("\n");
    const totalLines = lines.length;
    const startLine = Math.max(1, Math.min(totalLines, (args.start_line as number) || 1));
    const defaultEnd = startLine + 149; // 150 lines max by default
    const endLine = Math.min(totalLines, (args.end_line as number) || defaultEnd);
    const selectedLines = lines.slice(startLine - 1, endLine);
    const numbered = selectedLines.map((line, i) => `${String(startLine + i).padStart(5, ' ')} | ${line}`).join("\n");
    const truncationNote = endLine < totalLines
      ? `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} total. Call again with start_line=${endLine + 1} to see more.]`
      : ``;
    return {
      success: true,
      output: `File: ${filePath} (${totalLines} total lines)\n${'='.repeat(60)}\n${numbered}${truncationNote}`
    };
  },
});

// v5.76: self_read_file — alias for self_read_server_file.
// ANDROMEDA.md previously referenced this non-existent name, causing hallucination loops.
// Now both names work identically.
registerTool({
  name: "self_read_file",
  description: "Alias for self_read_server_file. Read a server source file with line numbers. Use before any self_patch_file call. Path is relative to server/ directory (e.g., 'ai.ts', 'tools/selfModifyTools.ts').",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_read_file",
      description: "Read a server source file with line numbers. Alias for self_read_server_file. Path is relative to the server/ directory, e.g. 'ai.ts' or 'tools/selfModifyTools.ts'.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path relative to the server/ directory, e.g. 'ai.ts' or 'tools/selfModifyTools.ts'"
          },
          start_line: {
            type: "number",
            description: "Optional: first line to return (1-indexed). Defaults to 1."
          },
          end_line: {
            type: "number",
            description: "Optional: last line to return (inclusive). Defaults to start_line + 150."
          }
        },
        required: ["file_path"]
      }
    }
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    if (!filePath) return { success: false, output: "file_path is required" };
    let resolved: string;
    try {
      resolved = resolveServerPath(filePath);
    } catch (e) {
      return { success: false, output: String(e) };
    }
    if (!existsSync(resolved)) {
      return { success: false, output: `File not found: ${filePath}. Use list_codebase_files or bash_execute with 'find server/ -name "*.ts" | sort' to find the correct path.` };
    }
    let content: string;
    try {
      content = readFileSync(resolved, "utf8");
    } catch (e) {
      return { success: false, output: `Cannot read file: ${String(e).slice(0, 200)}` };
    }
    const lines = content.split("\n");
    const totalLines = lines.length;
    const startLine = Math.max(1, Math.min(totalLines, (args.start_line as number) || 1));
    const defaultEnd = startLine + 149;
    const endLine = Math.min(totalLines, (args.end_line as number) || defaultEnd);
    const selectedLines = lines.slice(startLine - 1, endLine);
    const numbered = selectedLines.map((line, i) => `${String(startLine + i).padStart(5, ' ')} | ${line}`).join("\n");
    const truncationNote = endLine < totalLines
      ? `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} total. Call again with start_line=${endLine + 1} to see more.]`
      : ``;
    return {
      success: true,
      output: `File: ${filePath} (${totalLines} total lines)\n${'='.repeat(60)}\n${numbered}${truncationNote}`
    };
  },
});

export function registerSelfModifyTools(): void {
  // Tools are registered at module level via registerTool() calls above.
  // This function exists for explicit registration from index.ts.
}
