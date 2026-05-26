/**
 * bashExecute.ts — Shell Execution Tool (Cross-Platform)
 * Andromeda v5.38
 *
 * v5.38 FIX: Detects Windows and uses PowerShell/cmd.exe instead of /bin/bash.
 * On Linux/macOS, uses bash as before.
 * On Windows, uses PowerShell (preferred) or cmd.exe as fallback.
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { spawn } from "child_process";
import { platform } from "os";

const TIMEOUT_MS = 30_000;
const IS_WINDOWS = platform() === "win32";

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,
  /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;?\s*:/,   // fork bomb
  /dd\s+if=.*of=\/dev\//,
  /mkfs\./,
  /sudo\s+rm\s+-rf/,
  /shutdown|reboot|init\s+[06]/,
  /chmod\s+777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  // Windows-specific dangerous patterns
  /format\s+[a-z]:/i,
  /del\s+\/[sfq]\s+[a-z]:\\/i,
  /rd\s+\/s\s+\/q\s+[a-z]:\\/i,
];

/**
 * Get the shell command and arguments for the current platform.
 */
function getShellConfig(command: string): { shell: string; args: string[] } {
  if (IS_WINDOWS) {
    // Use PowerShell on Windows — it's available on all modern Windows
    // and handles most bash-like commands better than cmd.exe
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", command],
    };
  }
  // Linux/macOS: use bash
  return {
    shell: "bash",
    args: ["-c", command],
  };
}

async function executeBash(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const command = String(args.command ?? "");
  if (!command.trim()) {
    return { success: false, output: "", error: "command is required" };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { success: false, output: "", error: "Command contains dangerous patterns and was blocked for safety." };
    }
  }

  try {
    const { shell, args: shellArgs } = getShellConfig(command);

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(shell, shellArgs, {
        cwd: ctx.workspaceDir,
        timeout: TIMEOUT_MS,
        signal: ctx.signal,
        // On Windows, don't inherit the shell — spawn directly
        ...(IS_WINDOWS ? { windowsHide: true } : {}),
      });

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
    });

    const output = (result.stdout + (result.stderr ? `\nSTDERR: ${result.stderr}` : "")).slice(0, 200_000);
    if (result.exitCode !== 0) {
      return { success: false, output: result.stdout, error: result.stderr || `Exit code: ${result.exitCode}` };
    }
    return { success: true, output };
  } catch (err) {
    return { success: false, output: "", error: `Shell execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "bash_execute",
  description: IS_WINDOWS
    ? "Execute a PowerShell command in the workspace directory. Use for file operations, package installation, git commands, and system tasks."
    : "Execute a bash command in the workspace directory. Use for file operations, package installation, git commands, and system tasks.",
  category: "code",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "bash_execute",
      description: IS_WINDOWS
        ? "Execute a PowerShell command in the workspace directory. Returns stdout and stderr. On this Windows system, commands run via PowerShell. Use for file operations, installing packages, git commands, and system tasks."
        : "Execute a bash shell command in the workspace directory. Returns stdout and stderr. Use for file operations, installing packages, git commands, and system administration tasks.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: IS_WINDOWS ? "The PowerShell command to execute" : "The bash command to execute" },
        },
        required: ["command"],
      },
    },
  },
  execute: executeBash,
});
