/**
 * logger.ts — Structured logging for Andromeda (v6.02)
 *
 * Replaces raw console.log/warn/error with a structured logger that:
 * - Adds timestamps and module context
 * - Supports log levels (debug, info, warn, error)
 * - Writes errors to a rotating log file for post-mortem debugging
 * - Provides a `catch` helper for replacing empty catch blocks
 */
import fs from "fs";
import path from "path";

// ── Log Levels ────────────────────────────────────────────────────────────────
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── Configuration ─────────────────────────────────────────────────────────────
const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const LOG_DIR = path.join(process.cwd(), ".andromeda", "logs");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per log file
const MAX_LOG_FILES = 5;

// Ensure log directory exists
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.warn(`Failed to create log directory: ${errMsg}`);
}

// ── Log File Rotation ─────────────────────────────────────────────────────────
function getLogFilePath(): string {
  return path.join(LOG_DIR, "andromeda.log");
}

function rotateIfNeeded(): void {
  try {
    const logPath = getLogFilePath();
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size < MAX_LOG_SIZE) return;

    // Rotate: andromeda.log → andromeda.1.log → andromeda.2.log → ...
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = path.join(LOG_DIR, `andromeda.${i}.log`);
      const to = path.join(LOG_DIR, `andromeda.${i + 1}.log`);
      if (fs.existsSync(from)) {
        if (i === MAX_LOG_FILES - 1) fs.unlinkSync(from);
        else fs.renameSync(from, to);
      }
    }
    fs.renameSync(logPath, path.join(LOG_DIR, "andromeda.1.log"));
  } catch { /* rotation failure is non-fatal */ }
}

// ── Core Logger ───────────────────────────────────────────────────────────────
function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];
}

function formatMessage(level: LogLevel, module: string, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` | ${typeof meta === "string" ? meta : JSON.stringify(meta).slice(0, 500)}` : "";
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}${metaStr}`;
}

function writeToFile(formatted: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(getLogFilePath(), formatted + "\n");
  } catch { /* file write failure is non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function createLogger(module: string) {
  return {
    debug(message: string, meta?: unknown): void {
      if (!shouldLog("debug")) return;
      const formatted = formatMessage("debug", module, message, meta);
      console.log(formatted);
    },

    info(message: string, meta?: unknown): void {
      if (!shouldLog("info")) return;
      const formatted = formatMessage("info", module, message, meta);
      console.log(formatted);
    },

    warn(message: string, meta?: unknown): void {
      if (!shouldLog("warn")) return;
      const formatted = formatMessage("warn", module, message, meta);
      console.warn(formatted);
      writeToFile(formatted);
    },

    error(message: string, meta?: unknown): void {
      if (!shouldLog("error")) return;
      const formatted = formatMessage("error", module, message, meta);
      console.error(formatted);
      writeToFile(formatted);
    },

    /**
     * Use in catch blocks to replace empty `catch { }` with structured logging.
     * Usage: `catch (err) { log.caught("operation description", err); }`
     */
    caught(operation: string, err: unknown): void {
      if (!shouldLog("warn")) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      const formatted = formatMessage("warn", module, `${operation} failed: ${errMsg}`, err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" → ") : undefined);
      console.warn(formatted);
      writeToFile(formatted);
    },
  };
}

// ── Convenience: Default logger for quick imports ─────────────────────────────
export const log = createLogger("Andromeda");
