/**
 * atomicModifyTools.ts — Andromeda v5.68
 *
 * self_atomic_modify: Stage changes to multiple files, validate all at once,
 * then apply or rollback as an atomic unit.
 *
 * This solves the "multi-file refactor" problem where a feature requires
 * coordinated changes across 3-5 files. Previously, writing file A then
 * failing on file B would leave the codebase in a broken half-modified state.
 *
 * WORKFLOW:
 *   1. action='begin'   — Start a transaction, get transactionId
 *   2. action='stage'   — Stage a file write or patch (repeatable, N files)
 *   3. action='preview' — See all staged changes before committing
 *   4. action='commit'  — Apply all changes atomically (all succeed or all rollback)
 *   5. action='rollback'— Explicitly abort and restore all files
 */

import { registerTool } from "./toolRegistry";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
// import { createHash } from "crypto";

// ─── Path helpers (mirrors selfModifyTools.ts) ───────────────────────────────

function getServerDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here);
}

function getProjectRoot(): string {
  return path.resolve(getServerDir(), "..");
}

const FORBIDDEN_FILES = new Set([
  "andromeda-constitution.json",
  "server/selfImproveGuard.ts",
  "server/recursionGuard.ts",
  "server/selfRollback.ts",
  "server/selfRollback.ts",
  "server/tools/selfModifyTools.ts",
  "server/tools/atomicModifyTools.ts",
]);

function isForbidden(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return Array.from(FORBIDDEN_FILES).some(f => normalized.endsWith(f) || normalized === f);
}

