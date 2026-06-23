/**
 * fileOps.ts — File Operations Tool
 * Andromeda v5.5
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { join, resolve, relative, dirname, basename, extname } from "path";
// import { existsSync } from "fs";
import { resolveFilePath } from "../workspace";
import { fileURLToPath } from "url";

// v5.75: Helper to find a source file in the Andromeda server directory tree
// by matching the basename. Used when read_file fails on a .ts/.js path.
async function findInServerDir(requestedPath: string): Promise<string | null> {
  try {
    const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const ext = extname(requestedPath);
    if (![".ts", ".js", ".tsx", ".jsx", ".json", ".mjs"].includes(ext)) return null;
    const name = basename(requestedPath);
    // BFS through server directory to find matching filename
    const queue: string[] = [serverDir];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const dir = queue.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);
      if (visited.size > 200) break; // Safety limit
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
          } else if (entry.name === name) {
            return fullPath;
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Read File ──────────────────────────────────────────────────────────────

// v5.80: Translate hallucinated src/ and /app/ paths to real server/ paths
function translateToServerPath(filePath: string): string {
  const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const projectRoot = resolve(serverDir, "..");
  const translations: Array<[RegExp, string]> = [
    [/^src\/(.+)$/, `${serverDir}/$1`],               // src/foo.ts → server/foo.ts
    [/^\/app\/src\/(.+)$/, `${serverDir}/$1`],        // /app/src/foo.ts → server/foo.ts
    [/^\/app\/server\/(.+)$/, `${serverDir}/$1`],     // /app/server/foo.ts → server/foo.ts
    [/^\/app\/(.+)$/, `${projectRoot}/$1`],            // /app/foo.ts → projectRoot/foo.ts
    [/^src\/?$/, serverDir],                           // src → server/
    [/^\/app\/src\/?$/, serverDir],                    // /app/src → server/
    [/^\/app\/?$/, projectRoot],                       // /app → project root
  ];
  for (const [pattern, replacement] of translations) {
    if (pattern.test(filePath)) {
      const translated = filePath.replace(pattern, replacement);
      console.log(`[read_file] PATH TRANSLATION (v5.80): '${filePath}' → '${translated}'`);
      return translated;
    }
  }
  return filePath;
}

async function executeReadFile(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const rawPath = String(args.path ?? "");
  if (!rawPath) return { success: false, output: "", error: "path is required" };
  const filePath = translateToServerPath(rawPath);

  // v5.36: Support absolute paths when ALLOW_FULL_FS=true
  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) {
    return { success: false, output: "", error: "Path traversal detected — access denied. Set ALLOW_FULL_FS=true to access files outside workspace." };
  }

  try {
    const content = await readFile(absPath, "utf-8");
    const maxLen = 500_000; // v5.23: Increased from 100K to 500K for full file visibility
    if (content.length > maxLen) {
      return { success: true, output: content.slice(0, maxLen) + `\n\n... [truncated — ${content.length} chars total, showing first ${maxLen}]` };
    }
    return { success: true, output: content };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // v5.75: Smart server-source fallback — if the path looks like a source file
    // and the workspace read failed, search the Andromeda server directory tree.
    // This prevents the model from spiraling through guessed paths when it wants
    // to read its own source code but uses the wrong base path (e.g. src/ vs server/).
    if (errMsg.includes("ENOENT") || errMsg.includes("no such file")) {
      const serverMatch = await findInServerDir(filePath);
      if (serverMatch) {
        try {
          const serverContent = await readFile(serverMatch, "utf-8");
          const maxLen = 500_000;
          const note = `[NOTE: File not found at '${filePath}' in workspace. Found matching Andromeda source file at '${serverMatch}'. Use this path for future reads.]\n\n`;
          const body = serverContent.length > maxLen
            ? serverContent.slice(0, maxLen) + `\n\n... [truncated — ${serverContent.length} chars total]`
            : serverContent;
          return { success: true, output: note + body };
        } catch { /* fall through to original error */ }
      }
      // v5.76: Provide a helpful hint about the correct path structure
      // NOTE: References self_read_server_file (or its alias self_read_file) — both exist.
      const ext = extname(filePath);
      if ([".ts", ".js", ".tsx"].includes(ext)) {
        return {
          success: false,
          output: "",
          error: [
            `File not found: '${filePath}'.`,
            `HINT: Andromeda's own source files are in the 'server/' directory, not 'src/'.`,
            `Use self_read_server_file('llmProvider.ts') to read source files — pass just the filename, it resolves automatically.`,
            `Or use bash_execute with 'find server/ -name "*.ts" | sort' to see all real file paths.`,
            `Do NOT guess filenames — discover them first.`,
          ].join(" "),
        };
      }
    }
    return { success: false, output: "", error: `Failed to read file: ${errMsg}` };
  }
}

