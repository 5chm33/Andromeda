/**
 * semanticCodebaseGraph.ts — v13.0.0
 *
 * SOTA Semantic Codebase Graph: extends the existing ASTKnowledgeGraph with
 * function-level caller/callee tracking, dead code detection, and impact radius
 * proofs. Unlike the file-level dependencyGraph.ts, this module operates at
 * the AST symbol level — understanding not just that A imports B, but that
 * A calls B.foo() on line 42 with specific argument patterns.
 *
 * Key capabilities:
 *   1. Symbol-level call graph: function → callers, function → callees
 *   2. Dead code detection: exported symbols with zero callers across the project
 *   3. Impact radius proof: before applying a change to symbol X, statically
 *      enumerate all callers and verify they are either unaffected or updated
 *   4. Change safety score: 0.0–1.0 confidence that a proposed change is safe
 *   5. Incremental updates: re-parse only changed files, not the whole project
 *
 * Integration points:
 *   - selfImprove.ts: call getChangeSafetyScore() before applying any proposal
 *   - multiAgentDebate.ts: pass impact radius to debate agents for context
 *   - rsiEngine.ts: use getDeadCodeCandidates() to target cleanup proposals
 */

import fs from "fs";
import path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("semanticCodebaseGraph");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SymbolNode {
  /** Unique ID: "server/llmProvider.ts::chatCompletion" */
  id: string;
  /** Short name: "chatCompletion" */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Relative path from project root */
  relativePath: string;
  kind: "function" | "class" | "method" | "variable" | "type" | "interface" | "const";
  isExported: boolean;
  isAsync: boolean;
  lineStart: number;
  lineEnd: number;
  /** Parameter names extracted from signature */
  params: string[];
  /** Return type annotation if present */
  returnType?: string;
}

export interface CallEdge {
  /** ID of the calling symbol */
  callerId: string;
  /** ID of the called symbol */
  calleeId: string;
  /** Line in caller file where the call occurs */
  callLine: number;
  /** How the callee is referenced (direct, via destructure, via import alias) */
  referenceStyle: "direct" | "destructured" | "aliased" | "dynamic";
}

export interface DeadCodeCandidate {
  symbol: SymbolNode;
  reason: string;
  confidence: number; // 0.0–1.0
  safeToRemove: boolean;
}

export interface ImpactRadiusProof {
  targetSymbol: SymbolNode;
  directCallers: SymbolNode[];
  transitiveCallers: SymbolNode[];
  impactRadius: number; // total affected symbols
  riskScore: number; // 0.0–1.0
  highRisk: boolean;
  /** Symbols that MUST be updated if the target's signature changes */
  mustUpdateSymbols: SymbolNode[];
  /** Human-readable proof summary */
  summary: string;
}

export interface ChangeSafetyScore {
  score: number; // 0.0–1.0 (1.0 = completely safe)
  riskFactors: string[];
  safetyFactors: string[];
  recommendation: "apply" | "review" | "block";
  impactProof: ImpactRadiusProof | null;
}

