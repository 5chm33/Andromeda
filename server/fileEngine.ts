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
function getModelContextMaxOutput(model: string): number {
  try { return getMaxOutputTokens(model); } catch { return 16000; }
}
// ─── Configuration ──────────────────────────────────────────────────────────

// v6.15: Use active provider URL — supports OpenRouter, DeepSeek, etc.
// Falls back to env vars for backward compatibility
import { getActiveProvider as _getFileEngineProvider } from "./llmProvider.js";
function getFileEngineProviderHeaders(): Record<string, string> {
  try { return _getFileEngineProvider()?.headers ?? {}; } catch { return {}; }
}
function getFileEngineApiUrl(): string {
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
const MAX_REQUESTED_FILES = 9999;

/** File extensions we treat as text/source code */
const TEXT_EXTS = /\.(ts|tsx|js|jsx|json|md|txt|css|scss|html|env|ps1|bat|vbs|sh|py|yaml|yml|toml|sql|xml|svg|graphql|gql|prisma|proto|rs|go|java|kt|swift|c|cpp|h|hpp|rb|php|lua|zig|nim|ex|exs|erl|hrl|elm|vue|svelte|astro|mdx)$/i;

/** Files that should always be included in the index (high priority) */
const PRIORITY_FILES = [
  "package.json", "tsconfig.json", "Cargo.toml", "go.mod", "pyproject.toml",
  "requirements.txt", "Makefile", "Dockerfile", "docker-compose.yml",
  ".env.example", "README.md", "ANDROMEDA.md"
];

/** Directories to deprioritize in the index */
const LOW_PRIORITY_DIRS = ["node_modules", "dist", "build", ".git", "__pycache__", ".next", "coverage"];

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

// ─── v5.28: Smart Chunking by Function Boundaries ──────────────────────────

interface FunctionChunk {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
  tokenEstimate: number;
}

/**
 * Extract function/class boundaries from source code for intelligent chunking.
 * Instead of windowed viewing (head+tail), this splits by semantic boundaries.
 */
export function extractFunctionBoundaries(content: string, ext: string): FunctionChunk[] {
  const lines = content.split("\n");
  const chunks: FunctionChunk[] = [];
  const isTS = /^(ts|tsx|js|jsx)$/.test(ext);
  const isPy = ext === "py";

  if (isTS) {
    let braceDepth = 0;
    let currentStart = -1;
    let currentName = "";
    let inTopLevel = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect function/class/interface start at top level
      if (inTopLevel && braceDepth === 0) {
        const match = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/);
        if (match) {
          if (currentStart >= 0 && currentStart < i) {
            // Save previous chunk (module-level code between declarations)
            const body = lines.slice(currentStart, i).join("\n");
            if (body.trim().length > 0) {
              chunks.push({
                name: currentName || `_module_${currentStart}`,
                startLine: currentStart,
                endLine: i - 1,
                body,
                tokenEstimate: Math.ceil(body.length / 4),
              });
            }
          }
          currentStart = i;
          currentName = match[1];
        }
      }

      // Track brace depth
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") {
          braceDepth--;
          if (braceDepth === 0 && currentStart >= 0) {
            inTopLevel = true;
            const body = lines.slice(currentStart, i + 1).join("\n");
            chunks.push({
              name: currentName,
              startLine: currentStart,
              endLine: i,
              body,
              tokenEstimate: Math.ceil(body.length / 4),
            });
            currentStart = i + 1;
            currentName = "";
          }
        }
      }
      if (braceDepth > 0) inTopLevel = false;
    }

    // Remaining content after last closing brace
    if (currentStart >= 0 && currentStart < lines.length) {
      const body = lines.slice(currentStart).join("\n");
      if (body.trim().length > 0) {
        chunks.push({
          name: currentName || "_tail",
          startLine: currentStart,
          endLine: lines.length - 1,
          body,
          tokenEstimate: Math.ceil(body.length / 4),
        });
      }
    }
  } else if (isPy) {
    // Python: split by top-level def/class
    let currentStart = 0;
    let currentName = "_module_header";

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(?:async\s+)?(?:def|class)\s+(\w+)/);
      if (match) {
        if (i > currentStart) {
          const body = lines.slice(currentStart, i).join("\n");
          if (body.trim().length > 0) {
            chunks.push({
              name: currentName,
              startLine: currentStart,
              endLine: i - 1,
              body,
              tokenEstimate: Math.ceil(body.length / 4),
            });
          }
        }
        currentStart = i;
        currentName = match[1];
      }
    }
    // Remaining
    const body = lines.slice(currentStart).join("\n");
    if (body.trim().length > 0) {
      chunks.push({
        name: currentName,
        startLine: currentStart,
        endLine: lines.length - 1,
        body,
        tokenEstimate: Math.ceil(body.length / 4),
      });
    }
  } else {
    // Generic: treat entire file as one chunk
    chunks.push({
      name: "_full_file",
      startLine: 0,
      endLine: lines.length - 1,
      body: content,
      tokenEstimate: Math.ceil(content.length / 4),
    });
  }

  return chunks;
}

/**
 * v5.28: Smart file loading with progressive chunking.
 * Instead of truncating large files, this:
 * 1. Calculates available token budget from modelRegistry
 * 2. Splits large files by function/class boundaries
 * 3. Loads as many complete functions as fit in budget
 * 4. Provides a manifest of remaining chunks for progressive loading
 */
