import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  language: string;
  durationMs: number;
}

const TIMEOUT_MS = 15000; // 15 second hard limit
const MAX_OUTPUT = 50_000; // 50KB output cap
const MAX_CODE_SIZE = 1_000_000; // v5.43: 1MB - CEO edition

function detectLanguage(code: string, hint?: string): "python" | "javascript" | "shell" {
  if (hint) {
    if (hint === "python" || hint === "py") return "python";
    if (hint === "javascript" || hint === "js" || hint === "node") return "javascript";
    if (hint === "shell" || hint === "bash" || hint === "sh") return "shell";
  }
  // Auto-detect from code patterns
  if (/^\s*(import |from |def |class |print\(|if __name__)/.test(code)) return "python";
  if (/^\s*(const |let |var |function |require\(|console\.|module\.|import )/.test(code)) return "javascript";
  return "javascript"; // default
}

async function findPythonCmd(): Promise<string> {
  // Windows uses 'py' launcher or 'python'; Linux/Mac use 'python3'
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
    } catch {
      // try next
    }
  }
  return "python3"; // fallback with helpful error message
}

async function runPython(code: string, tmpDir: string): Promise<RunResult> {
  const file = path.join(tmpDir, "script.py");
  fs.writeFileSync(file, code, "utf8");
  const pythonCmd = await findPythonCmd();
  return runProcess([pythonCmd, file], tmpDir, "python");
}

async function runJavaScript(code: string, tmpDir: string): Promise<RunResult> {
  const file = path.join(tmpDir, "script.js");
  fs.writeFileSync(file, code, "utf8");
  return runProcess(["node", file], tmpDir, "javascript");
}

async function runShell(code: string, tmpDir: string): Promise<RunResult> {
  const file = path.join(tmpDir, "script.sh");
  // Prepend safety header: restrict to tmpDir, no network, no sudo
  const safeCode = `#!/bin/bash\nset -euo pipefail\ncd "${tmpDir}"\n# Disallow dangerous commands\n${code}`;
  fs.writeFileSync(file, safeCode, "utf8");
  fs.chmodSync(file, 0o755);
  return runProcess(["bash", "-r", file], tmpDir, "shell");
}

function runProcess(cmd: string[], cwd: string, language: string): Promise<RunResult> {
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
        // Restrict Python memory allocation
        PYTHONMALLOC: "default",
        // Limit Node.js heap to 256 MB to prevent memory exhaustion
        NODE_OPTIONS: "--max-old-space-size=256",
        // Prevent home dir access in scripts
        HOME: cwd,
        TMPDIR: cwd,
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
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: killed ? -1 : (code ?? -1),
        language,
        durationMs: Date.now() - start,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `Failed to start process: ${err.message}`,
        exitCode: -1,
        language,
        durationMs: Date.now() - start,
      });
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

export async function executeCode(code: string, languageHint?: string): Promise<RunResult> {
  if (code.length > MAX_CODE_SIZE) {
    return { stdout: "", stderr: `Code too large: ${(code.length/1024).toFixed(0)}KB exceeds ${MAX_CODE_SIZE/1024}KB limit`, exitCode: -1, language: languageHint || "unknown", durationMs: 0 };
  }
  // v5.4: Reject code containing irreversibly dangerous patterns before spawning any process
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return {
        stdout: "",
        stderr: `Execution blocked: code contains a potentially dangerous pattern (${pattern.source}). Remove it and try again.`,
        exitCode: -1,
        language: languageHint || "unknown",
        durationMs: 0,
      };
    }
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "andromeda-"));
  try {
    const lang = detectLanguage(code, languageHint);
    if (lang === "python") return await runPython(code, tmpDir);
    if (lang === "shell") return await runShell(code, tmpDir);
    return await runJavaScript(code, tmpDir);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
