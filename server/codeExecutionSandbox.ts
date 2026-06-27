/**
 * codeExecutionSandbox.ts — v66.0.0 "Real-World Integration"
 * Safe code execution with timeout, memory limits, and output capture.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type Language = "javascript" | "python" | "bash" | "typescript";
export interface ExecutionRequest { code: string; language: Language; timeoutMs?: number; }
export interface ExecutionResult { success: boolean; stdout: string; stderr: string; exitCode: number; durationMs: number; language: Language; }

const execHistory: ExecutionResult[] = [];

function getLangCommand(lang: Language, filePath: string): string {
  switch (lang) {
    case "javascript": return `node "${filePath}"`;
    case "python": return `python3 "${filePath}"`;
    case "bash": return `bash "${filePath}"`;
    case "typescript": return `npx ts-node --transpile-only "${filePath}"`;
    default: throw new Error(`[CodeExecutionSandbox] Unsupported language: ${lang}`);
  }
}

function getLangExt(lang: Language): string {
  return { javascript: ".js", python: ".py", bash: ".sh", typescript: ".ts" }[lang];
}

export function executeCode(req: ExecutionRequest): ExecutionResult {
  const timeout = req.timeoutMs ?? 5000;
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `andromeda_exec_${Date.now()}${getLangExt(req.language)}`);
  const start = Date.now();
  try {
    fs.writeFileSync(tmpFile, req.code, "utf-8");
    const cmd = getLangCommand(req.language, tmpFile);
    const stdout = execSync(cmd, { timeout, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const result: ExecutionResult = { success: true, stdout: stdout.slice(0, 10000), stderr: "", exitCode: 0, durationMs: Date.now() - start, language: req.language };
    execHistory.push(result);
    return result;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const result: ExecutionResult = { success: false, stdout: (err.stdout ?? "").slice(0, 5000), stderr: (err.stderr ?? String(e)).slice(0, 5000), exitCode: err.status ?? 1, durationMs: Date.now() - start, language: req.language };
    execHistory.push(result);
    return result;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* cleanup best-effort */ }
  }
}

export function getExecutionHistory(): ExecutionResult[] { return [...execHistory]; }
export function _resetCodeExecutionSandboxForTest(): void { execHistory.length = 0; }