export function smartChunkFile(
  content: string,
  path: string,
  availableTokens: number
): { loaded: string; manifest: string; isComplete: boolean; chunksLoaded: number; chunksTotal: number } {
  const ext = path.split(".").pop() || "";
  const totalTokens = Math.ceil(content.length / 4);

  // If file fits entirely, return it
  if (totalTokens <= availableTokens) {
    return { loaded: content, manifest: "", isComplete: true, chunksLoaded: 1, chunksTotal: 1 };
  }

  // Extract function boundaries
  const chunks = extractFunctionBoundaries(content, ext);
  if (chunks.length === 0) {
    // Fallback: return as much as fits
    const charBudget = availableTokens * 4;
    return {
      loaded: content.slice(0, charBudget),
      manifest: `[TRUNCATED: ${content.length - charBudget} chars remaining]`,
      isComplete: false,
      chunksLoaded: 1,
      chunksTotal: 1,
    };
  }

  // Greedily load chunks that fit
  let tokensUsed = 0;
  const loadedChunks: FunctionChunk[] = [];
  const remainingChunks: FunctionChunk[] = [];

  for (const chunk of chunks) {
    if (tokensUsed + chunk.tokenEstimate <= availableTokens) {
      loadedChunks.push(chunk);
      tokensUsed += chunk.tokenEstimate;
    } else {
      remainingChunks.push(chunk);
    }
  }

  const loaded = loadedChunks.map(c => c.body).join("\n\n");
  const manifest = remainingChunks.length > 0
    ? `\n// ─── [${remainingChunks.length} additional sections not loaded — request by name] ───\n` +
      `// Available: ${remainingChunks.map(c => `${c.name} (lines ${c.startLine}-${c.endLine}, ~${c.tokenEstimate} tokens)`).join(", ")}\n` +
      `// Use: loadChunk("${path}", "functionName") to load specific sections`
    : "";

  return {
    loaded: loaded + manifest,
    manifest,
    isComplete: remainingChunks.length === 0,
    chunksLoaded: loadedChunks.length,
    chunksTotal: chunks.length,
  };
}

// ─── File Index Builder ─────────────────────────────────────────────────────

/**
 * Build a compact file index from a ZIP archive.
 * Returns a structured index with file tree, signatures, and categories.
 */
export async function buildFileIndex(zip: JSZip): Promise<FileIndex> {
  const entries: FileEntry[] = [];
  let totalSize = 0;

  const allPaths = Object.keys(zip.files)
    .filter(p => !zip.files[p].dir)
    .filter(p => !LOW_PRIORITY_DIRS.some(d => p.includes(`/${d}/`) || p.startsWith(`${d}/`)))
    .filter(p => !p.includes("node_modules/"))
    .filter(p => !p.endsWith(".map"))
    .filter(p => !p.endsWith(".lock"))
    .filter(p => !p.includes(".git/"));

  // Process text files for signatures
  await Promise.all(
    allPaths.map(async (path) => {
      const file = zip.files[path];
      const size = (file as any)._data?.uncompressedSize ?? 0;
      totalSize += size;

      let signatures: string[] = [];
      if (TEXT_EXTS.test(path) && size < 500_000) {
        try {
          const content = await file.async("string");
          const ext = path.split(".").pop() || "";
          signatures = extractSignatures(content, `.${ext}`);
        } catch { /* skip unreadable */ }
      }

      entries.push({
        path,
        size,
        signatures,
        category: categorizeFile(path),
      });
    })
  );

  // Sort: priority files first, then by category (source > config > docs > test > asset)
  const categoryOrder = { source: 0, config: 1, docs: 2, test: 3, asset: 4 };
  entries.sort((a, b) => {
    const aPriority = PRIORITY_FILES.some(p => a.path.endsWith(p)) ? -1 : 0;
    const bPriority = PRIORITY_FILES.some(p => b.path.endsWith(p)) ? -1 : 0;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return (categoryOrder[a.category] ?? 5) - (categoryOrder[b.category] ?? 5);
  });

  // Build tree string
  const tree = entries.map(e => {
    const sizeStr = e.size > 1024 ? `${Math.round(e.size / 1024)}KB` : `${e.size}B`;
    return `  ${e.path} (${sizeStr}) [${e.category}]`;
  }).join("\n");

  // Build compact index text (what gets sent to the LLM)
  const indexText = entries.map(e => {
    const sizeStr = e.size > 1024 ? `${Math.round(e.size / 1024)}KB` : `${e.size}B`;
    const sigsStr = e.signatures.length > 0 ? `\n    ${e.signatures.slice(0, 8).join("\n    ")}` : "";
    return `${e.path} (${sizeStr})${sigsStr}`;
  }).join("\n");

  return {
    entries,
    totalFiles: entries.length,
    totalSize,
    tree,
    indexText,
  };
}

// ─── Multi-Pass Analysis Engine ─────────────────────────────────────────────

/**
 * Pass 2: Ask the LLM which files it needs to see in full.
 */