export interface GraphStats {
  totalSymbols: number;
  totalCallEdges: number;
  totalFiles: number;
  deadCodeCandidates: number;
  lastBuiltAt: number;
  buildDurationMs: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

const symbols = new Map<string, SymbolNode>();
const callEdges: CallEdge[] = [];
// callerIndex[calleeId] = Set of callerIds
const callerIndex = new Map<string, Set<string>>();
// calleeIndex[callerId] = Set of calleeIds
const calleeIndex = new Map<string, Set<string>>();
// fileIndex[filePath] = Set of symbolIds defined in that file
const fileIndex = new Map<string, Set<string>>();

let lastBuiltAt = 0;
let buildDurationMs = 0;
let totalFiles = 0;

// ─── Regex-based AST parser (no ts-morph dependency) ─────────────────────────
// Uses carefully crafted regexes to extract symbol definitions and call sites
// from TypeScript source. Not 100% accurate but fast and zero-dependency.

const FUNCTION_DEF_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/g;
const ARROW_FN_RE = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^=>{]+?))?\s*=>/g;
const CLASS_DEF_RE = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g;
const METHOD_DEF_RE = /^\s+(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+?))?\s*\{/gm;
const INTERFACE_DEF_RE = /(?:export\s+)?interface\s+(\w+)/g;
const TYPE_DEF_RE = /(?:export\s+)?type\s+(\w+)\s*=/g;
const IMPORT_RE = /import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
const CALL_RE = /\b(\w+)\s*\(/g;

function makeSymbolId(relativePath: string, name: string): string {
  return `${relativePath}::${name}`;
}

function parseFileSymbols(filePath: string, projectRoot: string): SymbolNode[] {
  const result: SymbolNode[] = [];
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return result;
  }
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  const lines = content.split("\n");

  function lineOf(index: number): number {
    return content.slice(0, index).split("\n").length;
  }

  // Functions
  let m: RegExpExecArray | null;
  FUNCTION_DEF_RE.lastIndex = 0;
  while ((m = FUNCTION_DEF_RE.exec(content)) !== null) {
    const name = m[1];
    const params = m[2].split(",").map(p => p.trim().split(":")[0].trim()).filter(Boolean);
    const returnType = m[3]?.trim();
    const line = lineOf(m.index);
    result.push({
      id: makeSymbolId(relativePath, name),
      name,
      filePath,
      relativePath,
      kind: "function",
      isExported: m[0].includes("export"),
      isAsync: m[0].includes("async"),
      lineStart: line,
      lineEnd: Math.min(line + 50, lines.length), // approximate
      params,
      returnType,
    });
  }

  // Arrow functions assigned to const/let
  ARROW_FN_RE.lastIndex = 0;
  while ((m = ARROW_FN_RE.exec(content)) !== null) {
    const name = m[1];
    const params = m[2].split(",").map(p => p.trim().split(":")[0].trim()).filter(Boolean);
    const returnType = m[3]?.trim();
    const line = lineOf(m.index);
    result.push({
      id: makeSymbolId(relativePath, name),
      name,
      filePath,
      relativePath,
      kind: "const",
      isExported: m[0].includes("export"),
      isAsync: m[0].includes("async"),
      lineStart: line,
      lineEnd: Math.min(line + 30, lines.length),
      params,
      returnType,
    });
  }

  // Classes
  CLASS_DEF_RE.lastIndex = 0;
  while ((m = CLASS_DEF_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(m.index);
    result.push({
      id: makeSymbolId(relativePath, name),
      name,
      filePath,
      relativePath,
      kind: "class",
      isExported: m[0].includes("export"),
      isAsync: false,
      lineStart: line,
      lineEnd: Math.min(line + 200, lines.length),
      params: [],
    });
  }

  // Interfaces
  INTERFACE_DEF_RE.lastIndex = 0;
  while ((m = INTERFACE_DEF_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(m.index);
    result.push({
      id: makeSymbolId(relativePath, name),
      name,
      filePath,
      relativePath,
      kind: "interface",
      isExported: m[0].includes("export"),
      isAsync: false,
      lineStart: line,
      lineEnd: Math.min(line + 30, lines.length),
      params: [],
    });
  }

  // Type aliases
  TYPE_DEF_RE.lastIndex = 0;
  while ((m = TYPE_DEF_RE.exec(content)) !== null) {
    const name = m[1];
    const line = lineOf(m.index);
    result.push({
      id: makeSymbolId(relativePath, name),
      name,
      filePath,
      relativePath,
      kind: "type",
      isExported: m[0].includes("export"),
      isAsync: false,
      lineStart: line,
      lineEnd: line + 1,
      params: [],
    });
  }

  return result;
}

function parseFileCalls(
  callerFilePath: string,
  projectRoot: string,
  allSymbolNames: Set<string>
): Array<{ callerName: string; calleeName: string; line: number }> {
  const result: Array<{ callerName: string; calleeName: string; line: number }> = [];
  let content: string;
  try {
    content = fs.readFileSync(callerFilePath, "utf-8");
  } catch {
    return result;
  }
  const lines = content.split("\n");

  // Build a map of which function each line belongs to
  // Simple heuristic: track the most recently opened function definition
  let currentFn = "_module_level_";
  const fnStack: string[] = ["_module_level_"];
  let braceDepth = 0;
  const fnBraceDepth = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect function definition
    const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/) ||
                    line.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(.*\)\s*(?::\s*\S+\s*)?\s*=>/);
    if (fnMatch) {
      currentFn = fnMatch[1];
      fnStack.push(currentFn);
      fnBraceDepth.set(currentFn, braceDepth);
    }
    // Track brace depth
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        // Pop function off stack when its brace closes
        if (fnStack.length > 1) {
          const topFnDepth = fnBraceDepth.get(fnStack[fnStack.length - 1]);
          if (topFnDepth !== undefined && braceDepth <= topFnDepth) {
            fnStack.pop();
            currentFn = fnStack[fnStack.length - 1] ?? "_module_level_";
          }
        }
      }
    }
    // Find call sites
    CALL_RE.lastIndex = 0;
    let callMatch: RegExpExecArray | null;
    while ((callMatch = CALL_RE.exec(line)) !== null) {
      const calleeName = callMatch[1];
      if (
        allSymbolNames.has(calleeName) &&
        calleeName !== currentFn && // skip self-calls
        !["if", "for", "while", "switch", "catch", "typeof", "instanceof"].includes(calleeName)
      ) {
        result.push({ callerName: currentFn, calleeName, line: i + 1 });
      }
    }
  }

  return result;
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

