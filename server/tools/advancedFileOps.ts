/**
 * advancedFileOps.ts — Advanced File Operations for Manus-level coding
 * Andromeda v5.36
 *
 * Adds: edit_file (line-based), append_file, search_files (grep), move_file,
 *        read_file_lines, project_context, tree_view
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { readFile, writeFile, readdir, stat, mkdir, rename,  unlink, appendFile as fsAppendFile } from "fs/promises";
import { join,  relative, dirname, basename, extname } from "path";
import { existsSync } from "fs";
import { resolveFilePath } from "../workspace";

// ─── Edit File (line-based) ────────────────────────────────────────────────

async function executeEditFile(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  if (!filePath) return { success: false, output: "", error: "path is required" };

  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed. Set ALLOW_FULL_FS=true for full access." };

  try {
    const content = await readFile(absPath, "utf-8");
    const lines = content.split("\n");

    // Support multiple edit operations in one call
    const edits = args.edits as Array<{ startLine: number; endLine?: number; content: string }> | undefined;
    const startLine = Number(args.start_line ?? 0);
    const endLine = Number(args.end_line ?? startLine);
    const newContent = String(args.content ?? "");
    const insertAfter = Number(args.insert_after ?? 0);

    if (edits && Array.isArray(edits)) {
      // Multi-edit mode: apply edits from bottom to top to preserve line numbers
      const sorted = [...edits].sort((a, b) => (b.startLine ?? 0) - (a.startLine ?? 0));
      for (const edit of sorted) {
        const s = Math.max(1, edit.startLine) - 1;
        const e = Math.min(lines.length, edit.endLine ?? edit.startLine) - 1;
        const replacement = edit.content.split("\n");
        lines.splice(s, e - s + 1, ...replacement);
      }
    } else if (insertAfter > 0) {
      // Insert mode: insert content after a specific line
      const insertLines = newContent.split("\n");
      lines.splice(insertAfter, 0, ...insertLines);
    } else if (startLine > 0) {
      // Replace mode: replace lines startLine through endLine
      const s = Math.max(1, startLine) - 1;
      const e = Math.min(lines.length, endLine) - 1;
      const replacement = newContent.split("\n");
      lines.splice(s, e - s + 1, ...replacement);
    } else {
      return { success: false, output: "", error: "Provide start_line (to replace), insert_after (to insert), or edits array" };
    }

    await writeFile(absPath, lines.join("\n"), "utf-8");
    return { success: true, output: `File edited: ${filePath} (${lines.length} lines total)` };
  } catch (err) {
    return { success: false, output: "", error: `Edit failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "edit_file",
  description: "Edit a file by line number — replace lines, insert after a line, or apply multiple edits at once. Much more precise than str_replace.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "edit_file",
      description: `Edit a file by line number. Three modes:
1. Replace: set start_line and end_line to replace a range of lines with new content
2. Insert: set insert_after to insert content after a specific line number
3. Multi-edit: provide an edits array for multiple changes in one call (applied bottom-to-top to preserve line numbers)

Line numbers are 1-indexed. Supports absolute paths when ALLOW_FULL_FS=true.`,
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          start_line: { type: "number", description: "First line to replace (1-indexed)" },
          end_line: { type: "number", description: "Last line to replace (1-indexed, defaults to start_line)" },
          insert_after: { type: "number", description: "Insert content after this line number (1-indexed)" },
          content: { type: "string", description: "New content (for replace or insert mode)" },
          edits: {
            type: "array",
            description: "Array of edits for multi-edit mode",
            items: {
              type: "object",
              properties: {
                startLine: { type: "number", description: "First line to replace" },
                endLine: { type: "number", description: "Last line to replace" },
                content: { type: "string", description: "Replacement content" },
              },
              required: ["startLine", "content"],
            },
          },
        },
        required: ["path"],
      },
    },
  },
  execute: executeEditFile,
});

// ─── Append File ───────────────────────────────────────────────────────────

async function executeAppendFile(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const content = String(args.content ?? "");
  if (!filePath) return { success: false, output: "", error: "path is required" };

  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed. Set ALLOW_FULL_FS=true for full access." };

  try {
    const dir = dirname(absPath);
    await mkdir(dir, { recursive: true });
    await fsAppendFile(absPath, content, "utf-8");
    return { success: true, output: `Appended ${content.length} chars to ${filePath}` };
  } catch (err) {
    return { success: false, output: "", error: `Append failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "append_file",
  description: "Append content to the end of a file. Creates the file if it doesn't exist.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "append_file",
      description: "Append content to the end of a file. Creates the file and parent directories if they don't exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          content: { type: "string", description: "Content to append" },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: executeAppendFile,
});

// ─── Search Files (grep) ───────────────────────────────────────────────────

async function executeSearchFiles(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const pattern = String(args.pattern ?? "");
  const searchPath = String(args.path ?? ".");
  const filePattern = String(args.file_pattern ?? "*");
  const maxResults = Number(args.max_results ?? 200);
  const contextLines = Number(args.context_lines ?? 2);

  if (!pattern) return { success: false, output: "", error: "pattern is required" };

  const { absPath, allowed } = resolveFilePath(searchPath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed. Set ALLOW_FULL_FS=true for full access." };

  try {
    const results: string[] = [];
    const regex = new RegExp(pattern, args.case_sensitive ? "g" : "gi");

    const searchDir = async (dir: string, depth: number): Promise<void> => {
      if (depth > 10 || results.length >= maxResults) return;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip common non-code directories
          if (["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"].includes(entry.name)) continue;
          await searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Check file pattern
          if (filePattern !== "*" && !entry.name.match(globToRegex(filePattern))) continue;
          // Skip binary files
          const ext = extname(entry.name).toLowerCase();
          if ([".png", ".jpg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar", ".gz", ".mp3", ".mp4"].includes(ext)) continue;
          try {
            const content = await readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                regex.lastIndex = 0; // Reset regex state
                const relPath = relative(absPath, fullPath);
                const start = Math.max(0, i - contextLines);
                const end = Math.min(lines.length - 1, i + contextLines);
                const snippet = lines.slice(start, end + 1).map((l, idx) => {
                  const lineNum = start + idx + 1;
                  const marker = lineNum === i + 1 ? ">" : " ";
                  return `${marker} ${String(lineNum).padStart(4)}| ${l}`;
                }).join("\n");
                results.push(`${relPath}:${i + 1}\n${snippet}`);
                if (results.length >= maxResults) break;
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }

    await searchDir(absPath, 0);

    if (results.length === 0) {
      return { success: true, output: `No matches found for "${pattern}" in ${searchPath}` };
    }
    return { success: true, output: `Found ${results.length} matches:\n\n${results.join("\n\n")}` };
  } catch (err) {
    return { success: false, output: "", error: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

registerTool({
  name: "search_files",
  description: "Search for a pattern across files in a directory (like grep). Returns matching lines with context.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a regex pattern across all files in a directory tree. Returns matching lines with surrounding context. Automatically skips node_modules, .git, dist, and binary files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory to search in (default: workspace root)" },
          file_pattern: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts', '*.py')" },
          max_results: { type: "number", description: "Maximum number of matches to return (default: 50)" },
          context_lines: { type: "number", description: "Number of context lines above and below each match (default: 2)" },
          case_sensitive: { type: "boolean", description: "Whether search is case-sensitive (default: false)" },
        },
        required: ["pattern"],
      },
    },
  },
  execute: executeSearchFiles,
});

// ─── Move/Rename File ──────────────────────────────────────────────────────

async function executeMoveFile(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const source = String(args.source ?? "");
  const destination = String(args.destination ?? "");
  if (!source || !destination) return { success: false, output: "", error: "source and destination are required" };

  const src = resolveFilePath(source);
  const dst = resolveFilePath(destination);
  if (!src.allowed) return { success: false, output: "", error: "Source path not allowed." };
  if (!dst.allowed) return { success: false, output: "", error: "Destination path not allowed." };

  try {
    await mkdir(dirname(dst.absPath), { recursive: true });
    await rename(src.absPath, dst.absPath);
    return { success: true, output: `Moved: ${source} → ${destination}` };
  } catch (err) {
    return { success: false, output: "", error: `Move failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "move_file",
  description: "Move or rename a file or directory.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "move_file",
      description: "Move or rename a file or directory. Creates parent directories for the destination if needed.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "Source path" },
          destination: { type: "string", description: "Destination path" },
        },
        required: ["source", "destination"],
      },
    },
  },
  execute: executeMoveFile,
});

// ─── Read File Lines (range) ───────────────────────────────────────────────

async function executeReadFileLines(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  const startLine = Number(args.start_line ?? 1);
  const endLine = Number(args.end_line ?? 0);
  if (!filePath) return { success: false, output: "", error: "path is required" };

  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed. Set ALLOW_FULL_FS=true for full access." };

  try {
    const content = await readFile(absPath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(1, startLine) - 1;
    const end = endLine > 0 ? Math.min(lines.length, endLine) : lines.length;
    const selected = lines.slice(start, end);
    const numbered = selected.map((line, i) => `${String(start + i + 1).padStart(5)}| ${line}`).join("\n");
    return { success: true, output: `${filePath} (lines ${start + 1}-${end} of ${lines.length}):\n${numbered}` };
  } catch (err) {
    return { success: false, output: "", error: `Read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "read_file_lines",
  description: "Read specific lines from a file with line numbers. Useful for reading large files in chunks.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "read_file_lines",
      description: "Read a range of lines from a file, displayed with line numbers. If end_line is omitted, reads to end of file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file" },
          start_line: { type: "number", description: "First line to read (1-indexed, default: 1)" },
          end_line: { type: "number", description: "Last line to read (1-indexed, default: end of file)" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeReadFileLines,
});

// ─── Project Context ───────────────────────────────────────────────────────

async function executeProjectContext(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const projectPath = String(args.path ?? ".");
  const { absPath, allowed } = resolveFilePath(projectPath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed. Set ALLOW_FULL_FS=true for full access." };

  const context: string[] = [];
  context.push(`# Project Context: ${basename(absPath)}`);
  context.push(`Path: ${absPath}\n`);

  // Read package.json
  const pkgPath = join(absPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      context.push("## package.json");
      context.push(`Name: ${pkg.name ?? "unknown"}`);
      context.push(`Version: ${pkg.version ?? "unknown"}`);
      if (pkg.description) context.push(`Description: ${pkg.description}`);
      if (pkg.scripts) context.push(`Scripts: ${Object.keys(pkg.scripts).join(", ")}`);
      if (pkg.dependencies) context.push(`Dependencies (${Object.keys(pkg.dependencies).length}): ${Object.keys(pkg.dependencies).slice(0, 20).join(", ")}${Object.keys(pkg.dependencies).length > 20 ? "..." : ""}`);
      if (pkg.devDependencies) context.push(`DevDependencies (${Object.keys(pkg.devDependencies).length}): ${Object.keys(pkg.devDependencies).slice(0, 15).join(", ")}${Object.keys(pkg.devDependencies).length > 15 ? "..." : ""}`);
      context.push("");
    } catch { /* skip */ }
  }

  // Read tsconfig.json
  const tsPath = join(absPath, "tsconfig.json");
  if (existsSync(tsPath)) {
    try {
      const ts = await readFile(tsPath, "utf-8");
      context.push("## tsconfig.json");
      context.push(ts.slice(0, 2000));
      context.push("");
    } catch { /* skip */ }
  }

  // Read .env or .env.local (show keys only, not values)
  for (const envFile of [".env", ".env.local"]) {
    const envPath = join(absPath, envFile);
    if (existsSync(envPath)) {
      try {
        const env = await readFile(envPath, "utf-8");
        const keys = env.split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => l.split("=")[0]);
        context.push(`## ${envFile} (keys only)`);
        context.push(keys.join(", "));
        context.push("");
      } catch { /* skip */ }
    }
  }

  // Read README.md (first 3000 chars)
  for (const readme of ["README.md", "readme.md", "README.txt"]) {
    const readmePath = join(absPath, readme);
    if (existsSync(readmePath)) {
      try {
        const content = await readFile(readmePath, "utf-8");
        context.push(`## ${readme}`);
        context.push(content.slice(0, 3000));
        if (content.length > 3000) context.push("... [truncated]");
        context.push("");
      } catch { /* skip */ }
      break;
    }
  }

  // Directory tree (2 levels deep)
  context.push("## Directory Structure");
    const tree = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 2) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const filtered = entries.filter(e => !["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", ".cache", ".turbo"].includes(e.name));
      for (let i = 0; i < filtered.length && i < 50; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1 || i === 49;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";
        if (entry.isDirectory()) {
          context.push(`${prefix}${connector}${entry.name}/`);
          await tree(join(dir, entry.name), prefix + childPrefix, depth + 1);
        } else {
          try {
            const s = await stat(join(dir, entry.name));
            const size = s.size < 1024 ? `${s.size}B` : s.size < 1024 * 1024 ? `${(s.size / 1024).toFixed(1)}K` : `${(s.size / (1024 * 1024)).toFixed(1)}M`;
            context.push(`${prefix}${connector}${entry.name} (${size})`);
          } catch {
            context.push(`${prefix}${connector}${entry.name}`);
          }
        }
      }
      if (filtered.length > 50) context.push(`${prefix}    ... and ${filtered.length - 50} more`);
    } catch { /* skip */ }
  }
  await tree(absPath, "", 0);

  return { success: true, output: context.join("\n") };
}

