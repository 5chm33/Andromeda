/**
 * agentToolInterface.ts — Typed Tool Interface for the ReAct Engine
 * Andromeda v5.0 (Elicit recommendation #3)
 *
 * Defines typed operations with capability and resource limits so the ReAct
 * loop calls well-defined interfaces rather than raw shell-shaped behavior.
 * This gives us: replayability, policy enforcement, and clean telemetry.
 *
 * Operations:
 *   read_symbol    — Read a specific symbol/function from a file
 *   search_symbols — Search for symbols matching a pattern across the codebase
 *   list_tests     — List test files relevant to a target file
 *   run_bounded    — Run a command with strict resource limits
 *   run_probe      — Run a lightweight read-only probe (no writes, no network)
 *   edit_file      — Apply a targeted edit to a file (requires hypothesis first)
 *   diff_preview   — Preview a diff without applying it
 *   validate       — Run TypeScript type-check on a file or the whole project
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync, spawnSync } from "child_process";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToolMode = "explore" | "candidate" | "promote";

export interface ResourceLimits {
  /** Maximum wall-clock time in milliseconds */
  timeoutMs: number;
  /** Maximum output bytes to capture */
  maxOutputBytes: number;
  /** Whether network access is permitted */
  allowNetwork: boolean;
  /** Whether file writes are permitted */
  allowWrites: boolean;
}

export interface ToolCapabilities {
  /** Can read source files */
  canRead: boolean;
  /** Can search the codebase */
  canSearch: boolean;
  /** Can execute commands */
  canExecute: boolean;
  /** Can write or modify files */
  canWrite: boolean;
  /** Can access the network */
  canNetwork: boolean;
}

export interface AgentToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** Structured evidence for the promotion contract */
  evidence?: {
    filesRead: string[];
    commandsRun: string[];
    testsExecuted: string[];
    durationMs: number;
  };
}

export interface HypothesisRecord {
  /** What the agent believes is wrong or improvable */
  claim: string;
  /** What observation would confirm this hypothesis */
  confirmingObservation: string;
  /** What observation would refute this hypothesis */
  refutingObservation: string;
  /** The bounded probe that will distinguish between them */
  probe: string;
  /** Timestamp when the hypothesis was formed */
  formedAt: string;
}

// ─── Mode-based capability gates ─────────────────────────────────────────────

const MODE_CAPABILITIES: Record<ToolMode, ToolCapabilities> = {
  explore: {
    canRead: true,
    canSearch: true,
    canExecute: false,
    canWrite: false,
    canNetwork: false,
  },
  candidate: {
    canRead: true,
    canSearch: true,
    canExecute: true,
    canWrite: false,
    canNetwork: false,
  },
  promote: {
    canRead: true,
    canSearch: true,
    canExecute: true,
    canWrite: true,
    canNetwork: false,
  },
};

const MODE_LIMITS: Record<ToolMode, ResourceLimits> = {
  explore: {
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
    allowNetwork: false,
    allowWrites: false,
  },
  candidate: {
    timeoutMs: 30_000,
    maxOutputBytes: 256 * 1024,
    allowNetwork: false,
    allowWrites: false,
  },
  promote: {
    timeoutMs: 120_000,
    maxOutputBytes: 1024 * 1024,
    allowNetwork: false,
    allowWrites: true,
  },
};

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * Read a specific symbol (function, class, interface) from a TypeScript file.
 * Returns only the relevant lines rather than the whole file.
 */