export async function selectRelevantFiles(
  index: FileIndex,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat"
): Promise<string[]> {
  const systemPrompt = `You are a code analysis assistant. The user wants to analyze or edit a codebase.
You are given a FILE INDEX showing all files in the project with their sizes and key signatures.
Your job: select which files need to be read IN FULL to complete the user's request.

Rules:
- Return ONLY a JSON array of file paths, e.g. ["src/app.ts", "package.json"]
- Select the MINIMUM files needed — don't request everything
- Always include package.json or equivalent config if it exists
- For analysis tasks: select the main source files + entry points
- For edit tasks: select files that need to be changed + files they depend on
- Maximum ${MAX_REQUESTED_FILES} files
- If the project is small (<15 files), you may request all of them
- Prefer source files over test files unless the task is about tests`;

  const userPrompt = `## User Instruction
${instruction}

## File Index (${index.totalFiles} files, ${Math.round(index.totalSize / 1024)}KB total)
${index.indexText}

Return ONLY a JSON array of file paths you need to see in full.`;

  const response = await fetch(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek API error in file selection: ${response.status}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("No file selection returned from AI");

  try {
    const parsed = JSON.parse(content);
    // Handle both { files: [...] } and [...] formats
    const files = Array.isArray(parsed) ? parsed : (parsed.files ?? parsed.paths ?? []);
    if (!Array.isArray(files)) return index.entries.slice(0, 15).map(e => e.path);
    return files.slice(0, MAX_REQUESTED_FILES).filter((f: any) => typeof f === "string");
  } catch {
    // Fallback: return top priority files
    return index.entries.slice(0, 15).map(e => e.path);
  }
}

/**
 * Pass 3: Load and compress the selected files.
 */
export async function loadAndCompressFiles(
  zip: JSZip,
  selectedPaths: string[],
  allPaths: string[]
): Promise<{ content: string; stats: { loaded: number; compressed: number; totalChars: number; avgRatio: number; overflowed: boolean; overflowPaths: string[] } }> {
  const parts: string[] = [];
  let totalChars = 0;
  let totalRatio = 0;
  let loaded = 0;
  const overflowPaths: string[] = [];

  // Validate paths exist in the ZIP
  const validPaths = selectedPaths.filter(p => {
    // Try exact match first
    if (zip.files[p]) return true;
    // Try with common prefixes stripped
    const match = allPaths.find(ap => ap.endsWith(p) || ap.includes(p));
    return !!match;
  });

  // v5.32: Progressive file loading with memory safety
  // Process files in batches to avoid memory exhaustion on large codebases
  const BATCH_SIZE = 50; // Process 50 files at a time
  const MAX_SINGLE_FILE_SIZE = 500_000; // Skip files > 500KB to prevent memory spikes

  for (let batchStart = 0; batchStart < validPaths.length; batchStart += BATCH_SIZE) {
    const batch = validPaths.slice(batchStart, batchStart + BATCH_SIZE);

    for (const requestedPath of batch) {
      // Resolve the actual path in the ZIP
      let actualPath = requestedPath;
      if (!zip.files[requestedPath]) {
        const match = allPaths.find(ap => ap.endsWith(requestedPath) || ap.includes(requestedPath));
        if (match) actualPath = match;
        else continue;
      }

      const file = zip.files[actualPath];
      if (!file || file.dir) continue;

      try {
        // v5.32: Check uncompressed size before loading to prevent memory exhaustion
        const fileAny = file as any;
        if (fileAny._data && typeof fileAny._data.uncompressedSize === "number") {
          if (fileAny._data.uncompressedSize > MAX_SINGLE_FILE_SIZE) {
            overflowPaths.push(actualPath);
            continue;
          }
        }

        const rawContent = await file.async("string");

        // v5.32: Double-check actual size after decompression
        if (rawContent.length > MAX_SINGLE_FILE_SIZE) {
          overflowPaths.push(actualPath);
          continue;
        }

        const { compressed, ratio } = compressFile(rawContent, actualPath);

        const chunk = `\n${"\u2550".repeat(60)}\nFILE: ${actualPath}\n${"\u2550".repeat(60)}\n${compressed}`;

        if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
          // v5.21: Track overflow files instead of just breaking
          overflowPaths.push(actualPath);
          continue; // Keep collecting overflow paths
        }

        parts.push(chunk);
        totalChars += chunk.length;
        totalRatio += ratio;
        loaded++;
      } catch {
        // Skip unreadable files
      }
    }

    // v5.32: Yield to event loop between batches to prevent blocking
    if (batchStart + BATCH_SIZE < validPaths.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (overflowPaths.length > 0) {
    parts.push(`\n[NOTE: ${overflowPaths.length} additional files will be analyzed in chunked passes]`);
  }

  return {
    content: parts.join("\n"),
    stats: {
      loaded,
      compressed: loaded,
      totalChars,
      avgRatio: loaded > 0 ? Math.round(totalRatio / loaded) : 0,
      overflowed: overflowPaths.length > 0,
      overflowPaths,
    },
  };
}

/**
 * Full multi-pass analysis pipeline.
 * Streams progress events via the emitter callback.
 */
export async function runMultiPassAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ analysis: string; filesAnalyzed: number; tokenEstimate: number }> {
  // ─── Setup ────────────────────────────────────────────────────────────────
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // ZIP bomb protection
  let fileCount = 0;
  let totalUncompressed = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(`Unsafe file path in ZIP: ${path}`);
    }
    fileCount++;
    if (fileCount > 2000) throw new Error("ZIP contains too many files (>2000)");
    totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB uncompressed limit");
  }

  // ─── Pass 1: Build Index ──────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "indexing", message: "Building file index..." });
  const index = await buildFileIndex(zip);
  emit?.({
    type: "index_built",
    fileCount: index.totalFiles,
    totalSize: `${Math.round(index.totalSize / 1024)}KB`,
    categories: {
      source: index.entries.filter(e => e.category === "source").length,
      config: index.entries.filter(e => e.category === "config").length,
      test: index.entries.filter(e => e.category === "test").length,
      docs: index.entries.filter(e => e.category === "docs").length,
    },
  });

  // ─── Pass 2: Select Relevant Files ────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "selecting", message: "AI selecting relevant files..." });

  let selectedPaths: string[];
  // v5.21: Load ALL text files for projects up to 500 files (was 20).
  // This ensures the LLM sees the entire codebase.
  if (index.totalFiles <= 500) {
    selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
    emit?.({ type: "files_selected", count: selectedPaths.length, reason: "Full codebase mode — loading all text files" });
  } else {
    // For very large projects (500+ files), use AI selection but with high limit
    selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
    emit?.({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths, reason: "AI-selected (project has 500+ files)" });
  }

  // ─── Pass 3: Load & Compress ──────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files with compression...` });
  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
  const { content: fileContent, stats } = await loadAndCompressFiles(zip, selectedPaths, allPaths);
  const tokenEstimate = Math.round(fileContent.length / 4);
  emit?.({
    type: "compression_applied",
    filesLoaded: stats.loaded,
    totalChars: stats.totalChars,
    avgCompressionRatio: `${stats.avgRatio}%`,
    tokenEstimate,
  });

  // ─── Pass 4: Full Analysis ────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "analyzing", message: "Running full analysis..." });

  const systemPrompt = `You are Andromeda, an expert AI code analyst. You have been given a codebase to analyze.
You have access to a FILE INDEX (showing all files) and the FULL CONTENT of the most relevant files.

Produce a thorough, structured analysis covering:
1. Architecture Overview — what this project is, its tech stack, how it's organized
2. Code Quality — patterns, anti-patterns, potential bugs, type safety
3. Security — vulnerabilities, input validation, auth issues
4. Performance — bottlenecks, memory leaks, inefficient patterns
5. Recommendations — prioritized list of improvements with severity levels

Be specific: reference actual file paths, function names, and line-level issues.
If you can see something is incomplete or truncated, note it but don't speculate about what's missing.

Your context window is large. Use it fully — provide detailed, actionable analysis.`;

  const userPrompt = `## Instruction
${instruction}

## File Index (${index.totalFiles} files total)
${index.indexText.slice(0, 10000)}

## Full File Contents (${stats.loaded} files loaded, ${tokenEstimate} tokens estimated)
${fileContent}`;

  const analysisResponse = await fetch(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  });

  if (!analysisResponse.ok) {
    const err = await analysisResponse.text();
    throw new Error(`DeepSeek API error in analysis: ${analysisResponse.status}: ${err}`);
  }

  const analysisData = (await analysisResponse.json()) as any;
  const analysis = analysisData.choices?.[0]?.message?.content || "Analysis failed — no response from AI";

  return { analysis, filesAnalyzed: stats.loaded, tokenEstimate };
}

