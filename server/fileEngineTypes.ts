/**
 * fileEngineTypes.ts — v6.25
 * Types, configuration, and semantic compression utilities.
 * Extracted from fileEngine.ts (god-module split).
 */
/**
 * Andromeda v5.21 — Multi-Pass File Engine (Full Codebase Mode)
 * 
 * v5.21 CHANGES:
 * - Removed file selection limit → loads ALL text files by default
 * - Removed 800-line per-file truncation → full file content always sent
 * - Increased context budget → auto-chunks if project exceeds LLM context
 * - Auto-falls back to chunked analysis with recursive synthesis for large projects
 * 
 * Architecture:
 * 1. Index Pass — build compact file tree with signatures
 * 2. Full Load — load ALL text files (skip AI selection for most cases)
 * 3. If within context budget → single-pass full analysis
 * 4. If exceeds budget → chunked analysis with recursive synthesis
 */

import JSZip from "jszip";
import { getContextWindow as getModelContextWindow, getMaxOutputTokens } from "./modelRegistry";

// v5.31: Helper to get max output tokens for the current model
export function getModelContextMaxOutput(model: string): number {
  try { return getMaxOutputTokens(model); } catch { return 16000; }
}
// ─── Configuration ──────────────────────────────────────────────────────────

// v6.15: Use active provider URL — supports OpenRouter, DeepSeek, etc.
// Falls back to env vars for backward compatibility
import { getActiveProvider as _getFileEngineProvider } from "./llmProvider.js";
export function getFileEngineProviderHeaders(): Record<string, string> {
  try { return _getFileEngineProvider()?.headers ?? {}; } catch { return {}; }
}
export function getFileEngineApiUrl(): string {
  try { return _getFileEngineProvider().apiUrl || process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions"; } catch { return process.env.LLM_API_URL || "https://api.deepseek.com/v1/chat/completions"; }
}
const DEEPSEEK_API_URL = process.env.LLM_API_URL || process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions";

/** Maximum characters for a single-pass analysis.
 *  v5.27: Now model-aware — uses modelRegistry.getContextWindow() for per-model limits.
 *  Formula: contextWindow * 4 chars/token * 0.75 (reserve 25% for prompts/output) */
let MAX_CONTEXT_CHARS = 960_000; // fallback
try {
  // v5.29: Using static import
  const activeModel = process.env.LLM_DEFAULT_MODEL || "deepseek-chat";  // v6.17: use short form
  MAX_CONTEXT_CHARS = Math.floor(getModelContextWindow(activeModel) * 4 * 0.75);
} catch {
  // modelRegistry not available — use fallback
}

/** Maximum files to load. v5.21: Effectively unlimited (was 40). */
export const MAX_REQUESTED_FILES = 9999;

/** File extensions we treat as text/source code */
export const TEXT_EXTS = /\.(ts|tsx|js|jsx|json|md|txt|css|scss|html|env|ps1|bat|vbs|sh|py|yaml|yml|toml|sql|xml|svg|graphql|gql|prisma|proto|rs|go|java|kt|swift|c|cpp|h|hpp|rb|php|lua|zig|nim|ex|exs|erl|hrl|elm|vue|svelte|astro|mdx)$/i;

/** Files that should always be included in the index (high priority) */
export const PRIORITY_FILES = [
  "package.json", "tsconfig.json", "Cargo.toml", "go.mod", "pyproject.toml",
  "requirements.txt", "Makefile", "Dockerfile", "docker-compose.yml",
  ".env.example", "README.md", "ANDROMEDA.md"
];

/** Directories to deprioritize in the index */
export const LOW_PRIORITY_DIRS = ["node_modules", "dist", "build", ".git", "__pycache__", ".next", "coverage"];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  path: string;
  size: number;
  signatures: string[];
  category: "config" | "source" | "test" | "docs" | "asset";
}

export interface FileIndex {
  entries: FileEntry[];
  totalFiles: number;
  totalSize: number;
  tree: string;
  indexText: string;
}

export interface CompressionResult {
  compressed: string;
  originalChars: number;
  compressedChars: number;
  ratio: number;
}

export interface MultiPassResult {
  phase: string;
  data: any;
}

export type SSEEmitter = (event: { type: string; [key: string]: any }) => void;

// ─── Semantic Compression Utilities ─────────────────────────────────────────

/**
 * Extract meaningful signatures from a source file.
 * Returns exported functions, classes, interfaces, types, and key declarations.
 */
