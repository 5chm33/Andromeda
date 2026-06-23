/**
 * Andromeda — self_patch_file Tool
 *
 * Apply a targeted patch to a server source file by replacing an exact snippet.
 * PREFERRED over self_write_file for large files — avoids token-limit truncation.
 */

import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { isForbidden, resolveServerPath } from "./selfModifyHelpers.js";

/** Hard limit on proposed_snippet size to prevent LLM truncation corruption. */
const PATCH_HARD_LIMIT = 6000;
/** Warning threshold — allow but log. */
const PATCH_SIZE_WARNING = 4000;

registerTool({
  name: "self_patch_file",
  description: `Apply a targeted patch to a server source file by replacing an exact snippet.
PREFERRED over self_write_file for large files — avoids token-limit truncation.
- Finds originalSnippet in the file and replaces it with proposedSnippet
- Creates a .bak backup before patching
- Forbidden files (constitution, guard, rollback) cannot be modified
- After patching, run self_run_tests to verify the change compiles
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

    // Hard size guard on proposed_snippet
    if (proposedSnippet.length > PATCH_HARD_LIMIT) {
      const patchLines = proposedSnippet.split("\n").length;
      return {
        success: false,
        output: [
          `HARD GUARD: proposed_snippet is ${proposedSnippet.length} chars (${patchLines} lines) — exceeds the ${PATCH_HARD_LIMIT}-char safety limit.`,
          `OPTIONS:`,
          `  1. Split into multiple self_patch_file calls, each targeting a smaller section (preferred).`,
          `  2. Use self_write_file_chunked to rewrite the entire file in 60-line chunks.`,
          `  3. Reduce the scope of your change — target only the specific lines that need to change.`,
        ].join("\n"),
      };
    }
    if (proposedSnippet.length > PATCH_SIZE_WARNING) {
      console.warn(`[self_patch_file] Large proposed_snippet: ${proposedSnippet.length} chars — approaching size limit.`);
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

    let currentContent: string;
    try {
      currentContent = readFileSync(resolved, "utf8");
    } catch (e) {
      return { success: false, output: `Cannot read file: ${String(e).slice(0, 200)}` };
    }

    // Try exact match first, then normalized line endings
    if (!currentContent.includes(originalSnippet)) {
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
      // Apply with normalized line endings
      const patchedContent = normalizedContent.replace(normalizedSnippet, proposedSnippet.replace(/\r\n/g, "\n"));
      try { writeFileSync(resolved + ".bak", currentContent); } catch {}
      writeFileSync(resolved, patchedContent, "utf8");
      return {
        success: true,
        output: [
          `✓ Patched ${filePath} (normalized line endings)`,
          `  Replaced ${originalSnippet.split("\n").length} lines → ${proposedSnippet.split("\n").length} lines`,
          `  Backup saved: ${path.basename(resolved)}.bak`,
          `NEXT STEP: Run self_run_tests to verify the change compiles.`,
        ].join("\n"),
      };
    }

    const patchedContent = currentContent.replace(originalSnippet, proposedSnippet);

    if (patchedContent === currentContent && originalSnippet !== proposedSnippet) {
      return { success: false, output: "Patch produced no change. The original_snippet may match but proposed_snippet is identical." };
    }

    // Self-review gate on the proposed snippet
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

    // Write backup and apply patch
    try { writeFileSync(resolved + ".bak", currentContent); } catch {}
    try {
      writeFileSync(resolved, patchedContent, "utf8");
    } catch (e) {
      return { success: false, output: `Write failed: ${String(e).slice(0, 200)}` };
    }

    // SHA-256 integrity verification
    const expectedPatchHash = createHash("sha256").update(patchedContent).digest("hex");
    let verifiedPatchHash = "";
    try {
      const writtenPatch = readFileSync(resolved, "utf8");
      verifiedPatchHash = createHash("sha256").update(writtenPatch).digest("hex");
    } catch { /* non-fatal */ }
    if (verifiedPatchHash && verifiedPatchHash !== expectedPatchHash) {
      try { copyFileSync(resolved + ".bak", resolved); } catch {}
      return { success: false, output: `Patch integrity check FAILED for ${filePath}. SHA-256 mismatch — backup restored.` };
    }

    // Log patch outcome to memory for cross-session learning
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
        `NEXT STEP: Run self_run_tests to verify the change compiles.`,
      ].join("\n"),
    };
  },
});
