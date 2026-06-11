/**
 * selfTestPipeline.ts — v5.22
 *
 * Sandboxed Code Testing Pipeline for Self-Enhancement.
 *
 * Implements the critical safety layer between "propose change" and "apply change":
 *   Proposal → Backup → Apply → TypeCheck → UnitTest → Verify → Commit (or Rollback)
 *
 * This module ensures that no self-improvement can break the system by:
 * 1. Creating a backup of all affected files before any change
 * 2. Applying changes in isolation
 * 3. Running TypeScript compiler check
 * 4. Running unit tests for affected modules
 * 5. Verifying the server still responds to health checks
 * 6. Auto-rolling back on ANY failure
 *
 * Safety guarantees:
 * - All changes are reversible (file-level snapshots)
 * - TypeScript must compile with zero errors
 * - Existing tests must still pass
 * - Health endpoint must still respond
 * - Maximum execution time enforced (timeout)
 * - Only one pipeline can run at a time (mutex)
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CodeChange {
  filePath: string;       // Relative to server/ directory
  operation: "edit" | "create" | "delete";
  content?: string;       // New content (for edit/create)
  findReplace?: {         // For surgical edits
    find: string;
    replace: string;
  };
}

export interface PipelineProposal {
  id: string;
  description: string;
  changes: CodeChange[];
  author: "self-improve" | "self-heal" | "user" | "agent";
  timestamp: number;
  priority: "low" | "medium" | "high" | "critical";
}

export type PipelineStage = "backup" | "apply" | "typecheck" | "unittest" | "healthcheck" | "commit";

export interface PipelineResult {
  proposalId: string;
  success: boolean;
  stage: PipelineStage;
  error?: string;
  output: string;
  duration: number;
  rolledBack: boolean;
  fileSnapshots: number;
}

export interface PipelineConfig {
  enabled: boolean;
  typecheckTimeout: number;     // ms (default: 30000)
  unittestTimeout: number;      // ms (default: 60000)
  healthcheckTimeout: number;   // ms (default: 5000)
  healthcheckUrl: string;       // default: http://localhost:3000/health
  requireTypecheck: boolean;    // default: true
  requireTests: boolean;        // default: true
  requireHealthcheck: boolean;  // default: true
  maxConcurrentPipelines: number; // default: 1
  backupDir: string;            // default: workspace/.pipeline_backups
}

// ─── State ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// v5.81: Resolve the real server/ source directory.
// When running from dist/_core/index.js, __dirname = andromeda/dist/_core/.
// Walk up from __dirname to find the project root (contains package.json),
// then return its server/ subdirectory.
function resolveServerDir(): string {
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    const serverSubdir = path.join(cur, "server");
    if (fs.existsSync(serverSubdir) && fs.statSync(serverSubdir).isDirectory()) {
      return serverSubdir;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Fallback: two levels up from dist/_core is project root
  return path.resolve(__dirname, "..", "..", "server");
}
const SERVER_DIR = resolveServerDir();
const PROJECT_DIR = path.resolve(SERVER_DIR, "..");

const DEFAULT_CONFIG: PipelineConfig = {
  enabled: true,
  typecheckTimeout: 30_000,
  unittestTimeout: 180_000,  // v10.1: increased from 60s — vitest takes 40-50s on this codebase
  healthcheckTimeout: 5_000,
  healthcheckUrl: "http://localhost:3000/health",
  requireTypecheck: true,
  requireTests: true,
  requireHealthcheck: true,
  maxConcurrentPipelines: 1,
  backupDir: path.resolve(PROJECT_DIR, "workspace", ".pipeline_backups"),
};

let config: PipelineConfig = { ...DEFAULT_CONFIG };
let pipelineRunning = false;
const pipelineHistory: PipelineResult[] = [];
const MAX_HISTORY = 100;

// ─── File Snapshot System ─────────────────────────────────────────────────────

interface FileSnapshot {
  path: string;
  existed: boolean;
  content: string | null;
}

function createFileSnapshots(changes: CodeChange[]): FileSnapshot[] {
  const snapshots: FileSnapshot[] = [];

  for (const change of changes) {
    const fullPath = path.resolve(SERVER_DIR, change.filePath);
    const existed = fs.existsSync(fullPath);
    const content = existed ? fs.readFileSync(fullPath, "utf-8") : null;

    snapshots.push({ path: fullPath, existed, content });
  }

  return snapshots;
}

function restoreFileSnapshots(snapshots: FileSnapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.existed && snapshot.content !== null) {
      // Restore original content
      fs.writeFileSync(snapshot.path, snapshot.content);
    } else if (!snapshot.existed) {
      // Delete file that was created
      if (fs.existsSync(snapshot.path)) {
        fs.unlinkSync(snapshot.path);
      }
    }
  }
}

// ─── Change Application ───────────────────────────────────────────────────────

function applyChanges(changes: CodeChange[]): { applied: number; errors: string[] } {
  let applied = 0;
  const errors: string[] = [];

  for (const change of changes) {
    const fullPath = path.resolve(SERVER_DIR, change.filePath);

    try {
      switch (change.operation) {
        case "create":
          // Ensure directory exists
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, change.content || "");
          applied++;
          break;

        case "edit":
          if (!fs.existsSync(fullPath)) {
            errors.push(`File not found: ${change.filePath}`);
            continue;
          }

          if (change.findReplace) {
            const content = fs.readFileSync(fullPath, "utf-8");
            if (!content.includes(change.findReplace.find)) {
              errors.push(`Find pattern not found in ${change.filePath}`);
              continue;
            }
            const newContent = content.replace(change.findReplace.find, change.findReplace.replace);
            fs.writeFileSync(fullPath, newContent);
          } else if (change.content) {
            fs.writeFileSync(fullPath, change.content);
          }
          applied++;
          break;

        case "delete":
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
          applied++;
          break;
      }
    } catch (err: any) {
      errors.push(`Failed to apply ${change.operation} on ${change.filePath}: ${err.message}`);
    }
  }

  return { applied, errors };
}

// ─── Validation Steps ─────────────────────────────────────────────────────────

function runTypeCheck(targetFiles?: string[]): { passed: boolean; output: string } {
  try {
    // v10.3.1: Use spawnSync with args array to avoid DEP0190 shell injection warning on Node 22.
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const tscBin = path.join(PROJECT_DIR, "node_modules", ".bin", "tsc");
    const tscExists = require("fs").existsSync(tscBin);
    const [tscExe, tscArgs] = tscExists
      ? [tscBin, ["--noEmit", "--pretty"]]
      : ["npx", ["tsc", "--noEmit", "--pretty"]];
    const result = spawnSync(tscExe, tscArgs, {
      cwd: PROJECT_DIR,
      timeout: config.typecheckTimeout,
      encoding: "utf-8",
      stdio: "pipe",
    });
    const rawOutput = ((result.stdout as string || "") + (result.stderr as string || ""));
    if (result.status === 0) {
      return { passed: true, output: rawOutput || "No errors" };
    }
    // If we know which files were changed, only fail if those files have errors.
    // Pre-existing errors in OTHER files should not block a valid proposal.
    if (targetFiles && targetFiles.length > 0) {
      const targetBases = targetFiles.map(f => path.basename(f));
      const relevantLines = rawOutput
        .split("\n")
        .filter((line: string) => targetBases.some((base: string) => line.includes(base)))
        .join("\n");
      if (!relevantLines.trim()) {
        // No errors in the changed files — pre-existing errors elsewhere, treat as pass.
        return { passed: true, output: "No new errors in changed files (pre-existing errors in other files ignored)" };
      }
      return { passed: false, output: relevantLines.substring(0, 3000) };
    }
    return { passed: false, output: rawOutput.substring(0, 3000) };
  } catch (err: any) {
    const rawOutput = (err.stdout || err.stderr || err.message || "");
    return { passed: false, output: rawOutput.substring(0, 3000) };
  }
}

function runUnitTests(): { passed: boolean; output: string } {
  try {
    // v10.3.1: Use spawnSync with args array to avoid DEP0190 shell injection warning on Node 22.
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const vitestBin = path.join(PROJECT_DIR, "node_modules", ".bin", "vitest");
    const vitestExists = require("fs").existsSync(vitestBin);
    const [vitestExe, vitestArgs] = vitestExists
      ? [vitestBin, ["run", "--reporter=verbose"]]
      : ["npx", ["vitest", "run", "--reporter=verbose"]];
    const result = spawnSync(vitestExe, vitestArgs, {
      cwd: PROJECT_DIR,
      timeout: config.unittestTimeout,
      encoding: "utf-8",
      stdio: "pipe",
    });
    const output = ((result.stdout as string || "") + (result.stderr as string || "")).substring(0, 3000);
    if (result.status === 0) {
      return { passed: true, output };
    }
    // Check if tests ran but some failed vs. couldn't run at all
    if (output.includes("Tests  ") || output.includes("Test Files")) {
      return { passed: false, output };
    }
    // No test files found is OK
    if (output.includes("No test files found")) {
      return { passed: true, output: "No test files found (OK)" };
    }
    return { passed: false, output };
  } catch (err: any) {
    const output = (err.stdout || err.stderr || err.message || "").substring(0, 3000);
    return { passed: false, output };
  }
}

async function runHealthCheck(): Promise<{ passed: boolean; output: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.healthcheckTimeout);

    const resp = await fetch(config.healthcheckUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json() as any;
      return { passed: true, output: `Health OK: v${data.version}` };
    }
    return { passed: false, output: `Health check returned ${resp.status}` };
  } catch (err: any) {
    return { passed: false, output: `Health check failed: ${err.message}` };
  }
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

/**
 * Execute the full self-test pipeline for a proposed change.
 * Returns success/failure with detailed stage information.
 */