registerTool({
  name: "read_file",
  description: "Read the contents of a file in the workspace.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file. Path is relative to the workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeReadFile,
});

// ─── Write File ─────────────────────────────────────────────────────────────

async function executeWriteFile(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const content = String(args.content ?? "");
  if (!filePath) return { success: false, output: "", error: "path is required" };

  // v5.36: Support absolute paths when ALLOW_FULL_FS=true
  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) {
    return { success: false, output: "", error: "Path traversal detected — access denied. Set ALLOW_FULL_FS=true to access files outside workspace." };
  }

  try {
    // Ensure parent directory exists
    const dir = dirname(absPath);
    await mkdir(dir, { recursive: true });
    await writeFile(absPath, content, "utf-8");
    return { success: true, output: `File written: ${filePath} (${content.length} chars)` };
  } catch (err) {
    return { success: false, output: "", error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "write_file",
  description: "Write content to a file in the workspace. Creates parent directories if needed.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Creates the file and parent directories if they don't exist. Path is relative to the workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          content: { type: "string", description: "Content to write to the file" },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: executeWriteFile,
});

// ─── List Directory ─────────────────────────────────────────────────────────

async function executeListDir(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const dirPath = String(args.path ?? ".");
  // v5.36: Support absolute paths when ALLOW_FULL_FS=true
  const { absPath, allowed } = resolveFilePath(dirPath);
  if (!allowed) {
    return { success: false, output: "", error: "Path traversal detected — access denied. Set ALLOW_FULL_FS=true to access files outside workspace." };
  }

  try {
    const entries = await readdir(absPath, { withFileTypes: true });
    const lines = await Promise.all(
      entries.slice(0, 200).map(async (e) => {
        const fullPath = join(absPath, e.name);
        try {
          const s = await stat(fullPath);
          const size = e.isDirectory() ? "DIR" : formatSize(s.size);
          return `${size.padStart(10)}  ${e.name}${e.isDirectory() ? "/" : ""}`;
        } catch {
          return `         ?  ${e.name}`;
        }
      }),
    );
    const header = `Directory: ${relative(ctx.workspaceDir, absPath) || "."}\n${"─".repeat(40)}`;
    return { success: true, output: `${header}\n${lines.join("\n")}` };
  } catch (err) {
    return { success: false, output: "", error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

registerTool({
  name: "list_directory",
  description: "List files and directories in the workspace.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and subdirectories with sizes. Path is relative to the workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the directory (default: current workspace root)" },
        },
        required: [],
      },
    },
  },
  execute: executeListDir,
});

// ─── String Replace in File ─────────────────────────────────────────────────

