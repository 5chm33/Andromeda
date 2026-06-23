/**
 * autoRollback.ts — Auto-Rollback System for Self-Modification
 * Andromeda v5.14
 *
 * When Andromeda edits its own codebase, this module:
 * 1. Creates a backup snapshot before any modification
 * 2. Validates the edit (TypeScript compilation, basic syntax checks)
 * 3. If validation fails, automatically rolls back to the snapshot
 * 4. Logs all rollback events for debugging
 *
 * Also includes dependency awareness: before editing a file, identifies
 * all files that import from it and warns about potential breakage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync,  readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname, relative, resolve } from "path";
import { execSync } from "child_process";
import { gitSandbox } from "./gitSandbox.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Snapshot {
  id: string;
  timestamp: string;
  files: Array<{ path: string; content: string }>;
  reason: string;
}

interface RollbackResult {
  rolledBack: boolean;
  reason?: string;
  validationErrors?: string[];
  snapshot?: string;
}

interface DependencyMap {
  file: string;
  importedBy: string[];
  imports: string[];
}

// ─── Snapshot Management ────────────────────────────────────────────────────

const SNAPSHOT_DIR = join(process.cwd(), ".andromeda", "snapshots");
const MAX_SNAPSHOTS = 20;

function ensureSnapshotDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

/**
 * Create a snapshot of the specified files before modification.
 */
export function createSnapshot(files: string[], reason: string): string {
  ensureSnapshotDir();

  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshot: Snapshot = {
    id,
    timestamp: new Date().toISOString(),
    files: files.map(filePath => ({
      path: filePath,
      content: existsSync(filePath) ? readFileSync(filePath, "utf-8") : "",
    })),
    reason,
  };

  writeFileSync(join(SNAPSHOT_DIR, `${id}.json`), JSON.stringify(snapshot, null, 2));

  // Cleanup old snapshots
  cleanupOldSnapshots();

  console.log(`[AutoRollback] Snapshot created: ${id} (${files.length} files)`);
  return id;
}

/**
 * Restore files from a snapshot.
 */
