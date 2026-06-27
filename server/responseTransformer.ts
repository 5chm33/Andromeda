/**
 * responseTransformer.ts — v79.0.0 "API Gateway & Integration"
 * Applies field mapping, filtering, and envelope wrapping to API responses.
 */
export interface TransformRule {
  ruleId: string;
  name: string;
  fieldMappings: Record<string, string>;
  excludeFields: string[];
  envelopeKey: string | null;
  addFields: Record<string, unknown>;
}

export interface TransformResult {
  original: Record<string, unknown>;
  transformed: Record<string, unknown>;
  appliedRuleId: string;
}

const rules = new Map<string, TransformRule>();
const history: TransformResult[] = [];

export function registerTransformRule(rule: TransformRule): void {
  rules.set(rule.ruleId, rule);
}

export function transformResponse(ruleId: string, data: Record<string, unknown>): TransformResult | null {
  const rule = rules.get(ruleId);
  if (!rule) return null;

  let result: Record<string, unknown> = { ...data };

  // Apply field mappings (rename fields)
  for (const [from, to] of Object.entries(rule.fieldMappings)) {
    if (from in result) {
      result[to] = result[from];
      delete result[from];
    }
  }

  // Exclude fields
  for (const field of rule.excludeFields) {
    delete result[field];
  }

  // Add extra fields
  for (const [key, value] of Object.entries(rule.addFields)) {
    result[key] = value;
  }

  // Wrap in envelope
  if (rule.envelopeKey) {
    result = { [rule.envelopeKey]: result };
  }

  const transformResult: TransformResult = { original: data, transformed: result, appliedRuleId: ruleId };
  history.push(transformResult);
  return transformResult;
}

export function getTransformHistory(): TransformResult[] { return [...history]; }
export function getTransformRule(ruleId: string): TransformRule | undefined { return rules.get(ruleId); }
export function _resetResponseTransformerForTest(): void { rules.clear(); history.length = 0; }
