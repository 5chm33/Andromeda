/**
 * documentClassifier.ts — v82.0.0 "Document Intelligence"
 * Classifies documents into categories using keyword-based and rule-based approaches.
 */
export interface ClassificationRule {
  ruleId: string;
  category: string;
  keywords: string[];
  weight: number;
}

export interface ClassificationResult {
  docId: string;
  topCategory: string;
  confidence: number;
  scores: Record<string, number>;
  appliedRules: string[];
}

const rules: ClassificationRule[] = [];
let ruleCounter = 0;

export function addClassificationRule(category: string, keywords: string[], weight = 1): ClassificationRule {
  const rule: ClassificationRule = { ruleId: `rule-${++ruleCounter}`, category, keywords, weight };
  rules.push(rule);
  return rule;
}

export function classifyDocument(docId: string, content: string): ClassificationResult {
  const lower = content.toLowerCase();
  const scores: Record<string, number> = {};
  const appliedRules: string[] = [];

  for (const rule of rules) {
    let score = 0;
    for (const kw of rule.keywords) {
      const matches = (lower.match(new RegExp(`\\b${kw.toLowerCase()}\\b`, "g")) ?? []).length;
      score += matches * rule.weight;
    }
    if (score > 0) {
      scores[rule.category] = (scores[rule.category] ?? 0) + score;
      appliedRules.push(rule.ruleId);
    }
  }

  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  const topCategory = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "uncategorized";
  const confidence = total > 0 ? (scores[topCategory] ?? 0) / total : 0;

  return { docId, topCategory, confidence, scores, appliedRules };
}

export function getRules(): ClassificationRule[] { return [...rules]; }
export function _resetDocumentClassifierForTest(): void { rules.length = 0; ruleCounter = 0; }
