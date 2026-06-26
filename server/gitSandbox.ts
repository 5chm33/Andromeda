/**
 * gitSandbox.ts — v11.4.0
 *
 * Strict whitelist sandbox for all git execSync calls in the RSI self-improvement loop.
 *
 * Problem: continuousImprover.ts, selfRollback.ts, and selfImprove.ts all call
 * execSync() with git commands constructed from runtime variables (file paths,
 * branch names, commit messages). If a proposal ever injected a malicious value
 * into one of those variables, it could execute arbitrary shell commands.
 *
 * Solution: Every git command must pass through gitSandbox() before execution.
 * The sandbox validates the git subcommand against a strict whitelist and
 * validates argument patterns before allowing execution.
 *
 * Allowed git subcommands (exhaustive list):
 *   init, add, commit, push, checkout, tag, remote, rev-parse, diff, log, status
 *
 * Any subcommand not on this list throws GitCommandNotAllowedError immediately.
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process";

// ─── Error Type ───────────────────────────────────────────────────────────────

export class GitCommandNotAllowedError extends Error {
  constructor(command: string, reason: string) {
    super(`[gitSandbox] Command blocked: "${command.slice(0, 120)}" — ${reason}`);
    this.name = "GitCommandNotAllowedError";
  }
}

// ─── Allowed Subcommands ──────────────────────────────────────────────────────

/**
 * Exhaustive whitelist of git subcommands the RSI loop is allowed to run.
 * Each entry is a regex that matches the full git command string.
 * The command must start with "git <subcommand>" to be considered.
 */
const ALLOWED_GIT_PATTERNS: RegExp[] = [
  // git init [-b <branch>]
  /^git init(?:\s+-b\s+[\w/-]+)?$/,

  // git add -A  |  git add -- "file"  |  git add "file"  |  git add "file1" "file2" ...
  /^git add(?:\s+-A|\s+--)?(?:\s+"[^";&|`$\\]+")+$/,
  /^git add\s+-A$/,

  // git commit --allow-empty -m "msg"  |  git commit -m "msg"
  /^git commit(?:\s+--allow-empty)?\s+-m\s+"[^`$\\]{1,300}"$/,
  // git commit -m 'msg' (JSON.stringify uses double quotes but allow single too)
  /^git commit(?:\s+--allow-empty)?\s+-m\s+'[^`$\\]{1,300}'$/,

  // git push "https://...@github.com/..." main
  /^git push\s+"https:\/\/[^";&|`$\\]+"\s+[\w/-]+$/,
  // git push origin main  (plain push without token in URL)
  /^git push(?:\s+[\w-]+){0,2}$/,

  // git checkout HEAD -- "file1" "file2" ...
  /^git checkout\s+HEAD\s+--(?:\s+"[^";&|`$\\]+")+$/,
  // git checkout -b <branch-name>
  /^git checkout\s+-b\s+[\w/.-]+$/,
  // git checkout <branch>
  /^git checkout\s+[\w/.-]+$/,

  // git tag <tagname>
  /^git tag\s+"?[\w/.-]+"?$/,

  // git remote add origin <url>
  /^git remote\s+add\s+[\w-]+\s+https:\/\/[^\s;&|`$\\]+$/,

  // git rev-parse --git-dir  |  git rev-parse HEAD  |  git rev-parse --abbrev-ref HEAD
  /^git rev-parse(?:\s+--[\w-]+)?(?:\s+[\w/.-]+)?$/,

  // git diff --name-only HEAD  |  git diff HEAD -- "file"
  /^git diff(?:\s+--[\w-]+)*(?:\s+HEAD)?(?:\s+--)?(?:\s+"[^";&|`$\\]+")*$/,

  // git log --oneline -<n>  |  git log --oneline
  /^git log(?:\s+--[\w=-]+)*(?:\s+-\d+)?$/,

  // git status [--short]
  /^git status(?:\s+--[\w-]+)*$/,
];

// ─── Core Sandbox Function ────────────────────────────────────────────────────

/**
 * Execute a git command after validating it against the whitelist.
 *
 * @param command  Full git command string, e.g. `git add "server/foo.ts"`
 * @param options  Standard execSync options (cwd, env, timeout, encoding, stdio)
 * @returns        stdout as string (if encoding is set), or Buffer
 * @throws         GitCommandNotAllowedError if the command is not whitelisted
 */
export function gitSandbox(
  command: string,
  options: ExecSyncOptionsWithStringEncoding & { timeout?: number }
): string {
  const trimmed = command.trim();

  // Must start with "git "
  if (!trimmed.startsWith("git ")) {
    throw new GitCommandNotAllowedError(trimmed, "command must start with 'git '");
  }

  // Check against whitelist
  const allowed = ALLOWED_GIT_PATTERNS && ALLOWED_GIT_PATTERNS.some(pattern => pattern.test(trimmed));
  if (!allowed) {
    throw new GitCommandNotAllowedError(
      trimmed,
      `git subcommand not in whitelist. Allowed: init, add, commit, push, checkout, tag, remote, rev-parse, diff, log, status`
    );
  }

  // Shell injection guard — reject any command containing shell metacharacters
  // that are not inside double-quoted argument strings
  const unquotedPart = trimmed.replace(/"[^"]*"/g, '""'); // strip quoted args
  if (/[;&|`$\\]/.test(unquotedPart)) {
    throw new GitCommandNotAllowedError(
      trimmed,
      "shell metacharacter detected outside of quoted arguments"
    );
  }

  return execSync(command, options) as string;
}

/**
 * Async-friendly wrapper: same validation, uses execSync internally.
 * Provided for call sites that use async/await patterns.
 */
export async function gitSandboxAsync(
  command: string,
  options: ExecSyncOptionsWithStringEncoding & { timeout?: number }
): Promise<string> {
  return gitSandbox(command, options);
}
