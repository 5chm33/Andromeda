/**
 * dockerSandbox.ts — Docker Sandbox Execution Tool
 * Andromeda v6.14
 *
 * Provides isolated code execution inside a Docker container.
 * Falls back to E2B cloud sandbox (if ANDROMEDA_E2B_API_KEY is set),
 * then to local execution if Docker is not available.
 *
 * v6.14 hardening:
 *  - Windows Docker Desktop path fix: C:\Users\... -> /c/Users/... (WSL-style)
 *  - Both persistent-session and one-shot paths get the same path conversion
 *  - Added --no-new-privileges, --cap-drop ALL security flags
 *  - E2B cloud sandbox fallback (set ANDROMEDA_E2B_API_KEY env var)
 *  - Improved error messages with actionable guidance for Windows users
 *
 * v5.39 features retained:
 *  - Persistent container sessions (reuse containers across tool calls)
 *  - Workspace volume mounting (agent can read/write project files from inside container)
 *  - Auto-pull missing images
 *  - Container health monitoring
 */
import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { spawn, execSync } from "child_process";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { platform } from "os";

const IS_WINDOWS = platform() === "win32";
const SANDBOX_IMAGE = process.env.ANDROMEDA_SANDBOX_IMAGE ?? "python:3.12-slim";
const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 500_000;

// ─── Windows Path Conversion ────────────────────────────────────────────────
/**
 * Convert a Windows path to Docker-compatible format.
 *
 * Docker Desktop on Windows requires paths in WSL/POSIX style:
 *   C:\Users\alice\project  ->  /c/Users/alice/project
 *
 * This handles:
 *  - Drive letter + colon (C:\ -> /c/)
 *  - Backslash -> forward slash
 *  - UNC paths (\\server\share -> //server/share)
 */
function toDockerPath(p: string): string {
  if (!IS_WINDOWS) return p;
  // UNC path: \\server\share\...
  if (p.startsWith("\\\\")) {
    return p.replace(/\\/g, "/");
  }
  // Drive letter: C:\... -> /c/...
  const driveMatch = p.match(/^([A-Za-z]):[\\\/](.*)/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, "/");
    return `/${drive}/${rest}`;
  }
  // Fallback: just replace backslashes
  return p.replace(/\\/g, "/");
}

// ─── Docker Availability Check ──────────────────────────────────────────────
let dockerAvailable: boolean | null = null;
let dockerLastCheck = 0;
const DOCKER_CHECK_INTERVAL_MS = 60_000;

export function checkDockerAvailability(): boolean {
  return checkDocker();
}

function checkDocker(): boolean {
  const now = Date.now();
  if (dockerAvailable !== null && now - dockerLastCheck < DOCKER_CHECK_INTERVAL_MS) {
    return dockerAvailable;
  }
  dockerLastCheck = now;
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    if (!dockerAvailable) console.log("[Docker] Sandbox is now available");
    dockerAvailable = true;
  } catch {
    if (dockerAvailable !== false) {
      console.warn("[Docker] Sandbox unavailable — will try E2B cloud sandbox or fall back to local execution");
      if (IS_WINDOWS) {
        console.warn("[Docker] Windows tip: Ensure Docker Desktop is running and WSL2 integration is enabled.");
      }
    }
    dockerAvailable = false;
  }
  return dockerAvailable;
}

// ─── E2B Cloud Sandbox Fallback ─────────────────────────────────────────────
/**
 * Execute code via E2B cloud sandbox API.
 * Requires ANDROMEDA_E2B_API_KEY environment variable.
 * E2B provides secure cloud-based code execution without local Docker.
 * See: https://e2b.dev/docs
 */
