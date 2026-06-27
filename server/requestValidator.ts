/**
 * requestValidator.ts — v79.0.0 "API Gateway & Integration"
 * Validates incoming API requests against JSON-schema-like rules.
 */
export type FieldType = "string" | "number" | "boolean" | "array" | "object";

export interface FieldRule {
  name: string;
  type: FieldType;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: (string | number)[];
}

export interface ValidationSchema {
  schemaId: string;
  name: string;
  fields: FieldRule[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const schemas = new Map<string, ValidationSchema>();

export function registerSchema(schema: ValidationSchema): void {
  schemas.set(schema.schemaId, schema);
}

export function validateRequest(schemaId: string, data: Record<string, unknown>): ValidationResult {
  const schema = schemas.get(schemaId);
  if (!schema) return { valid: false, errors: [`Schema "${schemaId}" not found`] };

  const errors: string[] = [];

  for (const rule of schema.fields) {
    const value = data[rule.name];

    if (rule.required && (value === undefined || value === null)) {
      errors.push(`Field "${rule.name}" is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    const actualType = Array.isArray(value) ? "array" : typeof value;
    if (actualType !== rule.type) {
      errors.push(`Field "${rule.name}" must be of type ${rule.type}, got ${actualType}`);
      continue;
    }

    if (rule.type === "string" && typeof value === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`Field "${rule.name}" must be at least ${rule.minLength} characters`);
      if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push(`Field "${rule.name}" must be at most ${rule.maxLength} characters`);
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`Field "${rule.name}" does not match pattern ${rule.pattern}`);
      if (rule.enum && !rule.enum.includes(value)) errors.push(`Field "${rule.name}" must be one of: ${rule.enum.join(", ")}`);
    }

    if (rule.type === "number" && typeof value === "number") {
      if (rule.min !== undefined && value < rule.min) errors.push(`Field "${rule.name}" must be >= ${rule.min}`);
      if (rule.max !== undefined && value > rule.max) errors.push(`Field "${rule.name}" must be <= ${rule.max}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function getSchema(schemaId: string): ValidationSchema | undefined { return schemas.get(schemaId); }
export function _resetRequestValidatorForTest(): void { schemas.clear(); }
