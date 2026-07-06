/**
 * dependencyResolver.ts — Autonomous Dependency Resolution
 *
 * Detects missing packages from error messages, import statements, and
 * manifest files (package.json, requirements.txt, etc.), then auto-installs
 * them with user confirmation and rollback on failure.
 *
 * v5.7 Enhancement
 * v5.8 Security: execSandbox whitelist — only pre-approved commands may run
 */
import { execSync, exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);

// ── v5.8 Security: Command Execution Sandbox ─────────────────────────────────
// ALL shell commands executed by the dependency resolver MUST pass through
// execSandbox(). This function enforces a strict whitelist of allowed command
// prefixes so that a compromised or hallucinating RSI engine cannot run
// arbitrary shell commands (e.g. `rm -rf`, `curl | bash`, `wget ... | sh`).
//
// Allowed command families:
//   npm / pnpm / yarn  — package management
//   pip3 / pip         — Python package management
//   python3 -c         — import verification only (no file execution)
//   node -e            — require() verification only
//   which              — binary existence check
//   sudo apt-get install -y <name>  — system package install
//   sudo apt-get remove  -y <name>  — system package remove
//
// Any command that does NOT match the whitelist throws an error and is never
// executed. The undoCommand for rollbacks is also validated before execution.

const EXEC_WHITELIST: RegExp[] = [
  // npm — install, uninstall, outdated (--json), audit (--json)
  /^npm\s+(install|uninstall)(\s|$)/,
  /^npm\s+outdated(\s+--json)?(\s+2>&1)?$/,
  /^npm\s+audit(\s+--json)?(\s+2>&1)?$/,
  // pnpm — add, remove, outdated
  /^pnpm\s+(add|remove)(\s|$)/,
  /^pnpm\s+outdated(\s+--json)?(\s+2>&1)?$/,
  // yarn — add, remove
  /^yarn\s+(add|remove)(\s|$)/,
  // pip3 / pip — install, uninstall, list
  /^pip3?\s+(install|uninstall)(\s|$)/,
  /^pip3?\s+list(\s+--outdated)?(\s+--format=json)?(\s+2>\/dev\/null)?$/,
  // Python import verification — ONLY `python3 -c "import <name>"` form
  /^python3\s+-c\s+"import\s+[a-zA-Z0-9_]+"(\s+2>\/dev\/null)?$/,
  // Node require verification — ONLY `node -e "require('<name>')"` form
  /^node\s+-e\s+"require\('([a-zA-Z0-9@\/_.-]+)'\)"(\s+2>\/dev\/null)?$/,
  // which — binary existence check (no args other than the binary name)
  /^which\s+[a-zA-Z0-9_-]+(\s+2>\/dev\/null)?$/,
  // apt-get — install and remove only, requires sudo, single package name
  /^sudo\s+apt-get\s+(install|remove)\s+-y\s+[a-zA-Z0-9_.-]+(\s+2>&1)?$/,
];

/**
 * v5.8: Sandboxed execSync — validates command against whitelist before execution.
 * Throws a SecurityError if the command is not explicitly whitelisted.
 * This is the ONLY way commands should be executed in this module.
 */
function assertCommandAllowed(cmd: string): void {
  const trimmed = cmd.trim();
  const allowed = EXEC_WHITELIST.some(pattern => pattern.test(trimmed));
  if (!allowed) {
    throw new Error(
      `[execSandbox] BLOCKED: Command not in whitelist: "${trimmed.slice(0, 120)}"\n` +
      `Only npm/pnpm/yarn/pip3/python3-import/node-require/which/apt-get commands are permitted.`
    );
  }
}

function execSandbox(cmd: string, opts?: Parameters<typeof execSync>[1]): string {
  assertCommandAllowed(cmd);
  return execSync(cmd, opts as any);
}

/**
 * v5.8: Sandboxed execAsync — async variant of execSandbox.
 */
