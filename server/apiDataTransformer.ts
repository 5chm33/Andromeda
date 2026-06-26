/**
 * apiDataTransformer.ts — v52.0.0
 *
 * Transforms API request/response data between formats using
 * field mapping, type coercion, and schema normalization.
 */

export interface FieldMapping {
  source: string;      // dot-notation path e.g. "user.id"
  target: string;      // dot-notation path e.g. "userId"
  transform?: "string" | "number" | "boolean" | "uppercase" | "lowercase" | "trim";
}

export interface TransformResult {
  success: boolean;
  data: Record<string, unknown>;
  errors: string[];
}

export function applyMapping(source: Record<string, unknown>, mappings: FieldMapping[]): TransformResult {
  const result: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const mapping of mappings) {
    try {
      const value = getNestedValue(source, mapping.source);
      const transformed = applyTransform(value, mapping.transform);
      setNestedValue(result, mapping.target, transformed);
    } catch (e) {
      errors.push(`Mapping "${mapping.source}" -> "${mapping.target}": ${(e as Error).message}`);
    }
  }

  return { success: errors.length === 0, data: result, errors };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) throw new Error(`Path "${path}" not found`);
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function applyTransform(value: unknown, transform?: FieldMapping["transform"]): unknown {
  if (!transform) return value;
  switch (transform) {
    case "string": return String(value ?? "");
    case "number": return Number(value);
    case "boolean": return Boolean(value);
    case "uppercase": return String(value ?? "").toUpperCase();
    case "lowercase": return String(value ?? "").toLowerCase();
    case "trim": return String(value ?? "").trim();
    default: return value;
  }
}

export function normalizeResponse(data: unknown, schema: Record<string, string>): Record<string, unknown> {
  if (typeof data !== "object" || data === null) return {};
  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(schema)) {
    if (key in obj) {
      result[key] = applyTransform(obj[key], type as FieldMapping["transform"]);
    }
  }
  return result;
}

export function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}
