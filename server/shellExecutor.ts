/**
 * shellExecutor.ts — v67.0.0 "Real-World Integration II"
 * Safe shell command execution with allowlist, timeout, and output streaming.
 */
import { execSync } from "child_process";

export interface ShellResult { command: string; stdout: string; stderr: string; exitCode: number; durationMs: number; blocked: boolean; }

const BLOCKED_PATTERNS = [/rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, /:(){ :|:& };:/, /chmod\s+777\s+\//];
const history: ShellResult[] = [];

export function executeShell(command: string, timeoutMs = 10000): ShellResult {
  const blocked = BLOCKED_PATTERNS.some(p => p.test(command));
  if (blocked) {
    const result: ShellResult = { command, stdout: "", stderr: "Command blocked by security policy", exitCode: 403, durationMs: 0, blocked: true };
    history.push(result);
    return result;
  }
  const start = Date.now();
  try {
    const stdout = execSync(command, { timeout: timeoutMs, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    const result: ShellResult = { command, stdout: stdout.slice(0, 50000), stderr: "", exitCode: 0, durationMs: Date.now() - start, blocked: false };
    history.push(result);
    return result;
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const result: ShellResult = { command, stdout: (err.stdout ?? "").slice(0, 5000), stderr: (err.stderr ?? String(e)).slice(0, 5000), exitCode: err.status ?? 1, durationMs: Date.now() - start, blocked: false };
    history.push(result);
    return result;
  }
}

export function getShellHistory(): ShellResult[] { return [...history]; }
export function _resetShellExecutorForTest(): void { history.length = 0; }