/**
 * Build the full semantic codebase graph by scanning all .ts files in serverDir.
 * Returns stats about the build.
 */
export async function buildSemanticGraph(
  projectRoot: string,
  serverDir?: string
): Promise<GraphStats> {
  const t0 = Date.now();
  const scanDir = serverDir ?? path.join(projectRoot, "server");

  // Clear existing state
  symbols.clear();
  callEdges.length = 0;
  callerIndex.clear();
  calleeIndex.clear();
  fileIndex.clear();

  // Collect all .ts files (excluding .test.ts, .d.ts)
  const tsFiles: string[] = [];
  function scanDir2(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          scanDir2(path.join(dir, entry.name));
        } else if (
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts") &&
          !entry.name.endsWith(".d.ts")
        ) {
          tsFiles.push(path.join(dir, entry.name));
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  scanDir2(scanDir);
  totalFiles = tsFiles.length;

  // Phase 1: Parse all symbols
  for (const filePath of tsFiles) {
    const fileSymbols = parseFileSymbols(filePath, projectRoot);
    const fileSymbolIds = new Set<string>();
    for (const sym of fileSymbols) {
      symbols.set(sym.id, sym);
      fileSymbolIds.add(sym.id);
    }
    fileIndex.set(filePath, fileSymbolIds);
  }

  // Build name lookup for call detection
  const allSymbolNames = new Set<string>();
  for (const sym of symbols.values()) {
    allSymbolNames.add(sym.name);
  }

  // Phase 2: Parse call sites and build edges
  for (const filePath of tsFiles) {
    const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
    const calls = parseFileCalls(filePath, projectRoot, allSymbolNames);
    for (const { callerName, calleeName, line } of calls) {
      const callerId = makeSymbolId(relativePath, callerName);
      // Find callee — prefer same file, then any file
      const calleeId = makeSymbolId(relativePath, calleeName) ||
        Array.from(symbols.keys()).find(id => id.endsWith(`::${calleeName}`));
      if (!calleeId || !symbols.has(calleeId)) {
        // Try to find callee in any file
        const found = Array.from(symbols.keys()).find(id => id.endsWith(`::${calleeName}`));
        if (!found) continue;
        const edge: CallEdge = {
          callerId: symbols.has(callerId) ? callerId : `${relativePath}::_module_level_`,
          calleeId: found,
          callLine: line,
          referenceStyle: "direct",
        };
        callEdges.push(edge);
        if (!callerIndex.has(found)) callerIndex.set(found, new Set());
        callerIndex.get(found)!.add(edge.callerId);
        if (!calleeIndex.has(edge.callerId)) calleeIndex.set(edge.callerId, new Set());
        calleeIndex.get(edge.callerId)!.add(found);
      } else {
        const edge: CallEdge = {
          callerId: symbols.has(callerId) ? callerId : `${relativePath}::_module_level_`,
          calleeId,
          callLine: line,
          referenceStyle: "direct",
        };
        callEdges.push(edge);
        if (!callerIndex.has(calleeId)) callerIndex.set(calleeId, new Set());
        callerIndex.get(calleeId)!.add(edge.callerId);
        if (!calleeIndex.has(edge.callerId)) calleeIndex.set(edge.callerId, new Set());
        calleeIndex.get(edge.callerId)!.add(calleeId);
      }
    }
  }

  lastBuiltAt = Date.now();
  buildDurationMs = lastBuiltAt - t0;

  const deadCandidates = getDeadCodeCandidates().length;
  log.info(`[semanticCodebaseGraph] Built: ${symbols.size} symbols, ${callEdges.length} call edges, ${deadCandidates} dead code candidates in ${buildDurationMs}ms`);

  return {
    totalSymbols: symbols.size,
    totalCallEdges: callEdges.length,
    totalFiles,
    deadCodeCandidates: deadCandidates,
    lastBuiltAt,
    buildDurationMs,
  };
}

// ─── Dead Code Detection ──────────────────────────────────────────────────────

/**
 * Find exported symbols that have zero callers across the entire project.
 * These are candidates for removal (with human review).
 */
export function getDeadCodeCandidates(): DeadCodeCandidate[] {
  const candidates: DeadCodeCandidate[] = [];
  const SAFE_PATTERNS = [
    // Route handlers, test helpers, and init functions are called externally
    /^(init|start|stop|register|setup|create|get|post|put|delete|patch|handle|on[A-Z])/,
    // Test utilities
    /test|spec|mock|stub|fixture/i,
    // Type-only exports are never "called"
  ];

  for (const [id, sym] of symbols) {
    if (!sym.isExported) continue;
    if (sym.kind === "type" || sym.kind === "interface") continue;
    const callers = callerIndex.get(id);
    if (callers && callers.size > 0) continue;

    // Check if it matches a safe pattern (externally called)
    const isSafePattern = SAFE_PATTERNS.some(p => p.test(sym.name));
    const confidence = isSafePattern ? 0.3 : 0.75;

    candidates.push({
      symbol: sym,
      reason: `Exported symbol '${sym.name}' in ${sym.relativePath} has 0 detected callers`,
      confidence,
      safeToRemove: !isSafePattern && sym.kind !== "class",
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ─── Impact Radius Proof ──────────────────────────────────────────────────────

/**
 * Compute the full impact radius for changing a named symbol.
 * Returns a proof object that can be used to block or warn about risky changes.
 */
export function computeImpactRadius(symbolName: string, filePath?: string): ImpactRadiusProof | null {
  // Find the target symbol
  let targetSym: SymbolNode | undefined;
  if (filePath) {
    const relPath = filePath.includes("server/") ? filePath : `server/${path.basename(filePath)}`;
    targetSym = symbols.get(makeSymbolId(relPath, symbolName)) ||
      Array.from(symbols.values()).find(s => s.name === symbolName && s.filePath === filePath);
  } else {
    targetSym = Array.from(symbols.values()).find(s => s.name === symbolName);
  }

  if (!targetSym) return null;

  // BFS to find all transitive callers
  const directCallerIds = callerIndex.get(targetSym.id) ?? new Set<string>();
  const directCallers = Array.from(directCallerIds)
    .map(id => symbols.get(id))
    .filter((s): s is SymbolNode => s !== undefined);

  const visited = new Set<string>(directCallerIds);
  const queue = [...directCallerIds];
  const transitiveCallerIds = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const upstreamCallers = callerIndex.get(current) ?? new Set<string>();
    for (const upstream of upstreamCallers) {
      if (!visited.has(upstream)) {
        visited.add(upstream);
        transitiveCallerIds.add(upstream);
        queue.push(upstream);
      }
    }
  }

  const transitiveCallers = Array.from(transitiveCallerIds)
    .map(id => symbols.get(id))
    .filter((s): s is SymbolNode => s !== undefined);

  const impactRadius = directCallers.length + transitiveCallers.length;

  // Risk scoring
  let riskScore = 0;
  if (impactRadius > 20) riskScore = 1.0;
  else if (impactRadius > 10) riskScore = 0.8;
  else if (impactRadius > 5) riskScore = 0.6;
  else if (impactRadius > 2) riskScore = 0.4;
  else if (impactRadius > 0) riskScore = 0.2;

  // Critical files boost risk
  const CRITICAL_FILES = ["rsiEngine.ts", "selfImprove.ts", "llmProvider.ts", "selfImproveGuard.ts"];
  if (CRITICAL_FILES.some(f => targetSym!.relativePath.includes(f))) {
    riskScore = Math.min(1.0, riskScore + 0.3);
  }

  // Symbols that must be updated if signature changes (direct callers only)
  const mustUpdateSymbols = directCallers.filter(s =>
    s.kind === "function" || s.kind === "const" || s.kind === "method"
  );

  const summary = impactRadius === 0
    ? `Safe: '${symbolName}' has no callers — change is isolated`
    : `Impact: '${symbolName}' is called by ${directCallers.length} direct + ${transitiveCallers.length} transitive symbols (risk: ${Math.round(riskScore * 100)}%)`;

  return {
    targetSymbol: targetSym,
    directCallers,
    transitiveCallers,
    impactRadius,
    riskScore,
    highRisk: riskScore >= 0.6,
    mustUpdateSymbols,
    summary,
  };
}

// ─── Change Safety Score ──────────────────────────────────────────────────────

/**
 * Compute a 0.0–1.0 safety score for a proposed change to a file.
 * Higher = safer to auto-apply.
 */
export function getChangeSafetyScore(
  targetFile: string,
  proposedDiff: string,
  projectRoot: string
): ChangeSafetyScore {
  const riskFactors: string[] = [];
  const safetyFactors: string[] = [];

  // Extract function names from the diff that are being modified
  const modifiedFunctions: string[] = [];
  const diffLines = proposedDiff.split("\n");
  for (const line of diffLines) {
    if (line.startsWith("-") || line.startsWith("+")) {
      const fnMatch = line.match(/(?:function|const|let)\s+(\w+)\s*[=(]/);
      if (fnMatch) modifiedFunctions.push(fnMatch[1]);
    }
  }

  let worstImpact: ImpactRadiusProof | null = null;
  let maxRisk = 0;

  for (const fnName of [...new Set(modifiedFunctions)]) {
    const impact = computeImpactRadius(fnName, targetFile);
    if (impact && impact.riskScore > maxRisk) {
      maxRisk = impact.riskScore;
      worstImpact = impact;
    }
    if (impact && impact.highRisk) {
      riskFactors.push(`'${fnName}' has ${impact.impactRadius} callers (risk: ${Math.round(impact.riskScore * 100)}%)`);
    } else if (impact && impact.impactRadius === 0) {
      safetyFactors.push(`'${fnName}' has no callers — isolated change`);
    }
  }

  // Diff size risk
  const addedLines = diffLines.filter(l => l.startsWith("+")).length;
  const removedLines = diffLines.filter(l => l.startsWith("-")).length;
  if (addedLines + removedLines > 100) {
    riskFactors.push(`Large diff: +${addedLines}/-${removedLines} lines`);
    maxRisk = Math.min(1.0, maxRisk + 0.2);
  } else if (addedLines + removedLines < 20) {
    safetyFactors.push(`Small diff: +${addedLines}/-${removedLines} lines`);
  }

  // Critical file risk
  const CRITICAL_FILES = ["rsiEngine.ts", "selfImprove.ts", "llmProvider.ts", "selfImproveGuard.ts", "andromeda-constitution.json"];
  if (CRITICAL_FILES.some(f => targetFile.includes(f))) {
    riskFactors.push(`Critical system file: ${path.basename(targetFile)}`);
    maxRisk = Math.min(1.0, maxRisk + 0.25);
  }

  const score = Math.max(0, 1.0 - maxRisk);
  const recommendation: ChangeSafetyScore["recommendation"] =
    score >= 0.7 ? "apply" :
    score >= 0.4 ? "review" :
    "block";

  return {
    score,
    riskFactors,
    safetyFactors,
    recommendation,
    impactProof: worstImpact,
  };
}

// ─── Incremental Update ───────────────────────────────────────────────────────

/**
 * Re-parse a single file and update the graph incrementally.
 * Much faster than a full rebuild for post-apply updates.
 */
export function updateFileInGraph(filePath: string, projectRoot: string): void {
  // Remove old symbols from this file
  const oldSymbolIds = fileIndex.get(filePath) ?? new Set<string>();
  for (const id of oldSymbolIds) {
    symbols.delete(id);
    callerIndex.delete(id);
    calleeIndex.delete(id);
  }
  // Remove old call edges involving this file
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, "/");
  const filtered = callEdges.filter(e => !e.callerId.startsWith(relativePath) && !e.calleeId.startsWith(relativePath));
  callEdges.length = 0;
  callEdges.push(...filtered);

  // Re-parse
  const newSymbols = parseFileSymbols(filePath, projectRoot);
  const newIds = new Set<string>();
  for (const sym of newSymbols) {
    symbols.set(sym.id, sym);
    newIds.add(sym.id);
  }
  fileIndex.set(filePath, newIds);

  // Rebuild caller/callee index from remaining edges
  callerIndex.clear();
  calleeIndex.clear();
  for (const edge of callEdges) {
    if (!callerIndex.has(edge.calleeId)) callerIndex.set(edge.calleeId, new Set());
    callerIndex.get(edge.calleeId)!.add(edge.callerId);
    if (!calleeIndex.has(edge.callerId)) calleeIndex.set(edge.callerId, new Set());
    calleeIndex.get(edge.callerId)!.add(edge.calleeId);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getGraphStats(): GraphStats {
  return {
    totalSymbols: symbols.size,
    totalCallEdges: callEdges.length,
    totalFiles,
    deadCodeCandidates: getDeadCodeCandidates().length,
    lastBuiltAt,
    buildDurationMs,
  };
}

export function getSymbol(id: string): SymbolNode | undefined {
  return symbols.get(id);
}

export function getCallers(symbolId: string): SymbolNode[] {
  const ids = callerIndex.get(symbolId) ?? new Set<string>();
  return Array.from(ids).map(id => symbols.get(id)).filter((s): s is SymbolNode => s !== undefined);
}

export function getCallees(symbolId: string): SymbolNode[] {
  const ids = calleeIndex.get(symbolId) ?? new Set<string>();
  return Array.from(ids).map(id => symbols.get(id)).filter((s): s is SymbolNode => s !== undefined);
}

export function isGraphReady(): boolean {
  return lastBuiltAt > 0 && symbols.size > 0;
}

/** Initialize the semantic graph in the background (non-blocking). */
export function initSemanticCodebaseGraph(projectRoot: string): void {
  const serverDir = path.join(projectRoot, "server");
  if (!fs.existsSync(serverDir)) return;
  // Build asynchronously — don't block startup
  setImmediate(async () => {
    try {
      const stats = await buildSemanticGraph(projectRoot, serverDir);
      log.info(`[semanticCodebaseGraph] Ready: ${stats.totalSymbols} symbols, ${stats.totalCallEdges} edges`);
    } catch (err) {
      log.warn(`[semanticCodebaseGraph] Build failed (non-fatal):`, err);
    }
  });
}
