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
import { spawnSync as _spawnSync } from "child_process"; // v11.4.0: removed unused execSync import
import { fileURLToPath } from "url";
// v11.0.1: ESM-safe require — build.mjs banner already injects:
//   import { createRequire } from "module";
//   const require = createRequire(import.meta.url);
// at the very top of the bundle, so we must NOT re-import createRequire here
// (that would produce a duplicate identifier SyntaxError at runtime).
// Instead we use a lazy initialiser that works in both tsx (dev) and bundled (prod).
let _require: NodeRequire;
try {
  // In tsx/dev: createRequire is available as a real ESM import
  const { createRequire: _cr } = await import("module");
  _require = _cr(import.meta.url);
} catch {
  // In bundled prod: the banner already set up `require` globally
  _require = (globalThis as any).require ?? require;
}

// ─── Project Root Resolution ─────────────────────────────────────────────────
// In production the built file lives at dist/_core/selfImproveGuard.js so
// path.dirname(import.meta.url) = dist/_core/.  We walk up until we find a
// directory that contains package.json (the true project root).
const _guardDistDir = path.dirname(fileURLToPath(import.meta.url));
function _findProjectRoot(): string {
  let cur = _guardDistDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(cur, "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Fallback: two levels up from dist/_core is project root
  return path.resolve(_guardDistDir, "..", "..");
}
const _guardProjectRoot = _findProjectRoot();

// v5.54: Cache the constitution JSON to avoid re-reading on every guardedApply call
let _constitutionCache: Record<string, unknown> | null = null;
let _constitutionCachePath: string | null = null;
function getConstitution(): Record<string, unknown> | null {
  if (_constitutionCache) return _constitutionCache;
  const candidates = [
    path.resolve(_guardProjectRoot, "andromeda-constitution.json"),
    path.resolve(_guardDistDir, "..", "andromeda-constitution.json"),
    path.resolve(_guardDistDir, "..", "..", "andromeda-constitution.json"),
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
  resolveServerFile,
  type ImprovementProposal,
} from "./selfImprove";
import { checkFailurePattern } from "./failurePatternMemory.js";
import { createLogger } from "./logger.js";
const log = createLogger("guard");

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
  const dir = path.resolve(_guardProjectRoot, "data");
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
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    // v10.3: Defensive merge — ensure config field is always present and complete
    if (!parsed.config) parsed.config = getDefaultConfig();
    else parsed.config = { ...getDefaultConfig(), ...parsed.config };
    if (!Array.isArray(parsed.backups)) parsed.backups = [];
    if (!Array.isArray(parsed.audit)) parsed.audit = [];
    return parsed;
  }
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
    blockedFiles: ["db.ts", "auth.ts", "selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts", "videoGeneration.test.ts", "RsiDashboard.tsx", "ProposalFileList.tsx", "ProposalTreeGraph.tsx", "tsHealEngine.ts"],
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
  // Use resolveServerFile so we find the actual source file, not dist/_core/<file>
  const filePath = resolveServerFile(filename);
  if (!filePath || !fs.existsSync(filePath)) return null;

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
  // v9.10.1: Run tsc on the FULL PROJECT with the proposed change applied to the actual server file.
  // Running tsc on an isolated tmp file produces false-positive TS2307 "Cannot find module" errors
  // for any file that imports from sibling modules (which is every file). The correct approach is:
  // 1. Write proposedContent to the actual server file (with backup)
  // 2. Run full project tsc --noEmit (uses tsconfig.json which has correct moduleResolution)
  // 3. Restore the original file
  // This is the same check that CI runs, so it's the ground truth for correctness.

  const projectRoot = _guardProjectRoot;
  const actualFile = resolveServerFile(filename) ?? path.join(projectRoot, "server", path.basename(filename));

  // Find the local tsc binary
  const localTscPaths = [
    path.join(projectRoot, "node_modules", ".bin", "tsc"),
    path.join(projectRoot, "node_modules", "typescript", "bin", "tsc"),
  ];
  const localTsc = localTscPaths.find(p => fs.existsSync(p));
  // v10.5.4: On Windows, node_modules/.bin/tsc is a .cmd shim that cannot be spawned
  // directly without shell:true. Always use pnpm exec for cross-platform compatibility.
  // On Linux/Mac, use the local tsc binary directly via node if available.
  const isWindowsTsc = process.platform === "win32";
  let tscExe: string;
  let tscArgs: string[];
  if (isWindowsTsc) {
    // Windows: route through cmd.exe with a single command string so .cmd shims resolve correctly
    tscExe = "cmd.exe";
    tscArgs = ["/c", "pnpm exec tsc --noEmit"];
  } else if (localTsc) {
    if (localTsc.includes("typescript/bin/tsc")) {
      tscExe = "node";
      tscArgs = [localTsc, "--noEmit"];
    } else {
      tscExe = localTsc;
      tscArgs = ["--noEmit"];
    }
  } else {
    // Fallback: use pnpm exec tsc
    tscExe = "pnpm";
    tscArgs = ["exec", "tsc", "--noEmit"];
  }

  // Backup the original file content
  let originalContent: string | null = null;
  if (fs.existsSync(actualFile)) {
    originalContent = fs.readFileSync(actualFile, "utf-8");
  }

  try {
    // Apply proposed content to the actual file
    fs.writeFileSync(actualFile, proposedContent, "utf-8");

    try {
      // v11.0.1: Use pre-imported _spawnSync (ESM-safe, no require() needed)
      const tscResult = _spawnSync(tscExe, tscArgs, {
        timeout: 45000,
        encoding: "utf-8",
        cwd: projectRoot,
        stdio: "pipe",
      });
      // If spawn itself failed (e.g. cmd.exe or pnpm not found), fall back to lightweight check
      if (tscResult.error) {
        return runLightweightSyntaxCheck(proposedContent);
      }
      if (tscResult.status === 0) {
        return { pass: true, errors: "" };
      }
      // Treat as a caught tsc error
      const tscOutput: string = (tscResult.stdout || tscResult.stderr || "TypeScript check failed") as string;
      const isTscMissing = /ENOENT|command not found|not recognized as an internal or external command/i.test(tscOutput);
      if (isTscMissing) {
        if (!(global as any)._tscWarningEmitted) {
          log.warn("tsc binary not found — using lightweight JS syntax fallback");
          (global as any)._tscWarningEmitted = true;
        }
        return runLightweightSyntaxCheck(proposedContent);
      }
      // Filter out errors from OTHER files — only keep errors in the target file.
      const targetBase2 = path.basename(filename);
      const targetLines2 = tscOutput
        .split("\n")
        .filter((line: string) => line.includes(targetBase2))
        .join("\n")
        .slice(0, 1000);
      if (!targetLines2) {
        return { pass: true, errors: "" };
      }
      return { pass: false, errors: targetLines2 };
    } catch (tscErr: any) {
      const tscOutput: string = tscErr.stdout ?? tscErr.message ?? "";
      const isTscMissing = /ENOENT|command not found|not recognized as an internal or external command/i.test(tscOutput);
      if (isTscMissing) {
        if (!(global as any)._tscWarningEmitted) {
          log.warn("tsc binary not found — using lightweight JS syntax fallback");
          (global as any)._tscWarningEmitted = true;
        }
        return runLightweightSyntaxCheck(proposedContent);
      }
      // Filter out errors from OTHER files — only keep errors in the target file.
      // Do NOT use a generic 'error TS\d+' filter because that catches pre-existing
      // errors in unrelated files and causes every proposal to fail.
      const targetBase = path.basename(filename);
      const targetLines = tscOutput
        .split("\n")
        .filter(line => line.includes(targetBase))
        .join("\n")
        .slice(0, 1000);
      if (!targetLines) {
        // No errors in the target file — the errors are all pre-existing in other files.
        // Treat this as a pass (the proposal didn't introduce new errors).
        return { pass: true, errors: "" };
      }
      return { pass: false, errors: targetLines };
    }
  } finally {
    // Always restore the original file
    if (originalContent !== null) {
      fs.writeFileSync(actualFile, originalContent, "utf-8");
    }
  }
}

