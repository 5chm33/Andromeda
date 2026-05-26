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
// v5.80: Resolve the real server/ source directory.
// When running from dist/index.js, __dirname = andromeda/dist/.
// We need andromeda/server/ instead, so we check for the sibling server/ directory.
function resolveServerDir(): string {
  const here = __dirname;
  const baseName = path.basename(here);
  if (baseName === "dist" || baseName === "build") {
    // Running from bundled output — find the sibling server/ directory
    const serverSibling = path.resolve(here, "..", "server");
    if (fs.existsSync(serverSibling)) {
      return serverSibling;
    }
  }
  return here;
}
const SERVER_DIR = resolveServerDir();
const PROJECT_DIR = path.resolve(SERVER_DIR, "..");

const DEFAULT_CONFIG: PipelineConfig = {
  enabled: true,
  typecheckTimeout: 30_000,
  unittestTimeout: 60_000,
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

function runTypeCheck(): { passed: boolean; output: string } {
  try {
    const output = execSync("npx tsc --noEmit --pretty 2>&1", {
      cwd: PROJECT_DIR,
      timeout: config.typecheckTimeout,
      encoding: "utf-8",
    });
    return { passed: true, output: output || "No errors" };
  } catch (err: any) {
    const output = (err.stdout || err.stderr || err.message || "").substring(0, 3000);
    return { passed: false, output };
  }
}

function runUnitTests(): { passed: boolean; output: string } {
  try {
    const output = execSync("npx vitest run --reporter=verbose 2>&1", {
      cwd: PROJECT_DIR,
      timeout: config.unittestTimeout,
      encoding: "utf-8",
    });
    return { passed: true, output: output.substring(0, 3000) };
  } catch (err: any) {
    const output = (err.stdout || err.stderr || err.message || "").substring(0, 3000);
    // Check if tests ran but some failed vs. couldn't run at all
    if (output.includes("Tests  ") || output.includes("Test Files")) {
      return { passed: false, output };
    }
    // No test files found is OK
    if (output.includes("No test files found")) {
      return { passed: true, output: "No test files found (OK)" };
    }
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
      const typeResult = runTypeCheck();
      if (!typeResult.passed) {
        console.warn(`[Pipeline] TypeCheck FAILED. Rolling back.`);
        restoreFileSnapshots(snapshots);
        return makeResult(proposal.id, false, "typecheck", typeResult.output, startTime, snapshots.length, true);
      }
      console.log(`[Pipeline] TypeCheck passed`);
    }

    // ─── Stage 4: Unit Tests ──────────────────────────────────────────────
    if (config.requireTests) {
      const testResult = runUnitTests();
      if (!testResult.passed) {
        console.warn(`[Pipeline] Unit tests FAILED. Rolling back.`);
        restoreFileSnapshots(snapshots);
        return makeResult(proposal.id, false, "unittest", testResult.output, startTime, snapshots.length, true);
      }
      console.log(`[Pipeline] Unit tests passed`);
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
 */
export function recoverFromCrash(): { recovered: boolean; message: string } {
  if (!fs.existsSync(config.backupDir)) return { recovered: false, message: "No backup directory" };

  const backups = fs.readdirSync(config.backupDir).filter(f => f.endsWith(".json"));
  if (backups.length === 0) return { recovered: false, message: "No pending backups" };

  // If there are backup files, it means a pipeline crashed mid-execution
  // The safest action is to log and let the user decide
  console.warn(`[Pipeline] Found ${backups.length} unfinished backup(s). Manual review recommended.`);
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