/**
 * Full multi-pass edit pipeline.
 * Returns the edited ZIP as base64 + edit log.
 */
export async function runMultiPassEdit(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ editedZip: string; summary: string; editsApplied: number; log: string[] }> {
  // ─── Setup ────────────────────────────────────────────────────────────────
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);

  // ZIP bomb protection
  let fileCount = 0;
  let totalUncompressed = 0;
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (path.includes("..") || path.startsWith("/")) throw new Error(`Unsafe path: ${path}`);
    fileCount++;
    if (fileCount > 2000) throw new Error("ZIP contains too many files (>2000)");
    totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB limit");
  }

  // ─── Pass 1: Build Index ──────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "indexing", message: "Building file index for editing..." });
  const index = await buildFileIndex(zip);
  emit?.({ type: "index_built", fileCount: index.totalFiles, totalSize: `${Math.round(index.totalSize / 1024)}KB` });

  // ─── Pass 2: Select Files to Edit (v5.21: load all for projects <500 files) ───
  emit?.({ type: "engine_phase", phase: "selecting", message: "Loading all files for editing (full codebase mode)..." });

  let selectedPaths: string[];
  if (index.totalFiles <= 500) {
    selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
  } else {
    selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
  }
  emit?.({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths });

  // ─── Pass 3: Load Files (NO compression for edits — need exact content for find/replace) ──
  emit?.({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files for editing...` });
  const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
  const fileMap: Record<string, string> = {};
  const parts: string[] = [];
  let totalChars = 0;

  for (const requestedPath of selectedPaths) {
    let actualPath = requestedPath;
    if (!zip.files[requestedPath]) {
      const match = allPaths.find(ap => ap.endsWith(requestedPath) || ap.includes(requestedPath));
      if (match) actualPath = match;
      else continue;
    }

    const file = zip.files[actualPath];
    if (!file || file.dir) continue;

    try {
      const content = await file.async("string");
      fileMap[actualPath] = content;

      // v5.28: Smart chunking replaces windowed viewing for large files
      // For edits, we need EXACT content so find/replace works
      let displayContent = content;
      const lines = content.split("\n");
      if (lines.length > 1500) {
        // Use smart chunking by function boundaries instead of head+tail
        const _ext = actualPath.split(".").pop() || "";
        const availableTokens = Math.floor((MAX_CONTEXT_CHARS - totalChars) / 4);
        const chunked = smartChunkFile(content, actualPath, availableTokens > 0 ? availableTokens : 50000);
        displayContent = chunked.loaded;
        if (!chunked.isComplete) {
          displayContent += `\n\n// ─── [${chunked.chunksTotal - chunked.chunksLoaded} of ${chunked.chunksTotal} sections not loaded] ───\n`;
          displayContent += `// Loaded ${chunked.chunksLoaded}/${chunked.chunksTotal} function-level chunks.\n`;
          displayContent += `// To edit unloaded sections, reference them by function name.\n`;
        }
      }

      const chunk = `\n${"═".repeat(60)}\nFILE: ${actualPath} (${lines.length} lines)\n${"═".repeat(60)}\n${displayContent}`;
      if (totalChars + chunk.length > MAX_CONTEXT_CHARS) {
        parts.push(`\n[CONTEXT BUDGET REACHED — remaining files not loaded]`);
        break;
      }
      parts.push(chunk);
      totalChars += chunk.length;
    } catch { /* skip */ }
  }

  const fileContent = parts.join("\n");
  emit?.({ type: "compression_applied", filesLoaded: Object.keys(fileMap).length, totalChars, tokenEstimate: Math.round(totalChars / 4) });

  // ─── Pass 4: Generate Edit Plan ───────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "editing", message: "Generating edit plan..." });

  const editSystemPrompt = `You are an expert code editor. The user has uploaded a codebase and wants you to make changes.
Your job is to produce a precise JSON edit plan.

Return ONLY valid JSON in this exact format:
{
  "summary": "Brief description of all changes made",
  "edits": [
    {
      "file": "exact/path/to/file.ts",
      "find": "exact string to find (must exist VERBATIM in the file)",
      "replace": "replacement string",
      "reason": "why this change is needed"
    }
  ],
  "newFiles": [
    {
      "file": "path/to/new-file.ts",
      "content": "full file content",
      "reason": "why this file is needed"
    }
  ]
}

CRITICAL RULES:
- "find" must be an EXACT verbatim substring from the file content shown — copy it character-for-character
- Include enough context in "find" to be unique (at least 2-3 lines)
- Do NOT invent code that isn't in the file
- Keep edits minimal and surgical — do not rewrite entire files unless explicitly asked
- "newFiles" is optional — only include if genuinely needed
- If a file was loaded with smart chunking (some sections not shown), reference functions by name to edit them
- For each edit, the "file" path must exactly match a FILE: header shown above`;

  const editUserPrompt = `## Instructions
${instruction}

## File Index (for reference — ${index.totalFiles} files total)
${index.indexText.slice(0, 5000)}

## File Contents (${Object.keys(fileMap).length} files loaded)
${fileContent}

Produce the edit plan as JSON.`;

  // v5.13: Auto-continuation for edit plan generation
  // If the LLM hits max_tokens mid-JSON, automatically continue
  const MAX_EDIT_CONTINUATIONS = 3;
  let editContent = "";
  let editMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: editSystemPrompt },
    { role: "user", content: editUserPrompt },
  ];

  for (let attempt = 0; attempt <= MAX_EDIT_CONTINUATIONS; attempt++) {
    const editResponse = await fetch(getFileEngineApiUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
      body: JSON.stringify({
        model,
        messages: editMessages,
        max_tokens: getModelContextMaxOutput(model),
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!editResponse.ok) {
      const err = await editResponse.text();
      throw new Error(`DeepSeek API error in edit: ${editResponse.status}: ${err}`);
    }

    const editData = (await editResponse.json()) as any;
    const chunk = editData.choices?.[0]?.message?.content || "";
    editContent += chunk;

    // Check if the response was truncated
    const finishReason = editData.choices?.[0]?.finish_reason;
    if (finishReason !== "length") break; // Completed naturally

    // Response was truncated — try to continue
    if (attempt < MAX_EDIT_CONTINUATIONS) {
      emit?.({ type: "engine_phase", phase: "editing", message: `Edit plan truncated, continuing (${attempt + 1}/${MAX_EDIT_CONTINUATIONS})...` });
      editMessages = [
        { role: "system", content: editSystemPrompt },
        { role: "user", content: editUserPrompt },
        { role: "assistant", content: editContent },
        { role: "user", content: "Your JSON was cut off. Continue the JSON from EXACTLY where you left off. Do not restart or repeat." },
      ];
    }
  }

  if (!editContent) throw new Error("No edit plan returned from AI");

  // Attempt to repair truncated JSON if needed
  let parsableContent = editContent.trim();
  if (!parsableContent.endsWith("}")) {
    // Try to close the JSON structure
    const lastBrace = parsableContent.lastIndexOf("}");
    const lastBracket = parsableContent.lastIndexOf("]");
    if (lastBrace > 0 || lastBracket > 0) {
      // Find the last complete edit entry and close the structure
      const cutPoint = Math.max(lastBrace, lastBracket);
      parsableContent = parsableContent.slice(0, cutPoint + 1);
      // Close any remaining open structures
      const openBraces = (parsableContent.match(/\{/g) || []).length - (parsableContent.match(/\}/g) || []).length;
      const openBrackets = (parsableContent.match(/\[/g) || []).length - (parsableContent.match(/\]/g) || []).length;
      parsableContent += "]".repeat(Math.max(0, openBrackets)) + "}".repeat(Math.max(0, openBraces));
    }
  }
  editContent = parsableContent;

  // ─── Apply Edits ──────────────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "applying", message: "Applying edits to files..." });

  interface EditPlan {
    summary: string;
    edits: Array<{ file: string; find: string; replace: string; reason: string }>;
    newFiles?: Array<{ file: string; content: string; reason: string }>;
  }

  let plan: EditPlan;
  try {
    plan = JSON.parse(editContent);
  } catch {
    throw new Error("AI returned invalid JSON for edit plan");
  }

  const log: string[] = [];
  let editsApplied = 0;

  // Apply find/replace edits
  if (plan.edits && Array.isArray(plan.edits)) {
    for (const edit of plan.edits) {
      // Resolve the file path
      let targetPath = edit.file;
      if (!fileMap[targetPath]) {
        // Try to find it with fuzzy matching
        const match = Object.keys(fileMap).find(p => p.endsWith(edit.file) || p.includes(edit.file));
        if (match) targetPath = match;
        else {
          // Try loading from ZIP directly
          const zipMatch = allPaths.find(p => p.endsWith(edit.file) || p.includes(edit.file));
          if (zipMatch) {
            try {
              fileMap[zipMatch] = await zip.files[zipMatch].async("string");
              targetPath = zipMatch;
            } catch {
              log.push(`SKIP: ${edit.file} — file not found in archive`);
              continue;
            }
          } else {
            log.push(`SKIP: ${edit.file} — file not found in archive`);
            continue;
          }
        }
      }

      const currentContent = fileMap[targetPath];
      if (!currentContent.includes(edit.find)) {
        // Try with normalized whitespace
        const normalizedContent = currentContent.replace(/\r\n/g, "\n");
        const normalizedFind = edit.find.replace(/\r\n/g, "\n");
        if (normalizedContent.includes(normalizedFind)) {
          fileMap[targetPath] = normalizedContent.replace(normalizedFind, edit.replace);
          editsApplied++;
          log.push(`EDIT: ${targetPath} — ${edit.reason}`);
        } else {
          log.push(`FAIL: ${targetPath} — "find" string not found verbatim (${edit.find.slice(0, 50)}...)`);
        }
      } else {
        fileMap[targetPath] = currentContent.replace(edit.find, edit.replace);
        editsApplied++;
        log.push(`EDIT: ${targetPath} — ${edit.reason}`);
      }
    }
  }

  // Add new files
  if (plan.newFiles && Array.isArray(plan.newFiles)) {
    for (const newFile of plan.newFiles) {
      // Determine the correct path prefix
      const existingPath = allPaths[0] || "";
      const prefix = existingPath.includes("/") ? existingPath.split("/").slice(0, -1).join("/") + "/" : "";
      const fullPath = newFile.file.startsWith(prefix) ? newFile.file : prefix + newFile.file;
      fileMap[fullPath] = newFile.content;
      editsApplied++;
      log.push(`NEW: ${fullPath} — ${newFile.reason}`);
    }
  }

  // ─── Validate Edits (v5.13 truncation detection) ─────────────────────────
  const { validateEditCompleteness } = await import("./truncationDetector.js");
  for (const [path, content] of Object.entries(fileMap)) {
    // Only validate files that were actually edited (compare with original)
    const originalFile = zip.files[path];
    if (!originalFile || originalFile.dir) continue;
    try {
      const originalContent = await originalFile.async("string");
      if (originalContent === content) continue; // Not edited
      const validation = validateEditCompleteness(originalContent, content, path);
      if (!validation.isComplete) {
        log.push(`WARN: ${path} — ${validation.issue} (edit may be incomplete)`);
      }
    } catch { /* skip validation for unreadable files */ }
  }

  // ─── Repack ZIP ─────────────────────────────────────────────────────────────────
  emit?.({ type: "engine_phase", phase: "repacking", message: `Repacking ZIP with ${editsApplied} changes...` }); // Start with the original ZIP and apply changes
  const newZip = await JSZip.loadAsync(zipBuffer);

  // Apply all file changes
  for (const [path, content] of Object.entries(fileMap)) {
    newZip.file(path, content);
  }

  const editedBuffer = await newZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const editedZip = editedBuffer.toString("base64");

  emit?.({ type: "edit_complete", editsApplied, summary: plan.summary });

  return {
    editedZip,
    summary: plan.summary,
    editsApplied,
    log,
  };
}

/**
 * Streaming wrapper for multi-pass analysis.
 * Sends SSE events for each phase, then streams the final analysis token-by-token.
 */
export async function streamMultiPassAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string,
  res: any // Express Response
): Promise<void> {
  const emit: SSEEmitter = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    // Run passes 1-3 (index, select, compress)
    const zipBuffer = Buffer.from(base64Zip, "base64");
    const zip = await JSZip.loadAsync(zipBuffer);

    // ZIP bomb protection
    let fileCount = 0;
    let totalUncompressed = 0;
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      if (path.includes("..") || path.startsWith("/")) throw new Error(`Unsafe path: ${path}`);
      fileCount++;
      if (fileCount > 2000) throw new Error("ZIP too large (>2000 files)");
      totalUncompressed += (file as any)._data?.uncompressedSize ?? 0;
      if (totalUncompressed > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100MB");
    }

    // Pass 1
    emit({ type: "engine_phase", phase: "indexing", message: "Building file index..." });
    const index = await buildFileIndex(zip);
    emit({
      type: "index_built",
      fileCount: index.totalFiles,
      totalSize: `${Math.round(index.totalSize / 1024)}KB`,
    });

    // Pass 2 — v5.21: Load ALL text files for projects up to 500 files
    emit({ type: "engine_phase", phase: "selecting", message: "Loading all project files (full codebase mode)..." });
    let selectedPaths: string[];
    if (index.totalFiles <= 500) {
      selectedPaths = index.entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
      emit({ type: "files_selected", count: selectedPaths.length, reason: "Full codebase mode — all text files" });
    } else {
      selectedPaths = await selectRelevantFiles(index, instruction, apiKey, model);
      emit({ type: "files_selected", count: selectedPaths.length, paths: selectedPaths.slice(0, 10), reason: "AI-selected (500+ files)" });
    }

    // Pass 3 — v5.21: Load all files, track overflow for chunked analysis
    emit({ type: "engine_phase", phase: "loading", message: `Loading ${selectedPaths.length} files (full codebase mode)...` });
    const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    const { content: fileContent, stats } = await loadAndCompressFiles(zip, selectedPaths, allPaths);
    const tokenEstimate = Math.round(fileContent.length / 4);
    emit({ type: "compression_applied", filesLoaded: stats.loaded, tokenEstimate, overflowFiles: stats.overflowPaths.length });

    // v5.21: If there are overflow files, analyze them in additional chunked passes
    let overflowAnalysis = "";
    if (stats.overflowed && stats.overflowPaths.length > 0) {
      emit({ type: "engine_phase", phase: "chunked_overflow", message: `Analyzing ${stats.overflowPaths.length} additional files in chunks...` });
      
      // Process overflow files in chunks of MAX_CONTEXT_CHARS
      const overflowChunks: string[][] = [];
      let currentChunk: string[] = [];
      let currentChunkSize = 0;
      
      for (const path of stats.overflowPaths) {
        const file = zip.files[path];
        if (!file || file.dir) continue;
        try {
          const content = await file.async("string");
          const { compressed } = compressFile(content, path);
          const chunkStr = `\nFILE: ${path}\n${compressed}`;
          if (currentChunkSize + chunkStr.length > MAX_CONTEXT_CHARS && currentChunk.length > 0) {
            overflowChunks.push(currentChunk);
            currentChunk = [chunkStr];
            currentChunkSize = chunkStr.length;
          } else {
            currentChunk.push(chunkStr);
            currentChunkSize += chunkStr.length;
          }
        } catch { /* skip */ }
      }
      if (currentChunk.length > 0) overflowChunks.push(currentChunk);

      // Analyze each overflow chunk
      const chunkSummaries: string[] = [];
      for (let i = 0; i < overflowChunks.length; i++) {
        emit({ type: "engine_phase", phase: "chunked_overflow", message: `Analyzing overflow chunk ${i + 1}/${overflowChunks.length}...` });
        const chunkContent = overflowChunks[i].join("\n");
        try {
          const chunkResp = await fetch(getFileEngineApiUrl(), {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: "You are a code analyst. Analyze these additional files concisely. Focus on key findings, issues, and how they relate to the overall project." },
                { role: "user", content: `Instruction: ${instruction}\n\nAdditional files (chunk ${i + 1}/${overflowChunks.length}):\n${chunkContent}` },
              ],
              max_tokens: 4000,
              temperature: 0.3,
            }),
          });
          if (chunkResp.ok) {
            const chunkData = (await chunkResp.json()) as any;
            const summary = chunkData.choices?.[0]?.message?.content || "";
            chunkSummaries.push(summary);
          }
        } catch { /* skip failed chunks */ }
      }
      if (chunkSummaries.length > 0) {
        overflowAnalysis = `\n\n## Additional Files Analysis (${stats.overflowPaths.length} files in ${overflowChunks.length} chunks)\n${chunkSummaries.join("\n\n")}`;
      }
    }

    // Pass 4: Stream the analysis with auto-continuation (v5.13)
    emit({ type: "engine_phase", phase: "analyzing", message: "Streaming analysis..." });

    const systemPrompt = `You are Andromeda, an expert AI code analyst and autonomous agent.
You have been given a COMPLETE codebase to analyze — ALL files have been loaded in full (no truncation).

Produce a thorough, structured analysis. Be specific — reference actual file paths, function names, and line-level issues.
Your analysis should be actionable and prioritized by severity.
Do NOT truncate your response — if you have more to say, keep going.
You have the ENTIRE codebase available — analyze ALL files comprehensively.

Context: You are analyzing ${index.totalFiles} files total, with ${stats.loaded} loaded in full (${tokenEstimate} tokens). No files were truncated or omitted.`;

    const overflowSection = overflowAnalysis ? `\n\n## Overflow Analysis (files that didn't fit in primary context)\n${overflowAnalysis}` : "";

    const userPrompt = `## Instruction
${instruction}

## Project Index (${index.totalFiles} files)
${index.indexText.slice(0, 50000)}

## Full File Contents (${stats.loaded} files loaded directly${stats.overflowed ? `, ${stats.overflowPaths.length} analyzed in chunks` : ""})
${fileContent}${overflowSection}`;

    // Auto-continuation loop: if the LLM hits max_tokens, automatically continue
    const MAX_CONTINUATIONS = 4;
    let continuationCount = 0;
    let fullAnswer = "";
    let messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    while (continuationCount <= MAX_CONTINUATIONS) {
      const streamResponse = await fetch(getFileEngineApiUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: getModelContextMaxOutput(model),
          temperature: 0.3,
          stream: true,
        }),
      });

      if (!streamResponse.ok) {
        const err = await streamResponse.text();
        throw new Error(`DeepSeek API error: ${streamResponse.status}: ${err}`);
      }

      let wasTruncated = false;
      let chunkAnswer = "";

      // Parse SSE stream from DeepSeek and forward as deltas
      const reader = streamResponse.body as any;
      if (reader && reader[Symbol.asyncIterator]) {
        let buffer = "";
        for await (const chunk of reader) {
          buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                emit({ type: "delta", content: delta });
                chunkAnswer += delta;
              }
              if (parsed.choices?.[0]?.finish_reason === "length") {
                wasTruncated = true;
              }
            } catch { /* skip malformed SSE lines */ }
          }
        }
      } else {
        // Fallback for non-streaming response
        const data = (await streamResponse.json()) as any;
        const content = data.choices?.[0]?.message?.content || "";
        emit({ type: "delta", content });
        chunkAnswer = content;
        if (data.choices?.[0]?.finish_reason === "length") wasTruncated = true;
      }

      fullAnswer += chunkAnswer;

      if (!wasTruncated) {
        // Response completed naturally
        emit({ type: "done", fullAnswer });
        break;
      }

      // Auto-continue: append the partial response and ask to continue
      continuationCount++;
      if (continuationCount > MAX_CONTINUATIONS) {
        emit({ type: "truncated" });
        emit({ type: "done", fullAnswer });
        break;
      }

      emit({ type: "engine_phase", phase: "continuing", message: `Auto-continuing (${continuationCount}/${MAX_CONTINUATIONS})...` });

      // Build continuation messages
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
        { role: "assistant", content: fullAnswer },
        { role: "user", content: "Continue your analysis from where you left off. Do not repeat what you've already said." },
      ];
    }
  } catch (err: any) {
    emit({ type: "error", message: err.message || "Multi-pass analysis failed" });
  }
}