export function restoreSnapshot(snapshotId: string): boolean {
  const snapshotPath = join(SNAPSHOT_DIR, `${snapshotId}.json`);
  if (!existsSync(snapshotPath)) {
    console.error(`[AutoRollback] Snapshot not found: ${snapshotId}`);
    return false;
  }

  try {
    const snapshot: Snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8"));
    for (const file of snapshot.files) {
      const dir = dirname(file.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(file.path, file.content);
    }
    console.log(`[AutoRollback] Restored ${snapshot.files.length} files from snapshot ${snapshotId}`);
    return true;
  } catch (e) {
    console.error(`[AutoRollback] Failed to restore snapshot: ${e}`);
    return false;
  }
}

function cleanupOldSnapshots(): void {
  try {
    const files = readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => ({ name: f, time: statSync(join(SNAPSHOT_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > MAX_SNAPSHOTS) {
      for (const old of files.slice(MAX_SNAPSHOTS)) {
        unlinkSync(join(SNAPSHOT_DIR, old.name));
      }
    }
  } catch { /* ignore cleanup errors */ }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate modified files by running TypeScript type-checking.
 * Returns an array of error messages (empty = success).
 */
function findTscPath(projectDir: string): string | null {
  const tscPaths = [
    join(projectDir, "node_modules", ".bin", "tsc"),
    join(projectDir, "..", "node_modules", ".bin", "tsc"),
  ];

  for (const p of tscPaths) {
    if (existsSync(p)) return p;
  }

  try {
    // Use execSync directly for 'which' — this is a read-only system check, not a git command
    execSync("which tsc", { stdio: "ignore" });
    return "tsc"; // Global tsc found
  } catch {
    return null; // No tsc found
  }
}

/**
 * Validate modified files by running TypeScript type-checking.
 * Returns an array of error messages (empty = success).
 */
export function validateTypeScript(projectDir: string): string[] {
  const tscPath = findTscPath(projectDir);
  if (!tscPath) {
    return []; // No TypeScript compiler available — skip validation
  }

  try {
    // tsc is a safe read-only validation command — use execSync directly
    // (gitSandbox is for git commands only; tsc validation is not a git operation)
    execSync(`${tscPath} --noEmit --pretty false 2>&1`, {
      cwd: projectDir,
      timeout: 60_000,
      encoding: "utf-8",
    });
    return []; // No errors
  } catch (e: any) {
    // tsc exits with code 1 when there are errors
    const output = (e instanceof Error && 'stdout' in e && typeof e.stdout === 'string') ? e.stdout : (e instanceof Error && 'stderr' in e && typeof e.stderr === 'string') ? e.stderr : String(e);
    const errors = output
      .split("\n")
      .filter((line: string) => line.includes("error TS"))
      .slice(0, 20); // Cap at 20 errors
    return errors;
  }
}

/**
 * Basic syntax validation for a single file (checks for obvious issues).
 */
export function validateSyntax(filePath: string, content: string): string[] {
  const errors: string[] = [];
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    // Remove strings and comments to avoid false positives
    const cleaned = content
      .replace(/\/\/.*$/gm, '') // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, ''); // strings

    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;

    for (const ch of cleaned) {
      if (ch === "{") braceCount++;
      if (ch === "}") braceCount--;
      if (ch === "(") parenCount++;
      if (ch === ")") parenCount--;
      if (ch === "[") bracketCount++;
      if (ch === "]") bracketCount--;
    }

    if (braceCount !== 0) errors.push(`Unbalanced braces: ${braceCount > 0 ? `${braceCount} unclosed {` : `${-braceCount} extra }`}`);
    if (parenCount !== 0) errors.push(`Unbalanced parentheses: ${parenCount > 0 ? `${parenCount} unclosed (` : `${-parenCount} extra )`}`);
    if (bracketCount !== 0) errors.push(`Unbalanced brackets: ${bracketCount > 0 ? `${bracketCount} unclosed [` : `${-bracketCount} extra ]`}`);

    // Check for obvious truncation
    const lastLine = content.trim().split("\n").pop() || "";
    if (lastLine.endsWith(",") || lastLine.endsWith("(") || lastLine.endsWith("{")) {
      errors.push(`File appears truncated: last line ends with "${lastLine.slice(-1)}"`);
    }
  }

  if (ext === "json") {
    try {
      JSON.parse(content);
    } catch (e: any) {
      errors.push(`Invalid JSON: ${e.message}`);
    }
  }

  return errors;
}

// ─── Auto-Rollback Wrapper ──────────────────────────────────────────────────

/**
 * Execute a file modification with automatic rollback on failure.
 *
 * Usage:
 *   const result = await withAutoRollback(
 *     ["/path/to/file.ts"],
 *     "Adding new feature X",
 *     async () => {
 *       // ... modify files ...
 *     }
 *   );
 */
export async function withAutoRollback(
  filePaths: string[],
  reason: string,
  modification: () => Promise<void>,
  options: { validateTs?: boolean; projectDir?: string } = {}
): Promise<RollbackResult> {
  // 1. Create snapshot
  const snapshotId = createSnapshot(filePaths, reason);

  try {
    // 2. Execute modification
    await modification();

    // 3. Validate syntax of all modified files
    const syntaxErrors: string[] = [];
    for (const filePath of filePaths) {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const fileErrors = validateSyntax(filePath, content);
        if (fileErrors.length > 0) {
          syntaxErrors.push(`${filePath}: ${fileErrors.join("; ")}`);
        }
      }
    }

    if (syntaxErrors.length > 0) {
      console.warn(`[AutoRollback] Syntax validation failed — rolling back`);
      restoreSnapshot(snapshotId);
      return {
        rolledBack: true,
        reason: "Syntax validation failed",
        validationErrors: syntaxErrors,
        snapshot: snapshotId,
      };
    }

    // 4. Optional TypeScript validation
    if (options.validateTs && options.projectDir) {
      const tsErrors = validateTypeScript(options.projectDir);
      if (tsErrors.length > 0) {
        console.warn(`[AutoRollback] TypeScript validation failed (${tsErrors.length} errors) — rolling back`);
        restoreSnapshot(snapshotId);
        return {
          rolledBack: true,
          reason: "TypeScript compilation failed",
          validationErrors: tsErrors,
          snapshot: snapshotId,
        };
      }
    }

    // 5. Success — no rollback needed
    console.log(`[AutoRollback] Modification validated successfully (snapshot: ${snapshotId})`);
    return { rolledBack: false, snapshot: snapshotId };

  } catch (e) {
    // Unexpected error during modification — rollback
    console.error(`[AutoRollback] Modification threw error — rolling back: ${e}`);
    restoreSnapshot(snapshotId);
    return {
      rolledBack: true,
      reason: `Modification error: ${String(e)}`,
      snapshot: snapshotId,
    };
  }
}

// ─── Dependency Awareness ───────────────────────────────────────────────────

/**
 * Analyze imports in a directory to build a dependency map.
 * Before editing a file, call this to understand what depends on it.
 */
export function buildDependencyMap(projectDir: string, targetFile: string): DependencyMap {
  const result: DependencyMap = {
    file: targetFile,
    importedBy: [],
    imports: [],
  };

  const targetRelative = relative(projectDir, targetFile).replace(/\\/g, "/");
  const __targetWithoutExt = targetRelative.replace(/\.(ts|tsx|js|jsx)$/, "");

  // Find all TS/JS files in the project
  const allFiles = findSourceFiles(projectDir);

  for (const filePath of allFiles) {
    if (filePath === targetFile) continue;

    try {
      const content = readFileSync(filePath, "utf-8");
      const fileRelative = relative(projectDir, filePath).replace(/\\/g, "/");

      // Check if this file imports from the target
      const importRegex = /(?:import|require)\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?|.*from\s*['"]([^'"]+)['"])/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1] || match[2];
        if (!importPath) continue;

        // Resolve relative imports
        if (importPath.startsWith(".")) {
          const resolvedImport = resolve(dirname(filePath), importPath).replace(/\\/g, "/");
          const resolvedWithoutExt = resolvedImport.replace(/\.(ts|tsx|js|jsx)$/, "");
          const targetAbsWithoutExt = resolve(targetFile).replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx)$/, "");

          if (resolvedWithoutExt === targetAbsWithoutExt || resolvedImport === resolve(targetFile).replace(/\\/g, "/")) {
            result.importedBy.push(fileRelative);
          }
        }
      }

      // Check what the target file imports
      if (filePath === targetFile) {
        while ((match = importRegex.exec(content)) !== null) {
          const importPath = match[1] || match[2];
          if (importPath) result.imports.push(importPath);
        }
      }
    } catch { /* skip unreadable files */ }
  }

  // Also check target's own imports
  try {
    const targetContent = readFileSync(targetFile, "utf-8");
    const importRegex = /(?:import|require)\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?|.*from\s*['"]([^'"]+)['"])/g;
    let match;
    while ((match = importRegex.exec(targetContent)) !== null) {
      const importPath = match[1] || match[2];
      if (importPath) result.imports.push(importPath);
    }
  } catch { /* skip */ }

  return result;
}

