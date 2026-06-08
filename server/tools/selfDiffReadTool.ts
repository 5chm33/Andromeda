/**
 * Andromeda — self_diff, self_read_server_file, and self_read_file Tools
 *
 * self_diff: Preview a unified diff before applying changes.
 * self_read_server_file: Read a server source file with line numbers.
 * self_read_file: Alias for self_read_server_file.
 */

import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";
import { readFileSync, existsSync } from "fs";
import { resolveServerPath } from "./selfModifyHelpers.js";

// ─── self_diff ───────────────────────────────────────────────────────────────

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
          filePath: { type: "string", description: "Relative path from project root, e.g. 'server/ai.ts'." },
          proposedContent: { type: "string", description: "The proposed new content to diff against the current file." },
          originalSnippet: { type: "string", description: "(Optional) For patch-style diffs: the original snippet to find." },
          proposedSnippet: { type: "string", description: "(Optional) For patch-style diffs: the proposed replacement snippet." },
          contextLines: { type: "number", description: "Number of context lines around each change. Default: 3." },
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

    let oldLines: string[];
    let newLines: string[];
    let diffLabel: string;

    if (originalSnippet && proposedSnippet !== undefined) {
      const idx = currentContent.indexOf(originalSnippet);
      if (idx === -1) {
        return { success: false, output: `Original snippet not found in ${filePath}. Cannot generate diff.` };
      }
      oldLines = originalSnippet.split("\n");
      newLines = proposedSnippet.split("\n");
      diffLabel = `patch diff for ${filePath}`;
    } else if (proposedContent !== undefined) {
      oldLines = currentLines;
      newLines = proposedContent.split("\n");
      diffLabel = `full diff for ${filePath}`;
    } else {
      return { success: false, output: "Provide either proposedContent (full file) or originalSnippet + proposedSnippet (patch)." };
    }

    const diffLines: string[] = [];
    diffLines.push(`--- a/${filePath}`);
    diffLines.push(`+++ b/${filePath} (proposed)`);

    let i = 0, j = 0;
    const hunks: Array<{ oldStart: number; oldLines: string[]; newLines: string[] }> = [];
    let currentHunk: { oldStart: number; oldLines: string[]; newLines: string[] } | null = null;

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        if (currentHunk) { hunks.push(currentHunk); currentHunk = null; }
        i++; j++;
      } else {
        if (!currentHunk) currentHunk = { oldStart: i, oldLines: [], newLines: [] };
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

    return {
      success: true,
      output: [
        `Diff preview (${diffLabel}):`,
        `  ${hunks.length} hunk(s), ~${changedLines} changed lines`,
        `  Current: ${currentLines.length} lines | Proposed: ${newLines.length} lines`,
        ``,
        diffLines.join("\n"),
      ].join("\n"),
    };
  },
});

// ─── Shared read implementation ──────────────────────────────────────────────

function executeReadServerFile(args: Record<string, unknown>): ToolResult {
  const filePath = args.file_path as string;
  if (!filePath) return { success: false, output: "file_path is required" };

  let resolved: string;
  try {
    resolved = resolveServerPath(filePath);
  } catch (e) {
    return { success: false, output: String(e) };
  }

  if (!existsSync(resolved)) {
    return {
      success: false,
      output: `File not found: ${filePath}. Use list_codebase_files or bash_execute with 'find server/ -name "*.ts" | sort' to find the correct path.`,
    };
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
  const numbered = selectedLines.map((line, i) => `${String(startLine + i).padStart(5, " ")} | ${line}`).join("\n");
  const truncationNote = endLine < totalLines
    ? `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines} total. Call again with start_line=${endLine + 1} to see more.]`
    : "";

  return {
    success: true,
    output: `File: ${filePath} (${totalLines} total lines)\n${"=".repeat(60)}\n${numbered}${truncationNote}`,
  };
}

// ─── self_read_server_file ───────────────────────────────────────────────────

registerTool({
  name: "self_read_server_file",
  description: "Read a server source file to understand it before modifying. Use this BEFORE self_patch_file or self_write_file_chunked to get the exact current content and line numbers.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_read_server_file",
      description: "Read a server source file with line numbers. Path is relative to server/ directory (e.g., 'ai.ts', 'tools/selfModifyTools.ts').",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path relative to the server/ directory, e.g. 'ai.ts'" },
          start_line: { type: "number", description: "Optional: first line to return (1-indexed). Defaults to 1." },
          end_line: { type: "number", description: "Optional: last line to return (inclusive). Defaults to start_line + 150." },
        },
        required: ["file_path"],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => executeReadServerFile(args as Record<string, unknown>),
});

// ─── self_read_file (alias) ──────────────────────────────────────────────────

registerTool({
  name: "self_read_file",
  description: "Alias for self_read_server_file. Read a server source file with line numbers. Path is relative to server/ directory.",
  category: "system",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "self_read_file",
      description: "Read a server source file with line numbers. Alias for self_read_server_file.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path relative to the server/ directory, e.g. 'ai.ts'" },
          start_line: { type: "number", description: "Optional: first line to return (1-indexed). Defaults to 1." },
          end_line: { type: "number", description: "Optional: last line to return (inclusive). Defaults to start_line + 150." },
        },
        required: ["file_path"],
      },
    },
  },
  execute: async (args, _ctx: ToolExecutionContext): Promise<ToolResult> => executeReadServerFile(args as Record<string, unknown>),
});

export function registerSelfDiffReadTools(): void {
  // Tools registered at module level via registerTool() calls above.
}
