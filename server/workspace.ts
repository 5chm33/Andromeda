/**
 * workspace.ts — Sandboxed file system workspace for Andromeda's code executor
 *
 * Provides a persistent workspace directory where code can read and write files
 * between executions. The workspace lives at andromeda/workspace/ and is
 * accessible to the user via the Workspace panel in the UI.
 *
 * Security: All file paths are validated to prevent directory traversal.
 * The workspace is isolated from the rest of the file system.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

// ─── Workspace directory ──────────────────────────────────────────────────────

/**
 * Returns the absolute path to the workspace directory.
 * Creates it if it doesn't exist.
 * The workspace is located at: <project_root>/workspace/
 */
/**
 * v5.36: Workspace directory is now configurable:
 *   - WORKSPACE_ROOT env var → use that exact path
 *   - ALLOW_FULL_FS=true → allow absolute paths (for accessing user projects anywhere)
 *   - Default → andromeda/workspace/ (original behavior)
 */
/**
 * v5.80: Get the server source directory (the directory containing this file).
 * Used to redirect hallucinated src/ paths to the real server/ directory.
 */
export function getServerDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // v5.80: When running from dist/index.js, here = andromeda/dist/
  // We need andromeda/server/ for source file access
  const baseName = path.basename(here);
  if (baseName === "dist" || baseName === "build") {
    const serverSibling = path.resolve(here, "..", "server");
    if (fs.existsSync(serverSibling)) {
      return serverSibling;
    }
  }
  return here;
}

// v6.12: Cache workspace dir to avoid repeated fs.existsSync calls in tight loops
let _cachedWorkspaceDir: string | null = null;
export function getWorkspaceDir(): string {
  if (_cachedWorkspaceDir) return _cachedWorkspaceDir;
  // Check for explicit workspace root from environment
  const envRoot = process.env.WORKSPACE_ROOT;
  if (envRoot) {
    const resolved = path.resolve(envRoot);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    _cachedWorkspaceDir = resolved;
    return resolved;
  }
  // Default: andromeda/workspace/ — use process.cwd() so it works from any entry point
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }
  _cachedWorkspaceDir = workspaceDir;
  return workspaceDir;
}

/**
 * v5.36: Check if full filesystem access is enabled.
 * When ALLOW_FULL_FS=true, the agent can read/write files anywhere on the system.
 * This is needed for working on user projects outside the workspace directory.
 */
export function isFullFsEnabled(): boolean {
  // v5.43: CEO edition - full filesystem access by default
  return process.env.ALLOW_FULL_FS !== "false";
}

/**
 * v5.36: Resolve a file path — supports both workspace-relative and absolute paths.
 * When ALLOW_FULL_FS is enabled, absolute paths are allowed.
 * Otherwise, paths are resolved relative to workspace and traversal is blocked.
 */
export function resolveFilePath(filePath: string): { absPath: string; allowed: boolean } {
  // If full FS access is enabled and path is absolute, allow it
  if (isFullFsEnabled() && path.isAbsolute(filePath)) {
    return { absPath: filePath, allowed: true };
  }
  // Otherwise resolve relative to workspace
  const wsDir = getWorkspaceDir();
  const absPath = path.resolve(wsDir, filePath);
  const allowed = absPath.startsWith(path.resolve(wsDir));
  return { absPath, allowed };
}

/**
 * Validates that a filename is safe (no path traversal, no absolute paths).
 * Returns the resolved absolute path within the workspace.
 */
function safeWorkspacePath(filename: string): string {
  // Strip any directory components — only allow simple filenames
  const basename = path.basename(filename);
  if (!basename || basename === "." || basename === "..") {
    throw new Error("Invalid filename");
  }
  // Allow subdirectories but validate they stay within workspace
  const resolved = path.resolve(getWorkspaceDir(), filename);
  if (!resolved.startsWith(getWorkspaceDir())) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

// ─── File operations ──────────────────────────────────────────────────────────

export interface WorkspaceFile {
  name: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

/**
 * Lists all files in the workspace directory.
 */
export async function listWorkspaceFiles(): Promise<WorkspaceFile[]> {
  try {
    const workspaceDir = getWorkspaceDir();
    const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    return entries
      .map((entry) => {
        const stat = fs.statSync(path.join(workspaceDir, entry.name));
        return {
          name: entry.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          isDirectory: entry.isDirectory(),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch (err) {
    console.error("Failed to list workspace files:", err);
    return [];
  }
}

/**
 * Reads a file from the workspace.
 */
export async function readWorkspaceFile(filename: string): Promise<string> {
  const filePath = safeWorkspacePath(filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filename}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Writes a file to the workspace.
 */
export async function writeWorkspaceFile(filename: string, content: string): Promise<void> {
  const filePath = safeWorkspacePath(filename);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Deletes a file from the workspace.
 */
export async function deleteWorkspaceFile(filename: string): Promise<void> {
  const filePath = safeWorkspacePath(filename);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

// ─── Code execution with workspace access ────────────────────────────────────

export interface WorkspaceRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  language: string;
  durationMs: number;
  filesCreated: string[];   // new files written to workspace during this run
  filesModified: string[];  // existing files modified during this run
}

const TIMEOUT_MS = 30_000; // 30s for workspace runs (may do file I/O)
const MAX_OUTPUT = 500_000; // v5.43: CEO edition - generous output limit

function detectLanguage(code: string, hint?: string): "python" | "javascript" | "shell" {
  if (hint) {
    if (hint === "python" || hint === "py") return "python";
    if (hint === "javascript" || hint === "js" || hint === "node") return "javascript";
    if (hint === "shell" || hint === "bash" || hint === "sh") return "shell";
  }
  if (/^\s*(import |from |def |class |print\(|if __name__)/.test(code)) return "python";
  if (/^\s*(const |let |var |function |require\(|console\.|module\.|import )/.test(code)) return "javascript";
  return "python"; // default for workspace runs
}

async function findPythonCmd(): Promise<string> {
  const candidates = process.platform === "win32"
    ? ["py", "python", "python3"]
    : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(cmd, ["--version"], { timeout: 3000 });
        p.on("close", (code) => (code === 0 ? resolve() : reject()));
        p.on("error", reject);
      });
      return cmd;
    } catch {}
  }
  return "python3";
}

function runProcess(cmd: string[], cwd: string, language: string): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;

    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        NODE_OPTIONS: "--max-old-space-size=512",
      },
      timeout: TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + "\n[output truncated]";
        proc.kill("SIGKILL");
      }
    });

    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: killed ? -1 : (code ?? -1), durationMs: Date.now() - start });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout: "", stderr: `Failed to start process: ${err.message}`, exitCode: -1, durationMs: Date.now() - start });
    });
  });
}

