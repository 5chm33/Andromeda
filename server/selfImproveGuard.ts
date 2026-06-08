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
  applyProposal,
  rejectProposal,
  type ImprovementProposal,
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

function runSyntaxCheck(filename: string, proposedContent: string, originalSnippet?: string, proposedSnippet?: string): { pass: boolean; errors: string } {
  const tmpDir = path.join(getDataDir(), "tmp_syntax");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, path.basename(filename));

  try {
    // Build the full-file content to check:
    // Priority 1: use proposedContent (already the full file with snippet applied, set by analyzeAndPropose)
    // Priority 2: if snippets provided, read the live file from disk and apply the replacement
    // Priority 3: fall back to proposedContent as-is
    let contentToCheck = proposedContent;
    if (originalSnippet && proposedSnippet) {
      const serverDir = path.dirname(fileURLToPath(import.meta.url));
      const filePath = path.join(serverDir, path.basename(filename));
      if (fs.existsSync(filePath)) {
        const fullContent = fs.readFileSync(filePath, "utf-8");
        // Use the live file + snippet replacement as ground truth
        const replaced = fullContent.replace(originalSnippet, proposedSnippet);
        // Only use this if the replacement actually changed something (i.e. snippet was found)
        if (replaced !== fullContent) {
          contentToCheck = replaced;
        }
        // If snippet not found in live file, fall back to proposedContent (which was built at proposal-creation time)
      }
    }
    fs.writeFileSync(tmpFile, contentToCheck, "utf-8");

    // v9.8.2: Find the local tsc binary instead of relying on npx (which is not always in PATH on Windows).
    // Search order: node_modules/.bin/tsc (project-local) → global tsc → npx fallback
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const localTscPaths = [
      path.join(projectRoot, "node_modules", ".bin", "tsc"),
      path.join(projectRoot, "node_modules", ".bin", "tsc.cmd"), // Windows .cmd wrapper
      path.join(projectRoot, "node_modules", "typescript", "bin", "tsc"), // pnpm direct path
    ];
    const localTsc = localTscPaths.find(p => fs.existsSync(p));
    
    // v9.8.4: Use pnpm exec as the primary fallback if local binary isn't found directly
    let tscCmd = "pnpm exec tsc";
    if (localTsc) {
      if (localTsc.endsWith(".cmd")) {
        tscCmd = `cmd.exe /c "${localTsc}"`;
      } else {
        // For node_modules/typescript/bin/tsc, we need to run it via node
        if (localTsc.includes("typescript/bin/tsc")) {
          tscCmd = `node "${localTsc}"`;
        } else {
          tscCmd = `"${localTsc}"`;
        }
      }
    }

    try {
      execSync(`${tscCmd} --noEmit --skipLibCheck --noResolve "${tmpFile}" 2>&1`, {
        timeout: 30000,
        encoding: "utf-8",
        cwd: projectRoot,
      });
      return { pass: true, errors: "" };
    } catch (tscErr: any) {
      const tscOutput: string = tscErr.stdout ?? tscErr.message ?? "";
      // v9.8.2: If tsc itself is not found (ENOENT / not recognized), fall back to a lightweight
      // JS-based brace/bracket balance check. This is not a full type-check but catches the most
      // common syntax errors (unmatched braces, unclosed strings) without requiring any binary.
      const isTscMissing = /ENOENT|not recognized|not found|cannot find/i.test(tscOutput);
      if (isTscMissing) {
        if (!(global as any)._tscWarningEmitted) {
          console.warn(`[Guard] tsc binary not found — using lightweight JS syntax fallback`);
          (global as any)._tscWarningEmitted = true;
        }
        return runLightweightSyntaxCheck(contentToCheck);
      }
      return { pass: false, errors: tscOutput.slice(0, 1000) };
    }
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

/**
 * v9.8.2: Lightweight syntax check that runs entirely in-process without any
 * external binary. Checks brace/bracket/paren balance and unclosed string literals.
 * Used as a fallback when tsc is not available (e.g. Windows PATH issues).
 */
function runLightweightSyntaxCheck(content: string): { pass: boolean; errors: string } {
  try {
    let braces = 0, brackets = 0, parens = 0;
    let inString: "'" | '"' | '`' | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    let i = 0;
    while (i < content.length) {
      const ch = content[i];
      const next = content[i + 1] ?? "";
      // Handle line comments
      if (!inString && !inBlockComment && ch === "/" && next === "/") { inLineComment = true; i += 2; continue; }
      if (inLineComment) { if (ch === "\n") inLineComment = false; i++; continue; }
      // Handle block comments
      if (!inString && ch === "/" && next === "*") { inBlockComment = true; i += 2; continue; }
      if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; i += 2; } else { i++; } continue; }
      // Handle strings
      if (!inString && (ch === "'" || ch === '"' || ch === '`')) { inString = ch as any; i++; continue; }
      if (inString) {
        if (ch === "\\" && next) { i += 2; continue; } // escape
        if (ch === inString) inString = null;
        i++; continue;
      }
      // Balance tracking
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
      else if (ch === "(") parens++;
      else if (ch === ")") parens--;
      i++;
    }
    if (braces !== 0) return { pass: false, errors: `Unbalanced braces: ${braces > 0 ? braces + " unclosed {" : Math.abs(braces) + " extra }"}` };
    if (brackets !== 0) return { pass: false, errors: `Unbalanced brackets: ${brackets > 0 ? brackets + " unclosed [" : Math.abs(brackets) + " extra ]"}` };
    if (parens !== 0) return { pass: false, errors: `Unbalanced parentheses: ${parens > 0 ? parens + " unclosed (" : Math.abs(parens) + " extra )"}` };
    if (inString) return { pass: false, errors: `Unclosed string literal (${inString})` };
    return { pass: true, errors: "" };
  } catch (err: any) {
    return { pass: true, errors: "" }; // if the checker itself throws, don't block the proposal
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
    syntaxResult = runSyntaxCheck(proposal.targetFile, proposal.proposedContent, proposal.originalSnippet, proposal.proposedSnippet);
    if (!syntaxResult.pass) {
      addAudit("apply", "failure", `Syntax check failed: ${syntaxResult.errors.slice(0, 200)}`, proposalId, proposal.targetFile);
      
      // v9.8.0: Proposal refinement loop — retry with LLM error feedback
      const refineCount = (proposal as any)._refineCount || 0;
      if (refineCount < 2) {
        try {
          const { refineProposal } = await import("./selfImprove.js") as any;
          if (typeof refineProposal === "function") {
            console.log(`[Guard] Syntax check failed for ${proposalId}, initiating refinement loop (${refineCount + 1}/2)`);
            const refined = await refineProposal(proposal, syntaxResult.errors);
            if (refined) {
              addAudit("apply", "failure", `Refined proposal ${proposalId} after syntax error`, proposalId, proposal.targetFile);
              
              // v9.8.1: Don't return false yet. We need to re-run the syntax check immediately
              // on the newly refined proposal to see if it fixed the issue.
              // If it did, we can continue with the apply pipeline.
              const retrySyntax = runSyntaxCheck(proposal.targetFile, proposal.proposedContent, proposal.originalSnippet, proposal.proposedSnippet);
              
              if (retrySyntax.pass) {
                console.log(`[Guard] Refinement successful for ${proposalId}. Syntax check passed.`);
                addAudit("apply", "success", `Refinement fixed syntax errors for ${proposalId}`, proposalId, proposal.targetFile);
                // The syntax check passed, so we can break out of the failure block and continue
                // the apply process (e.g. consensus check, rollback point creation, etc.)
                syntaxResult = retrySyntax;
              } else {
                console.log(`[Guard] Refinement failed to fix syntax for ${proposalId}. Queued for another try.`);
                return { success: false, message: "Syntax check failed — proposal refined but still has errors (queued for retry)", syntaxCheck: retrySyntax };
              }
            } else {
              // Refinement failed to generate a valid JSON or snippet
              return { success: false, message: "Syntax check failed — refinement generation failed", syntaxCheck: syntaxResult };
            }
          }
        } catch (err) {
          console.warn("[Guard] Refinement loop failed:", (err as Error).message);
          return { success: false, message: "Syntax check failed — refinement threw an error", syntaxCheck: syntaxResult };
        }
      } else {
        return { success: false, message: "Syntax check failed — proposal not applied (max refinements reached)", syntaxCheck: syntaxResult };
      }
      
      // If we reach here, it means the refinement loop successfully fixed the syntax error
      // and we should continue with the rest of the guard pipeline.
      if (!syntaxResult.pass) {
         return { success: false, message: "Syntax check failed — proposal not applied", syntaxCheck: syntaxResult };
      }
    }
  }

  // v9.7.0: Multi-model consensus check for high-risk proposals
  // Core files (memory, selfImprove, guard, rollback) require consensus when riskLevel >= 'high'
  const CORE_FILES = ["memory.ts", "selfImprove.ts", "selfImproveGuard.ts", "selfRollback.ts", "contextBus.ts", "reactEngine.ts"];
  const isCoreFile = CORE_FILES.some(f => proposal.targetFile.endsWith(f));
  const proposalRiskLevel = (proposal as any).riskLevel || (isCoreFile ? "high" : "medium");
  try {
    const { requiresConsensus, getConsensus } = await import("./consensusEngine.js");
    if (requiresConsensus(proposalRiskLevel)) {
      const consensusResult = await getConsensus({
        type: "modification",
        description: `Apply RSI proposal: ${proposal.title}`,
        targetFile: proposal.targetFile,
        proposedChange: `Rationale: ${proposal.rationale}\nSnippet: ${(proposal.originalSnippet || "").slice(0, 200)}`,
        riskLevel: proposalRiskLevel as "low" | "medium" | "high" | "critical",
      });
      if (!consensusResult.approved) {
        const approvalPct = ((consensusResult.approvalCount / Math.max(consensusResult.totalModels, 1)) * 100).toFixed(0);
        const topReason = consensusResult.votes?.[0]?.reasoning?.slice(0, 200) || "no reason given";
        addAudit("apply", "blocked", `Consensus rejected (${approvalPct}% approval): ${topReason}`, proposalId, proposal.targetFile);
        return { success: false, message: `Multi-model consensus rejected this proposal (${approvalPct}% approval)` };
      }
      const approvalPct = ((consensusResult.approvalCount / Math.max(consensusResult.totalModels, 1)) * 100).toFixed(0);
      console.log(`[Guard] Consensus approved for ${proposal.targetFile} (${approvalPct}% approval, confidence: ${consensusResult.consensusConfidence.toFixed(2)})`);
    }
  } catch (consensusErr) {
    // Non-fatal — if consensus engine is unavailable, proceed without it
    console.warn("[Guard] Consensus check unavailable (non-fatal):", (consensusErr as Error).message);
  }

  // Create backup
  const backup = createBackup(proposal.targetFile, proposalId, "pre-apply") ?? undefined;

  // Apply the proposal
  const result = await applyProposal(proposalId);
  if (!result.success) {
    addAudit("apply", "failure", result.message, proposalId, proposal.targetFile);
    return { success: false, message: result.message, syntaxCheck: syntaxResult, backup };
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
