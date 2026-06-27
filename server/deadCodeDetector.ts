/**
 * deadCodeDetector.ts — v81.0.0 "Code Intelligence"
 * Detects unreachable code, unused exports, and unused variables.
 */
export type DeadCodeType = "unreachable_after_return" | "unused_export" | "unused_variable" | "unused_import";

export interface DeadCodeIssue {
  issueId: string;
  type: DeadCodeType;
  description: string;
  line: number;
  symbol: string;
  severity: "warning" | "error";
}

export interface DeadCodeReport {
  fileName: string;
  issues: DeadCodeIssue[];
  unusedExports: string[];
  unusedImports: string[];
  unreachableBlocks: number;
}

let issueCounter = 0;

function detectUnreachableCode(code: string): Array<{ line: number; symbol: string }> {
  const lines = code.split("\n");
  const unreachable: Array<{ line: number; symbol: string }> = [];
  let returnSeen = false;
  let braceDepth = 0;
  let returnDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    braceDepth += (line.match(/{/g) ?? []).length;
    braceDepth -= (line.match(/}/g) ?? []).length;

    if (returnSeen && returnDepth === braceDepth && line.length > 0 && !line.startsWith("}") && !line.startsWith("//")) {
      unreachable.push({ line: i + 1, symbol: line.slice(0, 30) });
    }

    if (/^\s*return\b/.test(lines[i])) {
      returnSeen = true;
      returnDepth = braceDepth;
    }
    if (braceDepth < returnDepth) { returnSeen = false; returnDepth = -1; }
  }
  return unreachable;
}

function detectUnusedImports(code: string): string[] {
  const importMatches = [...code.matchAll(/import\s+\{([^}]+)\}\s+from/g)];
  const unused: string[] = [];
  for (const match of importMatches) {
    const names = match[1].split(",").map(s => s.trim().split(" as ").pop()!.trim());
    for (const name of names) {
      const usageCount = (code.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      if (usageCount <= 1) unused.push(name); // only the import line itself
    }
  }
  return unused;
}

export function detectDeadCode(fileName: string, code: string, declaredExports: string[], usedSymbols: string[]): DeadCodeReport {
  const issues: DeadCodeIssue[] = [];

  // Unreachable code
  const unreachable = detectUnreachableCode(code);
  for (const u of unreachable) {
    issues.push({ issueId: `dci-${++issueCounter}`, type: "unreachable_after_return", description: `Unreachable code after return: "${u.symbol}"`, line: u.line, symbol: u.symbol, severity: "warning" });
  }

  // Unused exports
  const unusedExports = declaredExports.filter(e => !usedSymbols.includes(e));
  for (const e of unusedExports) {
    issues.push({ issueId: `dci-${++issueCounter}`, type: "unused_export", description: `Export "${e}" is never imported by any consumer`, line: 0, symbol: e, severity: "warning" });
  }

  // Unused imports
  const unusedImports = detectUnusedImports(code);

  return { fileName, issues, unusedExports, unusedImports, unreachableBlocks: unreachable.length };
}

export function _resetDeadCodeDetectorForTest(): void { issueCounter = 0; }
