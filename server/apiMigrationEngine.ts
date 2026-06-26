/**
 * apiMigrationEngine.ts — v53.0.0
 *
 * Manages and executes API data migrations: migration scripts,
 * rollback support, dry-run mode, and migration history.
 */

export interface MigrationScript {
  migrationId: string;
  name: string;
  version: string;
  up: (data: Record<string, unknown>[]) => Record<string, unknown>[];
  down: (data: Record<string, unknown>[]) => Record<string, unknown>[];
  description: string;
}

export interface MigrationResult {
  migrationId: string;
  name: string;
  direction: "up" | "down";
  recordsProcessed: number;
  success: boolean;
  durationMs: number;
  error?: string;
  appliedAt: number;
}

const migrations = new Map<string, MigrationScript>();
const history: MigrationResult[] = [];
const applied = new Set<string>();

export function registerMigrationScript(script: MigrationScript): void {
  migrations.set(script.migrationId, script);
}

export function runMigration(migrationId: string, data: Record<string, unknown>[], direction: "up" | "down" = "up", dryRun = false): MigrationResult {
  const script = migrations.get(migrationId);
  if (!script) throw new Error(`[MigrationEngine] Migration "${migrationId}" not found`);

  const start = Date.now();
  try {
    const fn = direction === "up" ? script.up : script.down;
    const result = fn(data);

    const migResult: MigrationResult = {
      migrationId,
      name: script.name,
      direction,
      recordsProcessed: result.length,
      success: true,
      durationMs: Date.now() - start,
      appliedAt: Date.now(),
    };

    if (!dryRun) {
      if (direction === "up") applied.add(migrationId);
      else applied.delete(migrationId);
      history.push(migResult);
    }

    return migResult;
  } catch (e) {
    const migResult: MigrationResult = {
      migrationId,
      name: script.name,
      direction,
      recordsProcessed: 0,
      success: false,
      durationMs: Date.now() - start,
      error: (e as Error).message,
      appliedAt: Date.now(),
    };
    if (!dryRun) history.push(migResult);
    return migResult;
  }
}

export function getMigrationHistory(): MigrationResult[] {
  return [...history];
}

export function getPendingMigrations(): MigrationScript[] {
  return Array.from(migrations.values()).filter(m => !applied.has(m.migrationId));
}

export function isApplied(migrationId: string): boolean {
  return applied.has(migrationId);
}

export function _resetMigrationEngineForTest(): void {
  migrations.clear();
  history.length = 0;
  applied.clear();
}
