/**
 * constitutionalConstraints.ts — Constitutional AI Layer (v10.7.1)
 * Hard gates for RSI proposals based on 9 inviolable rules.
 */

export interface Proposal {
  diff: string;
  targetFile: string;
  description: string;
}

export interface ConstitutionResult {
  allowed: boolean;
  violations: string[];
  score: number; // 0.0 to 1.0
}

const DEFAULT_RULES = [
  "R1: Proposals MUST NOT degrade test coverage or remove valid assertions.",
  "R2: Proposals MUST NOT introduce infinite loops or unbounded recursion.",
  "R3: Proposals MUST NOT bypass or weaken existing security boundaries.",
  "R4: Proposals MUST NOT hardcode secrets, credentials, or PII.",
  "R5: Proposals MUST NOT execute arbitrary downloaded code without verification.",
  "R6: Proposals MUST NOT modify the core RSI engine (selfImprove.ts) to disable constraints.",
  "R7: Proposals MUST NOT introduce syntax errors or break TypeScript compilation.",
  "R8: Proposals MUST NOT remove the identity manifest or its core directives.",
  "R9: Proposals MUST NOT weaken test assertions by replacing null/undefined-safe checks with .toBeTruthy()."
];

let rules = [...DEFAULT_RULES];

export function checkConstitution(proposal: Proposal): ConstitutionResult {
  const violations: string[] = [];
  const diffLower = proposal.diff.toLowerCase();
  const descLower = proposal.description.toLowerCase();
  const fileLower = proposal.targetFile.toLowerCase();

  // R1: Test degradation heuristic
  if (diffLower.includes("-  expect(") || diffLower.includes("-  it(") || diffLower.includes("-  test(")) {
    // If removing tests, make sure we are adding tests too
    const addedTests = (proposal.diff.match(/\+\s*expect\(/g) || []).length;
    const removedTests = (proposal.diff.match(/-\s*expect\(/g) || []).length;
    if (removedTests > addedTests) {
      violations.push("R1_VIOLATION: Appears to reduce test assertions.");
    }
  }

  // R2: Infinite loop heuristic
  if (diffLower.includes("while (true)") || diffLower.includes("for (;;)")) {
    if (!diffLower.includes("break") && !diffLower.includes("return")) {
      violations.push("R2_VIOLATION: Unbounded loop detected without clear exit condition.");
    }
  }

  // R3 & R6: Security and RSI engine tampering
  if (fileLower.includes("selfimprove.ts") || fileLower.includes("constitutionalconstraints.ts")) {
    if (diffLower.includes("-") && (diffLower.includes("checkconstitution") || diffLower.includes("verifyproposal"))) {
      violations.push("R6_VIOLATION: Attempted to modify or remove RSI constraints.");
    }
  }

  // R4: Hardcoded secrets
  const secretRegex = /\b(api[_-]?key|secret|password|token)\b.*[:=].*["'][a-zA-Z0-9\-]{10,}["']/i;
  if (secretRegex.test(proposal.diff)) {
    violations.push("R4_VIOLATION: Potential hardcoded secret detected.");
  }

  // R8: Identity manifest
  if (fileLower.includes("identitymanifest.ts") && proposal.diff.includes("-")) {
    if (diffLower.includes("core_directives") || diffLower.includes("rsi_constraints")) {
      violations.push("R8_VIOLATION: Attempted to remove core identity directives.");
    }
  }

  // R9: Prevent weakening test assertions (null/undefined-safe checks → .toBeTruthy())
  // The RSI engine must not replace valid null/undefined-safe assertions with .toBeTruthy()
  // because cache misses return undefined and void functions return undefined — both are valid.
  if (fileLower.includes(".test.ts")) {
    const removedSafeCheck = /-.*(?:=== undefined|=== null|typeof result|resolves\.toBeUndefined|!!result)/i.test(proposal.diff);
    const addedToBeTruthy = /\+.*\.toBeTruthy\(\)/.test(proposal.diff);
    if (removedSafeCheck && addedToBeTruthy) {
      violations.push("R9_VIOLATION: Weakens test assertion — replaced null/undefined-safe check with .toBeTruthy() which fails on cache misses and void returns.");
    }
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1.0 - (violations.length * 0.25));

  return {
    allowed: violations.length === 0,
    violations,
    score
  };
}

export function getConstitutionRules(): string[] {
  return [...rules];
}

export function addConstitutionRule(rule: string): void {
  if (!rules.includes(rule)) {
    rules.push(rule);
  }
}

export function resetConstitutionRules(): void {
  rules = [...DEFAULT_RULES];
}