registerTool({
  name: "project_context",
  description: "Load project context: package.json, tsconfig, directory tree, README, and env var keys. Essential first step when working on any project.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "project_context",
      description: "Load comprehensive project context including package.json, tsconfig.json, directory structure (2 levels), README, and environment variable keys. Use this as the first step when starting work on any project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the project root (default: workspace root)" },
        },
        required: [],
      },
    },
  },
  execute: executeProjectContext,
});

// ─── Tree View ─────────────────────────────────────────────────────────────

async function executeTreeView(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const dirPath = String(args.path ?? ".");
  const maxDepth = Number(args.max_depth ?? 5);
  const { absPath, allowed } = resolveFilePath(dirPath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed." };

  const lines: string[] = [basename(absPath) + "/"];

    const buildTree = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth >= maxDepth) return;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      const filtered = entries.filter(e => !["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", ".cache"].includes(e.name));
      filtered.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (let i = 0; i < filtered.length && i < 100; i++) {
        const entry = filtered[i];
        const isLast = i === Math.min(filtered.length, 100) - 1;
        const connector = isLast ? "└── " : "├── ";
        const childPrefix = isLast ? "    " : "│   ";
        lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}`);
        if (entry.isDirectory()) {
          await buildTree(join(dir, entry.name), prefix + childPrefix, depth + 1);
        }
      }
      if (filtered.length > 100) lines.push(`${prefix}    ... and ${filtered.length - 100} more`);
    } catch { /* skip */ }
  }

  await buildTree(absPath, "", 0);
  return { success: true, output: lines.join("\n") };
}

registerTool({
  name: "tree_view",
  description: "Show directory tree structure. Useful for understanding project layout.",
  category: "filesystem",
  safety: "safe",
  definition: {
    type: "function",
    function: {
      name: "tree_view",
      description: "Display a tree view of a directory structure, similar to the `tree` command. Automatically skips node_modules, .git, etc.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the directory (default: workspace root)" },
          max_depth: { type: "number", description: "Maximum depth to traverse (default: 3)" },
        },
        required: [],
      },
    },
  },
  execute: executeTreeView,
});

// ─── Delete File ───────────────────────────────────────────────────────────

async function executeDeleteFile(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = String(args.path ?? "");
  if (!filePath) return { success: false, output: "", error: "path is required" };

  const { absPath, allowed } = resolveFilePath(filePath);
  if (!allowed) return { success: false, output: "", error: "Path not allowed." };

  try {
    await unlink(absPath);
    return { success: true, output: `Deleted: ${filePath}` };
  } catch (err) {
    return { success: false, output: "", error: `Delete failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "delete_file",
  description: "Delete a file.",
  category: "filesystem",
  safety: "dangerous",
  definition: {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file. Use with caution — this is irreversible. Consider asking the user for confirmation first.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to delete" },
        },
        required: ["path"],
      },
    },
  },
  execute: executeDeleteFile,
});