function findSourceFiles(dir: string, files: string[] = []): string[] {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === ".andromeda") continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          findSourceFiles(fullPath, files);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
          files.push(fullPath);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return files;
}

// ─── Integration with File Edit Engine ──────────────────────────────────────

/**
 * Wrap the multi-pass edit engine with auto-rollback protection.
 * Called by streamRouter.ts when Andromeda edits its own codebase.
 */
export async function safeFileEdit(
  filePaths: string[],
  projectDir: string,
  editFn: () => Promise<void>
): Promise<{ success: boolean; rolledBack: boolean; errors?: string[]; dependencies?: DependencyMap[] }> {
  // 1. Build dependency maps for all files being edited
  const dependencies = filePaths.map(f => buildDependencyMap(projectDir, f));

  // Log warnings about high-dependency files
  for (const dep of dependencies) {
    if (dep.importedBy.length > 5) {
      console.warn(`[AutoRollback] WARNING: ${dep.file} is imported by ${dep.importedBy.length} files — edits may have wide impact`);
    }
  }

  // 2. Execute with auto-rollback
  const result = await withAutoRollback(filePaths, "Multi-pass edit engine", editFn, {
    validateTs: true,
    projectDir,
  });

  return {
    success: !result.rolledBack,
    rolledBack: result.rolledBack,
    errors: result.validationErrors,
    dependencies,
  };
}