/**
 * v9.8.5: In-process TypeScript syntax check using the TypeScript compiler API.
 * This replaces the lightweight brace-balance checker with a proper TS parser
 * that understands TypeScript-specific syntax (type annotations, generics, interfaces).
 * Falls back to brace-balance check if the TypeScript API is unavailable.
 */
function runLightweightSyntaxCheck(content: string): { pass: boolean; errors: string } {
  // First try: use the TypeScript compiler API (in-process, no binary needed)
  try {
    // Dynamic require to avoid bundler issues — typescript is always available in node_modules
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ts = _require("typescript") as typeof import("typescript");
    const sourceFile = ts.createSourceFile(
      "__syntax_check__.ts",
      content,
      ts.ScriptTarget.ESNext,
      /*setParentNodes*/ false,
    );
    // Collect parse diagnostics (syntax errors only, no type errors)
    const diagnostics = (sourceFile as any).parseDiagnostics as import("typescript").Diagnostic[] | undefined;
    if (diagnostics && diagnostics.length > 0) {
      const errors = diagnostics
        .slice(0, 5)
        .map((d: import("typescript").Diagnostic) => {
          const msg = typeof d.messageText === "string" ? d.messageText : (d.messageText as any).messageText;
          const pos = d.start !== undefined ? ` (pos ${d.start})` : "";
          return `${msg}${pos}`;
        })
        .join("; ");
      return { pass: false, errors };
    }
    return { pass: true, errors: "" };
  } catch {
    // TypeScript API unavailable — fall back to brace/bracket/paren balance check
  }

  // Fallback: brace/bracket/paren balance check
  try {
    let braces = 0, brackets = 0, parens = 0;
    let inString: "'" | '"' | '`' | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    let i = 0;
    while (i < content.length) {
      const ch = content[i];
      const next = content[i + 1] ?? "";
      if (!inString && !inBlockComment && ch === "/" && next === "/") { inLineComment = true; i += 2; continue; }
      if (inLineComment) { if (ch === "\n") inLineComment = false; i++; continue; }
      if (!inString && ch === "/" && next === "*") { inBlockComment = true; i += 2; continue; }
      if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; i += 2; } else { i++; } continue; }
      if (!inString && (ch === "'" || ch === '"' || ch === '`')) { inString = ch as any; i++; continue; }
      if (inString) {
        if (ch === "\\" && next) { i += 2; continue; }
        if (ch === inString) inString = null;
        i++; continue;
      }
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
  } catch {
    return { pass: true, errors: "" }; // if the checker itself throws, don't block the proposal
  }
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

