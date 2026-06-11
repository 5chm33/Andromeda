/**
 * Truncation Detector & Self-Healing Module (v5.33)
 *
 * v5.33 CHANGES:
 * - Added 25+ comprehensive truncation patterns (mid-function, mid-JSX, mid-import, etc.)
 * - Smarter repair: handles mid-expression, mid-template-literal, mid-JSX truncation
 * - detectOutputTruncation now checks for actual structural truncation, not just markers
 * - Added confidence scoring based on pattern severity and count
 * - Added context-aware repair that preserves valid code above truncation point
 *
 * Two types of truncation:
 * 1. INPUT truncation: files are cut short before being sent to the LLM
 * 2. OUTPUT truncation: LLM response is cut off by max_tokens limit
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TruncationIssue {
  type: "bracket_imbalance" | "truncated_syntax" | "unclosed_string" | "unclosed_block" | "marker";
  line: number;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
}

interface TruncationResult {
  isTruncated: boolean;
  confidence: "high" | "medium" | "low";
  reason?: string;
  position?: number;
  issues?: TruncationIssue[];
}

// ─── Comprehensive Truncation Patterns ─────────────────────────────────────────

/**
 * v5.33: Patterns that indicate code was truncated mid-expression.
 * Each pattern is tested against the LAST 500 chars of the content.
 * Grouped by category for clarity.
 */