async function execAsyncSandbox(cmd: string, opts?: Parameters<typeof execAsync>[1]): Promise<{ stdout: string; stderr: string }> {
  assertCommandAllowed(cmd);
  const result = await execAsync(cmd, { encoding: "utf-8", ...opts });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export type PackageManager = "npm" | "pip" | "pip3" | "pnpm" | "yarn" | "apt";

export type DependencyRequest = {
  name: string;
  version?: string;
  manager: PackageManager;
  reason: string;
  source: "error_parse" | "import_scan" | "manifest_diff" | "user_request";
  confidence: number; // 0-1
};

export type InstallResult = {
  request: DependencyRequest;
  success: boolean;
  output: string;
  duration: number;
  rolledBack: boolean;
};

export type ResolverConfig = {
  autoInstall: boolean;          // Install without confirmation if confidence > threshold
  confidenceThreshold: number;   // Min confidence for auto-install (0-1)
  maxConcurrent: number;         // Max concurrent installs
  timeout: number;               // Per-install timeout in ms
  allowedManagers: PackageManager[];
  blockedPackages: string[];     // Never auto-install these
  sandboxVerify: boolean;        // Test import after install
  workspaceRoot: string;
};

type InstallRecord = {
  request: DependencyRequest;
  result: InstallResult;
  timestamp: number;
  undoCommand?: string;
};

// ── State ────────────────────────────────────────────────────────────────────

const installHistory: InstallRecord[] = [];
const pendingRequests: DependencyRequest[] = [];
let activeInstalls = 0;

let config: ResolverConfig = {
  autoInstall: false,
  confidenceThreshold: 0.85,
  maxConcurrent: 3,
  timeout: 120_000,
  allowedManagers: ["npm", "pip3", "pnpm"],
  blockedPackages: ["os", "sys", "child_process", "fs", "path", "crypto"],
  sandboxVerify: true,
  workspaceRoot: process.cwd(),
};

// ── Error Pattern Matching ───────────────────────────────────────────────────

const ERROR_PATTERNS: { regex: RegExp; manager: PackageManager; extract: (m: RegExpMatchArray) => string }[] = [
  // Node.js / npm
  { regex: /Cannot find module '([^']+)'/, manager: "npm", extract: m => m[1].split("/")[0].replace(/^@/, match => match) },
  { regex: /Module not found.*'([^']+)'/, manager: "npm", extract: m => m[1].split("/")[0] },
  { regex: /Error \[ERR_MODULE_NOT_FOUND\].*'([^']+)'/, manager: "npm", extract: m => m[1] },
  // Python / pip
  { regex: /ModuleNotFoundError: No module named '([^']+)'/, manager: "pip3", extract: m => m[1].split(".")[0] },
  { regex: /ImportError: No module named '([^']+)'/, manager: "pip3", extract: m => m[1].split(".")[0] },
  { regex: /No module named '([^']+)'/, manager: "pip3", extract: m => m[1].split(".")[0] },
  // System / apt
  { regex: /command not found: (\S+)/, manager: "apt", extract: m => m[1] },
  { regex: /(\S+): not found/, manager: "apt", extract: m => m[1] },
];

// Python package name mapping (import name → pip name)
const PYTHON_NAME_MAP: Record<string, string> = {
  cv2: "opencv-python",
  PIL: "Pillow",
  sklearn: "scikit-learn",
  bs4: "beautifulsoup4",
  yaml: "pyyaml",
  dotenv: "python-dotenv",
  gi: "PyGObject",
  attr: "attrs",
  dateutil: "python-dateutil",
  jwt: "PyJWT",
  serial: "pyserial",
  usb: "pyusb",
  magic: "python-magic",
  lxml: "lxml",
};

// Node package name mapping (import name → npm name)
const NODE_NAME_MAP: Record<string, string> = {
  "lodash/fp": "lodash",
  "react-dom/client": "react-dom",
};

// ── Core Functions ───────────────────────────────────────────────────────────