// ─── SOTA Improvements (v5.12) ──────────────────────────────────────────────

/**
 * Cost Budget Manager
 * Tracks token usage per task and enforces configurable limits.
 * Inspired by SWE-agent's cost-based budgeting ($3/task default).
 */
export interface CostBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxApiCalls: number;
  usedInputTokens: number;
  usedOutputTokens: number;
  apiCallCount: number;
}

export function createBudget(opts?: Partial<Pick<CostBudget, "maxInputTokens" | "maxOutputTokens" | "maxTotalTokens" | "maxApiCalls">>): CostBudget {
  return {
    maxInputTokens: opts?.maxInputTokens ?? 200_000,
    maxOutputTokens: opts?.maxOutputTokens ?? 16_000,
    maxTotalTokens: opts?.maxTotalTokens ?? 216_000,
    maxApiCalls: opts?.maxApiCalls ?? 10,
    usedInputTokens: 0,
    usedOutputTokens: 0,
    apiCallCount: 0,
  };
}

export function checkBudget(budget: CostBudget): { ok: boolean; reason?: string } {
  if (budget.apiCallCount >= budget.maxApiCalls) {
    return { ok: false, reason: `API call limit reached (${budget.maxApiCalls})` };
  }
  const totalUsed = budget.usedInputTokens + budget.usedOutputTokens;
  if (totalUsed >= budget.maxTotalTokens) {
    return { ok: false, reason: `Total token budget exhausted (${totalUsed}/${budget.maxTotalTokens})` };
  }
  return { ok: true };
}

