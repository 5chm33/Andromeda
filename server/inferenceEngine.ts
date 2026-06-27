/**
 * inferenceEngine.ts — v85.0.0 "Knowledge Graph & Reasoning"
 * Forward-chaining inference engine that derives new facts from rules and known facts.
 */
export interface Fact {
  factId: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  derived: boolean;
  sourceRuleId: string | null;
}

export interface InferenceRule {
  ruleId: string;
  name: string;
  conditions: Array<{ predicate: string; subjectVar: string; objectVar: string }>;
  conclusion: { predicate: string; subjectVar: string; objectVar: string };
  confidence: number;
}

export interface InferenceResult {
  newFacts: Fact[];
  appliedRules: string[];
  iterations: number;
}

const facts: Fact[] = [];
const rules: InferenceRule[] = [];
let factCounter = 0;
let ruleCounter = 0;

export function assertFact(subject: string, predicate: string, object: string, confidence = 1.0): Fact {
  const existing = facts.find(f => f.subject === subject && f.predicate === predicate && f.object === object);
  if (existing) return existing;
  const fact: Fact = { factId: `fact-${++factCounter}`, subject, predicate, object, confidence, derived: false, sourceRuleId: null };
  facts.push(fact);
  return fact;
}

export function addRule(name: string, conditions: InferenceRule["conditions"], conclusion: InferenceRule["conclusion"], confidence = 0.9): InferenceRule {
  const rule: InferenceRule = { ruleId: `rule-${++ruleCounter}`, name, conditions, conclusion, confidence };
  rules.push(rule);
  return rule;
}

export function runInference(maxIterations = 10): InferenceResult {
  const newFacts: Fact[] = [];
  const appliedRules: string[] = [];
  let iterations = 0;
  let changed = true;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const rule of rules) {
      // Simple single-condition rule matching
      if (rule.conditions.length !== 1) continue;
      const cond = rule.conditions[0];

      for (const fact of facts) {
        if (fact.predicate !== cond.predicate) continue;
        const bindings: Record<string, string> = { [cond.subjectVar]: fact.subject, [cond.objectVar]: fact.object };
        const newSubject = bindings[rule.conclusion.subjectVar] ?? rule.conclusion.subjectVar;
        const newObject = bindings[rule.conclusion.objectVar] ?? rule.conclusion.objectVar;
        const newConf = fact.confidence * rule.confidence;

        const exists = facts.some(f => f.subject === newSubject && f.predicate === rule.conclusion.predicate && f.object === newObject);
        if (!exists) {
          const derived: Fact = { factId: `fact-${++factCounter}`, subject: newSubject, predicate: rule.conclusion.predicate, object: newObject, confidence: newConf, derived: true, sourceRuleId: rule.ruleId };
          facts.push(derived);
          newFacts.push(derived);
          if (!appliedRules.includes(rule.ruleId)) appliedRules.push(rule.ruleId);
          changed = true;
        }
      }
    }
  }

  return { newFacts, appliedRules, iterations };
}

export function queryFacts(predicate?: string, subject?: string): Fact[] {
  return facts.filter(f => (!predicate || f.predicate === predicate) && (!subject || f.subject === subject));
}

export function getFactCount(): number { return facts.length; }
export function _resetInferenceEngineForTest(): void { facts.length = 0; rules.length = 0; factCounter = 0; ruleCounter = 0; }
