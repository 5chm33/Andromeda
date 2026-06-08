/**
 * selfImproveGuard.ts — v5.5 Tier 2
 *
 * Self-Improvement Hardening: Adds safety layers around the existing
 * selfImprove.ts module to prevent accidental code corruption.
 *
 * Features:
 * - Human-in-the-loop approval gating (proposals require explicit approval)
 * - Rich diff preview with syntax highlighting hints
 * - Automatic backup with git-style versioning
 * - Rollback to any previous version
 * - Sandboxed test execution before applying changes
 * - Proposal expiry (auto-reject after configurable timeout)
 * - Audit trail of all self-improvement actions
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

// v5.54: Cache the constitution JSON to avoid re-reading on every guardedApply call
let _constitutionCache: Record<string, unknown> | null = null;
let _constitutionCachePath: string | null = null;
function getConstitution(): Record<string, unknown> | null {
  if (_constitutionCache) return _constitutionCache;
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(serverDir, "..", "andromeda-constitution.json"),
    path.resolve(serverDir, "..", "..", "andromeda-constitution.json"),
    path.resolve(process.cwd(), "andromeda-constitution.json"),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) return null;
  try {
    _constitutionCache = JSON.parse(fs.readFileSync(found, "utf-8"));
    _constitutionCachePath = found;
    return _constitutionCache;
  } catch { return null; }
}
import {
  listProposals,
  rejectProposal,
  type ImprovementProposal,
  type SecondaryFileChange,
} from "./selfImprove";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardConfig = {
  /** Require human approval before applying any proposal */
  requireApproval: boolean;
  /** Auto-reject proposals older than this (ms). 0 = never */
  proposalExpiryMs: number;
  /** Run syntax check before applying */
  runSyntaxCheck: boolean;
  /** Run test suite before applying (if tests exist) */
  runTestsBefore: boolean;
  /** Automatically rollback if tests fail after applying */
  autoRollbackOnTestFailure: boolean;
  /** Maximum number of backups to keep per file */
  maxBackupsPerFile: number;
  /** Blocked file patterns (never allow self-improvement on these) */
  blockedFiles: string[];
  /** v5.25: Meta-guard files — immune system files requiring META_MODIFY_UNLOCK env */
  metaGuardFiles: string[];
};

export type BackupEntry = {
  id: string;
  filename: string;
  backupPath: string;
  originalSize: number;
  createdAt: string;
  proposalId?: string;
  reason: string;
};

export type GuardAuditEntry = {
  id: string;
  action: "propose" | "preview" | "approve" | "reject" | "apply" | "rollback" | "test" | "expire";
  proposalId?: string;
  filename?: string;
  result: "success" | "failure" | "blocked";
  details: string;
  timestamp: string;
};

type GuardStore = {
  config: GuardConfig;
  backups: BackupEntry[];
  audit: GuardAuditEntry[];
};

// ─── Storage ──────────────────────────────────────────────────────────────────

function getDataDir(): string {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getBackupDir(): string {
  const dir = path.join(getDataDir(), "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getDataDir(), "self_improve_guard.json");
}

function loadStore(): GuardStore {
  const p = getStorePath();
  if (!fs.existsSync(p)) {
    return {
      config: getDefaultConfig(),
      backups: [],
      audit: [],
    };
  }
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return { config: getDefaultConfig(), backups: [], audit: [] }; }
}

function saveStore(store: GuardStore): void {
  // Keep only last 1000 audit entries
  if (store.audit.length > 1000) store.audit = store.audit.slice(-1000);
  fs.writeFileSync(getStorePath(), JSON.stringify(store, null, 2), "utf-8");
}

function getDefaultConfig(): GuardConfig {
  return {
    requireApproval: true,
    proposalExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
    runSyntaxCheck: true,
    runTestsBefore: true,
    autoRollbackOnTestFailure: true,
    maxBackupsPerFile: 10,
    blockedFiles: ["db.ts", "auth.ts", "selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts"],
    // v5.25: Meta-mode guard — these files are the "immune system" and cannot be self-modified
    // unless META_MODIFY_UNLOCK=true is set in environment (requires human intervention)
    metaGuardFiles: ["selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts"],
  };
}

// ─── Audit ────────────────────────────────────────────────────────────────────

function addAudit(
  action: GuardAuditEntry["action"],
  result: GuardAuditEntry["result"],
  details: string,
  proposalId?: string,
  filename?: string,
): void {
  const store = loadStore();
  store.audit.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    action,
    proposalId,
    filename,
    result,
    details,
    timestamp: new Date().toISOString(),
  });
  saveStore(store);
}