async function executeViaE2B(
  code: string,
  language: string,
  packages: string[],
): Promise<ToolResult | null> {
  const apiKey = process.env.ANDROMEDA_E2B_API_KEY;
  if (!apiKey) return null;

  try {
    // Dynamically require E2B SDK if available (optional dependency)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const e2b = await Promise.resolve().then(() => require("@e2b/code-interpreter")).catch(() => null);
    if (!e2b) {
      console.warn("[E2B] @e2b/code-interpreter package not installed. Run: pnpm add @e2b/code-interpreter");
      return null;
    }

    const sandbox = await (e2b as any).CodeInterpreter.create({ apiKey });
    try {
      if (packages.length > 0 && language === "python") {
        await sandbox.notebook.execCell(`!pip install -q ${packages.join(" ")}`);
      }
      const result = await sandbox.notebook.execCell(code);
      const output = result.logs.stdout.join("\n") + (result.logs.stderr.length > 0 ? `\nSTDERR: ${result.logs.stderr.join("\n")}` : "");
      return {
        success: !result.error,
        output: `[E2B cloud sandbox]\n${output}`.slice(0, MAX_OUTPUT),
        error: result.error ? String(result.error) : undefined,
      };
    } finally {
      await sandbox.close();
    }
  } catch (err) {
    console.error("[E2B] Execution failed:", err);
    return null;
  }
}

// ─── v5.39: Persistent Container Sessions ──────────────────────────────────
interface ContainerSession {
  containerId: string;
  image: string;
  createdAt: number;
  lastUsed: number;
  workspaceDir: string;
}

const activeSessions = new Map<string, ContainerSession>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes idle timeout

// Cleanup idle sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of Array.from(activeSessions)) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      try {
        execSync(`docker rm -f ${session.containerId}`, { stdio: "ignore", timeout: 5000 });
        console.log(`[Docker] Cleaned up idle session: ${key}`);
      } catch {}
      activeSessions.delete(key);
    }
  }
}, 30_000);

/**
 * Get or create a persistent container session for the given workspace.
 */
async function getOrCreateSession(
  workspaceDir: string,
  image: string,
): Promise<ContainerSession | null> {
  const sessionKey = `${workspaceDir}:${image}`;
  const existing = activeSessions.get(sessionKey);

  if (existing) {
    try {
      const status = execSync(`docker inspect -f "{{.State.Running}}" ${existing.containerId}`, {
        timeout: 5000,
        encoding: "utf-8",
      }).trim();
      if (status === "true") {
        existing.lastUsed = Date.now();
        return existing;
      }
    } catch {}
    activeSessions.delete(sessionKey);
  }

  const containerId = `andromeda-session-${randomUUID().slice(0, 8)}`;
  try {
    try {
      execSync(`docker image inspect ${image}`, { stdio: "ignore", timeout: 10000 });
    } catch {
      console.log(`[Docker] Pulling image: ${image}...`);
      execSync(`docker pull ${image}`, { stdio: "ignore", timeout: 120000 });
    }

    // v6.14: Use toDockerPath() for Windows Docker Desktop compatibility
    const workspaceMount = toDockerPath(workspaceDir);

    execSync([
      "docker", "run", "-d",
      "--name", containerId,
      "--memory", "1g",
      "--cpus", "2",
      "--pids-limit", "200",
      "--tmpfs", "/tmp:rw,size=200m",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "-v", `${workspaceMount}:/workspace`,
      "-w", "/workspace",
      image,
      "tail", "-f", "/dev/null",
    ].join(" "), { timeout: 30000 });

    const session: ContainerSession = {
      containerId,
      image,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      workspaceDir,
    };
    activeSessions.set(sessionKey, session);
    console.log(`[Docker] Created persistent session: ${containerId} (${image})`);
    return session;
  } catch (err) {
    console.error(`[Docker] Failed to create session: ${err}`);
    return null;
  }
}

// ─── Sandbox Execution Dispatcher ──────────────────────────────────────────
async function executeSandbox(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const code = String(args.code ?? "");
  const language = String(args.language ?? "python").toLowerCase();
  const packages = (args.packages as string[]) ?? [];
  const persistent = args.persistent !== false;

  if (!code.trim()) {
    return { success: false, output: "", error: "code is required" };
  }

  const useDocker = checkDocker();

  if (useDocker) {
    if (persistent) {
      return executeInPersistentContainer(code, language, packages, ctx);
    }
    return executeInDocker(code, language, packages, ctx);
  }

  // Try E2B cloud sandbox
  const e2bResult = await executeViaE2B(code, language, packages);
  if (e2bResult !== null) return e2bResult;

  // Local fallback
  return executeLocal(code, language, ctx);
}

