/**
 * Andromeda v5.34 — Transaction Log
 *
 * Cross-module rollback coordination. When multiple files are modified
 * as part of a single logical change, this module ensures all-or-nothing
 * semantics: either all changes commit, or all are rolled back.
 *
 * Used by selfModifyBatch and the autonomy orchestrator to coordinate
 * multi-file self-modifications safely.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ───────────────────────────────────────────────────────────────────

interface FileChange {
  filePath: string;
  before: string;
  after: string;
}

interface Transaction {
  id: string;
  description: string;
  modules: string[];
  changes: FileChange[];
  status: "pending" | "committed" | "rolled_back" | "failed";
  createdAt: number;
  completedAt?: number;
  error?: string;
}

// ── State ───────────────────────────────────────────────────────────────────

const transactions: Transaction[] = [];
const MAX_TRANSACTIONS = 200;
const TRANSACTION_LOG_PATH = path.join(
  process.env.WORKSPACE_ROOT || path.join(process.cwd(), "workspace"),
  ".andromeda",
  "transaction_log.json"
);

// ── Core API ────────────────────────────────────────────────────────────────

/**
 * Begin a new transaction. Returns a transaction ID.
 */
export function beginTransaction(description: string, modules: string[]): string {
  const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const txn: Transaction = {
    id,
    description,
    modules,
    changes: [],
    status: "pending",
    createdAt: Date.now(),
  };
  transactions.push(txn);
  if (transactions.length > MAX_TRANSACTIONS) transactions.shift();
  return id;
}

/**
 * Record a file change within a transaction.
 * Must be called BEFORE writing the file — captures the "before" state.
 */
export function recordChange(txnId: string, filePath: string, newContent: string): boolean {
  const txn = transactions.find(t => t.id === txnId);
  if (!txn || txn.status !== "pending") return false;

  let before = "";
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    if (fs.existsSync(absPath)) {
      before = fs.readFileSync(absPath, "utf-8");
    }
  } catch {
    // New file — before is empty
  }

  txn.changes.push({ filePath, before, after: newContent });
  return true;
}

/**
 * Commit a transaction — marks it as committed.
 * Files should already be written to disk by the caller.
 */
export function commitTransaction(txnId: string): boolean {
  const txn = transactions.find(t => t.id === txnId);
  if (!txn || txn.status !== "pending") return false;

  txn.status = "committed";
  txn.completedAt = Date.now();
  persistLog();
  return true;
}

/**
 * Roll back a transaction — restores all files to their "before" state.
 */
export function rollbackTransaction(txnId: string): { success: boolean; filesRestored: number; errors: string[] } {
  const txn = transactions.find(t => t.id === txnId);
  if (!txn) return { success: false, filesRestored: 0, errors: ["Transaction not found"] };

  const errors: string[] = [];
  let filesRestored = 0;

  // Restore in reverse order
  for (let i = txn.changes.length - 1; i >= 0; i--) {
    const change = txn.changes[i];
    try {
      const absPath = path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(process.cwd(), change.filePath);

      if (change.before === "" && fs.existsSync(absPath)) {
        // File was newly created — delete it
        fs.unlinkSync(absPath);
      } else if (change.before) {
        fs.writeFileSync(absPath, change.before, "utf-8");
      }
      filesRestored++;
    } catch (err) {
      errors.push(`Failed to restore ${change.filePath}: ${(err as Error).message}`);
    }
  }

  txn.status = errors.length === 0 ? "rolled_back" : "failed";
  txn.completedAt = Date.now();
  if (errors.length > 0) txn.error = errors.join("; ");
  persistLog();

  return { success: errors.length === 0, filesRestored, errors };
}

/**
 * Get transaction by ID.
 */
export function getTransaction(txnId: string): Transaction | undefined {
  return transactions.find(t => t.id === txnId);
}

/**
 * Get recent transactions for diagnostics.
 */
export function getTransactionHistory(limit = 20): Transaction[] {
  return transactions.slice(-limit);
}

/**
 * Get transaction stats.
 */
export function getTransactionStats() {
  const committed = transactions.filter(t => t.status === "committed").length;
  const rolledBack = transactions.filter(t => t.status === "rolled_back").length;
  const failed = transactions.filter(t => t.status === "failed").length;
  const pending = transactions.filter(t => t.status === "pending").length;

  return {
    total: transactions.length,
    committed,
    rolledBack,
    failed,
    pending,
    successRate: transactions.length > 0
      ? Math.round((committed / transactions.length) * 100)
      : 100,
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

function persistLog(): void {
  try {
    const dir = path.dirname(TRANSACTION_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Only persist metadata, not full file contents (too large)
    const summary = transactions.slice(-50).map(t => ({
      id: t.id,
      description: t.description,
      modules: t.modules,
      status: t.status,
      fileCount: t.changes.length,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      error: t.error,
    }));

    const tmpPath = TRANSACTION_LOG_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2), "utf-8");
    fs.renameSync(tmpPath, TRANSACTION_LOG_PATH);
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

/**
 * Load transaction history from disk on startup.
 */
export function loadTransactionLog(): void {
  try {
    if (fs.existsSync(TRANSACTION_LOG_PATH)) {
      const data = JSON.parse(fs.readFileSync(TRANSACTION_LOG_PATH, "utf-8"));
      console.log(`[TransactionLog] Loaded ${data.length} historical transactions`);
    }
  } catch {
    // Non-fatal
  }
}