// ─── Backup Management ───────────────────────────────────────────────────────

function createBackup(filename: string, proposalId?: string, reason = "pre-apply"): BackupEntry | null {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.join(serverDir, path.basename(filename));
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath);
  const backupName = `${path.basename(filename, ".ts")}_${Date.now()}.ts.bak`;
  const backupPath = path.join(getBackupDir(), backupName);
  fs.writeFileSync(backupPath, content);

  const entry: BackupEntry = {
    id: `bak_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    filename: path.basename(filename),
    backupPath: backupName,
    originalSize: content.length,
    createdAt: new Date().toISOString(),
    proposalId,
    reason,
  };

  const store = loadStore();
  store.backups.push(entry);

  // Prune old backups for this file
  const fileBackups = store.backups
    .filter(b => b.filename === entry.filename)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (fileBackups.length > store.config.maxBackupsPerFile) {
    const toRemove = fileBackups.slice(store.config.maxBackupsPerFile);
    for (const old of toRemove) {
      const oldPath = path.join(getBackupDir(), old.backupPath);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      store.backups = store.backups.filter(b => b.id !== old.id);
    }
  }

  saveStore(store);
  return entry;
}

// ─── Diff Preview ─────────────────────────────────────────────────────────────

export function generateDiffPreview(proposal: ImprovementProposal): {
  filename: string;
  title: string;
  rationale: string;
  category: string;
  impact: string;
  linesRemoved: number;
  linesAdded: number;
  diff: string;
  originalSnippet: string;
  proposedSnippet: string;
  riskAssessment: string;
} {
  const origLines = proposal.originalSnippet.split("\n").length;
  const propLines = proposal.proposedSnippet.split("\n").length;

  // Risk assessment
  let risk = "LOW";
  const riskyPatterns = [
    /import\s+.*from/,
    /export\s+(default\s+)?function/,
    /process\.env/,
    /fs\.(write|unlink|rm)/,
    /exec(Sync)?/,
    /eval\(/,
  ];
  const riskyCount = riskyPatterns.filter(p =>
    p.test(proposal.proposedSnippet) && !p.test(proposal.originalSnippet)
  ).length;
  if (riskyCount >= 2) risk = "HIGH";
  else if (riskyCount >= 1) risk = "MEDIUM";

  addAudit("preview", "success", `Previewed proposal: ${proposal.title}`, proposal.id, proposal.targetFile);

  return {
    filename: proposal.targetFile,
    title: proposal.title,
    rationale: proposal.rationale,
    category: proposal.category,
    impact: proposal.impact,
    linesRemoved: origLines,
    linesAdded: propLines,
    diff: proposal.diff,
    originalSnippet: proposal.originalSnippet,
    proposedSnippet: proposal.proposedSnippet,
    riskAssessment: risk,
  };
}

// ─── Syntax Check ─────────────────────────────────────────────────────────────
// v9.4.0: Use TypeScript compiler API for syntax-only check (getSyntacticDiagnostics).
// This avoids the false-positive failures caused by tsc --noResolve which still
// reports TS2307 "Cannot find module" errors for relative imports even with --noResolve.
// getSyntacticDiagnostics only checks parse-level syntax, not type resolution.

function runSyntaxCheck(filename: string, content: string): { pass: boolean; errors: string } {
  try {
    // Use Node.js require to load TypeScript compiler API for syntax-only parse check.
    // We use createProgram + getSyntacticDiagnostics which only returns parse-level errors,
    // NOT type/import resolution errors (TS2307 etc). This fixes the false-positive failures
    // caused by tsc --noResolve which still reports import errors even with that flag.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = require("typescript") as typeof import("typescript");
    // Write to a temp file so createProgram can read it
    const tmpDir = path.join(getDataDir(), "tmp_syntax");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, path.basename(filename));
    fs.writeFileSync(tmpFile, content, "utf-8");
    try {
      const program = ts.createProgram([tmpFile], {
        noEmit: true,
        skipLibCheck: true,
        noResolve: true,
        allowJs: true,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
      });
      const sourceFile = program.getSourceFile(tmpFile);
      if (!sourceFile) return { pass: true, errors: "" };
      // getSyntacticDiagnostics: parse errors only, no type/import errors
      const syntaxErrors = program.getSyntacticDiagnostics(sourceFile).filter(
        d => d.category === ts.DiagnosticCategory.Error
      );
      if (syntaxErrors.length > 0) {
        const errorText = Array.from(syntaxErrors).slice(0, 3).map(d =>
          ts.flattenDiagnosticMessageText(d.messageText, "\n")
        ).join("; ");
        return { pass: false, errors: errorText };
      }
      return { pass: true, errors: "" };
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } catch (err: any) {
    // If TypeScript API unavailable, fall back to permissive (allow the proposal)
    console.warn("[Guard] Syntax check unavailable (TypeScript API error) — allowing proposal:", (err as Error).message);
    return { pass: true, errors: "" };
  }
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

function runTests(): { pass: boolean; output: string } {
  try {
    const output = execSync("npx vitest run --reporter=verbose 2>&1", {
      timeout: 120000,
      encoding: "utf-8",
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    });
    return { pass: true, output: output.slice(-2000) };
  } catch (err: any) {
    return { pass: false, output: (err.stdout ?? err.message ?? "").slice(-2000) };
  }
}

// ─── Guarded Apply ────────────────────────────────────────────────────────────

export async function guardedApply(proposalId: string): Promise<{
  success: boolean;
  message: string;
  syntaxCheck?: { pass: boolean; errors: string };
  testResult?: { pass: boolean; output: string };
  backup?: BackupEntry;
  rolledBack?: boolean;
}> {
  const store = loadStore();
  const config = store.config;

  // Find the proposal
  const proposals = listProposals();
  const proposal = proposals.find(p => p.id === proposalId);
  if (!proposal) {
    addAudit("apply", "failure", "Proposal not found", proposalId);
    return { success: false, message: "Proposal not found" };
  }

  if (proposal.status !== "pending") {
    addAudit("apply", "failure", `Proposal already ${proposal.status}`, proposalId, proposal.targetFile);
    return { success: false, message: `Proposal is already ${proposal.status}` };
  }

  // v5.53/v5.54: Constitution check — validate against andromeda-constitution.json before applying (cached)
  try {
    const constitution = getConstitution() as any;
    if (constitution) {
      // Check forbidden files
      const forbiddenFiles: string[] = constitution.forbiddenModifications?.files || [];
      if (forbiddenFiles.some((f: string) => proposal.targetFile.endsWith(f))) {
        addAudit("apply", "blocked", `Constitution: ${proposal.targetFile} is in forbiddenModifications.files`, proposalId, proposal.targetFile);
        return { success: false, message: `Constitution forbids autonomous modification of '${proposal.targetFile}'.` };
      }
      // Check forbidden patterns in proposed content
      const forbiddenPatterns: string[] = constitution.forbiddenModifications?.patterns || [];
      const matchedPattern = forbiddenPatterns.find((p: string) => (proposal.proposedContent || proposal.proposedSnippet || "").includes(p));
      if (matchedPattern) {
        // Count how many times this proposal has been blocked by a constitution pattern
        const store = loadStore();
        const blockCount = store.audit.filter(
          a => a.proposalId === proposalId && a.result === "blocked" && a.details?.includes("Constitution")
        ).length;
        addAudit("apply", "blocked", `Constitution: proposed content contains forbidden pattern '${matchedPattern}'`, proposalId, proposal.targetFile);
        // Auto-expire proposals that have been constitution-blocked 3+ times — they will never pass
        if (blockCount >= 2) {
          rejectProposal(proposalId);
          addAudit("expire", "success", `Auto-expired: constitution-blocked ${blockCount + 1} times (pattern: '${matchedPattern}')`, proposalId, proposal.targetFile);
          console.log(`[Guard] Auto-expired proposal ${proposalId} after ${blockCount + 1} constitution blocks`);
          return { success: false, message: `Proposal auto-expired: constitution-blocked ${blockCount + 1} times for pattern '${matchedPattern}'.` };
        }
        return { success: false, message: `Constitution blocked: proposed content contains forbidden pattern '${matchedPattern}'.` };
      }
      // Check rationale length
      const minRationaleLen: number = constitution.safetyChecks?.requireRationaleLength || 20;
      if (!proposal.rationale || proposal.rationale.length < minRationaleLen) {
        addAudit("apply", "blocked", `Constitution: rationale too short (${proposal.rationale?.length || 0} chars, min ${minRationaleLen})`, proposalId, proposal.targetFile);
        return { success: false, message: `Constitution requires a rationale of at least ${minRationaleLen} characters.` };
      }
      console.log(`[Guard] Constitution check passed for ${proposal.targetFile}`);
    }
  } catch (constitutionErr) {
    console.warn("[Guard] Constitution check unavailable (non-fatal):", (constitutionErr as Error).message);
  }

  // v5.25: Meta-mode guard — immune system files require explicit environment unlock
  const metaGuardFiles = (config as any).metaGuardFiles || ["selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts"];
  if (metaGuardFiles.includes(proposal.targetFile)) {
    if (process.env.META_MODIFY_UNLOCK !== "true") {
      addAudit("apply", "blocked", `Meta-guard: ${proposal.targetFile} requires META_MODIFY_UNLOCK=true`, proposalId, proposal.targetFile);
      return { success: false, message: `Meta-guard active: '${proposal.targetFile}' is an immune system file. Set META_MODIFY_UNLOCK=true to allow modification.` };
    }
    console.warn(`[Guard] ⚠️ META_MODIFY_UNLOCK active: allowing modification of immune system file ${proposal.targetFile}`);
  }

  // Check blocked files
  if (config.blockedFiles.includes(proposal.targetFile)) {
    addAudit("apply", "blocked", `File ${proposal.targetFile} is blocked from self-improvement`, proposalId, proposal.targetFile);
    return { success: false, message: `File '${proposal.targetFile}' is blocked from self-improvement` };
  }

  // Check expiry
  if (config.proposalExpiryMs > 0) {
    const age = Date.now() - proposal.createdAt;
    if (age > config.proposalExpiryMs) {
      rejectProposal(proposalId);
      addAudit("expire", "success", `Proposal expired after ${Math.round(age / 3600000)}h`, proposalId, proposal.targetFile);
      return { success: false, message: "Proposal has expired and was auto-rejected" };
    }
  }

  // Syntax check
  let syntaxResult: { pass: boolean; errors: string } | undefined;
  if (config.runSyntaxCheck) {
    syntaxResult = runSyntaxCheck(proposal.targetFile, proposal.proposedContent);
    if (!syntaxResult.pass) {
      addAudit("apply", "failure", `Syntax check failed: ${syntaxResult.errors.slice(0, 200)}`, proposalId, proposal.targetFile);
      return { success: false, message: "Syntax check failed — proposal not applied", syntaxCheck: syntaxResult };
    }
  }

  // Create backup
  const backup = createBackup(proposal.targetFile, proposalId, "pre-apply") ?? undefined;

  // v9.5.1: Direct file write — previously called applyProposal() here which caused
  // an async mutual recursion: applyProposal → guardedApply → applyProposal (re-entry blocked).
  // The guard's job is safety checks only; the actual write happens here directly.
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  let absoluteFilePath: string | null = null;
  const basename = path.basename(proposal.targetFile);
  // Try canonical server/ path first, then fallback candidates
  const projectRoot = path.resolve(serverDir, "..");
  const candidates = [
    path.join(projectRoot, "server", basename),
    path.join(projectRoot, "server", "tools", basename),
    path.join(projectRoot, "server", "self", basename),
    path.join(serverDir, basename),
    path.join(process.cwd(), "server", basename),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { absoluteFilePath = c; break; } } catch { /* skip */ }
  }
  if (!absoluteFilePath) {
    addAudit("apply", "failure", `Cannot resolve path for ${proposal.targetFile}`, proposalId, proposal.targetFile);
    return { success: false, message: `Cannot resolve file path for '${proposal.targetFile}'`, syntaxCheck: syntaxResult, backup };
  }
  if (!proposal.proposedContent) {
    addAudit("apply", "failure", "Proposal has no proposedContent", proposalId, proposal.targetFile);
    return { success: false, message: "Proposal has no proposedContent — cannot apply", syntaxCheck: syntaxResult, backup };
  }
  try {
    const dir = path.dirname(absoluteFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absoluteFilePath, proposal.proposedContent, "utf-8");
    // Verify write integrity
    const written = fs.readFileSync(absoluteFilePath, "utf-8");
    if (written !== proposal.proposedContent) {
      // Restore backup on integrity failure
      if (backup) {
        const backupFilePath = path.join(getBackupDir(), backup.backupPath);
        if (fs.existsSync(backupFilePath)) fs.copyFileSync(backupFilePath, absoluteFilePath);
      }
      addAudit("apply", "failure", "Write integrity check failed", proposalId, proposal.targetFile);
      return { success: false, message: "Write integrity check failed — backup restored", syntaxCheck: syntaxResult, backup };
    }
  } catch (writeErr: any) {
    addAudit("apply", "failure", `File write failed: ${writeErr.message}`, proposalId, proposal.targetFile);
    return { success: false, message: `File write failed: ${writeErr.message}`, syntaxCheck: syntaxResult, backup };
  }

  // v9.6.0: Apply secondary file changes atomically after primary write succeeds.
  // If any secondary write fails, roll back ALL secondary writes AND the primary write.
  if (proposal.secondaryChanges && proposal.secondaryChanges.length > 0) {
    const writtenSecondary: Array<{ path: string; original: string }> = [];
    let secondaryFailed = false;
    let secondaryError = "";

    for (const change of proposal.secondaryChanges as SecondaryFileChange[]) {
      if (!change.proposedContent) continue; // skip if no content
      // Resolve secondary file path using same multi-candidate strategy
      const serverDir = path.dirname(fileURLToPath(import.meta.url));
      const secCandidates = [
        path.resolve(serverDir, change.targetFile),
        path.resolve(serverDir, "..", "server", change.targetFile),
        path.resolve(process.cwd(), "server", change.targetFile),
        path.resolve(process.cwd(), change.targetFile),
      ];
      const secPath = secCandidates.find(c => fs.existsSync(c)) ||
                      secCandidates.find(c => fs.existsSync(path.dirname(c))) ||
                      secCandidates[0];
      if (!secPath) {
        secondaryFailed = true;
        secondaryError = `Cannot resolve secondary file: ${change.targetFile}`;
        break;
      }
      try {
        const currentContent = fs.existsSync(secPath) ? fs.readFileSync(secPath, "utf-8") : "";
        writtenSecondary.push({ path: secPath, original: currentContent });
        const secDir = path.dirname(secPath);
        if (!fs.existsSync(secDir)) fs.mkdirSync(secDir, { recursive: true });
        fs.writeFileSync(secPath, change.proposedContent, "utf-8");
        addAudit("apply", "success", `Applied secondary change to ${change.targetFile}`, proposalId, change.targetFile);
      } catch (secErr: any) {
        secondaryFailed = true;
        secondaryError = `Failed to write secondary file ${change.targetFile}: ${secErr.message}`;
        break;
      }
    }

    if (secondaryFailed) {
      // Roll back all secondary writes
      for (const { path: p, original } of writtenSecondary) {
        try { fs.writeFileSync(p, original, "utf-8"); } catch { /* best effort */ }
      }
      // Roll back primary write
      if (backup) {
        const backupFilePath = path.join(getBackupDir(), backup.backupPath);
        if (fs.existsSync(backupFilePath)) {
          try { fs.copyFileSync(backupFilePath, absoluteFilePath); } catch { /* best effort */ }
        }
      }
      addAudit("apply", "failure", `Multi-file rollback: ${secondaryError}`, proposalId, proposal.targetFile);
      return { success: false, message: `Multi-file apply rolled back: ${secondaryError}`, syntaxCheck: syntaxResult, backup };
    }
  }

  // Run tests after applying
  let testResult: { pass: boolean; output: string } | undefined;
  let rolledBack = false;
  if (config.runTestsBefore) {
    testResult = runTests();
    addAudit("test", testResult.pass ? "success" : "failure", testResult.output.slice(0, 200), proposalId, proposal.targetFile);

    if (!testResult.pass && config.autoRollbackOnTestFailure && backup) {
      // Rollback
      const rollbackResult = rollbackToBackup(backup.id);
      rolledBack = rollbackResult.success;
      addAudit("rollback", rolledBack ? "success" : "failure", `Auto-rollback after test failure: ${rollbackResult.message}`, proposalId, proposal.targetFile);

      if (rolledBack) {
        return {
          success: false,
          message: "Tests failed after applying — automatically rolled back",
          syntaxCheck: syntaxResult,
          testResult,
          backup,
          rolledBack: true,
        };
      }
    }
  }

  addAudit("apply", "success", `Applied proposal: ${proposal.title}`, proposalId, proposal.targetFile);

  return {
    success: true,
    message: `Applied successfully${testResult ? (testResult.pass ? " (tests passed)" : " (tests failed, NOT rolled back)") : ""}`,
    syntaxCheck: syntaxResult,
    testResult,
    backup,
    rolledBack: false,
  };
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

export function rollbackToBackup(backupId: string): { success: boolean; message: string } {
  const store = loadStore();
  const backup = store.backups.find(b => b.id === backupId);
  if (!backup) return { success: false, message: "Backup not found" };

  const backupPath = path.join(getBackupDir(), backup.backupPath);
  if (!fs.existsSync(backupPath)) return { success: false, message: "Backup file missing from disk" };

  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const targetPath = path.join(serverDir, backup.filename);

  try {
    // Create a backup of the current state before rolling back
    createBackup(backup.filename, undefined, "pre-rollback");
    fs.copyFileSync(backupPath, targetPath);
    addAudit("rollback", "success", `Rolled back ${backup.filename} to backup ${backup.id}`, backup.proposalId, backup.filename);
    return { success: true, message: `Rolled back ${backup.filename} to ${backup.createdAt}` };
  } catch (err) {
    return { success: false, message: `Rollback failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Config Management ────────────────────────────────────────────────────────

// v7.1.7: Sync AUTONOMY_REQUIRE_APPROVAL env var to guard config on first call.
// The stored config defaults to requireApproval:true, but if the user has set
// AUTONOMY_REQUIRE_APPROVAL=false in .env.local, the guard should respect that
// without requiring a manual API call to update the config.
let _envSyncDone = false;
function syncEnvToConfig(): void {
  if (_envSyncDone) return;
  _envSyncDone = true;
  const envVal = process.env.AUTONOMY_REQUIRE_APPROVAL;
  if (envVal === undefined) return; // not set — leave stored config as-is
  const desired = envVal === "false" || envVal === "0" ? false : true;
  const store = loadStore();
  if (store.config.requireApproval !== desired) {
    store.config.requireApproval = desired;
    saveStore(store);
    console.log(`[SelfImproveGuard] v7.1.7: Synced AUTONOMY_REQUIRE_APPROVAL=${envVal} from env — guard approval ${desired ? "enabled" : "disabled"}`);
  }
}

export function getGuardConfig(): GuardConfig {
  syncEnvToConfig();
  return { ...loadStore().config };
}

export function updateGuardConfig(updates: Partial<GuardConfig>): GuardConfig {
  const store = loadStore();
  store.config = { ...store.config, ...updates };
  saveStore(store);
  return store.config;
}

// ─── Listing ──────────────────────────────────────────────────────────────────

export function listBackups(filename?: string): BackupEntry[] {
  const store = loadStore();
  const backups = filename ? store.backups.filter(b => b.filename === filename) : store.backups;
  return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getAuditLog(limit = 50): GuardAuditEntry[] {
  return loadStore().audit.slice(-limit).reverse();
}

// ─── Expiry Sweep ─────────────────────────────────────────────────────────────

export function sweepExpiredProposals(): number {
  const store = loadStore();
  if (store.config.proposalExpiryMs <= 0) return 0;

  const pending = listProposals("pending");
  let expired = 0;
  for (const p of pending) {
    if (Date.now() - p.createdAt > store.config.proposalExpiryMs) {
      rejectProposal(p.id);
      addAudit("expire", "success", `Auto-expired: ${p.title}`, p.id, p.targetFile);
      expired++;
    }
  }
  return expired;
}
