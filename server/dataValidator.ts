/**
 * dataValidator.ts — v69.0.0 "Data Pipeline"
 * Schema-based data validation with custom rules, coercion, and error reporting.
 */
export type FieldType = "string" | "number" | "boolean" | "array" | "object" | "null";
export interface FieldSchema { type: FieldType; required?: boolean; min?: number; max?: number; pattern?: string; enum?: unknown[]; }
export interface ValidationSchema { [field: string]: FieldSchema; }
export interface ValidationResult { valid: boolean; errors: Array<{ field: string; message: string }>; coerced: Record<string, unknown>; }

export function validateData(data: Record<string, unknown>, schema: ValidationSchema): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const coerced: Record<string, unknown> = { ...data };
  for (const [field, rule] of Object.entries(schema)) {
    const val = data[field];
    if (rule.required && (val === undefined || val === null)) { errors.push({ field, message: "Required field missing" }); continue; }
    if (val === undefined || val === null) continue;
    if (rule.type === "number" && typeof val === "string") {
      const n = Number(val);
      if (!isNaN(n)) coerced[field] = n;
      else { errors.push({ field, message: `Cannot coerce to number` }); continue; }
    } else if (typeof val !== rule.type && !(rule.type === "array" && Array.isArray(val)) && !(rule.type === "null" && val === null)) {
      errors.push({ field, message: `Expected ${rule.type}, got ${typeof val}` }); continue;
    }
    const numVal = typeof coerced[field] === "number" ? coerced[field] as number : (typeof val === "number" ? val : NaN);
    if (rule.min !== undefined && numVal < rule.min) errors.push({ field, message: `Value ${numVal} below minimum ${rule.min}` });
    if (rule.max !== undefined && numVal > rule.max) errors.push({ field, message: `Value ${numVal} above maximum ${rule.max}` });
    if (rule.pattern && typeof val === "string" && !new RegExp(rule.pattern).test(val)) errors.push({ field, message: `Value does not match pattern ${rule.pattern}` });
    if (rule.enum && !rule.enum.includes(val)) errors.push({ field, message: `Value not in allowed enum` });
  }
  return { valid: errors.length === 0, errors, coerced };
}
