/**
 * featureFlagManager.ts — v77.0.0 "Feature Flags & Experimentation"
 * Manages feature flags with targeting rules, rollout percentages, and kill-switch support.
 */
export type FlagStatus = "enabled" | "disabled" | "rollout" | "experiment";

export interface TargetingRule {
  attribute: string;
  operator: "equals" | "contains" | "startsWith" | "in";
  value: string | string[];
}

export interface FeatureFlag {
  flagId: string;
  name: string;
  description: string;
  status: FlagStatus;
  rolloutPercent: number;
  targetingRules: TargetingRule[];
  createdAt: number;
  updatedAt: number;
}

export interface FlagEvaluation {
  flagId: string;
  userId: string;
  enabled: boolean;
  reason: string;
  evaluatedAt: number;
}

const flags = new Map<string, FeatureFlag>();
const evaluations: FlagEvaluation[] = [];
let evalCounter = 0;

export function createFlag(flagId: string, name: string, description: string, status: FlagStatus = "disabled", rolloutPercent = 0): FeatureFlag {
  const flag: FeatureFlag = { flagId, name, description, status, rolloutPercent, targetingRules: [], createdAt: Date.now(), updatedAt: Date.now() };
  flags.set(flagId, flag);
  return flag;
}

export function updateFlag(flagId: string, updates: Partial<Pick<FeatureFlag, "status" | "rolloutPercent" | "targetingRules">>): boolean {
  const flag = flags.get(flagId);
  if (!flag) return false;
  Object.assign(flag, updates, { updatedAt: Date.now() });
  return true;
}

function matchesRules(rules: TargetingRule[], context: Record<string, string>): boolean {
  return rules.every(rule => {
    const val = context[rule.attribute] ?? "";
    if (rule.operator === "equals") return val === rule.value;
    if (rule.operator === "contains") return val.includes(String(rule.value));
    if (rule.operator === "startsWith") return val.startsWith(String(rule.value));
    if (rule.operator === "in") return Array.isArray(rule.value) && rule.value.includes(val);
    return false;
  });
}

function hashUser(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % 100;
}

export function evaluateFlag(flagId: string, userId: string, context: Record<string, string> = {}): FlagEvaluation {
  const flag = flags.get(flagId);
  let enabled = false;
  let reason = "Flag not found";

  if (flag) {
    if (flag.status === "disabled") { enabled = false; reason = "Flag is disabled"; }
    else if (flag.status === "enabled") { enabled = true; reason = "Flag is globally enabled"; }
    else if (flag.targetingRules.length > 0 && matchesRules(flag.targetingRules, context)) { enabled = true; reason = "User matches targeting rules"; }
    else if (flag.status === "rollout" || flag.status === "experiment") {
      const bucket = hashUser(userId);
      enabled = bucket < flag.rolloutPercent;
      reason = enabled ? `User in rollout bucket (${bucket}/${flag.rolloutPercent}%)` : `User outside rollout bucket (${bucket}/${flag.rolloutPercent}%)`;
    }
  }

  const evaluation: FlagEvaluation = { flagId, userId, enabled, reason, evaluatedAt: Date.now() };
  evaluations.push(evaluation);
  return evaluation;
}

export function getFlag(flagId: string): FeatureFlag | undefined { return flags.get(flagId); }
export function getAllFlags(): FeatureFlag[] { return [...flags.values()]; }
export function getEvaluations(): FlagEvaluation[] { return [...evaluations]; }
export function _resetFeatureFlagManagerForTest(): void { flags.clear(); evaluations.length = 0; evalCounter = 0; }
