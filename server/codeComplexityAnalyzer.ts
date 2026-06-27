/**
 * codeComplexityAnalyzer.ts — v81.0.0 "Code Intelligence"
 * Computes cyclomatic complexity and cognitive complexity metrics for code functions.
 */
export type ComplexityRating = "low" | "medium" | "high" | "very_high";

export interface FunctionComplexity {
  functionName: string;
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  lineCount: number;
  rating: ComplexityRating;
}

export interface FileComplexityReport {
  fileName: string;
  functions: FunctionComplexity[];
  averageCyclomatic: number;
  maxCyclomatic: number;
  totalLines: number;
  overallRating: ComplexityRating;
}

function rateComplexity(cyclomatic: number): ComplexityRating {
  if (cyclomatic <= 5) return "low";
  if (cyclomatic <= 10) return "medium";
  if (cyclomatic <= 20) return "high";
  return "very_high";
}

function countDecisionPoints(code: string): number {
  // Count decision points: if, else if, for, while, case, catch, &&, ||, ternary
  const patterns = [/\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?[^:]/g];
  return patterns.reduce((sum, p) => sum + (code.match(p)?.length ?? 0), 0);
}

function countNestingComplexity(code: string): number {
  let depth = 0;
  let maxDepth = 0;
  let cognitive = 0;
  for (const char of code) {
    if (char === "{") { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (char === "}") depth = Math.max(0, depth - 1);
  }
  // Cognitive complexity increases with nesting depth
  cognitive = maxDepth * 2;
  return cognitive;
}

export function analyzeFunctionComplexity(functionName: string, code: string): FunctionComplexity {
  const lines = code.split("\n").filter(l => l.trim().length > 0);
  const decisionPoints = countDecisionPoints(code);
  const cyclomaticComplexity = decisionPoints + 1;
  const cognitiveComplexity = decisionPoints + countNestingComplexity(code);

  return {
    functionName,
    cyclomaticComplexity,
    cognitiveComplexity,
    lineCount: lines.length,
    rating: rateComplexity(cyclomaticComplexity),
  };
}

export function analyzeFileComplexity(fileName: string, functions: Array<{ name: string; code: string }>): FileComplexityReport {
  const analyzed = functions.map(f => analyzeFunctionComplexity(f.name, f.code));
  const totalLines = analyzed.reduce((sum, f) => sum + f.lineCount, 0);
  const avgCyclomatic = analyzed.length > 0 ? analyzed.reduce((sum, f) => sum + f.cyclomaticComplexity, 0) / analyzed.length : 0;
  const maxCyclomatic = analyzed.length > 0 ? Math.max(...analyzed.map(f => f.cyclomaticComplexity)) : 0;

  return {
    fileName,
    functions: analyzed,
    averageCyclomatic: avgCyclomatic,
    maxCyclomatic,
    totalLines,
    overallRating: rateComplexity(maxCyclomatic),
  };
}