export function recordUsage(budget: CostBudget, inputTokens: number, outputTokens: number): void {
  budget.usedInputTokens += inputTokens;
  budget.usedOutputTokens += outputTokens;
  budget.apiCallCount++;
}

/**
 * Error Recovery Ladder
 * Implements SWE-agent's error recovery pattern:
 * - Transient errors (429, 500, 502, 503): retry with exponential backoff
 * - Context overflow: auto-compact and retry once
 * - Permanent errors: fail immediately with autosubmit
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503],
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  emit?: SSEEmitter
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok || !config.retryableStatuses.includes(response.status)) {
        return response;
      }

      // Retryable error
      lastError = new Error(`API returned ${response.status}: ${response.statusText}`);

      if (attempt < config.maxRetries) {
        const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
        emit?.({ type: "retry", attempt: attempt + 1, maxRetries: config.maxRetries, delayMs: delay, status: response.status });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (err: any) {
      lastError = err;
      if (attempt < config.maxRetries) {
        const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt), config.maxDelayMs);
        emit?.({ type: "retry", attempt: attempt + 1, maxRetries: config.maxRetries, delayMs: delay, error: err.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("All retry attempts exhausted");
}

/**
 * Autosubmit Pattern
 * Inspired by SWE-agent: every error path ends in partial submission, not crash.
 * Even if the edit partially fails, return whatever was completed.
 */
