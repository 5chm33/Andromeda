/**
 * pythonExecute.ts — Python Code Execution Tool (Cross-Platform)
 * Andromeda v5.38
 *
 * v5.38 FIX: Detects Windows and uses 'python' or 'py' instead of 'python3'.
 * On Windows, Python is typically installed as 'python' or 'py', not 'python3'.
 */

import { registerTool } from "./toolRegistry";
import type { ToolExecutionContext, ToolResult } from "./toolRegistry";
import { spawn, execSync } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { platform } from "os";

const TIMEOUT_MS = 60_000;
const IS_WINDOWS = platform() === "win32";

/**
 * Detect the correct Python command for this platform.
 * Tries python3, python, py in order.
 */
let _pythonCmd: string | null = null;
function getPythonCommand(): string {
  if (_pythonCmd) return _pythonCmd;

  const candidates = IS_WINDOWS
    ? ["python", "py", "python3"]
    : ["python3", "python"];

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: "pipe", timeout: 5000 });
      _pythonCmd = cmd;
      return cmd;
    } catch {
      // Try next candidate
    }
  }

  // Fallback — will likely fail but gives a clear error
  _pythonCmd = IS_WINDOWS ? "python" : "python3";
  return _pythonCmd;
}

const DANGEROUS_PATTERNS = [
  /\bos\.system\s*\(\s*["'].*?(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot)/i,
  /\bsubprocess\.(run|call|Popen)\s*\(\s*\[?\s*["'].*?(rm\s+-rf\s+\/|mkfs|dd\s+if=)/i,
  /\bshutil\.rmtree\s*\(\s*["']\//i,
  /\b__import__\s*\(\s*["']os["']\s*\)\s*\.system/i,
];

async function executePython(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const code = String(args.code ?? "");
  if (!code.trim()) {
    return { success: false, output: "", error: "code is required" };
  }

  // Safety check
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      return { success: false, output: "", error: "Code contains dangerous patterns and was blocked for safety." };
    }
  }

  const filename = `andromeda_exec_${randomUUID().slice(0, 8)}.py`;
  const filepath = join(ctx.workspaceDir, filename);

  try {
    await writeFile(filepath, code, "utf-8");

    const pythonCmd = getPythonCommand();
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(pythonCmd, [filepath], {
        cwd: ctx.workspaceDir,
        timeout: TIMEOUT_MS,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        signal: ctx.signal,
        ...(IS_WINDOWS ? { windowsHide: true } : {}),
      });

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
      proc.on("error", (err) => resolve({ stdout, stderr: err.message, exitCode: 1 }));
    });

    // Clean up temp file
    await unlink(filepath).catch(() => {});

    const output = result.stdout || result.stderr;
    if (result.exitCode !== 0) {
      return { success: false, output: result.stdout, error: result.stderr || `Exit code: ${result.exitCode}` };
    }
    return { success: true, output: output.slice(0, 200_000) };
  } catch (err) {
    await unlink(filepath).catch(() => {});
    return { success: false, output: "", error: `Python execution failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

registerTool({
  name: "python_execute",
  description: "Execute Python 3 code and return stdout/stderr. Use for calculations, data analysis, file processing, and any programmatic task.",
  category: "code",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "python_execute",
      description: "Execute Python 3 code in the workspace directory. Returns stdout and stderr. Use for calculations, data processing, chart generation, file manipulation, and any programmatic task.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The Python 3 code to execute" },
        },
        required: ["code"],
      },
    },
  },
  execute: executePython,
});
