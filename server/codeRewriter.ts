/**
 * codeRewriter.ts — v92.0.0 "Recursive Self-Improvement & Introspection"
 * Code rewriting engine that applies transformations to improve code quality and performance.
 */
export type RewriteType = "simplify" | "optimize" | "refactor" | "document" | "test_add" | "dead_code_remove";

export interface RewriteRule {
  ruleId: string;
  name: string;
  type: RewriteType;
  pattern: string;
  replacement: string;
  priority: number;
  applicationsCount: number;
}

export interface RewriteResult {
  resultId: string;
  originalCode: string;
  rewrittenCode: string;
  appliedRules: string[];
  linesChanged: number;
  estimatedImprovementScore: number;
  rewriteType: RewriteType;
  timestamp: number;
}

const rules: RewriteRule[] = [];
const results: RewriteResult[] = [];
let ruleCounter = 0;
let resultCounter = 0;

export function defineRule(name: string, type: RewriteType, pattern: string, replacement: string, priority = 5): RewriteRule {
  const rule: RewriteRule = { ruleId: `rr-${++ruleCounter}`, name, type, pattern, replacement, priority, applicationsCount: 0 };
  rules.push(rule);
  rules.sort((a, b) => b.priority - a.priority);
  return rule;
}

export function applyRules(code: string, rewriteType?: RewriteType): RewriteResult {
  const applicableRules = rewriteType ? rules.filter(r => r.type === rewriteType) : rules;
  let rewritten = code;
  const appliedRuleIds: string[] = [];

  for (const rule of applicableRules) {
    if (rewritten.includes(rule.pattern)) {
      rewritten = rewritten.split(rule.pattern).join(rule.replacement);
      rule.applicationsCount++;
      appliedRuleIds.push(rule.ruleId);
    }
  }

  const originalLines = code.split("\n").length;
  const rewrittenLines = rewritten.split("\n").length;
  const linesChanged = Math.abs(originalLines - rewrittenLines) + appliedRuleIds.length;
  const improvementScore = appliedRuleIds.length > 0 ? Math.min(1.0, appliedRuleIds.length * 0.15) : 0;

  const result: RewriteResult = {
    resultId: `rwres-${++resultCounter}`,
    originalCode: code, rewrittenCode: rewritten,
    appliedRules: appliedRuleIds, linesChanged,
    estimatedImprovementScore: improvementScore,
    rewriteType: rewriteType ?? "refactor",
    timestamp: Date.now(),
  };
  results.push(result);
  return result;
}

export function getRules(type?: RewriteType): RewriteRule[] { return type ? rules.filter(r => r.type === type) : [...rules]; }
export function getResults(limit = 20): RewriteResult[] { return results.slice(-limit); }
export function _resetCodeRewriterForTest(): void { rules.length = 0; results.length = 0; ruleCounter = 0; resultCounter = 0; }