export function extractSignatures(content: string, ext: string): string[] {
  const sigs: string[] = [];
  const lines = content.split("\n");

  if (/\.(ts|tsx|js|jsx)$/.test(ext)) {
    // TypeScript/JavaScript: extract exports, classes, functions, interfaces, types
    for (const line of lines) {
      const trimmed = line.trim();
      // Export declarations
      if (/^export\s+(default\s+)?(function|class|interface|type|const|let|enum|abstract)\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/\{[\s\S]*$/, "{ ... }").slice(0, 120));
      }
      // Non-exported top-level declarations
      else if (/^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/\{[\s\S]*$/, "{ ... }").slice(0, 120));
      }
      else if (/^(export\s+)?class\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/\{[\s\S]*$/, "{ ... }").slice(0, 120));
      }
      else if (/^(export\s+)?interface\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/\{[\s\S]*$/, "{ ... }").slice(0, 120));
      }
      else if (/^(export\s+)?type\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/=[\s\S]*$/, "= ...").slice(0, 120));
      }
      // React components (const X = () => or const X: FC =)
      else if (/^(export\s+)?(const|let)\s+[A-Z]\w+\s*(:|=)/.test(trimmed)) {
        sigs.push(trimmed.replace(/=[\s\S]*$/, "= ...").slice(0, 120));
      }
    }
  } else if (/\.json$/.test(ext)) {
    // JSON: extract top-level keys
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) {
        const keys = Object.keys(parsed).slice(0, 20);
        sigs.push(`Keys: ${keys.join(", ")}`);
        if (parsed.scripts) sigs.push(`Scripts: ${Object.keys(parsed.scripts).join(", ")}`);
        if (parsed.dependencies) sigs.push(`Deps: ${Object.keys(parsed.dependencies).slice(0, 10).join(", ")}...`);
      }
    } catch { /* not valid JSON */ }
  } else if (/\.md$/.test(ext)) {
    // Markdown: extract headings
    for (const line of lines) {
      if (/^#{1,3}\s+/.test(line)) {
        sigs.push(line.trim().slice(0, 80));
      }
    }
  } else if (/\.py$/.test(ext)) {
    // Python: extract classes, functions, decorators
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(async\s+)?def\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/:[\s\S]*$/, "").slice(0, 120));
      } else if (/^class\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/:[\s\S]*$/, "").slice(0, 120));
      }
    }
  } else if (/\.(go|rs|java|kt|swift|c|cpp|h|hpp)$/.test(ext)) {
    // Go/Rust/Java/etc: extract function and struct/class declarations
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(pub\s+)?(fn|func|struct|impl|class|interface|enum)\s+\w+/.test(trimmed)) {
        sigs.push(trimmed.replace(/\{[\s\S]*$/, "").slice(0, 120));
      }
    }
  } else if (/\.(css|scss)$/.test(ext)) {
    // CSS: extract class/id selectors
    const selectors: string[] = [];
    for (const line of lines) {
      const match = line.match(/^([.#][\w-]+(?:\s*[,>~+]\s*[.#]?[\w-]+)*)\s*\{/);
      if (match) selectors.push(match[1]);
    }
    if (selectors.length > 0) sigs.push(`Selectors: ${selectors.slice(0, 15).join(", ")}`);
  } else {
    // Fallback: first 5 non-empty lines
    const nonEmpty = lines.filter(l => l.trim().length > 0).slice(0, 5);
    sigs.push(...nonEmpty.map(l => l.slice(0, 80)));
  }

  return sigs.slice(0, 25); // Cap at 25 signatures per file
}

/**
 * Categorize a file based on its path.
 */
export function categorizeFile(path: string): FileEntry["category"] {
  const lower = path.toLowerCase();
  if (/\.(test|spec|__test__|_test)\.(ts|tsx|js|jsx|py|go|rs)$/.test(lower)) return "test";
  if (/test[s]?\//.test(lower) || /__tests__\//.test(lower)) return "test";
  if (/\.(md|mdx|txt|rst|adoc)$/.test(lower)) return "docs";
  if (/\.(json|ya?ml|toml|env|ini|cfg|conf)$/.test(lower)) return "config";
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp|mp3|mp4|woff|ttf|eot)$/.test(lower)) return "asset";
  return "source";
}

/**
 * Compress a source file by stripping comments, collapsing blanks.
 * v5.28: No windowed viewing — uses smart chunking by function boundaries instead.
 */
export function compressFile(content: string, path: string): CompressionResult {
  const originalChars = content.length;
  let compressed = content;
  const ext = path.split(".").pop() || "";

  // Step 1: Strip block comments (but preserve JSDoc on exports)
  if (/^(ts|tsx|js|jsx|java|c|cpp|h|hpp|go|rs|swift|kt)$/.test(ext)) {
    // Remove /* ... */ comments that are NOT JSDoc (don't start with /**)
    compressed = compressed.replace(/\/\*(?!\*)[^]*?\*\//g, "");
    // Remove single-line comments (but not URLs like https://)
    compressed = compressed.replace(/(?<!:)\/\/(?!\/)[^\n]*/g, "");
  } else if (ext === "py") {
    // Remove Python docstrings (triple quotes) — keep function signatures
    compressed = compressed.replace(/"""[^]*?\"\"\"*/g, '""" ... """');
    compressed = compressed.replace(/'''[^]*?'''/g, "''' ... '''");
    // Remove # comments
    compressed = compressed.replace(/(?<=\s)#[^\n]*/g, "");
  }

  // Step 2: Collapse consecutive blank lines to single
  compressed = compressed.replace(/\n{3,}/g, "\n\n");

  // Step 3: Remove trailing whitespace
  compressed = compressed.replace(/[ \t]+$/gm, "");

  // v5.28: Full file content always preserved. Smart chunking handles overflow.

  const compressedChars = compressed.length;
  return {
    compressed,
    originalChars,
    compressedChars,
    ratio: originalChars > 0 ? Math.round((1 - compressedChars / originalChars) * 100) : 0,
  };
}