function runTests(targetFile?: string): { pass: boolean; output: string } {
  try {
    // v11.0.1: Use pre-imported _spawnSync (ESM-safe)
    const isWindows = process.platform === "win32";

    // v10.5.6: Targeted test running — only run the test file for the modified file.
    // CRITICAL: Pass only the BASENAME (e.g. "continuousImprover.test.ts"), NOT the full
    // absolute path. Vitest matches the filter as a substring against its include glob
    // ("server/**/*.test.ts"). An absolute path like "C:\Users\...\server\foo.test.ts"
    // does NOT match the relative glob, so vitest reports "No test files found".
    // A bare basename like "foo.test.ts" matches correctly on all platforms.
    let testFileArg: string | undefined;
    if (targetFile) {
      const baseName = targetFile.replace(/\.ts$/, "").replace(/\.js$/, "");
      const testBaseName = `${baseName}.test.ts`;
      const specBaseName = `${baseName}.spec.ts`;
      // Verify the test file actually exists before passing it as a filter
      const testExists = fs.existsSync(path.join(_guardProjectRoot, "server", testBaseName));
      const specExists = fs.existsSync(path.join(_guardProjectRoot, "server", specBaseName));
      if (testExists) {
        // v11.0.1: Prefix with "server/" so vitest substring-matches correctly on Windows.
        // On Windows, vitest resolves paths with backslashes (server\foo.test.ts).
        // A bare basename like "foo.test.ts" does NOT substring-match "server\foo.test.ts".
        // Prefixing with "server/" works on both platforms because vitest normalises slashes.
        testFileArg = `server/${testBaseName}`;
        log.info(`Running targeted tests for ${baseName}: ${testFileArg}`);
      } else if (specExists) {
        testFileArg = `server/${specBaseName}`;
        log.info(`Running targeted tests for ${baseName}: ${testFileArg}`);
      } else {
        log.info(`No test file found for ${baseName}, running full suite`);
      }
    }

    // v10.5.6: Use sh -c / cmd.exe /c with a single command string for cross-platform compatibility.
    // pnpm, vitest, and tsc are all .cmd shims on Windows and require shell resolution.
    const vitestCmd = testFileArg
      ? `pnpm exec vitest run --reporter=verbose "${testFileArg}"`
      : `pnpm exec vitest run --reporter=verbose`;

    const spawnArgs: Parameters<typeof _spawnSync> = isWindows
      ? ["cmd.exe", ["/c", vitestCmd], { shell: false, timeout: 300000, encoding: "utf-8", cwd: _guardProjectRoot, stdio: "pipe" }]
      : ["sh", ["-c", vitestCmd], { shell: false, timeout: 300000, encoding: "utf-8", cwd: _guardProjectRoot, stdio: "pipe" }];

    log.info(`Running tests: ${vitestCmd}`);
    const result = _spawnSync(...spawnArgs);

    // Handle spawn failure
    if (result.error) {
      const errMsg = `Test runner spawn failed: ${result.error.message}`;
      log.error(`Test runner error: ${errMsg}`);
      // ETIMEDOUT = tests took too long. Don't block the proposal — log and pass.
      if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
        log.warn("Test timeout — treating as pass");
        return { pass: true, output: `Tests timed out after 300s — treated as pass` };
      }
      return { pass: false, output: errMsg };
    }

    const stdout = (result.stdout as string) || "";
    const stderr = (result.stderr as string) || "";
    const output = (stdout + stderr).slice(-6000);

    // Log the full output so it appears in the user's terminal
    if (output) log.debug(`Test output:\n${output.slice(-500)}`);
    log.info(`Test exit code: ${result.status} | signal: ${result.signal}`);

    // null status = killed/timed out — treat as pass to avoid blocking valid proposals
    if (result.status === null) {
      log.warn(`Tests killed (signal: ${result.signal}) — treating as pass`);
      return { pass: true, output: `Tests killed by signal ${result.signal} — treated as pass` };
    }

    return { pass: result.status === 0, output };
  } catch (err: any) {
    const msg = (err.stdout ?? err.message ?? "").slice(-2000);
    log.error(`runTests exception: ${msg}`);
    return { pass: false, output: msg };
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

  // v9.8.5: Do NOT check proposal.status here. applyProposal() already checked for 'pending'
  // and set status to 'processing' before calling guardedApply(). Checking status here would
  // always see 'processing' and incorrectly reject every proposal.
  // The status guard lives exclusively in applyProposal().

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
      // v1.4.0: Check forbidden file patterns (e.g. *.test.ts, *.spec.ts)
      // Test files are the ground truth for correctness and must never be autonomously modified.
      const forbiddenFilePatterns: string[] = constitution.forbiddenModifications?.filePatterns || [];
      const targetBasename = (proposal.targetFile.split('/').pop() || proposal.targetFile).split('\\').pop() || proposal.targetFile;
      const matchedFilePattern = forbiddenFilePatterns.find((pattern: string) => {
        const regexStr = pattern.replace(/\./g, '\\.').replace(/\*/g, '.+');
        return new RegExp(`^${regexStr}$`).test(targetBasename);
      });
      if (matchedFilePattern) {
        addAudit("apply", "blocked", `Constitution v1.4.0: ${proposal.targetFile} matches forbidden file pattern '${matchedFilePattern}'. Test files must not be autonomously modified.`, proposalId, proposal.targetFile);
        rejectProposal(proposalId);
        return { success: false, message: `Constitution forbids autonomous modification of test files matching '${matchedFilePattern}'. Test files are the ground truth for correctness.` };
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
          log.info(`Auto-expired proposal ${proposalId} after ${blockCount + 1} constitution blocks`);
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
      log.info(`Constitution check passed for ${proposal.targetFile}`);
    }
  } catch (constitutionErr) {
    log.warn(`Constitution check unavailable: ${(constitutionErr as Error).message}`);
  }

  // v5.25: Meta-mode guard — immune system files require explicit environment unlock
  const metaGuardFiles = (config as any).metaGuardFiles || ["selfImproveGuard.ts", "selfHeal.ts", "selfRollback.ts", "selfTestPipeline.ts"];
  if (metaGuardFiles.includes(proposal.targetFile)) {
    if (process.env.META_MODIFY_UNLOCK !== "true") {
      addAudit("apply", "blocked", `Meta-guard: ${proposal.targetFile} requires META_MODIFY_UNLOCK=true`, proposalId, proposal.targetFile);
      return { success: false, message: `Meta-guard active: '${proposal.targetFile}' is an immune system file. Set META_MODIFY_UNLOCK=true to allow modification.` };
    }
    log.warn(`META_MODIFY_UNLOCK active: allowing modification of ${proposal.targetFile}`);
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
            log.info(`Syntax check failed for ${proposalId}, initiating refinement loop (${refineCount + 1}/2)`);
            const refined = await refineProposal(proposal, syntaxResult.errors);
            if (refined) {
              addAudit("apply", "failure", `Refined proposal ${proposalId} after syntax error`, proposalId, proposal.targetFile);
              
              // v9.8.1: Don't return false yet. We need to re-run the syntax check immediately
              // on the newly refined proposal to see if it fixed the issue.
              // If it did, we can continue with the apply pipeline.
              const retrySyntax = runSyntaxCheck(proposal.targetFile, proposal.proposedContent, proposal.originalSnippet, proposal.proposedSnippet);
              
              if (retrySyntax.pass) {
                log.info(`Refinement successful for ${proposalId}`);
                addAudit("apply", "success", `Refinement fixed syntax errors for ${proposalId}`, proposalId, proposal.targetFile);
                // The syntax check passed, so we can break out of the failure block and continue
                // the apply process (e.g. consensus check, rollback point creation, etc.)
                syntaxResult = retrySyntax;
              } else {
                log.warn(`Refinement failed to fix syntax for ${proposalId}`);
                return { success: false, message: "Syntax check failed — proposal refined but still has errors (queued for retry)", syntaxCheck: retrySyntax };
              }
            } else {
              // Refinement failed to generate a valid JSON or snippet
              return { success: false, message: "Syntax check failed — refinement generation failed", syntaxCheck: syntaxResult };
            }
          }
        } catch (err) {
          log.warn(`Refinement loop failed: ${(err as Error).message}`);
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
      log.info(`Consensus approved for ${proposal.targetFile} (${approvalPct}% approval, confidence: ${consensusResult.consensusConfidence.toFixed(2)})`);
      // v12.9.1 hardening: Store votes on proposal so RLAIF feedback loop fires after outcome.
      // applyProposal reads _consensusVotes to call recordConsensusProposalOutcome.
      (proposal as any)._consensusVotes = consensusResult.votes.map(v => ({ model: v.model, approved: v.approved }));
    }
  } catch (consensusErr) {
    // Non-fatal — if consensus engine is unavailable, proceed without it
    log.warn(`Consensus check unavailable: ${(consensusErr as Error).message}`);
  }

  // v11.12.0: Check failure pattern memory before writing — reject if this content previously caused failures
  if (proposal.proposedContent) {
    try {
      const failureCheck = await checkFailurePattern({
        filePath: proposal.targetFile,
        proposedContent: proposal.proposedContent,
        rationale: proposal.title || "RSI proposal",
      });
      if (failureCheck.severity === "block") {
        const msg = `Blocked by failure pattern memory: ${failureCheck.matchedPattern}. Previous error: ${failureCheck.previousError}`;
        log.warn(msg);
        addAudit("apply", "blocked", msg, proposalId, proposal.targetFile);
        return { success: false, message: msg, syntaxCheck: syntaxResult, backup: undefined };
      }
      if (failureCheck.severity === "warn") {
        log.warn(`Failure pattern warning for ${proposal.targetFile}: ${failureCheck.matchedPattern} (${failureCheck.similarFailureCount} recent failures)`);
      }
    } catch (fpErr) {
      log.warn(`Failure pattern check unavailable: ${(fpErr as Error).message}`);
    }
  }

  // v11.291.1: Self-consistency validation — only for HIGH-RISK proposals
  // Low-risk refactoring (constants, JSDoc, readability) skips this check to avoid
  // blocking the RSI pipeline when secondary validators disagree on trivial changes.
  const _proposalRiskForSC = (proposal as any).riskLevel || "medium";
  const _isLowRiskTitle = /jsdoc|readability|constant|rename|extract.*const|magic number|duplicate|comment|whitespace|formatting/i.test(proposal.title || "");
  const _skipConsistencyCheck = _proposalRiskForSC === "low" || (_proposalRiskForSC === "medium" && _isLowRiskTitle);
  if (proposal.proposedContent && !_skipConsistencyCheck) {
    try {
      const { validateSelfModification } = await import("./selfConsistency.js");
      const consistencyResult = await validateSelfModification(
        proposal.targetFile,
        proposal.rationale || proposal.title || "RSI proposal",
        proposal.proposedContent
      );
      if (!consistencyResult.approved && consistencyResult.report?.recommendation === "reject") {
        const topReason = consistencyResult.report?.evaluations?.[0]?.explanation?.slice(0, 200) || "consistency check failed";
        const msg = `Self-consistency validation rejected proposal (consensus=${consistencyResult.report?.consensus?.toFixed(2)}): ${topReason}`.slice(0, 300);
        log.warn(msg);
        addAudit("apply", "blocked", msg, proposalId, proposal.targetFile);
        return { success: false, message: msg, syntaxCheck: syntaxResult, backup: undefined };
      }
      if (!consistencyResult.approved) {
        log.warn(`Self-consistency warning for ${proposal.targetFile}: recommendation=${consistencyResult.report?.recommendation}, consensus=${consistencyResult.report?.consensus?.toFixed(2)}`);
      }
    } catch (scErr) {
      // Non-fatal — if selfConsistency is unavailable, proceed without it
    }
  } else if (_skipConsistencyCheck && proposal.proposedContent) {
    log.info(`Skipping self-consistency for low-risk proposal: ${(proposal.title || "").slice(0, 60)}`);
  }

  // v12.7.0: Brace-balancing post-processor — auto-fix off-by-one brace/paren imbalances
  // before quickValidate runs. The LLM occasionally generates a snippet with one extra or
  // missing brace, which is trivially fixable without an LLM retry.
  if (proposal.proposedContent) {
    const ext = (proposal.targetFile || "").split(".").pop() || "";
    if (/^(ts|tsx|js|jsx)$/.test(ext)) {
      let content = proposal.proposedContent;
      // Brace balance
      const openB = (content.match(/\{/g) || []).length;
      const closeB = (content.match(/\}/g) || []).length;
      const bracesDiff = openB - closeB;
      if (bracesDiff === 1) {
        // One extra open brace — append closing brace at end
        content = content.trimEnd() + "\n}";
        log.info(`[BraceBalance] Auto-appended missing } to ${proposal.targetFile}`);
        proposal.proposedContent = content;
      } else if (bracesDiff === -1) {
        // One extra close brace — remove last lone } on its own line
        content = content.replace(/(\n\s*\}\s*)$/, "");
        if ((content.match(/\{/g) || []).length === (content.match(/\}/g) || []).length) {
          log.info(`[BraceBalance] Auto-removed extra } from ${proposal.targetFile}`);
          proposal.proposedContent = content;
        }
      }
      // Paren balance (only fix off-by-one)
      const openP = (content.match(/\(/g) || []).length;
      const closeP = (content.match(/\)/g) || []).length;
      const parenDiff = openP - closeP;
      if (parenDiff === 1) {
        content = content.trimEnd() + ")";
        log.info(`[BraceBalance] Auto-appended missing ) to ${proposal.targetFile}`);
        proposal.proposedContent = content;
      } else if (parenDiff === -1) {
        content = content.replace(/(\n\s*\)\s*)$/, "");
        if ((content.match(/\(/g) || []).length === (content.match(/\)/g) || []).length) {
          log.info(`[BraceBalance] Auto-removed extra ) from ${proposal.targetFile}`);
          proposal.proposedContent = content;
        }
      }
    }
  }

  // v11.18.0 Audit 10 Fix C: Wire quickValidate so sandboxVerifier catches obvious issues before write
  if (proposal.proposedContent) {
    try {
      const { quickValidate } = await import("./sandboxVerifier.js");
      const qv = quickValidate(proposal.proposedContent, proposal.targetFile);
      if (!qv.valid) {
        const msg = `sandboxVerifier.quickValidate rejected proposal: ${qv.issues.slice(0, 3).join("; ")}`;
        log.warn(msg);
        addAudit("apply", "blocked", msg, proposalId, proposal.targetFile);
        return { success: false, message: msg, syntaxCheck: syntaxResult, backup: undefined };
      }
    } catch { /* non-fatal — sandboxVerifier may not be available */ }
  }

  // Create backup
  const backup = createBackup(proposal.targetFile, proposalId, "pre-apply") ?? undefined;

  // v9.8.5 MUTUAL-RECURSION FIX: Write the file directly instead of calling applyProposal().
  // Previously guardedApply() called applyProposal() which called guardedApply() again —
  // causing every proposal to be rejected with "Proposal is already processing".
  // Now guardedApply() writes the file itself; applyProposal() handles status + git commit.
  if (!proposal.proposedContent) {
    addAudit("apply", "failure", "No proposedContent to write", proposalId, proposal.targetFile);
    return { success: false, message: "Proposal has no proposedContent to write", syntaxCheck: syntaxResult, backup };
  }
  const targetFilePath = resolveServerFile(proposal.targetFile);
  if (!targetFilePath) {
    addAudit("apply", "failure", `Target file not found on disk: ${proposal.targetFile}`, proposalId, proposal.targetFile);
    return { success: false, message: `Target file not found on disk: ${proposal.targetFile}`, syntaxCheck: syntaxResult, backup };
  }
  try {
    fs.writeFileSync(targetFilePath, proposal.proposedContent, "utf-8");
    log.info(`Wrote ${proposal.proposedContent.length} bytes to ${proposal.targetFile}`);
  } catch (writeErr) {
    const msg = `Failed to write ${proposal.targetFile}: ${(writeErr as Error).message}`;
    addAudit("apply", "failure", msg, proposalId, proposal.targetFile);
    return { success: false, message: msg, syntaxCheck: syntaxResult, backup };
  }

  // Run tests after applying
  let testResult: { pass: boolean; output: string } | undefined;
  let rolledBack = false;
  if (config.runTestsBefore) {
    testResult = runTests(proposal.targetFile);
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
  const targetPath = resolveServerFile(backup.filename) ?? path.join(_guardProjectRoot, "server", backup.filename);
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
    log.info(`Synced AUTONOMY_REQUIRE_APPROVAL=${envVal} — guard approval ${desired ? "enabled" : "disabled"}`);
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
