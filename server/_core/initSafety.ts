/**
 * initSafety.ts — v6.04
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Handles boot-time safety checks:
 * - Crash flag detection and git rollback
 * - Boot count tracking
 * - Crash guard activation
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * Run boot-time integrity check.
 * Detects crash from previous self-improvement session and auto-rolls back if needed.
 * Writes a crash flag that is cleared on clean shutdown.
 */
export async function runBootIntegrityCheck(): Promise<void> {
  const andDir = join(process.cwd(), ".andromeda");
  if (!existsSync(andDir)) mkdirSync(andDir, { recursive: true });

  const crashFlagPath = join(andDir, ".boot_crash_flag");
  const bootCountPath = join(andDir, ".boot_count");

  try {
    if (existsSync(crashFlagPath)) {
      console.warn("[BootIntegrity] Crash flag from previous boot detected — attempting git rollback to last snapshot");
      try {
        const cwd = process.cwd();
        const gitEnv = {
          ...process.env,
          GIT_AUTHOR_NAME: "Andromeda AI",
          GIT_AUTHOR_EMAIL: "andromeda@local",
          GIT_COMMITTER_NAME: "Andromeda AI",
          GIT_COMMITTER_EMAIL: "andromeda@local",
        };
        if (existsSync(join(cwd, ".git"))) {
          const log = execSync("git log --oneline -20", { cwd, env: gitEnv, encoding: "utf-8" }) as string;
          const snapshotLine = (log as string).split("\n").find((l: string) => l.includes("pre-improvement snapshot"));
          if (snapshotLine) {
            const hash = snapshotLine.split(" ")[0];
            execSync(`git checkout ${hash} -- .`, { cwd, env: gitEnv, encoding: "utf-8" });
            console.log(`[BootIntegrity] Rolled back to: ${snapshotLine}`);
          } else {
            console.warn("[BootIntegrity] No snapshot commit found — continuing with current state");
          }
        }
      } catch (rbErr) {
        console.warn("[BootIntegrity] Rollback failed:", (rbErr as Error).message);
      }
      try { unlinkSync(crashFlagPath); } catch { /* ignore */ }
    }

    // Write crash flag atomically (write to .tmp then rename) to prevent partial
    // writes that could cause a false rollback on next boot if the process is
    // killed mid-write.
    const crashFlagTmp = crashFlagPath + ".tmp";
    try { unlinkSync(crashFlagTmp); } catch { /* ignore leftover */ }
    writeFileSync(
      crashFlagTmp,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      "utf-8"
    );
    renameSync(crashFlagTmp, crashFlagPath);

    const bootCount = existsSync(bootCountPath)
      ? (parseInt(readFileSync(bootCountPath, "utf-8") || "0") + 1)
      : 1;
    writeFileSync(bootCountPath, String(bootCount), "utf-8");
    console.log(`[BootIntegrity] Boot #${bootCount} — crash guard active (crash flag written)`);
  } catch (bootErr) {
    console.warn("[BootIntegrity] Boot check unavailable:", (bootErr as Error).message);
  }
}

/**
 * Clear the crash flag on clean shutdown.
 * Call this from SIGTERM/SIGINT handlers.
 */
export function clearCrashFlag(): void {
  try {
    const crashFlagPath = join(process.cwd(), ".andromeda", ".boot_crash_flag");
    if (existsSync(crashFlagPath)) unlinkSync(crashFlagPath);
  } catch { /* ignore */ }
}
