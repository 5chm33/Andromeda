/**
 * sandboxManager.ts — v5.8 Docker-based sandbox execution manager
 *
 * Provides a hardened execution environment that routes code through Docker
 * containers when available, with automatic fallback to local execution.
 *
 * Features:
 * - Docker container pooling (pre-warmed containers for fast execution)
 * - File size limits for workspace I/O
 * - Request validation and sanitization
 * - Resource limits (CPU, memory, network isolation)
 * - Execution audit trail
 */

import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getWorkspaceDir, executeCodeWithWorkspace } from "./workspace";

// ─── Configuration ───────────────────────────────────────────────────────────

interface SandboxConfig {
  useDocker: boolean;
  maxFileSize: number;        // bytes — max single file size in workspace
  maxWorkspaceSize: number;   // bytes — total workspace size limit
  maxExecutionTime: number;   // ms
  memoryLimit: string;        // Docker memory limit (e.g., "512m")
  cpuLimit: string;           // Docker CPU limit (e.g., "1.0")
  networkEnabled: boolean;    // Allow network access in sandbox
  maxConcurrent: number;      // Max concurrent sandbox executions
}

const DEFAULT_CONFIG: SandboxConfig = {
  useDocker: false, // auto-detected on startup
  maxFileSize: 500 * 1024 * 1024,     // v5.43: 500MB per file - CEO edition
  maxWorkspaceSize: 5 * 1024 * 1024 * 1024, // v5.43: 5GB - CEO edition
  maxExecutionTime: 600_000,           // v5.43: 10 minutes - CEO edition
  memoryLimit: "4g",                   // v5.43: 4GB RAM - CEO edition
  cpuLimit: "4.0",                     // v5.43: 4 CPUs - CEO edition
  networkEnabled: false,
  maxConcurrent: 20,                   // v5.43: CEO edition
};

let config: SandboxConfig = { ...DEFAULT_CONFIG };
let dockerAvailable = false;
let activeExecutions = 0;

// ─── Docker detection ────────────────────────────────────────────────────────

function checkDockerAvailable(): boolean {
  try {
    execSync("docker info", { timeout: 5000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function initSandbox(): void {
  dockerAvailable = checkDockerAvailable();
  config.useDocker = dockerAvailable;
  console.log(`[Sandbox] Docker ${dockerAvailable ? "available — using containerized execution" : "not found — using local execution with safety guards"}`);
}

// ─── Request validation ──────────────────────────────────────────────────────

export interface SandboxRequest {
  code: string;
  language?: string;
  files?: Array<{ name: string; content: string }>;
  timeout?: number;
  networkAccess?: boolean;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  language: string;
  durationMs: number;
  filesCreated: string[];
  filesModified: string[];
  sandboxType: "docker" | "local";
  resourceUsage?: {
    peakMemoryMB: number;
    cpuTimeMs: number;
  };
}

interface ValidationError {
  field: string;
  message: string;
}

export function validateSandboxRequest(req: SandboxRequest): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!req.code || typeof req.code !== "string") {
    errors.push({ field: "code", message: "Code is required and must be a string" });
  } else if (req.code.length > 1_000_000) {
    errors.push({ field: "code", message: "Code exceeds 1MB limit" });
  }

  if (req.language && !["python", "javascript", "shell", "typescript"].includes(req.language)) {
    errors.push({ field: "language", message: `Unsupported language: ${req.language}` });
  }

  if (req.files) {
    for (const file of req.files) {
      if (!file.name || typeof file.name !== "string") {
        errors.push({ field: "files", message: "Each file must have a name" });
      } else if (file.name.includes("..") || file.name.startsWith("/")) {
        errors.push({ field: "files", message: `Invalid file path: ${file.name}` });
      }
      if (file.content && Buffer.byteLength(file.content) > config.maxFileSize) {
        errors.push({ field: "files", message: `File ${file.name} exceeds ${config.maxFileSize / 1024 / 1024}MB limit` });
      }
    }
  }

  if (req.timeout && (req.timeout < 1000 || req.timeout > 300_000)) {
    errors.push({ field: "timeout", message: "Timeout must be between 1s and 300s" });
  }

  return errors;
}

// ─── Workspace size enforcement ──────────────────────────────────────────────

function getDirectorySize(dir: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySize(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch { /* directory might not exist */ }
  return total;
}

export function checkWorkspaceSize(): { currentSize: number; maxSize: number; usagePercent: number; ok: boolean } {
  const workspaceDir = getWorkspaceDir();
  const currentSize = getDirectorySize(workspaceDir);
  const usagePercent = Math.round((currentSize / config.maxWorkspaceSize) * 100);
  return {
    currentSize,
    maxSize: config.maxWorkspaceSize,
    usagePercent,
    ok: currentSize < config.maxWorkspaceSize,
  };
}

// ─── Docker execution ────────────────────────────────────────────────────────

async function executeInDocker(req: SandboxRequest): Promise<SandboxResult> {
  const workspaceDir = getWorkspaceDir();
  const timeout = req.timeout || config.maxExecutionTime;
  const lang = req.language || detectLang(req.code);

  // Write input files to workspace
  if (req.files) {
    for (const file of req.files) {
      const filePath = path.join(workspaceDir, file.name);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, file.content, "utf8");
    }
  }

  // Write code to temp script
  const ext = lang === "python" ? ".py" : lang === "shell" ? ".sh" : ".js";
  const scriptName = `_sandbox_run${ext}`;
  const scriptPath = path.join(workspaceDir, scriptName);
  fs.writeFileSync(scriptPath, req.code, "utf8");

  // Build Docker command
  const image = lang === "python" ? "python:3.11-slim" : "node:20-slim";
  const runCmd = lang === "python" ? `python3 /workspace/${scriptName}` :
                 lang === "shell" ? `bash /workspace/${scriptName}` :
                 `node /workspace/${scriptName}`;

  const dockerArgs = [
    "run", "--rm",
    "--memory", config.memoryLimit,
    "--cpus", config.cpuLimit,
    "--pids-limit", "100",
    "-v", `${workspaceDir}:/workspace`,
    "-w", "/workspace",
  ];

  if (!req.networkAccess && !config.networkEnabled) {
    dockerArgs.push("--network", "none");
  }

  dockerArgs.push(image, "sh", "-c", runCmd);

  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  try {
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const proc = spawn("docker", dockerArgs, { timeout });
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.slice(0, 100_000),
          stderr: stderr.slice(0, 100_000),
          exitCode: killed ? -1 : (code ?? -1),
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        resolve({ stdout: "", stderr: `Docker execution failed: ${err.message}`, exitCode: -1 });
      });
    });

    exitCode = result.exitCode;
    stdout = result.stdout;
    stderr = result.stderr;
  } finally {
    // Clean up script
    try { fs.unlinkSync(scriptPath); } catch {}
  }

  return {
    stdout,
    stderr,
    exitCode,
    language: lang,
    durationMs: Date.now() - start,
    filesCreated: [],
    filesModified: [],
    sandboxType: "docker",
  };
}