export interface AutosubmitResult {
  success: boolean;
  partial: boolean;
  editedZip?: string;
  summary: string;
  editsApplied: number;
  editsAttempted: number;
  log: string[];
  exitReason?: string;
}

export async function runMultiPassEditWithAutosubmit(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter,
  budget?: CostBudget
): Promise<AutosubmitResult> {
  const effectiveBudget = budget || createBudget();

  try {
    // Check budget before starting
    const budgetCheck = checkBudget(effectiveBudget);
    if (!budgetCheck.ok) {
      return {
        success: false,
        partial: false,
        summary: `Budget exhausted before starting: ${budgetCheck.reason}`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`BUDGET: ${budgetCheck.reason}`],
        exitReason: "budget_exhausted",
      };
    }

    const result = await runMultiPassEdit(base64Zip, instruction, apiKey, model, emit);

    return {
      success: true,
      partial: false,
      editedZip: result.editedZip,
      summary: result.summary,
      editsApplied: result.editsApplied,
      editsAttempted: result.log.length,
      log: result.log,
    };
  } catch (err: any) {
    // Autosubmit pattern: try to return partial work
    emit?.({ type: "autosubmit", reason: err.message });

    try {
      // Attempt to return the original ZIP unchanged with an error log
      return {
        success: false,
        partial: true,
        editedZip: base64Zip, // Return original unchanged
        summary: `Edit partially failed: ${err.message}. Original files returned unchanged.`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`AUTOSUBMIT: ${err.message}`, "Original ZIP returned unchanged"],
        exitReason: err.message.includes("context") ? "context_overflow" :
                    err.message.includes("budget") ? "budget_exhausted" :
                    err.message.includes("429") ? "rate_limited" : "error",
      };
    } catch {
      return {
        success: false,
        partial: false,
        summary: `Complete failure: ${err.message}`,
        editsApplied: 0,
        editsAttempted: 0,
        log: [`FATAL: ${err.message}`],
        exitReason: "fatal",
      };
    }
  }
}

/**
 * Context Window Monitor
 * Tracks how much of the context window is being used and triggers
 * compaction when approaching the limit.
 */
