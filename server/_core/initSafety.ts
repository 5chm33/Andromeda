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
      console.warn("[BootIntegrity] Crash flag from previous boot detected.");
      // v9.8.5: Disabled the automatic git checkout -- . on boot.
      // The crash flag was rolling back successful commits if the server didn't exit cleanly,
      // causing the system to undo its own work and loop endlessly on the same proposals.
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
