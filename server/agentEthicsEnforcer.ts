/**
 * agentEthicsEnforcer.ts — v49.0.0
 *
 * Enforces ethical constraints on sub-agent actions using a rule-based
 * ethics framework with severity levels and override mechanisms.
 */

export type EthicsCategory = "harm" | "privacy" | "fairness" | "transparency" | "autonomy";

export interface EthicsRule {
  ruleId: string;
  category: EthicsCategory;
  description: string;
  severity: "advisory" | "warning" | "blocking";
  pattern: string;  // keyword/pattern to match in action description
}

export interface EthicsDecision {
  allowed: boolean;
  violations: EthicsRule[];
  overrideRequired: boolean;
  reasoning: string;
}

export interface EthicsAuditEntry {
  entryId: string;
  agentId: string;
  action: string;
  decision: EthicsDecision;
  timestamp: number;
}

const DEFAULT_RULES: EthicsRule[] = [
  { ruleId: "e1", category: "harm", description: "Prevent physical harm", severity: "blocking", pattern: "harm|injure|damage|destroy" },
  { ruleId: "e2", category: "privacy", description: "Protect personal data", severity: "blocking", pattern: "personal data|pii|private info|password" },
  { ruleId: "e3", category: "fairness", description: "Avoid discriminatory actions", severity: "warning", pattern: "discriminat|bias|unfair" },
  { ruleId: "e4", category: "transparency", description: "Require transparency", severity: "advisory", pattern: "hidden|covert|secret operation" },
  { ruleId: "e5", category: "autonomy", description: "Respect human autonomy", severity: "warning", pattern: "override human|bypass approval|ignore consent" },
];

const rules: EthicsRule[] = [...DEFAULT_RULES];
const auditLog: EthicsAuditEntry[] = [];
let entryCounter = 0;

export function addRule(rule: EthicsRule): void {
  rules.push(rule);
}

export function evaluateAction(agentId: string, actionDescription: string): EthicsDecision {
  const lowerAction = actionDescription.toLowerCase();
  const triggered: EthicsRule[] = [];

  for (const rule of rules) {
    const patterns = rule.pattern.split("|");
    if (patterns.some(p => lowerAction.includes(p.trim()))) {
      triggered.push(rule);
    }
  }

  const hasBlocking = triggered.some(r => r.severity === "blocking");
  const hasWarning = triggered.some(r => r.severity === "warning");

  const decision: EthicsDecision = {
    allowed: !hasBlocking,
    violations: triggered,
    overrideRequired: hasBlocking,
    reasoning: hasBlocking
      ? `Action blocked: ${triggered.filter(r => r.severity === "blocking").map(r => r.description).join("; ")}`
      : hasWarning
        ? `Action allowed with warnings: ${triggered.filter(r => r.severity === "warning").map(r => r.description).join("; ")}`
        : "Action approved — no ethics violations detected.",
  };

  auditLog.push({
    entryId: `eth-${++entryCounter}`,
    agentId,
    action: actionDescription,
    decision,
    timestamp: Date.now(),
  });

  if (!decision.allowed) {
    console.warn(`[EthicsEnforcer] BLOCKED agent ${agentId}: ${decision.reasoning}`);
  }

  return decision;
}

export function getAuditLog(agentId?: string): EthicsAuditEntry[] {
  return agentId ? auditLog.filter(e => e.agentId === agentId) : [...auditLog];
}

export function getBlockedActionCount(agentId?: string): number {
  const entries = agentId ? auditLog.filter(e => e.agentId === agentId) : auditLog;
  return entries.filter(e => !e.decision.allowed).length;
}

export function _resetEthicsEnforcerForTest(): void {
  rules.length = 0;
  rules.push(...DEFAULT_RULES);
  auditLog.length = 0;
  entryCounter = 0;
}