// v5.8: Enhanced dangerous-pattern guard — covers curl|sh, netcat, eval injection, glob
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf?\s+\/(?!tmp)/i,          // rm -rf / (allow /tmp)
  /rm\s+-rf?\s+\/\*/i,               // rm -rf /*
  /rm\s+-rf?\s+\.\s*$/im,            // rm -rf . (when cwd might be /)
  /format\s+[a-z]:/i,                // Windows format drive
  /mkfs\./i,                         // Linux filesystem format
  /dd\s+if=.*of=\/dev/i,             // dd to block device
  /:\s*\(\)\s*\{.*\|.*:.*&.*\}/,    // fork bomb
  /sudo\s+rm/i,                      // sudo rm
  /shutdown\s+(-h|-r|now)/i,         // system shutdown/reboot
  /reboot\b/i,
  /chmod\s+777\s+\//i,               // chmod 777 / (root)
  /chown.*root.*\//i,                // chown root on /
  /curl[^|]*\|\s*(ba)?sh/i,          // curl piped to shell
  /wget[^|]*\|\s*(ba)?sh/i,          // wget piped to shell
  /\beval\s*\(.*\$\(/i,              // eval with command substitution
  /python[23]?\s+-c.*os\.system.*rm/i, // python -c os.system("rm...")
  /nc\s+-[le].*\/bin\/(ba)?sh/i,     // netcat reverse shell
  /\bxargs\s+.*rm/i,                 // xargs rm (mass delete)
];

/**
 * Executes code with full access to the persistent workspace directory.
 * The workspace is passed as the working directory, so relative file paths
 * in the code resolve to workspace files.
 *
 * Tracks which files were created or modified during the run.
 */
export async function executeCodeWithWorkspace(
  code: string,
  languageHint?: string
): Promise<WorkspaceRunResult> {
  // v5.4: Block dangerous patterns before spawning any process
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return {
        stdout: "",
        stderr: `Execution blocked: code contains a potentially dangerous pattern (${pattern.source}). Remove it and try again.`,
        exitCode: -1,
        language: languageHint || "unknown",
        durationMs: 0,
        filesCreated: [],
        filesModified: [],
      };
    }
  }
  const workspaceDir = getWorkspaceDir();
  const lang = detectLanguage(code, languageHint);

  // Snapshot files before execution
  const before = new Set(
    fs.existsSync(workspaceDir) && fs.statSync(workspaceDir).isDirectory()
      ? fs.readdirSync(workspaceDir).map((f) => {
          const stat = fs.statSync(path.join(workspaceDir, f));
          return `${f}:${stat.mtimeMs}`;
        })
      : []
  );

  // Write code to a temp file in the workspace
  const scriptName = lang === "python" ? "_run.py" : lang === "shell" ? "_run.sh" : "_run.js";
  const scriptPath = path.join(workspaceDir, scriptName);
  fs.writeFileSync(scriptPath, code, "utf8");
  if (lang === "shell") fs.chmodSync(scriptPath, 0o755);

  let result: { stdout: string; stderr: string; exitCode: number; durationMs: number };

  if (lang === "python") {
    const pythonCmd = await findPythonCmd();
    result = await runProcess([pythonCmd, scriptPath], workspaceDir, lang);
  } else if (lang === "shell") {
    result = await runProcess(["bash", scriptPath], workspaceDir, lang);
  } else {
    result = await runProcess(["node", scriptPath], workspaceDir, lang);
  }

  // Clean up the script file
  try { fs.unlinkSync(scriptPath); } catch {}

  // Detect new/modified files
  const filesCreated: string[] = [];
  const filesModified: string[] = [];

  if (fs.existsSync(workspaceDir)) {
    for (const f of fs.readdirSync(workspaceDir)) {
      if (f.startsWith("_run.")) continue; // skip temp scripts
      const stat = fs.statSync(path.join(workspaceDir, f));
      const key = `${f}:${stat.mtimeMs}`;
      const wasPresent = Array.from(before).some((b) => b.startsWith(`${f}:`));
      if (!wasPresent) {
        filesCreated.push(f);
      } else if (!before.has(key)) {
        filesModified.push(f);
      }
    }
  }

  return {
    ...result,
    language: lang,
    filesCreated,
    filesModified,
  };
}