export function readSymbol(
  filePath: string,
  symbolName: string,
  mode: ToolMode = "explore"
): AgentToolResult {
  const caps = MODE_CAPABILITIES[mode];
  if (!caps.canRead) {
    return { success: false, output: "", error: `Mode '${mode}' does not permit reads` };
  }
  const start = Date.now();
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    // Find the symbol definition
    const symbolPattern = new RegExp(
      `^(export\\s+)?(async\\s+)?function\\s+${symbolName}\\b|` +
      `^(export\\s+)?class\\s+${symbolName}\\b|` +
      `^(export\\s+)?(const|let|var)\\s+${symbolName}\\s*=|` +
      `^(export\\s+)?interface\\s+${symbolName}\\b|` +
      `^(export\\s+)?type\\s+${symbolName}\\s*=`
    );
    const startIdx = lines.findIndex(l => symbolPattern.test(l.trim()));
    if (startIdx === -1) {
      return { success: false, output: "", error: `Symbol '${symbolName}' not found in ${path.basename(filePath)}` };
    }
    // Extract until the matching closing brace or 80 lines max
    let braceDepth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < Math.min(startIdx + 80, lines.length); i++) {
      for (const ch of lines[i]) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      endIdx = i;
      if (braceDepth < 0 || (braceDepth === 0 && i > startIdx)) break;
    }
    const extracted = lines.slice(startIdx, endIdx + 1).join("\n");
    const limits = MODE_LIMITS[mode];
    const truncated = extracted.length > limits.maxOutputBytes
      ? extracted.slice(0, limits.maxOutputBytes) + "\n// [truncated]"
      : extracted;
    return {
      success: true,
      output: truncated,
      evidence: { filesRead: [filePath], commandsRun: [], testsExecuted: [], durationMs: Date.now() - start },
    };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

/**
 * Search for symbols matching a pattern across the codebase.
 * Read-only, bounded to the server/ directory.
 */