// ─── v5.39: Persistent Container Execution ─────────────────────────────────
async function executeInPersistentContainer(
  code: string,
  language: string,
  packages: string[],
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  let image: string;
  let ext: string;
  let runCmd: string;

  switch (language) {
    case "python":
      image = "python:3.12-slim";
      ext = ".py";
      runCmd = packages.length > 0
        ? `pip install -q ${packages.join(" ")} && python /tmp/code.py`
        : "python /tmp/code.py";
      break;
    case "javascript":
    case "node":
      image = "node:22-slim";
      ext = ".js";
      runCmd = "node /tmp/code.js";
      break;
    case "bash":
    case "shell":
      image = "ubuntu:22.04";
      ext = ".sh";
      runCmd = "bash /tmp/code.sh";
      break;
    default:
      image = "python:3.12-slim";
      ext = ".py";
      runCmd = "python /tmp/code.py";
  }

  const session = await getOrCreateSession(ctx.workspaceDir, image);
  if (!session) {
    return executeInDocker(code, language, packages, ctx);
  }

  try {
    const codeFile = `code${ext}`;
    execSync(
      `docker exec ${session.containerId} sh -c 'cat > /tmp/${codeFile}' <<'ANDROMEDA_EOF'\n${code}\nANDROMEDA_EOF`,
      { timeout: 10000, input: code }
    );

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn("docker", ["exec", session.containerId, "sh", "-c", runCmd], {
        timeout: TIMEOUT_MS,
        signal: ctx.signal,
      });
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
    });

    const output = (result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : "")).slice(0, MAX_OUTPUT);
    if (result.exitCode !== 0) {
      return { success: false, output: result.stdout.slice(0, MAX_OUTPUT), error: result.stderr || `Exit code: ${result.exitCode}` };
    }
    return { success: true, output: `[Docker persistent session: ${session.containerId.slice(0, 12)}]\n${output}` };
  } catch (err) {
    return { success: false, output: "", error: `Persistent execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── One-shot Docker Execution ─────────────────────────────────────────────
async function executeInDocker(
  code: string,
  language: string,
  packages: string[],
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const containerId = `andromeda-sandbox-${randomUUID().slice(0, 8)}`;
  const tmpDir = join(ctx.workspaceDir, ".sandbox-tmp");
  await mkdir(tmpDir, { recursive: true });

  let image = SANDBOX_IMAGE;
  let ext = ".py";
  let cmd: string[];

  switch (language) {
    case "python":
      image = "python:3.12-slim";
      ext = ".py";
      cmd = packages.length > 0
        ? ["bash", "-c", `pip install -q ${packages.join(" ")} && python /workspace/code${ext}`]
        : ["python", `/workspace/code${ext}`];
      break;
    case "javascript":
    case "node":
      image = "node:22-slim";
      ext = ".js";
      cmd = ["node", `/workspace/code${ext}`];
      break;
    case "bash":
    case "shell":
      image = "ubuntu:22.04";
      ext = ".sh";
      cmd = ["bash", `/workspace/code${ext}`];
      break;
    default:
      image = "python:3.12-slim";
      ext = ".py";
      cmd = ["python", `/workspace/code${ext}`];
  }

  const codeFile = join(tmpDir, `code${ext}`);
  await writeFile(codeFile, code, "utf-8");

  // v6.14: Convert path for Docker Desktop on Windows
  const mountPath = toDockerPath(tmpDir);

  try {
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn("docker", [
        "run", "--rm",
        "--name", containerId,
        "--network", "none",
        "--memory", "512m",
        "--cpus", "1",
        "--pids-limit", "100",
        "--read-only",
        "--tmpfs", "/tmp:rw,size=100m",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "-v", `${mountPath}:/workspace:ro`,
        image,
        ...cmd,
      ], {
        timeout: TIMEOUT_MS,
        signal: ctx.signal,
      });
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      proc.on("error", (err) => {
        try { execSync(`docker kill ${containerId}`, { stdio: "ignore" }); } catch {}
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });

    const output = (result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : "")).slice(0, MAX_OUTPUT);
    await unlink(codeFile).catch(() => {});

    if (result.exitCode !== 0) {
      return { success: false, output: result.stdout.slice(0, MAX_OUTPUT), error: result.stderr || `Exit code: ${result.exitCode}` };
    }
    return { success: true, output };
  } catch (err) {
    try { execSync(`docker kill ${containerId}`, { stdio: "ignore" }); } catch {}
    await unlink(codeFile).catch(() => {});
    return { success: false, output: "", error: `Docker execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Local Fallback ────────────────────────────────────────────────────────
async function executeLocal(
  code: string,
  language: string,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  let cmd: string;
  let ext: string;

  switch (language) {
    case "javascript":
    case "node":
      cmd = "node";
      ext = ".js";
      break;
    case "bash":
    case "shell":
      if (IS_WINDOWS) {
        cmd = "powershell.exe";
        ext = ".ps1";
      } else {
        cmd = "bash";
        ext = ".sh";
      }
      break;
    default:
      cmd = IS_WINDOWS ? "python" : "python3";
      ext = ".py";
  }

  const filename = `sandbox_${randomUUID().slice(0, 8)}${ext}`;
  const filepath = join(ctx.workspaceDir, filename);

  try {
    await writeFile(filepath, code, "utf-8");
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(cmd, [filepath], {
        cwd: ctx.workspaceDir,
        timeout: TIMEOUT_MS,
        signal: ctx.signal,
        ...(IS_WINDOWS ? { windowsHide: true } : {}),
      });
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
    });

    await unlink(filepath).catch(() => {});
    const output = (result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : "")).slice(0, MAX_OUTPUT);
    if (result.exitCode !== 0) {
      return { success: false, output: result.stdout.slice(0, MAX_OUTPUT), error: result.stderr || `Exit code: ${result.exitCode}` };
    }
    return { success: true, output: `[Local execution — Docker not available]\n${output}` };
  } catch (err) {
    await unlink(filepath).catch(() => {});
    return { success: false, output: "", error: `Local execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── v5.39: Cleanup all sessions on shutdown ───────────────────────────────
export function cleanupAllSessions(): void {
  for (const [key, session] of Array.from(activeSessions)) {
    try {
      execSync(`docker rm -f ${session.containerId}`, { stdio: "ignore", timeout: 5000 });
    } catch {}
    activeSessions.delete(key);
  }
}

// ─── Register ───────────────────────────────────────────────────────────────
registerTool({
  name: "sandbox_execute",
  description: "Execute code in an isolated Docker sandbox (or E2B cloud sandbox / local fallback if Docker is unavailable). Supports Python, JavaScript/Node.js, and Bash. v6.14: Windows Docker Desktop path fix, --cap-drop ALL, E2B fallback.",
  category: "sandbox",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "sandbox_execute",
      description: "Execute code in an isolated Docker sandbox. The sandbox has limited CPU/memory for safety. Supports Python, JavaScript, and Bash. Use for untrusted code, complex computations, or when you need package installations. Falls back to E2B cloud sandbox (if ANDROMEDA_E2B_API_KEY is set) or local execution if Docker is unavailable. Persistent sessions keep state between calls. On Windows, requires Docker Desktop with WSL2 integration enabled.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The code to execute" },
          language: {
            type: "string",
            description: "Programming language: python, javascript, or bash (default: python)",
            enum: ["python", "javascript", "bash"],
          },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Python packages to install before execution (only for Python)",
          },
          persistent: {
            type: "boolean",
            description: "Use a persistent container session that keeps state between calls (default: true)",
          },
        },
        required: ["code"],
      },
    },
  },
  execute: executeSandbox,
});