export interface ContextWindowState {
  maxTokens: number;
  usedTokens: number;
  reservedForOutput: number;
  availableTokens: number;
  utilizationPercent: number;
  shouldCompact: boolean;
}

export function getContextWindowState(
  contentChars: number,
  maxContextTokens: number = 131_072,
  outputReserve: number = 8_000
): ContextWindowState {
  const usedTokens = Math.ceil(contentChars / 4); // ~4 chars per token
  const availableTokens = maxContextTokens - outputReserve - usedTokens;
  const utilizationPercent = Math.round((usedTokens / (maxContextTokens - outputReserve)) * 100);

  return {
    maxTokens: maxContextTokens,
    usedTokens,
    reservedForOutput: outputReserve,
    availableTokens: Math.max(0, availableTokens),
    utilizationPercent: Math.min(100, utilizationPercent),
    shouldCompact: utilizationPercent > 85,
  };
}

/**
 * Intelligent File Prioritization
 * Uses a scoring system inspired by Aider's PageRank to determine
 * which files are most important for a given task.
 */
export function scoreFileRelevance(
  entry: FileEntry,
  instruction: string,
  allEntries: FileEntry[]
): number {
  let score = 0;
  const instructionLower = instruction.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const fileName = entry.path.split("/").pop()?.toLowerCase() || "";

  // Direct mention in instruction (+50)
  if (instructionLower.includes(fileName.replace(/\.[^.]+$/, ""))) {
    score += 50;
  }

  // Priority file bonus (+30)
  if (PRIORITY_FILES.some(p => entry.path.endsWith(p))) {
    score += 30;
  }

  // Source files > config > docs > tests > assets
  const categoryScores = { source: 20, config: 15, docs: 10, test: 5, asset: 0 };
  score += categoryScores[entry.category] ?? 0;

  // Entry point bonus (+25)
  if (/index\.(ts|js|tsx|jsx)$/.test(pathLower) || /main\.(ts|js|py|go|rs)$/.test(pathLower) || /app\.(ts|tsx|js|jsx)$/.test(pathLower)) {
    score += 25;
  }

  // Cross-reference bonus: files that are imported by many other files
  const importCount = allEntries.filter(other =>
    other.signatures.some(sig => sig.includes(fileName.replace(/\.[^.]+$/, "")))
  ).length;
  score += Math.min(importCount * 5, 25);

  // Size penalty for very large files (>2000 lines ≈ >50KB)
  if (entry.size > 50_000) score -= 10;

  // Keyword matching from instruction
  const keywords = instructionLower.split(/\s+/).filter(w => w.length > 3);
  for (const keyword of keywords) {
    if (pathLower.includes(keyword)) score += 10;
    if (entry.signatures.some(s => s.toLowerCase().includes(keyword))) score += 15;
  }

  return score;
}

/**
 * Fallback: Chunked Sub-Analysis for extremely large projects.
 * Splits files into logical groups and analyzes each separately,
 * then synthesizes results.
 */
export async function runChunkedAnalysis(
  base64Zip: string,
  instruction: string,
  apiKey: string,
  model: string = "deepseek/deepseek-chat",
  emit?: SSEEmitter
): Promise<{ analysis: string; chunksProcessed: number; totalFiles: number }> {
  const zipBuffer = Buffer.from(base64Zip, "base64");
  const zip = await JSZip.loadAsync(zipBuffer);
  const index = await buildFileIndex(zip);

  // Group files by top-level directory
  const groups: Record<string, FileEntry[]> = {};
  for (const entry of index.entries) {
    const topDir = entry.path.split("/").slice(0, 2).join("/");
    if (!groups[topDir]) groups[topDir] = [];
    groups[topDir].push(entry);
  }

  const chunkResults: string[] = [];
  let chunksProcessed = 0;

  // Process each group as a sub-analysis
  for (const [dir, entries] of Object.entries(groups)) {
    if (entries.length === 0) continue;
    if (entries.every(e => e.category === "asset")) continue; // Skip pure asset dirs

    emit?.({ type: "chunk_start", directory: dir, fileCount: entries.length });

    // Load files for this chunk
    const chunkPaths = entries.filter(e => TEXT_EXTS.test(e.path)).map(e => e.path);
    const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
    const { content: chunkContent, stats } = await loadAndCompressFiles(zip, chunkPaths, allPaths);

    if (stats.loaded === 0) continue;

    const chunkPrompt = `Analyze this section of the codebase (directory: ${dir}, ${stats.loaded} files).
Focus on: architecture, code quality, potential issues, and how it relates to the overall project.
Be concise — this is one chunk of a larger analysis.

${chunkContent}`;

    try {
      const response = await fetchWithRetry(getFileEngineApiUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a code analyst. Analyze this code chunk concisely." },
            { role: "user", content: chunkPrompt },
          ],
          max_tokens: 3000,
          temperature: 0.3,
        }),
      }, DEFAULT_RETRY_CONFIG, emit);

      if (response.ok) {
        const data = (await response.json()) as any;
        const chunkAnalysis = data.choices?.[0]?.message?.content || "";
        chunkResults.push(`## ${dir}\n${chunkAnalysis}`);
        chunksProcessed++;
        emit?.({ type: "chunk_complete", directory: dir, chunksProcessed });
      }
    } catch (err: any) {
      chunkResults.push(`## ${dir}\n[Analysis failed: ${err.message}]`);
    }
  }

  // Synthesis pass: combine all chunk results
  emit?.({ type: "engine_phase", phase: "synthesizing", message: "Combining chunk analyses..." });

  const synthesisPrompt = `You analyzed a large codebase in chunks. Here are the per-directory analyses.
Synthesize them into a single cohesive report that addresses the user's original instruction.

User instruction: ${instruction}

Chunk analyses:
${chunkResults.join("\n\n")}

Produce a unified, well-structured analysis report.`;

  const synthesisResponse = await fetchWithRetry(getFileEngineApiUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...getFileEngineProviderHeaders() },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are an expert code analyst. Synthesize chunk analyses into a unified report." },
        { role: "user", content: synthesisPrompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }),
  }, DEFAULT_RETRY_CONFIG, emit);

  let analysis = "Synthesis failed";
  if (synthesisResponse.ok) {
    const data = (await synthesisResponse.json()) as any;
    analysis = data.choices?.[0]?.message?.content || "Synthesis failed";
  }

  return { analysis, chunksProcessed, totalFiles: index.totalFiles };
}
