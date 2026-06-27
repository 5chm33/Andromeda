/**
 * privacyEngine.ts — v74.0.0 "Privacy & Data Protection"
 * Central privacy engine that coordinates PII detection, redaction, and consent enforcement.
 */
export type PrivacyAction = "allow" | "redact" | "block" | "anonymize";
export type DataCategory = "pii" | "sensitive" | "public" | "internal" | "confidential";

export interface PrivacyPolicy {
  policyId: string;
  name: string;
  dataCategory: DataCategory;
  action: PrivacyAction;
  retentionDays: number;
  requiresConsent: boolean;
}

export interface PrivacyDecision {
  decisionId: string;
  dataCategory: DataCategory;
  action: PrivacyAction;
  policyApplied: string;
  reason: string;
  timestamp: number;
}

const policies: PrivacyPolicy[] = [];
const decisions: PrivacyDecision[] = [];
let decisionCounter = 0;

const DEFAULT_POLICIES: PrivacyPolicy[] = [
  { policyId: "default-pii", name: "PII Policy", dataCategory: "pii", action: "redact", retentionDays: 30, requiresConsent: true },
  { policyId: "default-sensitive", name: "Sensitive Policy", dataCategory: "sensitive", action: "anonymize", retentionDays: 90, requiresConsent: true },
  { policyId: "default-public", name: "Public Policy", dataCategory: "public", action: "allow", retentionDays: 365, requiresConsent: false },
  { policyId: "default-internal", name: "Internal Policy", dataCategory: "internal", action: "allow", retentionDays: 180, requiresConsent: false },
  { policyId: "default-confidential", name: "Confidential Policy", dataCategory: "confidential", action: "block", retentionDays: 7, requiresConsent: true },
];

export function initPrivacyEngine(): void {
  policies.push(...DEFAULT_POLICIES);
  console.log("[PrivacyEngine] Initialized with default policies.");
}

export function registerPolicy(policy: PrivacyPolicy): void {
  const existing = policies.findIndex(p => p.policyId === policy.policyId);
  if (existing >= 0) policies[existing] = policy;
  else policies.push(policy);
}

export function evaluatePrivacy(dataCategory: DataCategory, hasConsent: boolean): PrivacyDecision {
  const policy = policies.find(p => p.dataCategory === dataCategory) ?? DEFAULT_POLICIES.find(p => p.dataCategory === dataCategory);
  const action: PrivacyAction = policy ? (policy.requiresConsent && !hasConsent ? "block" : policy.action) : "block";
  const decision: PrivacyDecision = {
    decisionId: `priv-decision-${++decisionCounter}`,
    dataCategory,
    action,
    policyApplied: policy?.policyId ?? "none",
    reason: policy ? `Policy "${policy.name}" applied` : "No matching policy — defaulting to block",
    timestamp: Date.now(),
  };
  decisions.push(decision);
  return decision;
}

export function getPrivacyDecisions(): PrivacyDecision[] { return [...decisions]; }
export function getPolicies(): PrivacyPolicy[] { return [...policies]; }

export function _resetPrivacyEngineForTest(): void {
  policies.length = 0;
  decisions.length = 0;
  decisionCounter = 0;
}