export function parseErrorForDependencies(errorText: string): DependencyRequest[] {
  const results: DependencyRequest[] = [];
  const seen = new Set<string>();

  for (const pattern of ERROR_PATTERNS) {
    const matches = errorText.matchAll(new RegExp(pattern.regex, "g"));
    for (const match of Array.from(matches)) {
      let pkgName = pattern.extract(match);
      
      // Apply name mapping
      if (pattern.manager === "pip3" && PYTHON_NAME_MAP[pkgName]) {
        pkgName = PYTHON_NAME_MAP[pkgName];
      } else if (pattern.manager === "npm" && NODE_NAME_MAP[pkgName]) {
        pkgName = NODE_NAME_MAP[pkgName];
      }

      const key = `${pattern.manager}:${pkgName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (config.blockedPackages.includes(pkgName)) continue;

      results.push({
        name: pkgName,
        manager: pattern.manager,
        reason: `Detected from error: ${match[0].substring(0, 100)}`,
        source: "error_parse",
        confidence: 0.9,
      });
    }
  }

  return results;
}

export function scanImportsForDependencies(code: string, language: "typescript" | "python"): DependencyRequest[] {
  const results: DependencyRequest[] = [];
  const seen = new Set<string>();

  if (language === "typescript") {
    // Match: import ... from "pkg", require("pkg")
    const importRegex = /(?:import\s+.*\s+from\s+['"]([^'"./][^'"]*)['"]\s*;?|require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\))/g;
    for (const match of Array.from(code.matchAll(importRegex))) {
      let pkg = (match[1] || match[2]).split("/")[0];
      if (pkg.startsWith("@") && match[1]) {
        const parts = (match[1] || match[2]).split("/");
        pkg = parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
      }
      if (seen.has(pkg) || config.blockedPackages.includes(pkg)) continue;
      seen.add(pkg);

      // Check if already installed
      if (!isNodePackageInstalled(pkg)) {
        results.push({
          name: pkg,
          manager: "npm",
          reason: `Import found: ${match[0].trim().substring(0, 80)}`,
          source: "import_scan",
          confidence: 0.75,
        });
      }
    }
  } else if (language === "python") {
    // Match: import pkg, from pkg import ...
    const importRegex = /(?:^|\n)\s*(?:import\s+(\S+)|from\s+(\S+)\s+import)/g;
    for (const match of Array.from(code.matchAll(importRegex))) {
      let pkg = (match[1] || match[2]).split(".")[0];
      if (PYTHON_NAME_MAP[pkg]) pkg = PYTHON_NAME_MAP[pkg];
      if (seen.has(pkg) || config.blockedPackages.includes(pkg)) continue;
      seen.add(pkg);

      if (!isPythonPackageInstalled(pkg)) {
        results.push({
          name: pkg,
          manager: "pip3",
          reason: `Import found: ${match[0].trim().substring(0, 80)}`,
          source: "import_scan",
          confidence: 0.7,
        });
      }
    }
  }

  return results;
}

export function diffManifestDependencies(manifestPath: string): DependencyRequest[] {
  const results: DependencyRequest[] = [];

  if (!existsSync(manifestPath)) return results;

  const content = readFileSync(manifestPath, "utf-8");
  const filename = manifestPath.split("/").pop() || "";

  if (filename === "package.json") {
    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, version] of Object.entries(allDeps)) {
        if (!isNodePackageInstalled(name)) {
          results.push({
            name,
            version: String(version).replace(/^[\^~>=<]/, ""),
            manager: "npm",
            reason: `Listed in ${filename} but not installed`,
            source: "manifest_diff",
            confidence: 0.95,
          });
        }
      }
    } catch {}
  } else if (filename === "requirements.txt") {
    const lines = content.split("\n").filter(l => l.trim() && !l.startsWith("#"));
    for (const line of lines) {
      const [name, version] = line.split(/[=><]+/);
      if (!isPythonPackageInstalled(name.trim())) {
        results.push({
          name: name.trim(),
          version: version?.trim(),
          manager: "pip3",
          reason: `Listed in ${filename} but not installed`,
          source: "manifest_diff",
          confidence: 0.95,
        });
      }
    }
  }

  return results;
}

// ── Installation ─────────────────────────────────────────────────────────────

export async function installDependency(request: DependencyRequest): Promise<InstallResult> {
  const start = Date.now();

  if (config.blockedPackages.includes(request.name)) {
    return {
      request,
      success: false,
      output: `Package "${request.name}" is blocked by configuration`,
      duration: 0,
      rolledBack: false,
    };
  }

  if (!config.allowedManagers.includes(request.manager)) {
    return {
      request,
      success: false,
      output: `Package manager "${request.manager}" is not allowed`,
      duration: 0,
      rolledBack: false,
    };
  }

  const installCmd = buildInstallCommand(request);
  const uninstallCmd = buildUninstallCommand(request);

  try {
    activeInstalls++;
    // v6.12: Use async exec to avoid blocking the event loop during installs
    const { stdout } = await execAsyncSandbox(installCmd, {
      timeout: config.timeout,
      encoding: "utf-8",
    });
    const output = String(stdout ?? "");
    // Verify installation if sandbox verify is enabled
    if (config.sandboxVerify) {
      const verified = verifyInstallation(request);
      if (!verified) {
        // Rollback
        try {
          await execAsyncSandbox(uninstallCmd);
        } catch (rollbackErr) {
          console.warn(`Rollback failed for ${request.name}:`, rollbackErr);
        }
        const result: InstallResult = {
          request,
          success: false,
          output: `Installed but verification failed — rolled back`,
          duration: Date.now() - start,
          rolledBack: true,
        };
        recordInstall(request, result, uninstallCmd);
        return result;
      }
    }

    const result: InstallResult = {
      request,
      success: true,
      output: output.substring(0, 500),
      duration: Date.now() - start,
      rolledBack: false,
    };
    recordInstall(request, result, uninstallCmd);
    return result;
  } catch (err: any) {
    const result: InstallResult = {
      request,
      success: false,
      output: (err.stderr || err.message || "Unknown error").substring(0, 500),
      duration: Date.now() - start,
      rolledBack: false,
    };
    recordInstall(request, result);
    return result;
  } finally {
    activeInstalls--;
  }
}

export async function installBatch(requests: DependencyRequest[]): Promise<InstallResult[]> {
  const results: InstallResult[] = [];

  // Sort by confidence (highest first)
  const sorted = [...requests].sort((a, b) => b.confidence - a.confidence);

  for (const req of sorted) {
    // Wait if at max concurrent
    while (activeInstalls >= config.maxConcurrent) {
      await new Promise(r => setTimeout(r, 500));
    }
    const result = await installDependency(req);
    results.push(result);
  }

  return results;
}

export function addPendingRequest(request: DependencyRequest): void {
  const exists = pendingRequests.some(r => r.name === request.name && r.manager === request.manager);
  if (!exists) pendingRequests.push(request);
}

export function getPendingRequests(): DependencyRequest[] {
  return [...pendingRequests];
}

export function clearPendingRequests(): void {
  pendingRequests.length = 0;
}

export async function autoResolve(errorText: string): Promise<InstallResult[]> {
  const deps = parseErrorForDependencies(errorText);
  if (deps.length === 0) return [];

  if (config.autoInstall) {
    const autoInstallable = deps.filter(d => d.confidence >= config.confidenceThreshold);
    const needsConfirmation = deps.filter(d => d.confidence < config.confidenceThreshold);

    // Queue low-confidence ones for manual approval
    for (const dep of needsConfirmation) addPendingRequest(dep);

    // Auto-install high-confidence ones
    if (autoInstallable.length > 0) {
      return installBatch(autoInstallable);
    }
  } else {
    // Queue everything for manual approval
    for (const dep of deps) addPendingRequest(dep);
  }

  return [];
}

// ── Rollback ─────────────────────────────────────────────────────────────────

export function rollbackInstall(index: number): boolean {
  if (index < 0 || index >= installHistory.length) return false;
  const record = installHistory[index];
  if (!record.result.success || !record.undoCommand) return false;

  try {
    execSandbox(record.undoCommand, { timeout: 30_000, encoding: "utf-8" });
    record.result.rolledBack = true;
    return true;
  } catch {
    return false;
  }
}

export function rollbackAll(): { rolled: number; failed: number } {
  let rolled = 0;
  let failed = 0;

  // Rollback in reverse order
  for (let i = installHistory.length - 1; i >= 0; i--) {
    const record = installHistory[i];
    if (record.result.success && !record.result.rolledBack && record.undoCommand) {
      if (rollbackInstall(i)) rolled++;
      else failed++;
    }
  }

  return { rolled, failed };
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getResolverConfig(): ResolverConfig {
  return { ...config };
}

export function setResolverConfig(updates: Partial<ResolverConfig>): ResolverConfig {
  config = { ...config, ...updates };
  return { ...config };
}

export function getInstallHistory(): InstallRecord[] {
  return [...installHistory];
}

export function getResolverStats(): {
  totalInstalls: number;
  successful: number;
  failed: number;
  rolledBack: number;
  pending: number;
  activeInstalls: number;
} {
  return {
    totalInstalls: installHistory.length,
    successful: installHistory.filter(r => r.result.success && !r.result.rolledBack).length,
    failed: installHistory.filter(r => !r.result.success).length,
    rolledBack: installHistory.filter(r => r.result.rolledBack).length,
    pending: pendingRequests.length,
    activeInstalls,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// v5.23: Sanitize package names to prevent command injection
function sanitizePackageName(name: string): string {
  // Only allow alphanumeric, hyphens, underscores, dots, slashes (scoped packages), and @
  const sanitized = name.replace(/[^a-zA-Z0-9@/_.-]/g, "");
  // Reject if it contains shell metacharacters or looks suspicious
  if (sanitized !== name || /[;&|`$(){}\[\]!#~]/.test(name) || name.includes("..")) {
    throw new Error(`Invalid package name: "${name}" contains disallowed characters`);
  }
  return sanitized;
}

function sanitizeVersion(version: string | undefined): string {
  if (!version) return "";
  // Only allow version-like characters: digits, dots, hyphens, carets, tildes, x, *
  const sanitized = version.replace(/[^a-zA-Z0-9.*^~<>=|-]/g, "");
  if (sanitized !== version) {
    throw new Error(`Invalid version: "${version}" contains disallowed characters`);
  }
  return sanitized;
}

function buildInstallCommand(req: DependencyRequest): string {
  const name = sanitizePackageName(req.name);
  const version = sanitizeVersion(req.version);
  const ver = version ? `@${version}` : "";
  switch (req.manager) {
    case "npm": return `npm install ${name}${ver} --save 2>&1`;
    case "pnpm": return `pnpm add ${name}${ver} 2>&1`;
    case "yarn": return `yarn add ${name}${ver} 2>&1`;
    case "pip": case "pip3": return `pip3 install ${name}${ver ? `==${version}` : ""} 2>&1`;
    case "apt": return `sudo apt-get install -y ${name} 2>&1`;
    default: return `echo "Unknown manager: ${req.manager}"`;
  }
}

function buildUninstallCommand(req: DependencyRequest): string {
  const name = sanitizePackageName(req.name);
  switch (req.manager) {
    case "npm": return `npm uninstall ${name} 2>&1`;
    case "pnpm": return `pnpm remove ${name} 2>&1`;
    case "yarn": return `yarn remove ${name} 2>&1`;
    case "pip": case "pip3": return `pip3 uninstall -y ${name} 2>&1`;
    case "apt": return `sudo apt-get remove -y ${name} 2>&1`;
    default: return `echo "Unknown manager: ${req.manager}"`;
  }
}

function isNodePackageInstalled(name: string): boolean {
  try {
    const pkgPath = join(config.workspaceRoot, "node_modules", name);
    return existsSync(pkgPath);
  } catch {
    return false;
  }
}

function isPythonPackageInstalled(name: string): boolean {
  try {
    const safeName = sanitizePackageName(name).replace(/-/g, "_");
    execSandbox(`python3 -c "import ${safeName}" 2>/dev/null`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function verifyInstallation(req: DependencyRequest): boolean {
  try {
    const safeName = sanitizePackageName(req.name);
    if (req.manager === "pip" || req.manager === "pip3") {
      execSandbox(`python3 -c "import ${safeName.replace(/-/g, "_")}"`, { timeout: 10_000 });
      return true;
    } else if (req.manager === "npm" || req.manager === "pnpm" || req.manager === "yarn") {
      execSandbox(`node -e "require('${safeName}')"`, { timeout: 10_000 });
      return true;
    } else if (req.manager === "apt") {
      execSandbox(`which ${safeName}`, { timeout: 5_000 });
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

function recordInstall(req: DependencyRequest, result: InstallResult, undoCommand?: string): void {
  installHistory.push({ request: req, result, timestamp: Date.now(), undoCommand });
  // Keep history bounded
  if (installHistory.length > 200) installHistory.splice(0, installHistory.length - 200);
}


// ─── v5.15: Dependency Update Checker ────────────────────────────────────────
// Checks installed packages against latest versions and reports available updates.
// Can be triggered manually or on a schedule.

export type UpdateInfo = {
  name: string;
  currentVersion: string;
  latestVersion: string;
  manager: PackageManager;
  severity: "patch" | "minor" | "major";
  isSecurityUpdate: boolean;
};

export type UpdateCheckResult = {
  checkedAt: number;
  totalPackages: number;
  updatesAvailable: UpdateInfo[];
  errors: string[];
};

let lastUpdateCheck: UpdateCheckResult | null = null;

/**
 * Check for available dependency updates.
 * Reads package.json (for Node) and requirements.txt (for Python) to find outdated packages.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    checkedAt: Date.now(),
    totalPackages: 0,
    updatesAvailable: [],
    errors: [],
  };

  // Check Node.js packages via `pnpm outdated` or `npm outdated`
  try {
    const pkgJsonPath = join(config.workspaceRoot, "package.json");
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      result.totalPackages += Object.keys(allDeps).length;

      try {
        // Use pnpm outdated --json for structured output
        // v5.8: Try pnpm first, then npm — each command is individually whitelisted
        let outdatedOutput = "";
        try {
          outdatedOutput = execSandbox("pnpm outdated --json", {
            cwd: config.workspaceRoot,
            timeout: 30_000,
            encoding: "utf-8",
          }) as string;
        } catch {
          try {
            outdatedOutput = execSandbox("npm outdated --json", {
              cwd: config.workspaceRoot,
              timeout: 30_000,
              encoding: "utf-8",
            }) as string;
          } catch { /* no outdated info available */ }
        }

        if (outdatedOutput.trim()) {
          const outdated = JSON.parse(outdatedOutput);
          for (const [name, info] of Object.entries(outdated) as any[]) {
            const current = info.current || info.version || allDeps[name]?.replace(/[\^~]/, "") || "unknown";
            const latest = info.latest || info.wanted || "unknown";
            if (current === latest || latest === "unknown") continue;

            const severity = getSeverity(current, latest);
            result.updatesAvailable.push({
              name,
              currentVersion: current,
              latestVersion: latest,
              manager: "pnpm",
              severity,
              isSecurityUpdate: false, // Would need advisory API for this
            });
          }
        }
      } catch (cmdErr) {
        // pnpm/npm outdated returns exit code 1 when there ARE outdated packages
        const errOutput = (cmdErr as any).stdout || (cmdErr as any).stderr || "";
        if (errOutput.trim().startsWith("{")) {
          try {
            const outdated = JSON.parse(errOutput);
            for (const [name, info] of Object.entries(outdated) as any[]) {
              const current = info.current || "unknown";
              const latest = info.latest || "unknown";
              if (current === latest || latest === "unknown") continue;
              result.updatesAvailable.push({
                name,
                currentVersion: current,
                latestVersion: latest,
                manager: "pnpm",
                severity: getSeverity(current, latest),
                isSecurityUpdate: false,
              });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  } catch (err) {
    result.errors.push(`Node dependency check failed: ${(err as Error).message}`);
  }

  // Check Python packages via pip list --outdated
  try {
    const reqPath = join(config.workspaceRoot, "requirements.txt");
    if (existsSync(reqPath)) {
      const pipOutput = execSandbox("pip3 list --outdated --format=json", {
        timeout: 30_000,
        encoding: "utf-8",
      });

      if (pipOutput.trim()) {
        const outdated = JSON.parse(pipOutput);
        result.totalPackages += outdated.length;
        for (const pkg of outdated) {
          result.updatesAvailable.push({
            name: pkg.name,
            currentVersion: pkg.version,
            latestVersion: pkg.latest_version,
            manager: "pip3",
            severity: getSeverity(pkg.version, pkg.latest_version),
            isSecurityUpdate: false,
          });
        }
      }
    }
  } catch (err) {
    result.errors.push(`Python dependency check failed: ${(err as Error).message}`);
  }

  lastUpdateCheck = result;
  console.log(`[DependencyResolver] Update check complete: ${result.updatesAvailable.length} updates available out of ${result.totalPackages} packages`);
  return result;
}

/**
 * Get the last update check result without re-running the check.
 */
export function getLastUpdateCheck(): UpdateCheckResult | null {
  return lastUpdateCheck;
}

/**
 * Determine the severity of a version bump (patch, minor, major).
 */
function getSeverity(current: string, latest: string): "patch" | "minor" | "major" {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);

  // If parsing fails, default to patch to be safe
  if (currentParts.some(isNaN) || latestParts.some(isNaN)) return "patch";

  const majorDiff = latestParts[0] - currentParts[0];
  const minorDiff = latestParts[1] - currentParts[1];

  if (majorDiff > 0) return "major";
  if (minorDiff > 0) return "minor";
  return "patch";
}

/**
 * Auto-update all packages with patch-level updates (safe).
 * Returns the list of packages that were updated.
 */
export async function autoUpdatePatches(): Promise<InstallResult[]> {
  const check = lastUpdateCheck || await checkForUpdates();
  const patches = check.updatesAvailable.filter(u => u.severity === "patch");

  if (patches.length === 0) return [];

  const requests: DependencyRequest[] = patches.map(p => ({
    name: p.name,
    version: p.latestVersion,
    manager: p.manager,
    reason: `Patch update: ${p.currentVersion} → ${p.latestVersion}`,
    source: "manifest_diff" as const,
    confidence: 0.95,
  }));

  return installBatch(requests);
}

// ─── v5.33: Vulnerability Scanning ──────────────────────────────────────────

export interface VulnerabilityReport {
  scannedAt: number;
  totalVulnerabilities: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  advisories: Array<{
    name: string;
    severity: string;
    title: string;
    url?: string;
    fixAvailable: boolean;
  }>;
  errors: string[];
}

let lastVulnScan: VulnerabilityReport | null = null;

/**
 * Run a vulnerability scan on installed dependencies.
 * Uses `npm audit` and `pip-audit` (if available).
 */
export async function scanVulnerabilities(): Promise<VulnerabilityReport> {
  const report: VulnerabilityReport = {
    scannedAt: Date.now(),
    totalVulnerabilities: 0,
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    advisories: [],
    errors: [],
  };

  // Scan Node.js dependencies
  try {
    const pkgJsonPath = join(config.workspaceRoot, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const auditOutput = execSandbox("npm audit --json", {
          cwd: config.workspaceRoot,
          timeout: 60_000,
          encoding: "utf-8",
        });

        if (auditOutput.trim()) {
          const audit = JSON.parse(auditOutput);
          if (audit.metadata) {
            report.totalVulnerabilities += audit.metadata.vulnerabilities?.total || 0;
            report.critical += audit.metadata.vulnerabilities?.critical || 0;
            report.high += audit.metadata.vulnerabilities?.high || 0;
            report.moderate += audit.metadata.vulnerabilities?.moderate || 0;
            report.low += audit.metadata.vulnerabilities?.low || 0;
          }
          if (audit.advisories) {
            for (const [_id, advisory] of Object.entries(audit.advisories) as any[]) {
              report.advisories.push({
                name: advisory.module_name || "unknown",
                severity: advisory.severity || "unknown",
                title: advisory.title || "Unknown vulnerability",
                url: advisory.url,
                fixAvailable: !!advisory.patched_versions,
              });
            }
          }
          // npm audit v2 format
          if (audit.vulnerabilities) {
            for (const [name, vuln] of Object.entries(audit.vulnerabilities) as any[]) {
              report.advisories.push({
                name,
                severity: vuln.severity || "unknown",
                title: vuln.via?.[0]?.title || vuln.via?.[0] || "Vulnerability found",
                url: vuln.via?.[0]?.url,
                fixAvailable: !!vuln.fixAvailable,
              });
            }
          }
        }
      } catch (cmdErr) {
        // npm audit returns exit code 1 when vulnerabilities found
        const errOutput = (cmdErr as any).stdout || "";
        if (errOutput.trim().startsWith("{")) {
          try {
            const audit = JSON.parse(errOutput);
            if (audit.metadata?.vulnerabilities) {
              report.totalVulnerabilities += audit.metadata.vulnerabilities.total || 0;
              report.critical += audit.metadata.vulnerabilities.critical || 0;
              report.high += audit.metadata.vulnerabilities.high || 0;
              report.moderate += audit.metadata.vulnerabilities.moderate || 0;
              report.low += audit.metadata.vulnerabilities.low || 0;
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  } catch (err) {
    report.errors.push(`Node vulnerability scan failed: ${(err as Error).message}`);
  }

  lastVulnScan = report;
  console.log(`[DependencyResolver] Vulnerability scan complete: ${report.totalVulnerabilities} vulnerabilities found (${report.critical} critical, ${report.high} high)`);
  return report;
}

/**
 * Get the last vulnerability scan result.
 */
export function getLastVulnScan(): VulnerabilityReport | null {
  return lastVulnScan;
}