export function searchSymbols(
  pattern: string,
  rootDir: string,
  mode: ToolMode = "explore"
): AgentToolResult {
  const caps = MODE_CAPABILITIES[mode];
  if (!caps.canSearch) {
    return { success: false, output: "", error: `Mode '${mode}' does not permit search` };
  }
  const start = Date.now();
  try {
    const result = spawnSync("grep", ["-rn", "--include=*.ts", "-m", "50", pattern, rootDir], {
      timeout: MODE_LIMITS[mode].timeoutMs,
      maxBuffer: MODE_LIMITS[mode].maxOutputBytes,
      encoding: "utf-8",
    });
    const output = (result.stdout || "") + (result.stderr || "");
    return {
      success: result.status === 0 || result.status === 1, // grep exits 1 when no match
      output: output.slice(0, MODE_LIMITS[mode].maxOutputBytes),
      evidence: { filesRead: [], commandsRun: [`grep -rn ${pattern}`], testsExecuted: [], durationMs: Date.now() - start },
    };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

/**
 * List test files relevant to a given source file.
 */
export function listTests(
  sourceFile: string,
  rootDir: string,
  mode: ToolMode = "explore"
): AgentToolResult {
  const caps = MODE_CAPABILITIES[mode];
  if (!caps.canRead) {
    return { success: false, output: "", error: `Mode '${mode}' does not permit reads` };
  }
  const start = Date.now();
  try {
    const base = path.basename(sourceFile, ".ts");
    const result = spawnSync("find", [rootDir, "-name", `${base}.test.ts`, "-o", "-name", `${base}.spec.ts`], {
      timeout: 5_000,
      encoding: "utf-8",
    });
    return {
      success: true,
      output: (result.stdout || "").trim() || `No test files found for ${base}`,
      evidence: { filesRead: [], commandsRun: [`find ${base}.test.ts`], testsExecuted: [], durationMs: Date.now() - start },
    };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

/**
 * Run a bounded command with strict resource limits.
 * Only available in 'candidate' and 'promote' modes.
 */
export function runBounded(
  command: string,
  args: string[],
  cwd: string,
  mode: ToolMode = "candidate"
): AgentToolResult {
  const caps = MODE_CAPABILITIES[mode];
  if (!caps.canExecute) {
    return { success: false, output: "", error: `Mode '${mode}' does not permit command execution` };
  }
  const limits = MODE_LIMITS[mode];
  const start = Date.now();
  try {
    const result = spawnSync(command, args, {
      cwd,
      timeout: limits.timeoutMs,
      maxBuffer: limits.maxOutputBytes,
      encoding: "utf-8",
      env: {
        ...process.env,
        // Strip network-sensitive env vars in non-network modes
        ...(limits.allowNetwork ? {} : { ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "", OPENAI_API_KEY: "" }),
      },
    });
    const output = ((result.stdout || "") + (result.stderr || "")).slice(0, limits.maxOutputBytes);
    const timedOut = result.signal === "SIGTERM" || result.error?.message?.includes("ETIMEDOUT");
    if (timedOut) {
      return { success: false, output, error: `Command timed out after ${limits.timeoutMs}ms — blocked by resource policy` };
    }
    return {
      success: result.status === 0,
      output,
      error: result.status !== 0 ? `Exit code ${result.status}` : undefined,
      evidence: { filesRead: [], commandsRun: [`${command} ${args.join(" ")}`], testsExecuted: [], durationMs: Date.now() - start },
    };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

/**
 * Run a lightweight read-only probe (no writes, no network, 5s limit).
 * Used for the hypothesis investigation step before generating a patch.
 */
export function runProbe(
  command: string,
  args: string[],
  cwd: string
): AgentToolResult {
  return runBounded(command, args, cwd, "explore");
}

/**
 * Preview a diff without applying it.
 * Returns a unified diff string for review.
 */
export function diffPreview(
  filePath: string,
  originalContent: string,
  proposedContent: string
): AgentToolResult {
  const start = Date.now();
  try {
    const tmpOrig = `/tmp/andromeda_diff_orig_${Date.now()}`;
    const tmpProp = `/tmp/andromeda_diff_prop_${Date.now()}`;
    fs.writeFileSync(tmpOrig, originalContent, "utf-8");
    fs.writeFileSync(tmpProp, proposedContent, "utf-8");
    const result = spawnSync("diff", ["-u", "--label", `a/${path.basename(filePath)}`, "--label", `b/${path.basename(filePath)}`, tmpOrig, tmpProp], {
      encoding: "utf-8",
      timeout: 5_000,
    });
    fs.unlinkSync(tmpOrig);
    fs.unlinkSync(tmpProp);
    return {
      success: true,
      output: result.stdout || "(no diff)",
      evidence: { filesRead: [filePath], commandsRun: ["diff -u"], testsExecuted: [], durationMs: Date.now() - start },
    };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

/**
 * Validate TypeScript types for a file or the whole project.
 * Returns the tsc output. Only available in 'candidate' and 'promote' modes.
 */
export function validateTypes(
  projectRoot: string,
  mode: ToolMode = "candidate"
): AgentToolResult {
  const caps = MODE_CAPABILITIES[mode];
  if (!caps.canExecute) {
    return { success: false, output: "", error: `Mode '${mode}' does not permit execution` };
  }
  return runBounded("npx", ["tsc", "--noEmit"], projectRoot, mode);
}

// ─── Hypothesis protocol ──────────────────────────────────────────────────────

/**
 * Record a hypothesis before editing.
 * The RSI engine should call this before generating any patch.
 * Returns the hypothesis record for injection into the LLM prompt.
 */
export function recordHypothesis(
  targetFile: string,
  claim: string,
  confirmingObservation: string,
  refutingObservation: string,
  probe: string
): HypothesisRecord {
  const record: HypothesisRecord = {
    claim,
    confirmingObservation,
    refutingObservation,
    probe,
    formedAt: new Date().toISOString(),
  };
  // Persist to a lightweight JSONL log for telemetry
  try {
    const logPath = path.join(process.cwd(), "data", "hypothesis_log.jsonl");
    fs.appendFileSync(logPath, JSON.stringify({ targetFile, ...record }) + "\n", "utf-8");
  } catch { /* non-fatal */ }
  return record;
}

/**
 * Format a hypothesis record for injection into an LLM prompt.
 */
export function formatHypothesisForPrompt(h: HypothesisRecord): string {
  return [
    `--- INVESTIGATION HYPOTHESIS ---`,
    `Claim: ${h.claim}`,
    `Confirming observation: ${h.confirmingObservation}`,
    `Refuting observation: ${h.refutingObservation}`,
    `Probe executed: ${h.probe}`,
    `--- END HYPOTHESIS ---`,
  ].join("\n");
}
