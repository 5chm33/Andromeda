/**
 * gitOps.ts — Git Operations Tool
 * Andromeda v5.5
 *
 * Gives the ReAct agent the ability to version-control workspace outputs,
 * create branches, commit changes, view diffs, and manage git history.
 * Operates within the workspace directory only.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { registerTool } from "./toolRegistry";
import type { ToolResult, ToolExecutionContext } from "./toolRegistry";

// ─── Safety: restrict all git operations to workspace ───────────────────────

function runGit(args: string, cwd: string, timeout = 15000): string {
  try {
    const result = execSync(`git ${args}`, {
      cwd,
      timeout,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Andromeda AI",
        GIT_AUTHOR_EMAIL: "andromeda@local",
        GIT_COMMITTER_NAME: "Andromeda AI",
        GIT_COMMITTER_EMAIL: "andromeda@local",
      },
    });
    return result.trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() ?? "";
    const stdout = err.stdout?.toString?.() ?? "";
    throw new Error(stderr || stdout || err.message);
  }
}

function ensureGitRepo(cwd: string): void {
  if (!existsSync(join(cwd, ".git"))) {
    runGit("init", cwd);
    // Create initial commit so branches work
    runGit("add -A", cwd);
    runGit('commit --allow-empty -m "Initial commit by Andromeda"', cwd);
  }
}

// ─── Tool Implementation ────────────────────────────────────────────────────

async function execute(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const operation = args.operation as string;
  const cwd = ctx.workspaceDir;

  if (!cwd || !existsSync(cwd)) {
    return { success: false, output: "", error: "Workspace directory does not exist" };
  }

  try {
    ensureGitRepo(cwd);

    switch (operation) {
      case "status": {
        const status = runGit("status --short", cwd);
        const branch = runGit("rev-parse --abbrev-ref HEAD", cwd);
        return {
          success: true,
          output: `Branch: ${branch}\n\n${status || "(clean — no changes)"}`,
        };
      }

      case "add": {
        const files = (args.files as string) ?? ".";
        runGit(`add ${files}`, cwd);
        return { success: true, output: `Staged: ${files}` };
      }

      case "commit": {
        const message = (args.message as string) ?? "Auto-commit by Andromeda";
        // Stage all changes first
        runGit("add -A", cwd);
        const result = runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
        return { success: true, output: result };
      }

      case "log": {
        const count = (args.count as number) ?? 10;
        const log = runGit(`log --oneline -${count}`, cwd);
        return { success: true, output: log || "(no commits yet)" };
      }

      case "diff": {
        const target = (args.target as string) ?? "";
        const diff = runGit(`diff ${target}`, cwd);
        return { success: true, output: diff || "(no differences)" };
      }

      case "branch": {
        const branchName = args.branch_name as string;
        if (!branchName) {
          // List branches
          const branches = runGit("branch -a", cwd);
          return { success: true, output: branches };
        }
        runGit(`checkout -b ${branchName}`, cwd);
        return { success: true, output: `Created and switched to branch: ${branchName}` };
      }

      case "checkout": {
        const target2 = args.target as string;
        if (!target2) {
          return { success: false, output: "", error: "Target branch/commit required" };
        }
        runGit(`checkout ${target2}`, cwd);
        return { success: true, output: `Switched to: ${target2}` };
      }

      case "stash": {
        const action = (args.stash_action as string) ?? "push";
        if (action === "push") {
          const msg = (args.message as string) ?? "Stash by Andromeda";
          runGit(`stash push -m "${msg}"`, cwd);
          return { success: true, output: `Stashed changes: ${msg}` };
        } else if (action === "pop") {
          const result2 = runGit("stash pop", cwd);
          return { success: true, output: result2 };
        } else if (action === "list") {
          const list = runGit("stash list", cwd);
          return { success: true, output: list || "(no stashes)" };
        }
        return { success: false, output: "", error: `Unknown stash action: ${action}` };
      }

      case "reset": {
        const mode = (args.mode as string) ?? "soft";
        const ref = (args.target as string) ?? "HEAD~1";
        runGit(`reset --${mode} ${ref}`, cwd);
        return { success: true, output: `Reset (${mode}) to ${ref}` };
      }

      case "tag": {
        const tagName = args.tag_name as string;
        if (!tagName) {
          const tags = runGit("tag -l", cwd);
          return { success: true, output: tags || "(no tags)" };
        }
        const tagMsg = (args.message as string) ?? tagName;
        runGit(`tag -a ${tagName} -m "${tagMsg}"`, cwd);
        return { success: true, output: `Created tag: ${tagName}` };
      }

      default:
        return { success: false, output: "", error: `Unknown git operation: ${operation}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: message };
  }
}

// ─── Register ───────────────────────────────────────────────────────────────

registerTool({
  name: "git_operations",
  description: "Perform git version control operations in the workspace: status, add, commit, log, diff, branch, checkout, stash, reset, tag. All operations are restricted to the workspace directory.",
  category: "filesystem",
  safety: "moderate",
  definition: {
    type: "function",
    function: {
      name: "git_operations",
      description: "Perform git version control operations in the workspace. Supports: status, add, commit, log, diff, branch, checkout, stash, reset, tag.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["status", "add", "commit", "log", "diff", "branch", "checkout", "stash", "reset", "tag"],
            description: "The git operation to perform",
          },
          message: {
            type: "string",
            description: "Commit message (for commit), stash message (for stash push), or tag message (for tag)",
          },
          files: {
            type: "string",
            description: "Files to stage (for add). Defaults to '.' (all files)",
          },
          target: {
            type: "string",
            description: "Target ref for diff, checkout, or reset (e.g., 'HEAD~1', 'main', a commit hash)",
          },
          branch_name: {
            type: "string",
            description: "Branch name to create (for branch operation)",
          },
          tag_name: {
            type: "string",
            description: "Tag name to create (for tag operation)",
          },
          count: {
            type: "number",
            description: "Number of log entries to show (for log). Defaults to 10",
          },
          stash_action: {
            type: "string",
            enum: ["push", "pop", "list"],
            description: "Stash sub-action (for stash operation). Defaults to 'push'",
          },
          mode: {
            type: "string",
            enum: ["soft", "mixed", "hard"],
            description: "Reset mode (for reset operation). Defaults to 'soft'",
          },
        },
        required: ["operation"],
      },
    },
  },
  execute,
});
