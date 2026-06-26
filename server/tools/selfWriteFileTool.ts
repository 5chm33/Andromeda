/**
 * Andromeda — self_write_file Tool
 *
 * Writes content to a server source file to apply a self-improvement.
 * All modifications go through: selfImproveGuard → twoPhaseCommit → selfTestPipeline.
 */

import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import { existsSync, mkdirSync } from "fs";
import * as path from "path";
import { isForbidden, resolveServerPath, getServerDir } from "./selfModifyHelpers.js";
import { twoPhaseCommit } from "../twoPhaseCommit.js";
import { generateSmokeTests } from "../testGenerator.js";

/** Maximum content size for self_write_file (prevents LLM truncation corruption). */
const CONTENT_SIZE_LIMIT = 3000;

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
            description: "Relative path from project root (e.g., 'server/ai.ts'). Must be within the project.",
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
      return { success: false, output: `Rationale too short (${rationale.length} chars). Minimum 30 chars required.` };
    }

    // Truncation guard — reject large content that will be silently cut by the LLM token limit
    const lineCount = content.split("\n").length;
    if (content.length > CONTENT_SIZE_LIMIT) {
      let recommendation: string;
      try {
        const resolvedCheck = resolveServerPath(filePath);
        recommendation = existsSync(resolvedCheck)
          ? "self_patch_file (for existing files — provide only the changed snippet)"
          : "self_write_file_chunked (for new files — split into 60-line chunks)";
      } catch {
        recommendation = "self_patch_file or self_write_file_chunked";
      }
      return {
        success: false,
        output: [
          `TRUNCATION GUARD: Content too large for self_write_file (${content.length} chars, ${lineCount} lines).`,
          `The LLM token limit will silently cut off content larger than ~3000 chars, corrupting the file.`,
          ``,
          `USE INSTEAD: ${recommendation}`,
        ].join("\n"),
      };
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

    if (!existsSync(resolved) && !createIfMissing) {
      const basename = path.basename(filePath);
      const serverDir = getServerDir();
      let suggestion = "";
      try {
        const { execSync } = await import("child_process");
        const findResult = execSync(`find "${serverDir}" -name "${basename}" -type f 2>/dev/null`, {
          encoding: "utf8", timeout: 5000,
        }).trim();
        if (findResult) {
          const matches = findResult.split("\n").filter(Boolean);
          const projectRoot = path.resolve(serverDir, "..");
          const relMatches = matches.map(m => path.relative(projectRoot, m));
          suggestion = `\n\nDid you mean one of these real files?\n${relMatches.map(m => `  - ${m}`).join("\n")}`;
        } else {
          suggestion = `\n\nNo file named '${basename}' exists in server/. Use list_codebase_files to discover real file names.`;
        }
      } catch {
        suggestion = `\n\nUse list_codebase_files or bash_execute with 'find server/ -name "*.ts"' to discover real file names.`;
      }
      return {
        success: false,
        output: [
          `PATH VALIDATION GUARD: File '${filePath}' does not exist.`,
          `Resolved to: ${resolved}`,
          suggestion,
          ``,
          `If you want to CREATE a new file, set create_if_missing: true.`,
          `If you want to MODIFY an existing file, first call list_codebase_files to find the real path.`,
        ].join("\n"),
      };
    }

    const dir = path.dirname(resolved);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Self-review gate
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
      if (gate.result.autoFixCount > 0 && gate.result.fixedCode) {
        content = gate.result.fixedCode;
        reviewSummary = ` (review: ${gate.result.score}/100, ${gate.result.autoFixCount} auto-fix(es) applied)`;
      } else {
        reviewSummary = ` (review: ${gate.result.score}/100)`;
      }
    } catch { /* selfReview not available — proceed without gate */ }

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

    try { await generateSmokeTests(filePath, content); } catch { /* non-fatal */ }

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
      ].join("\n"),
    };
  },
});