const TRUNCATION_PATTERNS: Array<{ pattern: RegExp; description: string; severity: TruncationIssue["severity"] }> = [
  // ── Function/method truncation ──
  { pattern: /function\s+\w+\s*\([^)]*$/m, description: "Mid-function signature", severity: "critical" },
  { pattern: /async\s+function\s+\w+\s*\([^)]*$/m, description: "Mid-async function signature", severity: "critical" },
  { pattern: /=>\s*\{[^}]*$/m, description: "Mid-arrow function body", severity: "high" },
  { pattern: /=>\s*$/m, description: "Arrow function with no body", severity: "high" },
  { pattern: /\)\s*:\s*\w+\s*$/m, description: "Mid-return-type annotation", severity: "medium" },

  // ── Template literal truncation ──
  { pattern: /`[^`]*$/m, description: "Mid-template literal", severity: "high" },
  { pattern: /\$\{[^}]*$/m, description: "Mid-template expression", severity: "high" },

  // ── JSX truncation ──
  { pattern: /<[A-Z]\w*[^>]*$/m, description: "Mid-JSX component element", severity: "high" },
  { pattern: /<[a-z]\w*[^>]*$/m, description: "Mid-JSX HTML element", severity: "medium" },
  { pattern: /<\/[A-Za-z]\w*$/m, description: "Mid-JSX closing tag", severity: "high" },
  { pattern: /className\s*=\s*["'][^"']*$/m, description: "Mid-JSX className attribute", severity: "medium" },

  // ── Import/export truncation ──
  { pattern: /import\s+\{[^}]*$/m, description: "Mid-import destructuring", severity: "critical" },
  { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"][^'"]*$/m, description: "Mid-import path", severity: "critical" },
  { pattern: /import\s+['"][^'"]*$/m, description: "Mid-import string", severity: "critical" },
  { pattern: /export\s+(default\s+)?(function|class|const|let|var)\s+\w+\s*[=({]?[^;]*$/m, description: "Mid-export statement", severity: "critical" },
  { pattern: /from\s+['"][^'"]*$/m, description: "Mid-from clause", severity: "high" },

  // ── Control flow truncation ──
  { pattern: /if\s*\([^)]*$/m, description: "Mid-if condition", severity: "high" },
  { pattern: /for\s*\([^)]*$/m, description: "Mid-for loop", severity: "high" },
  { pattern: /while\s*\([^)]*$/m, description: "Mid-while condition", severity: "high" },
  { pattern: /switch\s*\([^)]*$/m, description: "Mid-switch expression", severity: "high" },
  { pattern: /case\s+[^:]*$/m, description: "Mid-case clause", severity: "medium" },

  // ── Statement truncation ──
  { pattern: /return\s+[^;]*$/m, description: "Mid-return statement", severity: "high" },
  { pattern: /const\s+\{[^}]*$/m, description: "Mid-destructuring assignment", severity: "high" },
  { pattern: /const\s+\[[^\]]*$/m, description: "Mid-array destructuring", severity: "high" },
  { pattern: /(?:const|let|var)\s+\w+\s*=\s*$/m, description: "Assignment with no value", severity: "high" },
  { pattern: /throw\s+new\s+\w+\s*\([^)]*$/m, description: "Mid-throw statement", severity: "medium" },

  // ── Object/array literal truncation ──
  { pattern: /:\s*\{[^}]*$/m, description: "Mid-object literal value", severity: "medium" },
  { pattern: /:\s*\[[^\]]*$/m, description: "Mid-array literal value", severity: "medium" },

  // ── Comment truncation ──
  { pattern: /\/\*[^*]*$/m, description: "Mid-block comment", severity: "low" },

  // ── Type annotation truncation ──
  { pattern: /interface\s+\w+\s*\{[^}]*$/m, description: "Mid-interface definition", severity: "high" },
  { pattern: /type\s+\w+\s*=\s*\{[^}]*$/m, description: "Mid-type definition", severity: "high" },
  { pattern: /:\s*(?:Promise|Array|Map|Set|Record)\s*<[^>]*$/m, description: "Mid-generic type", severity: "medium" },
];

// ─── Core Detection Functions ──────────────────────────────────────────────────

/**
 * Detect if a file's content has been truncated.
 * Uses multiple heuristics to determine if content is incomplete.
 */
export function detectFileTruncation(content: string, filePath: string): TruncationResult {
  // Check for explicit truncation markers
  if (/\.\.\.\[truncated\s+\d+KB?\s+more\]/i.test(content)) {
    return { isTruncated: true, confidence: "high", reason: "Explicit truncation marker found" };
  }
  if (/\[\.\.\.content\s+truncated/i.test(content)) {
    return { isTruncated: true, confidence: "high", reason: "Content truncation marker found" };
  }

  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  if (["ts", "tsx", "js", "jsx", "java", "c", "cpp", "cs", "go", "rs"].includes(ext)) {
    return detectCodeTruncation(content, ext);
  }

  if (["json"].includes(ext)) {
    return detectJsonTruncation(content);
  }

  if (["md", "txt"].includes(ext)) {
    return detectTextTruncation(content);
  }

  // Generic: check for mid-word/mid-line ending
  const lastLine = content.split("\n").pop() || "";
  if (lastLine.length > 0 && !lastLine.endsWith(";") && !lastLine.endsWith("}") && !lastLine.endsWith("\n")) {
    return { isTruncated: false, confidence: "low" };
  }

  return { isTruncated: false, confidence: "low" };
}

// ─── Bracket/String Balance Helpers ────────────────────────────────────────

interface BalanceScanResult {
  braces: number;
  parens: number;
  brackets: number;
  inString: boolean;
  stringChar: string;
}

function scanBracketBalance(content: string): BalanceScanResult {
  let braces = 0, parens = 0, brackets = 0;
  let inString = false, stringChar = "", templateDepth = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const prev = i > 0 ? content[i - 1] : "";
    if (!inString) {
      if (ch === "/" && content[i + 1] === "/") { const nl = content.indexOf("\n", i); if (nl >= 0) i = nl; continue; }
      if (ch === "/" && content[i + 1] === "*") { const end = content.indexOf("*/", i + 2); if (end >= 0) i = end + 1; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { inString = true; stringChar = ch; if (ch === "`") templateDepth = 0; }
      else if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "(") parens++;
      else if (ch === ")") parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    } else {
      if (prev === "\\" && (i < 2 || content[i - 2] !== "\\")) continue;
      if (stringChar === "`" && ch === "$" && content[i + 1] === "{") templateDepth++;
      else if (stringChar === "`" && ch === "}" && templateDepth > 0) templateDepth--;
      else if (ch === stringChar && templateDepth === 0) inString = false;
    }
  }
  return { braces, parens, brackets, inString, stringChar };
}

function buildBracketIssues(scan: BalanceScanResult, lineCount: number, content: string): TruncationIssue[] {
  const issues: TruncationIssue[] = [];
  if (scan.inString) {
    issues.push({ type: "unclosed_string", line: lineCount,
      description: `File ends inside an unclosed ${scan.stringChar === "`" ? "template literal" : "string literal"}`, severity: "critical" });
  }
  if (scan.braces > 3) issues.push({ type: "bracket_imbalance", line: lineCount, description: `${scan.braces} unclosed braces — severe truncation`, severity: "critical" });
  else if (scan.braces > 1) issues.push({ type: "bracket_imbalance", line: lineCount, description: `${scan.braces} unclosed braces`, severity: "high" });
  else if (scan.braces === 1) issues.push({ type: "bracket_imbalance", line: lineCount, description: "1 unclosed brace", severity: "medium" });
  if (scan.parens > 1) issues.push({ type: "bracket_imbalance", line: lineCount, description: `${scan.parens} unclosed parentheses`, severity: "high" });
  if (scan.brackets > 1) issues.push({ type: "bracket_imbalance", line: lineCount, description: `${scan.brackets} unclosed brackets`, severity: "high" });
  return issues;
}

function checkTailPatterns(content: string): TruncationIssue[] {
  const issues: TruncationIssue[] = [];
  const tail = content.slice(-500);
  const tailStartLine = content.substring(0, content.length - tail.length).split("\n").length;
  for (const { pattern, description, severity } of TRUNCATION_PATTERNS) {
    const match = tail.match(pattern);
    if (match) {
      const matchLine = tailStartLine + tail.substring(0, match.index || 0).split("\n").length - 1;
      issues.push({ type: "truncated_syntax", line: matchLine, description, severity });
    }
  }
  return issues;
}

function buildTruncationResult(issues: TruncationIssue[], contentLength: number): TruncationResult {
  if (issues.length === 0) return { isTruncated: false, confidence: "low" };
  const hasCritical = issues.some(i => i.severity === "critical");
  const hasHigh = issues.some(i => i.severity === "high");
  const confidence = hasCritical ? "high" : hasHigh ? "medium" : "low";
  const isTruncated = hasCritical || hasHigh || issues.length >= 2;
  return { isTruncated, confidence, reason: issues.map(i => i.description).join("; "), position: contentLength, issues };
}

/**
 * v10.4.0: Comprehensive code truncation detection.
 * Checks bracket balance, string literals, AND 25+ mid-expression patterns.
 */
function detectCodeTruncation(content: string, ext: string): TruncationResult {
  const scan = scanBracketBalance(content);
  const lineCount = content.split("\n").length;
  const issues: TruncationIssue[] = [
    ...buildBracketIssues(scan, lineCount, content),
    ...checkTailPatterns(content),
  ];
  return buildTruncationResult(issues, content.length);
}

/**
 * Detect truncation in JSON files.
 */
function detectJsonTruncation(content: string): TruncationResult {
  const trimmed = content.trim();

  if (!trimmed.endsWith("}") && !trimmed.endsWith("]")) {
    return {
      isTruncated: true,
      confidence: "high",
      reason: "JSON does not end with } or ]",
      position: content.length,
    };
  }

  try {
    JSON.parse(trimmed);
    return { isTruncated: false, confidence: "high" };
  } catch (e: any) {
    return {
      isTruncated: true,
      confidence: "high",
      reason: `JSON parse error: ${e.message}`,
      position: content.length,
    };
  }
}

/**
 * Detect truncation in text/markdown files.
 */
function detectTextTruncation(content: string): TruncationResult {
  const lastLine = content.trim().split("\n").pop() || "";

  // Check for unclosed markdown code blocks
  const codeBlockCount = (content.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    return {
      isTruncated: true,
      confidence: "high",
      reason: "Unclosed markdown code block",
      position: content.length,
    };
  }

  if (lastLine.length > 0 && /\w$/.test(lastLine) && lastLine.length < 80) {
    return {
      isTruncated: true,
      confidence: "low",
      reason: "Text appears to end mid-sentence",
      position: content.length,
    };
  }

  return { isTruncated: false, confidence: "low" };
}

// ─── Output Truncation Detection ────────────────────────────────────────────

/**
 * v5.33: Comprehensive LLM output truncation detection.
 * Checks structural completeness, not just markers.
 */
export function detectOutputTruncation(output: string): TruncationResult {
  const issues: TruncationIssue[] = [];

  // ── 1. Check for unclosed code blocks ──
  const codeBlockStarts = (output.match(/```[\w]*/g) || []).length;
  const codeBlockEnds = (output.match(/\n```\s*$/gm) || []).length + (output.match(/^```\s*$/gm) || []).length;
  if (codeBlockStarts > codeBlockEnds) {
    issues.push({
      type: "unclosed_block",
      line: output.split("\n").length,
      description: `${codeBlockStarts - codeBlockEnds} unclosed code block(s)`,
      severity: "critical",
    });
  }

  // ── 2. Check code blocks for internal truncation ──
  const codeBlocks = output.match(/```[\w]*\n([\s\S]*?)(?:```|$)/g) || [];
  for (const block of codeBlocks) {
    if (!block.endsWith("```")) {
      issues.push({
        type: "unclosed_block",
        line: output.split("\n").length,
        description: "Code block never closed",
        severity: "critical",
      });
    } else {
      // Check the code inside the block for truncation
      const codeContent = block.replace(/^```[\w]*\n/, "").replace(/\n```$/, "");
      const ext = (block.match(/^```(\w+)/) || [])[1] || "ts";
      if (["ts", "tsx", "js", "jsx", "java", "c", "cpp"].includes(ext)) {
        const innerResult = detectCodeTruncation(codeContent, ext);
        if (innerResult.isTruncated && innerResult.confidence !== "low") {
          issues.push({
            type: "truncated_syntax",
            line: output.split("\n").length,
            description: `Code block content truncated: ${innerResult.reason}`,
            severity: "high",
          });
        }
      }
    }
  }

  // ── 3. Check for mid-structure patterns in last 500 chars ──
  const tail = output.slice(-500);
  const structuralPatterns = [
    { pattern: /\{[^}]*$/, description: "Ends mid-object/block" },
    { pattern: /\n\d+\.\s+[^\n]*$/, description: "Ends mid-numbered-list" },
    { pattern: /\|[^|\n]*$/, description: "Ends mid-table-row" },
    { pattern: /\n[-*]\s+[^\n]*$/, description: "Ends mid-bullet-list" },
  ];

  for (const { pattern, description } of structuralPatterns) {
    if (pattern.test(tail)) {
      issues.push({
        type: "truncated_syntax",
        line: output.split("\n").length,
        description,
        severity: "medium",
      });
    }
  }

  // ── 4. Check for abrupt ending (no terminal punctuation or closing) ──
  const lastLine = output.trim().split("\n").pop() || "";
  if (lastLine.length > 10 && !/[.!?;}\])`'"]$/.test(lastLine.trim())) {
    issues.push({
      type: "truncated_syntax",
      line: output.split("\n").length,
      description: "Output ends without terminal punctuation",
      severity: "low",
    });
  }

  if (issues.length === 0) {
    return { isTruncated: false, confidence: "low" };
  }

  const hasCritical = issues.some(i => i.severity === "critical");
  const hasHigh = issues.some(i => i.severity === "high");

  return {
    isTruncated: hasCritical || hasHigh || issues.length >= 2,
    confidence: hasCritical ? "high" : hasHigh ? "medium" : "low",
    reason: issues.map(i => i.description).join("; "),
    position: output.length,
    issues,
  };
}

// ─── Self-Healing: Repair Truncated Content ─────────────────────────────────

/**
 * v5.33: Smarter repair that handles mid-expression truncation.
 * Preserves valid code and adds minimal closing syntax.
 */
function repairTemplateLiterals(repair: string, repairs: string[]): string {
  let inTemplate = false;
  for (let i = 0; i < repair.length; i++) {
    if (repair[i] === "`" && (i === 0 || repair[i - 1] !== "\\")) inTemplate = !inTemplate;
  }
  if (inTemplate) { repair += "`"; repairs.push("Closed unclosed template literal"); }
  return repair;
}

function repairStringLiterals(repair: string, repairs: string[]): string {
  const lines = repair.split("\n");
  const lastLine = lines[lines.length - 1];
  if ((lastLine.match(/(?<!\\)'/g) || []).length % 2 !== 0) { repair += "'"; repairs.push("Closed unclosed single-quote string"); }
  if ((lastLine.match(/(?<!\\)"/g) || []).length % 2 !== 0) { repair += '"'; repairs.push("Closed unclosed double-quote string"); }
  return repair;
}

function repairMidExpressions(repair: string, repairs: string[]): string {
  const tail = repair.slice(-200);
  if (/\w+\s*\([^)]*$/m.test(tail) && !/function\s+\w+\s*\([^)]*$/m.test(tail)) { repair += ")"; repairs.push("Closed unclosed function call"); }
  if (/function\s+\w+\s*\([^)]*$/m.test(tail)) { repair += ") {}"; repairs.push("Closed unclosed function signature"); }
  if (/=>\s*$/m.test(tail)) { repair += " {}"; repairs.push("Added empty arrow function body"); }
  return repair;
}

function repairOpenBrackets(repair: string, repairs: string[]): string {
  const scan = scanBracketBalance(repair);
  if (scan.parens > 0) { repair += ")".repeat(scan.parens); repairs.push(`Closed ${scan.parens} parentheses`); }
  if (scan.brackets > 0) { repair += "]".repeat(scan.brackets); repairs.push(`Closed ${scan.brackets} brackets`); }
  if (scan.braces > 0) { repair += "\n" + "}\n".repeat(scan.braces); repairs.push(`Closed ${scan.braces} braces`); }
  return repair;
}

export function repairTruncatedCode(content: string, filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (!["ts", "tsx", "js", "jsx", "java", "c", "cpp", "cs", "go", "rs"].includes(ext)) return content;
  const repairs: string[] = [];
  let repair = repairTemplateLiterals(content, repairs);
  repair = repairStringLiterals(repair, repairs);
  repair = repairMidExpressions(repair, repairs);
  repair = repairOpenBrackets(repair, repairs);
  if (repairs.length > 0) repair += `\n// [AUTO-REPAIRED v10.4.0: ${repairs.join(", ")}]\n`;
  return repair;
}

// ─── Batch Truncation Scan ──────────────────────────────────────────────────

export interface TruncationScanResult {
  path: string;
  result: TruncationResult;
}

/**
 * Scan all files in a collection for truncation.
 */
export function scanForTruncation(
  files: Array<{ path: string; content: string }>
): TruncationScanResult[] {
  const results: TruncationScanResult[] = [];

  for (const file of files) {
    const result = detectFileTruncation(file.content, file.path);
    if (result.isTruncated && (result.confidence === "high" || result.confidence === "medium")) {
      results.push({ path: file.path, result });
    }
  }

  return results;
}

/**
 * Validate that an edit result is complete.
 */
export function validateEditCompleteness(
  originalContent: string,
  editedContent: string,
  filePath: string
): { isComplete: boolean; issue?: string } {
  if (editedContent.length < originalContent.length * 0.3) {
    return {
      isComplete: false,
      issue: `Edited content is ${Math.round((editedContent.length / originalContent.length) * 100)}% of original — likely truncated`,
    };
  }

  const truncation = detectFileTruncation(editedContent, filePath);
  if (truncation.isTruncated && truncation.confidence === "high") {
    return {
      isComplete: false,
      issue: truncation.reason || "Edit output appears truncated",
    };
  }

  return { isComplete: true };
}
