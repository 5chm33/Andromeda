/**
 * aiMemory.ts — ANDROMEDA.md Project Memory
 * Andromeda v6.19 — extracted from ai.ts (was lines 1653-1679)
 *
 * Claude Code-style project memory: a persistent markdown file that the agent
 * reads at startup and writes to when it learns something important about the
 * project. Survives across sessions.
 */

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("aiMemory");

// ─── Path Resolution ──────────────────────────────────────────────────────────

function getAndromedaMemoryPath(): string {
  // Check workspace first, then CWD
  const workspacePath = path.resolve(process.cwd(), "workspace", "ANDROMEDA.md");
  if (fs.existsSync(path.dirname(workspacePath))) return workspacePath;
  return path.resolve(process.cwd(), "ANDROMEDA.md");
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Write or append to the ANDROMEDA.md project memory file.
 * This is how the agent persists learnings about the project across sessions.
 */
export async function writeAndromedaMemory(content: string): Promise<{ path: string; chars: number }> {
  const memPath = getAndromedaMemoryPath();
  const dir = path.dirname(memPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // If file exists, append with a timestamp header; otherwise create fresh
  if (fs.existsSync(memPath)) {
    const timestamp = new Date().toISOString();
    const appended = `\n\n---\n*Updated: ${timestamp}*\n\n${content}`;
    fs.appendFileSync(memPath, appended, "utf8");
    const chars = fs.statSync(memPath).size;
    log.info(`Appended ${content.length} chars to ANDROMEDA.md (total: ${chars} bytes)`);
    return { path: memPath, chars };
  } else {
    const header = `# ANDROMEDA Project Memory\n*Created: ${new Date().toISOString()}*\n\n`;
    fs.writeFileSync(memPath, header + content, "utf8");
    log.info(`Created ANDROMEDA.md with ${content.length} chars`);
    return { path: memPath, chars: content.length };
  }
}

/**
 * Read the current ANDROMEDA.md project memory.
 * Returns null if no memory file exists yet.
 */
export function readAndromedaMemory(): string | null {
  const memPath = getAndromedaMemoryPath();
  if (!fs.existsSync(memPath)) return null;
  try {
    return fs.readFileSync(memPath, "utf8");
  } catch (err) {
    log.warn("Failed to read ANDROMEDA.md:", err);
    return null;
  }
}

/**
 * Get the path to the ANDROMEDA.md file (for display purposes).
 */
export function getAndromedaMemoryPathPublic(): string {
  return getAndromedaMemoryPath();
}

/**
 * Check if ANDROMEDA.md exists and return its size.
 */
export function getAndromedaMemoryStats(): { exists: boolean; path: string; sizeBytes: number; lastModified?: Date } {
  const memPath = getAndromedaMemoryPath();
  if (!fs.existsSync(memPath)) {
    return { exists: false, path: memPath, sizeBytes: 0 };
  }
  const stat = fs.statSync(memPath);
  return { exists: true, path: memPath, sizeBytes: stat.size, lastModified: stat.mtime };
}
