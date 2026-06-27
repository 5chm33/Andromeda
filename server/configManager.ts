/**
 * configManager.ts — v67.0.0 "Real-World Integration II"
 * Hierarchical config management with env override, validation, and change tracking.
 */

export type ConfigValue = string | number | boolean | null;
export interface ConfigEntry { key: string; value: ConfigValue; source: "default" | "file" | "env" | "runtime"; updatedAt: number; }
export interface ConfigSchema { key: string; type: "string" | "number" | "boolean"; required: boolean; defaultValue?: ConfigValue; }

const store = new Map<string, ConfigEntry>();
const schemas = new Map<string, ConfigSchema>();
const changeLog: Array<{ key: string; oldValue: ConfigValue; newValue: ConfigValue; ts: number }> = [];

export function defineSchema(schema: ConfigSchema): void { schemas.set(schema.key, schema); }

export function setConfig(key: string, value: ConfigValue, source: ConfigEntry["source"] = "runtime"): void {
  const schema = schemas.get(key);
  if (schema) {
    if (value !== null && typeof value !== schema.type) throw new Error(`[ConfigManager] Type mismatch for ${key}: expected ${schema.type}`);
  }
  const old = store.get(key)?.value ?? null;
  store.set(key, { key, value, source, updatedAt: Date.now() });
  changeLog.push({ key, oldValue: old, newValue: value, ts: Date.now() });
}

export function getConfig(key: string): ConfigValue {
  const envKey = key.toUpperCase().replace(/\./g, "_");
  if (process.env[envKey] !== undefined) return process.env[envKey]!;
  const entry = store.get(key);
  if (entry) return entry.value;
  const schema = schemas.get(key);
  if (schema?.defaultValue !== undefined) return schema.defaultValue;
  return null;
}

export function validateAll(): Array<{ key: string; error: string }> {
  const errors: Array<{ key: string; error: string }> = [];
  schemas.forEach(schema => {
    if (schema.required && getConfig(schema.key) === null) errors.push({ key: schema.key, error: "Required config missing" });
  });
  return errors;
}

export function getChangeLog(): typeof changeLog { return [...changeLog]; }
export function _resetConfigManagerForTest(): void { store.clear(); schemas.clear(); changeLog.length = 0; }