async function executeStrReplace(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const find = String(args.find ?? "");
  const replace = String(args.replace ?? "");
  if (!filePath || !find) return { success: false, output: "", error: "path and find are required" };

  // v5.36: Support absolute paths when ALLOW_FULL_FS=true
  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) {
    return { success: false, output: "", error: "Path traversal detected — access denied. Set ALLOW_FULL_FS=true to access files outside workspace." };
  }

  try {
    const content = await readFile(absPath, "utf-8");
    if (!content.includes(find)) {
      return { success: false, output: "", error: `String not found in ${filePath}. Make sure the 'find' string matches exactly.` };
    }
    const newContent = content.replace(find, replace);
    await writeFile(absPath, newContent, "utf-8");
    return { success: true, output: `Replaced in ${filePath}. ${find.length} chars → ${replace.length} chars.` };
  } catch (err) {
    return { success: false, output: "", error: `Failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "str_replace",
  description: "Find and replace an exact string in a file. Precise surgical edits without rewriting the whole file.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "str_replace",
      description: "Find an exact string in a file and replace it with a new string. Only the first occurrence is replaced. Use for precise code edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          find: { type: "string", description: "The exact string to find (must match exactly)" },
          replace: { type: "string", description: "The replacement string" },
        },
        required: ["path", "find", "replace"],
      },
    },
  },
  execute: executeStrReplace,
});

// ─── Read File Range (v5.53: paginate through large files) ──────────────────
async function executeReadFileRange(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const startByte = Math.max(0, Number(args.start_byte ?? 0));
  const chunkSize = Math.min(500_000, Math.max(1000, Number(args.chunk_size ?? 500_000)));
  const endByte = startByte + chunkSize;
  if (!filePath) return { success: false, output: "", error: "path is required" };
  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path traversal detected — access denied." };
  try {
    const content = await readFile(absPath, "utf-8");
    const chunk = content.slice(startByte, endByte);
    const remaining = Math.max(0, content.length - endByte);
    const header = `[File: ${filePath} | Bytes ${startByte}–${Math.min(endByte, content.length)} of ${content.length}${remaining > 0 ? ` | ${remaining} bytes remaining — call with start_byte=${endByte} to continue` : " | END OF FILE"}]\n`;
    return { success: true, output: header + chunk };
  } catch (err) {
    return { success: false, output: "", error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
  }
}
registerTool({
  name: "read_file_range",
  description: "Read a specific byte range of a large file. Use this when read_file is truncated. Supports pagination through files of any size.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "read_file_range",
      description: "Read a chunk of a large file starting at a byte offset. The output header shows how many bytes remain and the next start_byte to use for continuation.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          start_byte: { type: "number", description: "Starting byte offset (default: 0)" },
          chunk_size: { type: "number", description: "Number of bytes to read (default: 500000, max: 500000)" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeReadFileRange,
});

// ─── Read File Lines (v5.53: read specific line ranges) ─────────────────────
async function executeReadFileLines(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const startLine = Math.max(1, Number(args.start_line ?? 1));
  const numLines = Math.min(500, Math.max(1, Number(args.num_lines ?? 200)));
  const endLine = startLine + numLines - 1;
  if (!filePath) return { success: false, output: "", error: "path is required" };
  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path traversal detected — access denied." };
  try {
    const content = await readFile(absPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;
    const slice = lines.slice(startLine - 1, endLine);
    const numbered = slice.map((l, i) => `${String(startLine + i).padStart(6)}: ${l}`).join("\n");
    const remaining = Math.max(0, totalLines - endLine);
    const header = `[File: ${filePath} | Lines ${startLine}–${Math.min(endLine, totalLines)} of ${totalLines}${remaining > 0 ? ` | ${remaining} lines remaining — call with start_line=${endLine + 1} to continue` : " | END OF FILE"}]\n`;
    return { success: true, output: header + numbered };
  } catch (err) {
    return { success: false, output: "", error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
  }
}
registerTool({
  name: "read_file_lines",
  description: "Read specific line numbers from a file with line numbers shown. Use this to navigate large source files without reading the entire file.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "read_file_lines",
      description: "Read a range of lines from a file. Line numbers are shown in the output. Use start_line to paginate through large files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file" },
          start_line: { type: "number", description: "Starting line number (1-indexed, default: 1)" },
          num_lines: { type: "number", description: "Number of lines to read (default: 200, max: 500)" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeReadFileLines,
});