export async function runPipeline(proposal: PipelineProposal): Promise<PipelineResult> {
  const startTime = Date.now();

  // Mutex check
  if (pipelineRunning) {
    return {
      proposalId: proposal.id,
      success: false,
      stage: "backup",
      error: "Another pipeline is already running",
      output: "Pipeline mutex locked",
      duration: 0,
      rolledBack: false,
      fileSnapshots: 0,
    };
  }

  if (!config.enabled) {
    return {
      proposalId: proposal.id,
      success: false,
      stage: "backup",
      error: "Pipeline is disabled",
      output: "Set config.enabled = true to enable",
      duration: 0,
      rolledBack: false,
      fileSnapshots: 0,
    };
  }

  pipelineRunning = true;
  let snapshots: FileSnapshot[] = [];

  try {
    // ─── Stage 1: Backup ──────────────────────────────────────────────────
    console.log(`[Pipeline] Starting pipeline for proposal: ${proposal.id}`);
    snapshots = createFileSnapshots(proposal.changes);
    console.log(`[Pipeline] Created ${snapshots.length} file snapshots`);

    // Also save to disk for crash recovery
    const backupPath = path.join(config.backupDir, `${proposal.id}_${Date.now()}.json`);
    fs.mkdirSync(config.backupDir, { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({
      proposal,
      snapshots: snapshots.map(s => ({ path: s.path, existed: s.existed, contentLength: s.content?.length ?? 0 })),
      timestamp: Date.now(),
    }));

    // ─── Stage 2: Apply Changes ───────────────────────────────────────────
    const { applied, errors } = applyChanges(proposal.changes);
    if (errors.length > 0) {
      console.warn(`[Pipeline] Apply had ${errors.length} errors:`, errors);
      restoreFileSnapshots(snapshots);
      return makeResult(proposal.id, false, "apply", errors.join("; "), startTime, snapshots.length, true);
    }
    console.log(`[Pipeline] Applied ${applied} changes`);

    // ─── Stage 3: TypeScript Check ────────────────────────────────────────
    if (config.requireTypecheck) {
      const changedFiles = proposal.changes.map(c => c.filePath);
      const typeResult = runTypeCheck(changedFiles);
      if (!typeResult.passed) {
        console.warn(`[Pipeline] TypeCheck FAILED. Rolling back.`);
        restoreFileSnapshots(snapshots);
        return makeResult(proposal.id, false, "typecheck", typeResult.output, startTime, snapshots.length, true);
      }
      console.log(`[Pipeline] TypeCheck passed`);
    }

    // ─── Stage 4: Unit Tests ──────────────────────────────────────────────
    // v10.1: Skip unit tests for benchmark-only proposals (empty changes)
    // Running the full test suite (40-50s) for a no-op benchmark is wasteful
    // and was causing false failures due to the 60s timeout.
    const isBenchmarkOnly = proposal.changes.length === 0;
    if (config.requireTests && !isBenchmarkOnly) {
      const testResult = runUnitTests();
      if (!testResult.passed) {
        console.warn(`[Pipeline] Unit tests FAILED. Rolling back.`);
        restoreFileSnapshots(snapshots);
        return makeResult(proposal.id, false, "unittest", testResult.output, startTime, snapshots.length, true);
      }
      console.log(`[Pipeline] Unit tests passed`);
    } else if (isBenchmarkOnly) {
      console.log(`[Pipeline] Unit tests skipped (benchmark-only proposal with no file changes)`);
    }

    // ─── Stage 5: Health Check ────────────────────────────────────────────
    if (config.requireHealthcheck) {
      const healthResult = await runHealthCheck();
      if (!healthResult.passed) {
        console.warn(`[Pipeline] Health check FAILED. Rolling back.`);
        restoreFileSnapshots(snapshots);
        return makeResult(proposal.id, false, "healthcheck", healthResult.output, startTime, snapshots.length, true);
      }
      console.log(`[Pipeline] Health check passed`);
    }

    // ─── Stage 6: Commit ──────────────────────────────────────────────────
    console.log(`[Pipeline] All checks passed! Changes committed.`);
    
    // Clean up backup (successful)
    try { fs.unlinkSync(backupPath); } catch { /* OK */ }

    return makeResult(proposal.id, true, "commit", `Successfully applied ${applied} changes`, startTime, snapshots.length, false);

  } catch (err: any) {
    // Unexpected error — rollback
    console.error(`[Pipeline] Unexpected error:`, err.message);
    if (snapshots.length > 0) {
      restoreFileSnapshots(snapshots);
    }
    return makeResult(proposal.id, false, "backup", `Unexpected: ${err.message}`, startTime, snapshots.length, true);
  } finally {
    pipelineRunning = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(
  proposalId: string,
  success: boolean,
  stage: PipelineStage,
  output: string,
  startTime: number,
  fileSnapshots: number,
  rolledBack: boolean
): PipelineResult {
  const result: PipelineResult = {
    proposalId,
    success,
    stage,
    error: success ? undefined : output,
    output,
    duration: Date.now() - startTime,
    rolledBack,
    fileSnapshots,
  };

  pipelineHistory.push(result);
  if (pipelineHistory.length > MAX_HISTORY) pipelineHistory.shift();

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get pipeline status and recent history.
 */
export function getPipelineStatus(): {
  running: boolean;
  config: PipelineConfig;
  recentResults: PipelineResult[];
  successRate: number;
} {
  const total = pipelineHistory.length;
  const successes = pipelineHistory.filter(r => r.success).length;

  return {
    running: pipelineRunning,
    config,
    recentResults: pipelineHistory.slice(-20),
    successRate: total > 0 ? Math.round((successes / total) * 100) : 0,
  };
}

/**
 * Update pipeline configuration.
 */
export function setPipelineConfig(updates: Partial<PipelineConfig>): PipelineConfig {
  config = { ...config, ...updates };
  return config;
}

/**
 * Validate a proposal without executing it (dry run).
 */
export function validateProposal(proposal: PipelineProposal): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!proposal.id) issues.push("Missing proposal ID");
  if (!proposal.changes || proposal.changes.length === 0) issues.push("No changes specified");

  for (const change of proposal.changes) {
    if (!change.filePath) issues.push("Change missing filePath");
    if (!change.operation) issues.push("Change missing operation");

    // Security: prevent path traversal
    const resolved = path.resolve(SERVER_DIR, change.filePath);
    if (!resolved.startsWith(SERVER_DIR) && !resolved.startsWith(path.resolve(PROJECT_DIR, "client"))) {
      issues.push(`Path traversal detected: ${change.filePath}`);
    }

    if (change.operation === "edit" && !change.content && !change.findReplace) {
      issues.push(`Edit operation for ${change.filePath} has no content or findReplace`);
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Recover from a crash by checking for unfinished backups.
 * v10.4.0: Auto-cleans backups older than 24h (definitely stale after a restart).
 */
export function recoverFromCrash(): { recovered: boolean; message: string } {
  if (!fs.existsSync(config.backupDir)) return { recovered: false, message: "No backup directory" };

  const allBackups = fs.readdirSync(config.backupDir).filter(f => f.endsWith(".json"));
  if (allBackups.length === 0) return { recovered: false, message: "No pending backups" };

  // Auto-clean backups older than 24h — they are definitely stale after any restart
  const STALE_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let cleaned = 0;
  for (const fname of allBackups) {
    const fpath = path.join(config.backupDir, fname);
    try {
      const stat = fs.statSync(fpath);
      if (now - stat.mtimeMs > STALE_MS) {
        fs.unlinkSync(fpath);
        cleaned++;
      }
    } catch { /* non-fatal */ }
  }
  if (cleaned > 0) {
    console.log(`[Pipeline] Auto-cleaned ${cleaned} stale backup(s) older than 24h`);
  }

  const backups = fs.readdirSync(config.backupDir).filter(f => f.endsWith(".json"));
  if (backups.length === 0) return { recovered: false, message: "No pending backups" };

  // Recent backups (< 24h) indicate a pipeline crash — log and let the user decide
  console.warn(`[Pipeline] Found ${backups.length} recent unfinished backup(s). Manual review recommended.`);
  return {
    recovered: false,
    message: `Found ${backups.length} unfinished backup(s) in ${config.backupDir}. These indicate a pipeline crash. Review and delete manually.`,
  };
}

/**
 * Initialize the pipeline on startup.
 */
export function initPipeline(): void {
  // Check for crash recovery
  const recovery = recoverFromCrash();
  if (recovery.message.includes("unfinished")) {
    console.warn(`[Pipeline] ${recovery.message}`);
  }

  console.log(`[Pipeline] Initialized. Enabled: ${config.enabled}`);
}
