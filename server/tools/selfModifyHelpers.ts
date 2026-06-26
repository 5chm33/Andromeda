/**
 * Andromeda — Self-Modification Tool Helpers
 *
 * Shared utilities used across all self-modification tool files:
 * - Path resolution and validation
 * - Forbidden file list
 * - Server/project root detection
 */

import { existsSync } from "fs";
import { fileURLToPath } from "url";
import * as path from "path";

// ─── Server/Project Root Detection ──────────────────────────────────────────

/**
 * Resolves the server source directory at runtime, handling both dev (server/tools/)
 * and production (dist/) execution contexts.
 */
export function getServerDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const baseName = path.basename(here);
  if (baseName === "dist" || baseName === "build") {
    const serverSibling = path.resolve(here, "..", "server");
    if (existsSync(serverSibling)) return serverSibling;
  }
  if (baseName === "tools") return path.resolve(here, "..");
  return path.resolve(here);
}

/**
 * Resolves the project root directory (parent of server/).
 */
export function getProjectRoot(): string {
  return path.resolve(getServerDir(), "..");
}

// ─── Forbidden File List ─────────────────────────────────────────────────────

/** Files that can NEVER be modified by any self-modification tool. */
export const FORBIDDEN_FILES = new Set([
  "andromeda-constitution.json",
  "server/selfImproveGuard.ts",
  "server/recursionGuard.ts",
  "server/selfRollback.ts",
  "server/selfRollback.ts",
  "server/tools/selfModifyTools.ts",
  "server/tools/selfModifyHelpers.ts",
  "server/tools/selfWriteFileTool.ts",
  "server/tools/selfPatchFileTool.ts",
  "server/tools/selfChunkedWriteTool.ts",
  "server/tools/selfRunTestsTool.ts",
  "server/tools/selfDiffReadTool.ts",
]);

/**
 * Returns true if the given relative path is in the forbidden list.
 */
export function isForbidden(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return Array.from(FORBIDDEN_FILES).some(f => normalized.endsWith(f) || normalized === f);
}

// ─── Path Resolution ─────────────────────────────────────────────────────────

/**
 * Resolves a potentially hallucinated or relative file path to an absolute path
 * within the project root. Handles bare filenames, src/ prefixes, and Docker paths.
 *
 * @throws {Error} If the resolved path is outside the project root.
 */
export function resolveServerPath(filePath: string): string {
  const projectRoot = getProjectRoot();
  const serverDir = getServerDir();

  let normalized = filePath;

  if (!path.isAbsolute(normalized)) {
    normalized = normalized.replace(/^\.\//, "");

    if (normalized.startsWith("src/")) {
      normalized = "server/" + normalized.slice(4);
      console.log(`[resolveServerPath] PATH TRANSLATION: '${filePath}' → '${normalized}'`);
    } else if (!normalized.includes("/") && !normalized.includes("\\")) {
      const inServer = path.join(serverDir, normalized);
      const inTools = path.join(serverDir, "tools", normalized);
      if (existsSync(inServer)) {
        normalized = "server/" + normalized;
      } else if (existsSync(inTools)) {
        normalized = "server/tools/" + normalized;
      } else {
        normalized = "server/" + normalized;
      }
      console.log(`[resolveServerPath] PATH TRANSLATION: bare '${filePath}' → '${normalized}'`);
    }
  }

  let resolved: string;
  if (path.isAbsolute(normalized)) {
    resolved = normalized;
  } else if (path.isAbsolute(filePath) && normalized === filePath) {
    resolved = filePath;
  } else {
    resolved = path.resolve(projectRoot, normalized);
  }

  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path "${filePath}" is outside the project root. Only project files can be modified.`);
  }
  return resolved;
}
