/**
 * apiVersionAdapter.ts — v52.0.0
 *
 * Adapts API calls between different API versions, applying
 * field migrations, deprecation warnings, and compatibility shims.
 */

export interface VersionMigration {
  fromVersion: string;
  toVersion: string;
  fieldRenames: Record<string, string>;    // old field -> new field
  fieldRemovals: string[];                  // fields removed in new version
  fieldAdditions: Record<string, unknown>;  // new fields with defaults
  breakingChanges: string[];               // descriptions of breaking changes
}

export interface AdaptationResult {
  adapted: Record<string, unknown>;
  warnings: string[];
  appliedMigrations: string[];
}

const migrations = new Map<string, VersionMigration>();

export function registerMigration(migration: VersionMigration): void {
  const key = `${migration.fromVersion}->${migration.toVersion}`;
  migrations.set(key, migration);
}

export function adaptRequest(
  data: Record<string, unknown>,
  fromVersion: string,
  toVersion: string
): AdaptationResult {
  const key = `${fromVersion}->${toVersion}`;
  const migration = migrations.get(key);
  const warnings: string[] = [];
  const appliedMigrations: string[] = [];

  if (!migration) {
    return { adapted: { ...data }, warnings: [`No migration found for ${fromVersion} -> ${toVersion}`], appliedMigrations };
  }

  const adapted: Record<string, unknown> = { ...data };

  // Apply field renames
  for (const [oldField, newField] of Object.entries(migration.fieldRenames)) {
    if (oldField in adapted) {
      adapted[newField] = adapted[oldField];
      delete adapted[oldField];
      appliedMigrations.push(`Renamed "${oldField}" -> "${newField}"`);
    }
  }

  // Remove deprecated fields
  for (const field of migration.fieldRemovals) {
    if (field in adapted) {
      delete adapted[field];
      warnings.push(`Field "${field}" removed in ${toVersion}`);
    }
  }

  // Add new fields with defaults
  for (const [field, defaultValue] of Object.entries(migration.fieldAdditions)) {
    if (!(field in adapted)) {
      adapted[field] = defaultValue;
      appliedMigrations.push(`Added "${field}" with default value`);
    }
  }

  // Warn about breaking changes
  for (const change of migration.breakingChanges) {
    warnings.push(`Breaking change: ${change}`);
  }

  return { adapted, warnings, appliedMigrations };
}

export function getCompatibilityReport(fromVersion: string, toVersion: string): string[] {
  const key = `${fromVersion}->${toVersion}`;
  const migration = migrations.get(key);
  if (!migration) return [`No migration path found for ${fromVersion} -> ${toVersion}`];

  const report: string[] = [];
  if (Object.keys(migration.fieldRenames).length > 0) {
    report.push(`${Object.keys(migration.fieldRenames).length} field(s) renamed`);
  }
  if (migration.fieldRemovals.length > 0) {
    report.push(`${migration.fieldRemovals.length} field(s) removed`);
  }
  if (migration.breakingChanges.length > 0) {
    report.push(`${migration.breakingChanges.length} breaking change(s)`);
  }
  return report;
}

export function _resetVersionAdapterForTest(): void {
  migrations.clear();
}
