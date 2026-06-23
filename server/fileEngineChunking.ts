/**
 * fileEngineChunking.ts — v6.29
 * Smart chunking by function boundaries and file index builder.
 * v6.29: AST-based semantic chunking using the TypeScript compiler API.
 *        Falls back to the v6.25 regex-based approach for Python and non-TS files.
 */
import JSZip from "jszip";
import { createLogger } from "./logger.js";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
import type { FileEntry, FileIndex, CompressionResult, SSEEmitter } from "./fileEngineTypes.js";
import { LOW_PRIORITY_DIRS, TEXT_EXTS, PRIORITY_FILES, categorizeFile, extractSignatures } from "./fileEngineTypes.js";
export type { FileEntry, FileIndex, CompressionResult, SSEEmitter } from "./fileEngineTypes.js";
const log = createLogger("fileEngineChunking");

// ─── v6.29: TypeScript compiler API — lazy-loaded ──────────────────────────
// TypeScript is already a project dependency (used by the build pipeline).
// We load it lazily so the module still works in environments where it's absent.
let _ts: typeof import("typescript") | null = null;
function getTS(): typeof import("typescript") | null {
  if (_ts !== undefined) return _ts;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _ts = _require("typescript") as typeof import("typescript");
    return _ts;
  } catch {
    _ts = null;
    return null;
  }
}

// ─── Shared chunk type ──────────────────────────────────────────────────────

interface FunctionChunk {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
  tokenEstimate: number;
}

// ─── v6.29: AST-based extraction ───────────────────────────────────────────

/**
 * Extract top-level declarations from TypeScript/JavaScript using the TS
 * compiler API. Returns null if the API is unavailable (triggers regex fallback).
 *
 * Compared to the v6.25 regex approach this correctly handles:
 *  - Multi-line arrow functions assigned to const/let
 *  - Nested template literals containing braces
 *  - Decorators on classes
 *  - Overloaded function signatures
 *  - Re-export statements
 */
function extractChunksAST(content: string, filename: string): FunctionChunk[] | null {
  const ts = getTS();
  if (!ts) return null;

  try {
    const sf = ts.createSourceFile(
      filename,
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
    );

    const lines = content.split("\n");
    const chunks: FunctionChunk[] = [];

    sf.statements.forEach((node) => {
      // Determine a human-readable name for the node
      let name = "_anon";

      if (
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)
      ) {
        name = (node as any).name?.text ?? "_anon";
      } else if (ts.isVariableStatement(node)) {
        // e.g. `export const foo = ...`
        const decl = node.declarationList.declarations[0];
        if (decl && ts.isIdentifier(decl.name)) {
          name = decl.name.text;
        }
      } else if (ts.isExpressionStatement(node)) {
        name = "_expr";
      } else if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        name = "_import";
      } else {
        name = "_stmt";
      }

      // getFullStart() includes leading trivia (comments/whitespace)
      const startPos = node.getFullStart();
      const endPos = node.getEnd();
      const startLine = sf.getLineAndCharacterOfPosition(startPos).line;
      const endLine = sf.getLineAndCharacterOfPosition(endPos).line;
      const body = lines.slice(startLine, endLine + 1).join("\n");

      if (body.trim().length === 0) return;

      chunks.push({
        name,
        startLine,
        endLine,
        body,
        tokenEstimate: Math.ceil(body.length / 4),
      });
    });

    return chunks.length > 0 ? chunks : null;
  } catch (err) {
    log.warn("AST chunking failed, falling back to regex:", String(err).slice(0, 120));
    return null;
  }
}

// ─── v6.25: Regex-based fallback ───────────────────────────────────────────

function extractChunksRegex(content: string, ext: string): FunctionChunk[] {
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

      if (inTopLevel && braceDepth === 0) {
        const match = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+(\w+)/);
        if (match) {
          if (currentStart >= 0 && currentStart < i) {
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

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract function/class boundaries from source code for intelligent chunking.
 * v6.29: Tries AST-based extraction first (TypeScript compiler API), falls back
 * to the v6.25 regex approach for Python and when the TS API is unavailable.
 */
export function extractFunctionBoundaries(content: string, ext: string): FunctionChunk[] {
  const isTS = /^(ts|tsx|js|jsx)$/.test(ext);

  if (isTS) {
    // Try AST first — more accurate for complex TS patterns
    const astChunks = extractChunksAST(content, `file.${ext}`);
    if (astChunks && astChunks.length > 0) {
      log.debug(`AST chunking: ${astChunks.length} semantic chunks extracted`);
      return astChunks;
    }
    // Fallback to regex
    log.debug("AST unavailable, using regex chunking");
  }

  return extractChunksRegex(content, ext);
}

/**
 * v5.28 / v6.29: Smart file loading with progressive chunking.
 * Instead of truncating large files, this:
 * 1. Calculates available token budget from modelRegistry
 * 2. Splits large files by semantic boundaries (AST in v6.29, regex fallback)
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

  // Extract semantic boundaries
  const chunks = extractFunctionBoundaries(content, ext);
  if (chunks.length === 0) {
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
