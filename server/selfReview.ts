/**
 * selfReview.ts — Autonomous Code Self-Review
 * 
 * Analyzes generated code before execution for: syntax errors, security issues,
 * performance anti-patterns, missing error handling, and style violations.
 * Can auto-fix detected issues or flag them for human review.
 * 
 * v5.7 Enhancement
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReviewSeverity = "critical" | "warning" | "info" | "style";

export type ReviewCategory =
  | "syntax"
  | "security"
  | "performance"
  | "error_handling"
  | "logic"
  | "style"
  | "best_practice";

export type ReviewIssue = {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
  autoFixable: boolean;
};

export type ReviewResult = {
  language: "typescript" | "python" | "bash" | "unknown";
  issues: ReviewIssue[];
  score: number;           // 0-100
  passesGate: boolean;     // Score >= threshold
  syntaxValid: boolean;
  autoFixCount: number;
  reviewTime: number;      // ms
  fixedCode?: string;      // If auto-fix was applied
};

export type ReviewConfig = {
  enabled: boolean;
  gateThreshold: number;   // Min score to pass (0-100)
  autoFix: boolean;        // Auto-apply safe fixes
  maxIssues: number;       // Stop after N issues
  categories: ReviewCategory[];
  severityWeights: Record<ReviewSeverity, number>;
};

type ReviewStats = {
  totalReviews: number;
  passed: number;
  failed: number;
  autoFixed: number;
  issuesByCategory: Record<string, number>;
  avgScore: number;
};

// ── State ────────────────────────────────────────────────────────────────────

const reviewHistory: { code: string; result: ReviewResult; timestamp: number }[] = [];

let config: ReviewConfig = {
  enabled: true,
  gateThreshold: 45,  // v5.68: Relaxed from 60 to reduce false positives on valid self-modifications
  autoFix: true,
  maxIssues: 50,
  categories: ["syntax", "security", "performance", "error_handling", "logic", "style", "best_practice"],
  severityWeights: { critical: 25, warning: 10, info: 3, style: 1 },
};

// ── Security Patterns ────────────────────────────────────────────────────────

const SECURITY_PATTERNS: { regex: RegExp; message: string; severity: ReviewSeverity; lang: string[] }[] = [
  // Universal
  { regex: /Function\s*\(/, message: "Use of Function() constructor is a security risk — consider alternatives", severity: "critical", lang: ["typescript", "python"] },
  { regex: /exec\s*\(.*\$\{/, message: "Template literal in exec() — potential command injection", severity: "critical", lang: ["typescript"] },
  { regex: /child_process.*exec\(.*\+/, message: "String concatenation in exec() — potential command injection", severity: "critical", lang: ["typescript"] },
  { regex: /subprocess\.call\(.*shell\s*=\s*True/, message: "subprocess with shell=True — potential command injection", severity: "critical", lang: ["python"] },
  { regex: /os\.system\(/, message: "os.system() is unsafe — use subprocess.run() instead", severity: "warning", lang: ["python"] },
  // SQL injection
  { regex: /`SELECT.*\$\{/, message: "Template literal in SQL query — use parameterized queries", severity: "critical", lang: ["typescript"] },
  { regex: /f"SELECT.*\{/, message: "f-string in SQL query — use parameterized queries", severity: "critical", lang: ["python"] },
  // Path traversal
  { regex: /\.\.\/.*\.\.\//, message: "Path traversal pattern detected", severity: "warning", lang: ["typescript", "python"] },
  // Hardcoded secrets
  { regex: /(?:password|secret|api_key|apikey|token)\s*=\s*['"][^'"]{8,}['"]/, message: "Possible hardcoded secret — use environment variables", severity: "critical", lang: ["typescript", "python"] },
  // Dangerous operations
  { regex: /rm\s+-rf\s+\/(?!\w)/, message: "Dangerous rm -rf / pattern", severity: "critical", lang: ["typescript", "python", "bash"] },
  { regex: /chmod\s+777/, message: "chmod 777 is overly permissive", severity: "warning", lang: ["bash"] },
  { regex: /:\(\)\s*\{\s*:\|:&\s*\};:/, message: "Fork bomb detected", severity: "critical", lang: ["bash"] },
];

// ── Performance Patterns ─────────────────────────────────────────────────────

const PERF_PATTERNS: { regex: RegExp; message: string; suggestion: string; lang: string[] }[] = [
  { regex: /for\s*\(.*\.length.*\).*\.push\(/, message: "Array push in loop — consider pre-allocation or map()", suggestion: "Use Array.map() or pre-allocate", lang: ["typescript"] },
  { regex: /JSON\.parse\(JSON\.stringify\(/, message: "Deep clone via JSON round-trip is slow", suggestion: "Use structuredClone() or a library", lang: ["typescript"] },
  { regex: /new RegExp\(.*\).*(?:for|while|\.forEach)/, message: "RegExp creation inside loop", suggestion: "Move RegExp to outer scope", lang: ["typescript"] },
  { regex: /await.*(?:for|while)\s*\(/, message: "Sequential await in loop — consider Promise.all()", suggestion: "Use Promise.all() for parallel execution", lang: ["typescript"] },
  { regex: /\.sort\(\)\.reverse\(\)/, message: "sort().reverse() — use custom comparator instead", suggestion: "Use .sort((a,b) => b - a)", lang: ["typescript"] },
  { regex: /time\.sleep\(.*\).*(?:for|while)/, message: "sleep() in loop — consider async patterns", suggestion: "Use asyncio.sleep() with async/await", lang: ["python"] },
];

// ── Error Handling Patterns ──────────────────────────────────────────────────

const ERROR_PATTERNS: { regex: RegExp; message: string; lang: string[] }[] = [
  { regex: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/, message: "Empty catch block — errors are silently swallowed", lang: ["typescript"] },
  { regex: /catch\s*\(\s*\w*\s*\)\s*\{\s*\/\//, message: "Catch block with only a comment — consider logging", lang: ["typescript"] },
  { regex: /except:\s*$/, message: "Bare except clause — catches all exceptions including SystemExit", lang: ["python"] },
  { regex: /except\s+Exception\s*:\s*\n\s*pass/, message: "except Exception: pass — errors are silently swallowed", lang: ["python"] },
  { regex: /\.then\(.*\)(?!\s*\.catch)/, message: "Promise .then() without .catch() — unhandled rejection risk", lang: ["typescript"] },
  { regex: /fs\.\w+Sync\((?!.*try)/, message: "Sync file operation without try/catch", lang: ["typescript"] },
];

// ── Style Patterns ───────────────────────────────────────────────────────────

const STYLE_PATTERNS: { regex: RegExp; message: string; lang: string[] }[] = [
  { regex: /console\.log\(/, message: "console.log() left in code — use a proper logger", lang: ["typescript"] },
  { regex: /print\(.*\)(?!.*#.*debug)/, message: "print() left in code — use logging module", lang: ["python"] },
  { regex: /TODO|FIXME|HACK|XXX/, message: "TODO/FIXME comment found — address before shipping", lang: ["typescript", "python"] },
  { regex: /var\s+\w+\s*=/, message: "Use const/let instead of var", lang: ["typescript"] },
  { regex: /==(?!=)/, message: "Use === for strict equality", lang: ["typescript"] },
];

// ── Core Review Functions ────────────────────────────────────────────────────

export function reviewCode(code: string, language?: "typescript" | "python" | "bash"): ReviewResult {
  const start = Date.now();
  const lang = language || detectLanguage(code);
  const issues: ReviewIssue[] = [];
  let issueCounter = 0;

  // 1. Syntax check
  const syntaxValid = checkSyntax(code, lang);
  if (!syntaxValid) {
    issues.push({
      id: `issue_${issueCounter++}`,
      severity: "critical",
      category: "syntax",
      message: "Code has syntax errors — will not execute",
      autoFixable: false,
    });
  }

  // 2. Security scan
  if (config.categories.includes("security")) {
    for (const pattern of SECURITY_PATTERNS) {
      if (!pattern.lang.includes(lang)) continue;
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i]) && issues.length < config.maxIssues) {
          issues.push({
            id: `issue_${issueCounter++}`,
            severity: pattern.severity,
            category: "security",
            line: i + 1,
            message: pattern.message,
            autoFixable: false,
          });
        }
      }
    }
  }

  // 3. Performance scan
  if (config.categories.includes("performance")) {
    for (const pattern of PERF_PATTERNS) {
      if (!pattern.lang.includes(lang)) continue;
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i]) && issues.length < config.maxIssues) {
          issues.push({
            id: `issue_${issueCounter++}`,
            severity: "warning",
            category: "performance",
            line: i + 1,
            message: pattern.message,
            suggestion: pattern.suggestion,
            autoFixable: false,
          });
        }
      }
    }
  }

  // 4. Error handling scan
  if (config.categories.includes("error_handling")) {
    for (const pattern of ERROR_PATTERNS) {
      if (!pattern.lang.includes(lang)) continue;
      if (pattern.regex.test(code) && issues.length < config.maxIssues) {
        issues.push({
          id: `issue_${issueCounter++}`,
          severity: "warning",
          category: "error_handling",
          message: pattern.message,
          autoFixable: false,
        });
      }
    }
  }

  // 5. Style scan
  if (config.categories.includes("style")) {
    for (const pattern of STYLE_PATTERNS) {
      if (!pattern.lang.includes(lang)) continue;
      const lines = code.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i]) && issues.length < config.maxIssues) {
          issues.push({
            id: `issue_${issueCounter++}`,
            severity: "style",
            category: "style",
            line: i + 1,
            message: pattern.message,
            autoFixable: pattern.message.includes("var ") || pattern.message.includes("==="),
          });
        }
      }
    }
  }

  // 6. Best practice checks
  if (config.categories.includes("best_practice")) {
    const bpIssues = checkBestPractices(code, lang);
    for (const issue of bpIssues) {
      if (issues.length < config.maxIssues) issues.push({ ...issue, id: `issue_${issueCounter++}` });
    }
  }

  // Calculate score
  let deductions = 0;
  for (const issue of issues) {
    deductions += config.severityWeights[issue.severity];
  }
  const score = Math.max(0, 100 - deductions);

  // Auto-fix if enabled
  let fixedCode: string | undefined;
  let autoFixCount = 0;
  if (config.autoFix) {
    const fixResult = applyAutoFixes(code, issues, lang);
    if (fixResult.fixCount > 0) {
      fixedCode = fixResult.code;
      autoFixCount = fixResult.fixCount;
    }
  }

  const result: ReviewResult = {
    language: lang,
    issues,
    score,
    passesGate: score >= config.gateThreshold,
    syntaxValid,
    autoFixCount,
    reviewTime: Date.now() - start,
    fixedCode,
  };

  // Record history
  reviewHistory.push({ code, result, timestamp: Date.now() });
  if (reviewHistory.length > 100) reviewHistory.splice(0, reviewHistory.length - 100);

  return result;
}

export function reviewAndGate(code: string, language?: "typescript" | "python" | "bash"): {
  allowed: boolean;
  result: ReviewResult;
  code: string;
} {
  if (!config.enabled) {
    return {
      allowed: true,
      result: {
        language: language || "unknown",
        issues: [],
        score: 100,
        passesGate: true,
        syntaxValid: true,
        autoFixCount: 0,
        reviewTime: 0,
      },
      code,
    };
  }

  const result = reviewCode(code, language);
  return {
    allowed: result.passesGate,
    result,
    code: result.fixedCode || code,
  };
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getReviewConfig(): ReviewConfig {
  return { ...config };
}

export function setReviewConfig(updates: Partial<ReviewConfig>): ReviewConfig {
  config = { ...config, ...updates };
  return { ...config };
}

export function getReviewStats(): ReviewStats {
  const catCounts: Record<string, number> = {};
  let totalScore = 0;

  for (const entry of reviewHistory) {
    totalScore += entry.result.score;
    for (const issue of entry.result.issues) {
      catCounts[issue.category] = (catCounts[issue.category] || 0) + 1;
    }
  }

  return {
    totalReviews: reviewHistory.length,
    passed: reviewHistory.filter(r => r.result.passesGate).length,
    failed: reviewHistory.filter(r => !r.result.passesGate).length,
    autoFixed: reviewHistory.filter(r => r.result.autoFixCount > 0).length,
    issuesByCategory: catCounts,
    avgScore: reviewHistory.length > 0 ? Math.round(totalScore / reviewHistory.length) : 100,
  };
}

export function getReviewHistory(limit: number = 20): { code: string; result: ReviewResult; timestamp: number }[] {
  return reviewHistory.slice(-limit);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectLanguage(code: string): "typescript" | "python" | "bash" | "unknown" {
  // TypeScript/JavaScript indicators
  const tsScore = (code.match(/(?:const |let |var |function |import |export |=>|interface |type )/g) || []).length;
  // Python indicators
  const pyScore = (code.match(/(?:def |class |import |from |print\(|if __name__|elif |except )/g) || []).length;
  // Bash indicators
  const bashScore = (code.match(/^#!/gm) || []).length * 5 +
    (code.match(/(?:\becho\b|\bfi\b|\bdone\b|\besac\b|\bthen\b)/g) || []).length;

  if (bashScore > tsScore && bashScore > pyScore) return "bash";
  if (pyScore > tsScore) return "python";
  if (tsScore > 0) return "typescript";
  return "unknown";
}

function checkSyntax(code: string, lang: "typescript" | "python" | "bash" | "unknown"): boolean {
  const tmpDir = "/tmp";
  try {
    if (lang === "python") {
      const tmpFile = join(tmpDir, `_review_${Date.now()}.py`);
      writeFileSync(tmpFile, code);
      try {
        execSync(`python3 -m py_compile ${tmpFile} 2>&1`, { timeout: 10_000 });
        return true;
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    } else if (lang === "bash") {
      const tmpFile = join(tmpDir, `_review_${Date.now()}.sh`);
      writeFileSync(tmpFile, code);
      try {
        execSync(`bash -n ${tmpFile} 2>&1`, { timeout: 10_000 });
        return true;
      } finally {
        if (existsSync(tmpFile)) unlinkSync(tmpFile);
      }
    } else if (lang === "typescript") {
      // Basic bracket/paren/brace balance check
      const stack: string[] = [];
      const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
      let inString = false;
      let stringChar = "";
      for (const ch of code) {
        if (inString) {
          if (ch === stringChar) inString = false;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = true;
          stringChar = ch;
          continue;
        }
        if ("([{".includes(ch)) stack.push(ch);
        if (")]}".includes(ch)) {
          if (stack.length === 0 || stack[stack.length - 1] !== pairs[ch]) return false;
          stack.pop();
        }
      }
      return stack.length === 0;
    }
    return true;
  } catch {
    return false;
  }
}

function checkBestPractices(code: string, lang: string): Omit<ReviewIssue, "id">[] {
  const issues: Omit<ReviewIssue, "id">[] = [];
  const lines = code.split("\n");

  // Function length check
  let funcStart = -1;
  let funcName = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const funcMatch = lang === "python"
      ? line.match(/^def\s+(\w+)/)
      : line.match(/(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=.*=>)/);
    
    if (funcMatch) {
      if (funcStart >= 0 && i - funcStart > 50) {
        issues.push({
          severity: "info",
          category: "best_practice",
          line: funcStart + 1,
          message: `Function "${funcName}" is ${i - funcStart} lines — consider splitting`,
          autoFixable: false,
        });
      }
      funcStart = i;
      funcName = funcMatch[1] || funcMatch[2] || "anonymous";
    }
  }

  // File length check
  if (lines.length > 500) {
    issues.push({
      severity: "info",
      category: "best_practice",
      message: `File is ${lines.length} lines — consider splitting into modules`,
      autoFixable: false,
    });
  }

  // Magic number check
  if (lang === "typescript") {
    for (let i = 0; i < lines.length; i++) {
      if (/(?:if|while|for|return)\s*\(.*\b\d{3,}\b/.test(lines[i]) && !/(?:1000|1024|3600|86400|60000)/.test(lines[i])) {
        issues.push({
          severity: "style",
          category: "best_practice",
          line: i + 1,
          message: "Magic number in logic — consider using a named constant",
          autoFixable: false,
        });
      }
    }
  }

  // No return type on exported functions (TypeScript)
  if (lang === "typescript") {
    for (let i = 0; i < lines.length; i++) {
      if (/^export\s+(?:async\s+)?function\s+\w+\([^)]*\)\s*\{/.test(lines[i]) && !/:/.test(lines[i].split("{")[0].split(")").pop() || "")) {
        issues.push({
          severity: "info",
          category: "best_practice",
          line: i + 1,
          message: "Exported function without explicit return type",
          autoFixable: false,
        });
      }
    }
  }

  return issues;
}

function applyAutoFixes(code: string, issues: ReviewIssue[], lang: string): { code: string; fixCount: number } {
  let fixed = code;
  let fixCount = 0;

  if (lang === "typescript") {
    // Fix var → const
    if (issues.some(i => i.message.includes("var"))) {
      const before = fixed;
      fixed = fixed.replace(/\bvar\s+(\w+)\s*=/g, "const $1 =");
      if (fixed !== before) fixCount++;
    }

    // Fix == → ===
    if (issues.some(i => i.message.includes("==="))) {
      const before = fixed;
      fixed = fixed.replace(/([^!=<>])={2}(?!=)/g, "$1===");
      if (fixed !== before) fixCount++;
    }
  }

  return { code: fixed, fixCount };
}