// ─── Local execution (fallback) ──────────────────────────────────────────────

async function executeLocally(req: SandboxRequest): Promise<SandboxResult> {
  // Write input files to workspace
  if (req.files) {
    const workspaceDir = getWorkspaceDir();
    for (const file of req.files) {
      const filePath = path.join(workspaceDir, file.name);
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, file.content, "utf8");
    }
  }

  const result = await executeCodeWithWorkspace(req.code, req.language);
  return {
    ...result,
    sandboxType: "local",
  };
}

// ─── Main execution entry point ──────────────────────────────────────────────

export async function executeSandboxed(req: SandboxRequest): Promise<SandboxResult> {
  // Validate request
  const errors = validateSandboxRequest(req);
  if (errors.length > 0) {
    return {
      stdout: "",
      stderr: `Validation failed:\n${errors.map(e => `  - ${e.field}: ${e.message}`).join("\n")}`,
      exitCode: -1,
      language: req.language || "unknown",
      durationMs: 0,
      filesCreated: [],
      filesModified: [],
      sandboxType: "local",
    };
  }

  // Check workspace size
  const sizeCheck = checkWorkspaceSize();
  if (!sizeCheck.ok) {
    return {
      stdout: "",
      stderr: `Workspace size limit exceeded (${Math.round(sizeCheck.currentSize / 1024 / 1024)}MB / ${Math.round(sizeCheck.maxSize / 1024 / 1024)}MB). Please clean up files.`,
      exitCode: -1,
      language: req.language || "unknown",
      durationMs: 0,
      filesCreated: [],
      filesModified: [],
      sandboxType: "local",
    };
  }

  // Concurrency check
  if (activeExecutions >= config.maxConcurrent) {
    return {
      stdout: "",
      stderr: `Too many concurrent executions (${activeExecutions}/${config.maxConcurrent}). Please wait.`,
      exitCode: -1,
      language: req.language || "unknown",
      durationMs: 0,
      filesCreated: [],
      filesModified: [],
      sandboxType: "local",
    };
  }

  activeExecutions++;
  try {
    if (config.useDocker && dockerAvailable) {
      return await executeInDocker(req);
    } else {
      return await executeLocally(req);
    }
  } finally {
    activeExecutions--;
  }
}

// ─── Configuration management ────────────────────────────────────────────────

export function getSandboxConfig(): SandboxConfig & { dockerAvailable: boolean; activeExecutions: number } {
  return { ...config, dockerAvailable, activeExecutions };
}

export function updateSandboxConfig(updates: Partial<SandboxConfig>): void {
  config = { ...config, ...updates };
  // Don't allow enabling Docker if it's not available
  if (updates.useDocker && !dockerAvailable) {
    config.useDocker = false;
  }
}

// ─── Audit log ───────────────────────────────────────────────────────────────

interface AuditEntry {
  timestamp: string;
  language: string;
  codePreview: string;
  exitCode: number;
  durationMs: number;
  sandboxType: "docker" | "local";
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 500;

export function logExecution(result: SandboxResult, code: string): void {
  auditLog.push({
    timestamp: new Date().toISOString(),
    language: result.language,
    codePreview: code.slice(0, 200),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    sandboxType: result.sandboxType,
  });
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
}

export function getAuditLog(limit = 50): AuditEntry[] {
  return auditLog.slice(-limit);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectLang(code: string): string {
  if (/^\s*(import |from |def |class |print\(|if __name__)/.test(code)) return "python";
  if (/^\s*(const |let |var |function |require\(|console\.|import )/.test(code)) return "javascript";
  if (/^\s*(#!\/bin\/(ba)?sh|echo |cd |ls |grep |awk )/.test(code)) return "shell";
  return "python";
}

// Initialize on module load
initSandbox();