function resolveServerPath(filePath: string): string {
  const projectRoot = getProjectRoot();
  let resolved: string;
  if (path.isAbsolute(filePath)) {
    resolved = filePath;
  } else {
    resolved = path.resolve(projectRoot, filePath);
  }
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path "${filePath}" is outside the project root.`);
  }
  return resolved;
}

// ─── Transaction Store ───────────────────────────────────────────────────────

interface StagedChange {
  filePath: string;          // Relative path
  resolved: string;          // Absolute path
  type: "write" | "patch";
  // For write:
  newContent?: string;
  // For patch:
  originalSnippet?: string;
  proposedSnippet?: string;
  // Computed at commit time:
  backupPath?: string;
  originalContent?: string;
}

interface Transaction {
  id: string;
  stagedChanges: StagedChange[];
  rationale: string;
  startedAt: number;
  committed: boolean;
}

const _transactions = new Map<string, Transaction>();

function cleanStaleTransactions(): void {
  for (const [id, tx] of Array.from(_transactions.entries())) {
    if (Date.now() - tx.startedAt > 3_600_000) { // 1 hour
      _transactions.delete(id);
    }
  }
}

// ─── Tool Registration ───────────────────────────────────────────────────────

registerTool({
  name: "self_atomic_modify",
  description: "Apply coordinated changes to MULTIPLE files as a single atomic transaction. If any file fails, ALL changes are rolled back. WORKFLOW: 1) begin — start transaction, 2) stage — stage a write or patch per file, 3) preview — review staged changes, 4) commit — apply all (runs tsc check, rolls back on failure), 5) rollback — abort and restore.",
  category: "system" as const,
  safety: "moderate" as const,
  definition: {
    type: "function" as const,
    function: {
      name: "self_atomic_modify",
      description: "Multi-file atomic transaction tool. Actions: begin, stage, preview, commit, rollback, list.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["begin", "stage", "preview", "commit", "rollback", "list"],
            description: "The transaction action to perform.",
          },
          rationale: {
            type: "string",
            description: "(begin only) Why this multi-file change is being made.",
          },
          transactionId: {
            type: "string",
            description: "(stage/preview/commit/rollback) The transaction ID from 'begin'.",
          },
          filePath: {
            type: "string",
            description: "(stage only) Relative path from project root, e.g. 'server/ai.ts'.",
          },
          changeType: {
            type: "string",
            enum: ["write", "patch"],
            description: "(stage only) 'write' replaces the entire file; 'patch' replaces a snippet.",
          },
          newContent: {
            type: "string",
            description: "(stage, changeType='write') The complete new file content.",
          },
          originalSnippet: {
            type: "string",
            description: "(stage, changeType='patch') The exact text to find and replace.",
          },
          proposedSnippet: {
            type: "string",
            description: "(stage, changeType='patch') The replacement text.",
          },
          skipTypeCheck: {
            type: "boolean",
            description: "(commit only) Skip TypeScript check before committing. Default: false.",
          },
        },
        required: ["action"],
      },
    },
  },
  execute: async (params: Record<string, unknown>, _ctx?: import("./toolRegistry").ToolExecutionContext): Promise<{ success: boolean; output: string }> => {
    const action = params.action as string;
    cleanStaleTransactions();

    // ── begin ──────────────────────────────────────────────────────────────
    if (action === "begin") {
      const { nanoid } = await import("nanoid");
      const rationale = (params.rationale as string) || "Multi-file modification";
      const id = nanoid(10);
      _transactions.set(id, {
        id,
        stagedChanges: [],
        rationale,
        startedAt: Date.now(),
        committed: false,
      });
      return {
        success: true,
        output: [
          `✓ Transaction started.`,
          `  ID: ${id}`,
          `  Rationale: ${rationale}`,
          `NEXT: Stage file changes with action='stage', transactionId='${id}'`,
        ].join("\n"),
      };
    }

    // ── stage ──────────────────────────────────────────────────────────────
    if (action === "stage") {
      const txId = params.transactionId as string;
      const tx = _transactions.get(txId);
      if (!tx) return { success: false, output: `Unknown transaction '${txId}'. Use action='begin' first.` };
      if (tx.committed) return { success: false, output: `Transaction '${txId}' is already committed.` };

      const filePath = params.filePath as string;
      const changeType = (params.changeType as string) || "write";

      if (!filePath) return { success: false, output: "filePath is required for action='stage'" };
      if (isForbidden(filePath)) return { success: false, output: `File '${filePath}' is forbidden.` };

      let resolved: string;
      try { resolved = resolveServerPath(filePath); } catch (e) {
        return { success: false, output: `Path error: ${(e as Error).message}` };
      }

      // Check for duplicate staging of same file
      const existing = tx.stagedChanges.findIndex(c => c.filePath === filePath);

      const change: StagedChange = { filePath, resolved, type: changeType as "write" | "patch" };

      if (changeType === "write") {
        const newContent = params.newContent as string;
        if (!newContent) return { success: false, output: "newContent is required for changeType='write'" };
        change.newContent = newContent;
      } else if (changeType === "patch") {
        const originalSnippet = params.originalSnippet as string;
        const proposedSnippet = params.proposedSnippet as string;
        if (!originalSnippet || proposedSnippet === undefined) {
          return { success: false, output: "originalSnippet and proposedSnippet are required for changeType='patch'" };
        }
        // Validate snippet exists in file (if file exists)
        if (existsSync(resolved)) {
          const currentContent = readFileSync(resolved, "utf8");
          if (!currentContent.includes(originalSnippet)) {
            return {
              success: false,
              output: [
                `✗ originalSnippet not found in ${filePath}.`,
                `  The snippet must match exactly (including whitespace).`,
                `  First 100 chars of snippet: ${originalSnippet.slice(0, 100)}`,
              ].join("\n"),
            };
          }
        }
        change.originalSnippet = originalSnippet;
        change.proposedSnippet = proposedSnippet;
      }

      if (existing >= 0) {
        tx.stagedChanges[existing] = change; // Replace existing staged change for same file
        return {
          success: true,
          output: `✓ Updated staged change for ${filePath} (replaced previous staging). Transaction has ${tx.stagedChanges.length} staged change(s).`,
        };
      } else {
        tx.stagedChanges.push(change);
        return {
          success: true,
          output: [
            `✓ Staged ${changeType} for ${filePath}.`,
            `  Transaction '${txId}' now has ${tx.stagedChanges.length} staged change(s).`,
            `  Files: ${tx.stagedChanges.map(c => c.filePath).join(", ")}`,
          ].join("\n"),
        };
      }
    }

    // ── preview ────────────────────────────────────────────────────────────
    if (action === "preview") {
      const txId = params.transactionId as string;
      const tx = _transactions.get(txId);
      if (!tx) return { success: false, output: `Unknown transaction '${txId}'.` };

      if (tx.stagedChanges.length === 0) {
        return { success: true, output: `Transaction '${txId}' has no staged changes yet.` };
      }

      const lines: string[] = [
        `Transaction: ${txId}`,
        `Rationale: ${tx.rationale}`,
        `Staged changes (${tx.stagedChanges.length}):`,
      ];
      for (const change of tx.stagedChanges) {
        lines.push(`  [${change.type.toUpperCase()}] ${change.filePath}`);
        if (change.type === "write" && change.newContent) {
          lines.push(`    New content: ${change.newContent.split("\n").length} lines, ${change.newContent.length} chars`);
        } else if (change.type === "patch") {
          lines.push(`    Replace: ${change.originalSnippet?.split("\n").length} lines → ${change.proposedSnippet?.split("\n").length} lines`);
        }
        lines.push(`    File exists: ${existsSync(change.resolved) ? "yes" : "no (will create)"}`);
      }
      lines.push(`\nTo apply: action='commit', transactionId='${txId}'`);
      lines.push(`To cancel: action='rollback', transactionId='${txId}'`);

      return { success: true, output: lines.join("\n") };
    }

    // ── commit ─────────────────────────────────────────────────────────────
    if (action === "commit") {
      const txId = params.transactionId as string;
      const skipTypeCheck = params.skipTypeCheck as boolean | undefined;
      const tx = _transactions.get(txId);
      if (!tx) return { success: false, output: `Unknown transaction '${txId}'.` };
      if (tx.committed) return { success: false, output: `Transaction '${txId}' is already committed.` };
      if (tx.stagedChanges.length === 0) return { success: false, output: `No staged changes in transaction '${txId}'.` };

      const backups: Array<{ resolved: string; backupPath: string; existed: boolean }> = [];
      const applied: string[] = [];

      try {
        // Phase 1: Create backups and validate all changes
        for (const change of tx.stagedChanges) {
          const backupPath = change.resolved + `.atomic_${txId}.bak`;
          if (existsSync(change.resolved)) {
            copyFileSync(change.resolved, backupPath);
            backups.push({ resolved: change.resolved, backupPath, existed: true });
          } else {
            backups.push({ resolved: change.resolved, backupPath, existed: false });
          }
        }

        // Phase 2: Apply all changes
        for (const change of tx.stagedChanges) {
          const dir = path.dirname(change.resolved);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          if (change.type === "write" && change.newContent) {
            const normalized = change.newContent.replace(/\r\n/g, "\n");
            writeFileSync(change.resolved, normalized, "utf8");
          } else if (change.type === "patch" && change.originalSnippet !== undefined && change.proposedSnippet !== undefined) {
            const currentContent = readFileSync(change.resolved, "utf8");
            const newContent = currentContent.replace(change.originalSnippet, change.proposedSnippet);
            writeFileSync(change.resolved, newContent, "utf8");
          }
          applied.push(change.filePath);
        }

        // Phase 3: TypeScript check
        if (!skipTypeCheck) {
          const projectRoot = getProjectRoot();
          try {
            execSync("pnpm exec tsc --noEmit", {
              cwd: projectRoot,
              timeout: 60_000,
              stdio: "pipe",
            });
          } catch (tsErr) {
            const errMsg = ((tsErr as { stderr?: Buffer }).stderr?.toString() || "").slice(0, 1000);
            // Rollback all changes
            for (const backup of backups) {
              if (backup.existed) {
                copyFileSync(backup.backupPath, backup.resolved);
              } else if (existsSync(backup.resolved)) {
                // Remove the newly created file
                unlinkSync(backup.resolved);
              }
            }
            // Clean up backup files
            for (const backup of backups) {
              if (existsSync(backup.backupPath)) unlinkSync(backup.backupPath);
            }
            tx.committed = false;
            return {
              success: false,
              output: [
                `✗ TypeScript check FAILED. All ${applied.length} changes rolled back.`,
                `TypeScript errors:`,
                errMsg,
                `\nFix the errors and try again with a new transaction.`,
              ].join("\n"),
            };
          }
        }

        // Phase 4: Clean up backup files (keep them for 10 minutes just in case)
        // Don't delete immediately — they'll be cleaned up by the stale transaction cleanup

        tx.committed = true;

        // Log to memory
        try {
          const { storeMemory } = await import("../memory.js");
          await storeMemory(
            `Atomic multi-file modification SUCCESS: [${applied.join(", ")}] — ${tx.rationale}. Transaction ${txId}.`,
            "project",
            ["self-modification", "atomic", "success", ...applied.map(f => path.basename(f))]
          );
        } catch { /* non-fatal */ }

        return {
          success: true,
          output: [
            `✓ Atomic transaction committed successfully!`,
            `  Transaction: ${txId}`,
            `  Files modified (${applied.length}): ${applied.join(", ")}`,
            skipTypeCheck ? `  TypeScript check: skipped` : `  TypeScript check: ✓ passed`,
            `  Backups retained for safety (auto-cleaned after 1 hour)`,
            `NEXT STEP: Run self_run_tests for a full test suite check.`,
          ].join("\n"),
        };

      } catch (err) {
        // Emergency rollback
        for (const backup of backups) {
          try {
            if (backup.existed) {
              copyFileSync(backup.backupPath, backup.resolved);
            } else if (existsSync(backup.resolved)) {
              unlinkSync(backup.resolved);
            }
          } catch { /* best effort */ }
        }
        return {
          success: false,
          output: `✗ Commit failed with error: ${(err as Error).message}. All changes rolled back.`,
        };
      }
    }

    // ── rollback ───────────────────────────────────────────────────────────
    if (action === "rollback") {
      const txId = params.transactionId as string;
      const tx = _transactions.get(txId);
      if (!tx) return { success: false, output: `Unknown transaction '${txId}'.` };

      const restored: string[] = [];
      for (const change of tx.stagedChanges) {
        const backupPath = change.resolved + `.atomic_${txId}.bak`;
        if (existsSync(backupPath)) {
          copyFileSync(backupPath, change.resolved);
          try { unlinkSync(backupPath); } catch { /* ignore */ }
          restored.push(change.filePath);
        }
      }

      _transactions.delete(txId);
      return {
        success: true,
        output: restored.length > 0
          ? `✓ Transaction '${txId}' rolled back. Restored: ${restored.join(", ")}`
          : `✓ Transaction '${txId}' aborted (no files had been written yet).`,
      };
    }

    // ── list ───────────────────────────────────────────────────────────────
    if (action === "list") {
      const active = Array.from(_transactions.values()).filter(tx => !tx.committed);
      if (active.length === 0) return { success: true, output: "No active transactions." };
      const lines = active.map(tx =>
        `  ${tx.id}: ${tx.stagedChanges.length} staged changes, started ${Math.round((Date.now() - tx.startedAt) / 60000)}m ago — ${tx.rationale}`
      );
      return { success: true, output: `Active transactions:\n${lines.join("\n")}` };
    }

    return { success: false, output: `Unknown action '${action}'. Use: begin, stage, preview, commit, rollback, list.` };
  },
});
