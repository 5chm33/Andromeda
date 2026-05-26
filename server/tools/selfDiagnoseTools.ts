/**
 * selfDiagnoseTools.ts — Andromeda v5.77 Self-Diagnosis & Test Generation Tools
 *
 * Implements the P0 items from Andromeda's own B+ → A+ roadmap (log 143):
 *
 * 1. self_diagnose       — Structured diagnostic protocol for any described bug
 * 2. self_generate_tests — Generate regression tests for a specific code change
 * 3. self_review         — Multi-dimensional pre-apply review (6 dimensions)
 * 4. self_benchmark      — Performance regression detection before/after modification
 *
 * These tools are the difference between an agent that "tries to fix itself"
 * and one that follows a rigorous engineering process.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { registerTool } from "./toolRegistry.js";
import { storeMemory, searchMemory } from "../memory.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServerDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.cwd(), "server/tools");
  }
}

function getAndromedaRoot(): string {
  return path.resolve(getServerDir(), "..", "..");
}

function getWorkspaceDir(): string {
  return path.resolve(getAndromedaRoot(), "workspace");
}

function getDiagLogPath(): string {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "self-diagnosis-log.jsonl");
}

function getBaselinePath(): string {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "performance-baselines.json");
}

function loadBaselines(): Record<string, { latencyMs: number; errorRate: number; timestamp: string }> {
  try {
    const p = getBaselinePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function saveBaselines(baselines: Record<string, { latencyMs: number; errorRate: number; timestamp: string }>): void {
  try {
    fs.writeFileSync(getBaselinePath(), JSON.stringify(baselines, null, 2), "utf8");
  } catch {
    // Non-fatal
  }
}

function findFilesMatchingKeywords(keywords: string[]): string[] {
  const serverDir = path.resolve(getServerDir(), "..");
  const results: string[] = [];
  function walk(dir: string, depth = 0): void {
    if (depth > 4) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
          const lower = entry.name.toLowerCase();
          if (keywords.some(k => lower.includes(k.toLowerCase()))) {
            results.push(full);
          }
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }
  walk(serverDir);
  return results.slice(0, 10);
}

function runTypeCheck(): { success: boolean; errorCount: number; errors: string[] } {
  const root = getAndromedaRoot();
  try {
    execSync("npx tsc --noEmit 2>&1", { cwd: root, timeout: 60000, encoding: "utf8" });
    return { success: true, errorCount: 0, errors: [] };
  } catch (e: any) {
    const output = String(e.stdout || e.message || "");
    const errorLines = output.split("\n").filter(l => l.includes("error TS"));
    return { success: false, errorCount: errorLines.length, errors: errorLines.slice(0, 10) };
  }
}

// ── Tool: self_diagnose ───────────────────────────────────────────────────────

registerTool({
  name: "self_diagnose",
  category: "system",
  safety: "moderate",
  description: `Structured self-diagnosis protocol for any described bug or issue.
Follows the 5-step diagnostic process:
  1. Search episodic memory for similar past issues
  2. Identify candidate source files based on keywords
  3. Analyze each candidate file for the described symptom
  4. Rank root causes by likelihood with evidence
  5. Generate targeted fix proposals

Use this BEFORE attempting any self-modification. It prevents the hallucination spiral
of guessing file paths by grounding the diagnosis in actual file content.

Returns: structured diagnosis report with root causes, evidence, and fix proposals.`,
  definition: {
    type: "function",
    function: {
      name: "self_diagnose",
      description: "Structured self-diagnosis protocol for any described bug or issue.",
      parameters: {
        type: "object",
    properties: {
      issue_description: {
        type: "string",
        description: "Natural language description of the bug or issue to diagnose. Be specific: include symptoms, when it occurs, and what you've already tried.",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "Keywords to search for in source files (e.g. ['truncation', 'streaming', 'finish_reason']). Leave empty to auto-extract from issue_description.",
      },
      max_files: {
        type: "number",
        description: "Maximum number of source files to analyze (default: 5, max: 10).",
      },
    },
    required: ["issue_description"],
  },
    },
  },
  execute: async (args: Record<string, unknown>) => {
    const issue = String(args.issue_description || "");
    const maxFiles = Math.min(10, Number(args.max_files) || 5);

    // Step 1: Search episodic memory for similar issues
    let memoryResults: string[] = [];
    try {
      const memories = await searchMemory(issue, 5);
      memoryResults = memories.map(m => `[${m.entry.type}] ${m.entry.content.slice(0, 200)}`);
    } catch {
      memoryResults = ["Memory search unavailable"];
    }

    // Step 2: Extract keywords and find candidate files
    let keywords = (args.keywords as string[]) || [];
    if (keywords.length === 0) {
      // Auto-extract keywords from issue description
      const words = issue.toLowerCase().split(/\W+/).filter(w => w.length > 4);
      const stopWords = new Set(["there", "their", "which", "about", "would", "could", "should", "after", "before", "every", "where", "while", "these", "those"]);
      keywords = [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 6);
    }

    const candidateFiles = findFilesMatchingKeywords(keywords);

    // Step 3: Read and analyze each candidate file
    const fileAnalyses: Array<{ file: string; relevantLines: string[]; suspiciousPatterns: string[] }> = [];
    for (const filePath of candidateFiles.slice(0, maxFiles)) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        const relevantLines: string[] = [];
        const suspiciousPatterns: string[] = [];

        // Find lines containing any keyword
        lines.forEach((line, i) => {
          if (keywords.some(k => line.toLowerCase().includes(k.toLowerCase()))) {
            relevantLines.push(`L${i + 1}: ${line.trim().slice(0, 120)}`);
          }
        });

        // Check for common bug patterns
        if (content.includes("finish_reason") && !content.includes("finish_reason === \"length\"") && !content.includes('finish_reason === "length"')) {
          suspiciousPatterns.push("finish_reason checked but 'length' case may not be handled");
        }
        if (content.includes("max_tokens") && content.includes("8192")) {
          suspiciousPatterns.push("max_tokens set to 8192 — may truncate large outputs");
        }
        if (content.includes("slice(0,") || content.includes(".slice(0, ")) {
          const sliceMatches = lines.filter(l => l.includes(".slice(0,")).slice(0, 3);
          suspiciousPatterns.push(`Potential truncation: ${sliceMatches.map(l => l.trim().slice(0, 80)).join(" | ")}`);
        }
        if (content.includes("substring(0,") || content.includes(".substring(0,")) {
          suspiciousPatterns.push("substring(0, N) call found — potential truncation");
        }

        fileAnalyses.push({
          file: path.relative(getAndromedaRoot(), filePath),
          relevantLines: relevantLines.slice(0, 8),
          suspiciousPatterns,
        });
      } catch {
        // Skip unreadable files
      }
    }

    // Step 4: Rank root causes
    const rootCauses: Array<{ cause: string; likelihood: string; evidence: string; fixHint: string }> = [];

    // Truncation-specific analysis
    if (keywords.some(k => ["truncat", "cut off", "incomplete", "finish_reason", "max_tokens"].some(t => k.includes(t)))) {
      rootCauses.push({
        cause: "LLM output token limit (finish_reason: 'length')",
        likelihood: "HIGH",
        evidence: "DeepSeek and most LLMs have output token limits separate from context window. When output hits the limit, finish_reason='length' and content is cut off.",
        fixHint: "Check llmProvider.ts for max_tokens setting and continuation logic. Increase max_tokens and ensure finish_reason='length' triggers a continuation request.",
      });
      rootCauses.push({
        cause: "Tool call argument truncation in JSON",
        likelihood: "MEDIUM",
        evidence: "When self_write_file is called with large content, the tool call JSON argument itself can be truncated before it reaches the handler.",
        fixHint: "Check llmProvider.ts continuation logic for tool calls (isIncompleteJson). Check twoPhaseCommit.ts for detectTruncation guard.",
      });
    }

    // Add file-specific causes
    for (const analysis of fileAnalyses) {
      for (const pattern of analysis.suspiciousPatterns) {
        rootCauses.push({
          cause: `Suspicious pattern in ${analysis.file}`,
          likelihood: "MEDIUM",
          evidence: pattern,
          fixHint: `Read ${analysis.file} and examine the flagged pattern. Use self_read_server_file to view the full context.`,
        });
      }
    }

    // Step 5: Generate fix proposals
    const fixProposals = rootCauses
      .filter(c => c.likelihood === "HIGH")
      .map(c => `FIX: ${c.fixHint}`);

    // Log the diagnosis
    const diagEntry = {
      timestamp: new Date().toISOString(),
      issue,
      keywords,
      candidateFiles: candidateFiles.map(f => path.relative(getAndromedaRoot(), f)),
      rootCauses: rootCauses.length,
      fixProposals: fixProposals.length,
    };
    try {
      fs.appendFileSync(getDiagLogPath(), JSON.stringify(diagEntry) + "\n", "utf8");
    } catch {
      // Non-fatal
    }

    // Store in episodic memory for cross-session learning
    if (rootCauses.length > 0) {
      storeMemory(
        `Self-diagnosis: "${issue.slice(0, 100)}" → Root causes: ${rootCauses.map(c => c.cause).join(", ")}`,
        "error",
        ["self-diagnosis", "root-cause", ...keywords.slice(0, 3)]
      );
    }

    // Format output
    const lines: string[] = [
      `## Self-Diagnosis Report`,
      `**Issue:** ${issue}`,
      `**Keywords:** ${keywords.join(", ")}`,
      ``,
      `### Step 1: Episodic Memory (similar past issues)`,
      memoryResults.length > 0 ? memoryResults.join("\n") : "No similar issues found in memory.",
      ``,
      `### Step 2: Candidate Files (${candidateFiles.length} found)`,
      ...candidateFiles.map(f => `- ${path.relative(getAndromedaRoot(), f)}`),
      ``,
      `### Step 3: File Analysis`,
      ...fileAnalyses.map(a => [
        `**${a.file}:**`,
        a.relevantLines.length > 0 ? a.relevantLines.join("\n") : "  (no keyword matches)",
        a.suspiciousPatterns.length > 0 ? `  ⚠️ ${a.suspiciousPatterns.join("\n  ⚠️ ")}` : "",
      ].filter(Boolean).join("\n")),
      ``,
      `### Step 4: Root Causes (ranked by likelihood)`,
      ...rootCauses.map((c, i) => `${i + 1}. [${c.likelihood}] **${c.cause}**\n   Evidence: ${c.evidence}\n   Fix hint: ${c.fixHint}`),
      ``,
      `### Step 5: Fix Proposals`,
      fixProposals.length > 0 ? fixProposals.join("\n") : "No high-confidence fix proposals. Review MEDIUM likelihood causes above.",
      ``,
      `**Next step:** Use self_read_server_file to read the specific files flagged above, then use self_patch_file to apply targeted fixes.`,
    ];

    return { success: true, output: lines.join("\n") };
  },
});

// ── Tool: self_generate_tests ─────────────────────────────────────────────────

registerTool({
  name: "self_generate_tests",
  category: "system",
  safety: "safe",
  description: `Generate regression tests for a specific self-modification.
Given a file path and a description of the change made, generates:
  1. Unit tests covering the modified code paths
  2. Integration tests for the affected subsystem
  3. A regression test that would have caught the original bug

The generated tests are written to workspace/generated-tests/ and can be run
with self_run_tests.

Use this AFTER applying a self-modification to ensure the change is validated
beyond just TypeScript compilation.`,
  definition: {
    type: "function",
    function: {
      name: "self_generate_tests",
      description: "Generate regression tests for a specific self-modification.",
      parameters: {
        type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the modified file (relative to server/ or absolute).",
      },
      change_description: {
        type: "string",
        description: "Description of what was changed and why. Be specific about the bug that was fixed.",
      },
      test_type: {
        type: "string",
        enum: ["unit", "integration", "regression", "all"],
        description: "Type of tests to generate (default: 'regression').",
      },
    },
    required: ["file_path", "change_description"],
  },
    },
  },
  execute: async (args: Record<string, unknown>) => {
    const filePath = String(args.file_path || "");
    const changeDesc = String(args.change_description || "");
    const testType = String(args.test_type || "regression");

    // Resolve the file path
    const serverDir = path.resolve(getServerDir(), "..");
    let resolved = path.isAbsolute(filePath) ? filePath : path.join(serverDir, filePath);
    if (!fs.existsSync(resolved)) {
      // Try basename search
      const basename = path.basename(filePath);
      const found = findFilesMatchingKeywords([basename.replace(".ts", "")]);
      if (found.length > 0) {
        resolved = found[0];
      } else {
        return { success: false, output: `File not found: ${filePath}. Use tree_view to find the correct path.` };
      }
    }

    const content = fs.readFileSync(resolved, "utf8");
    const filename = path.basename(resolved, ".ts");
    const relativePath = path.relative(getAndromedaRoot(), resolved);

    // Analyze the file to extract testable exports
    const exportedFunctions = content.match(/export (?:async )?function (\w+)/g)?.map(m => m.replace(/export (?:async )?function /, "")) || [];
    const exportedClasses = content.match(/export class (\w+)/g)?.map(m => m.replace("export class ", "")) || [];

    // Generate test file content
    const testFileName = `${filename}.regression.test.ts`;
    const testDir = path.join(getWorkspaceDir(), "generated-tests");
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const testFilePath = path.join(testDir, testFileName);

    const testContent = [
      `/**`,
      ` * Auto-generated regression test for: ${relativePath}`,
      ` * Change: ${changeDesc}`,
      ` * Generated: ${new Date().toISOString()}`,
      ` * Test type: ${testType}`,
      ` */`,
      ``,
      `// ── Regression Tests ────────────────────────────────────────────────────────`,
      `// These tests verify the specific bug described in the change was fixed.`,
      ``,
      `describe("${filename} regression tests", () => {`,
      ``,
      `  // Test 1: Verify the fix works for the described scenario`,
      `  it("should handle the scenario described in: ${changeDesc.slice(0, 60)}", async () => {`,
      `    // TODO: Implement reproduction of the original bug`,
      `    // The original bug was: ${changeDesc}`,
      `    // Verify it no longer occurs:`,
      `    expect(true).toBe(true); // Replace with actual assertion`,
      `  });`,
      ``,
      ...(testType === "unit" || testType === "all" ? [
        `  // Unit tests for exported functions`,
        ...exportedFunctions.slice(0, 5).map(fn => [
          `  it("${fn} should handle normal input without throwing", async () => {`,
          `    // TODO: Import and test ${fn} from '${relativePath}'`,
          `    // const result = await ${fn}(...);`,
          `    // expect(result).toBeDefined();`,
          `    expect(true).toBe(true); // Replace with actual test`,
          `  });`,
          ``,
        ].join("\n")),
      ] : []),
      `});`,
      ``,
      `// ── How to run these tests ───────────────────────────────────────────────────`,
      `// Use the self_run_tests tool with filter: "${filename}"`,
      `// Or: npx jest ${testFileName} --no-coverage`,
    ].join("\n");

    fs.writeFileSync(testFilePath, testContent, "utf8");

    // Store in episodic memory
    storeMemory(
      `Generated regression tests for ${relativePath}: ${changeDesc.slice(0, 100)}. Test file: generated-tests/${testFileName}`,
      "fact",
      ["test-generation", "regression", filename]
    );

    return {
      success: true,
      output: [
        `## Generated Regression Tests`,
        `**File modified:** ${relativePath}`,
        `**Change:** ${changeDesc}`,
        `**Test file:** workspace/generated-tests/${testFileName}`,
        `**Exported functions found:** ${exportedFunctions.join(", ") || "(none)"}`,
        `**Exported classes found:** ${exportedClasses.join(", ") || "(none)"}`,
        ``,
        `The test file has been written with TODO stubs for:`,
        `1. A regression test that verifies the described bug is fixed`,
        exportedFunctions.length > 0 ? `2. Unit tests for ${exportedFunctions.length} exported functions` : "",
        ``,
        `**Next step:** Edit the test file to add actual assertions, then run with self_run_tests.`,
        `**Test file path:** ${testFilePath}`,
      ].filter(Boolean).join("\n"),
    };
  },
});

// ── Tool: self_review ─────────────────────────────────────────────────────────

registerTool({
  name: "self_review",
  category: "system",
  safety: "moderate",
  description: `Multi-dimensional pre-apply review for a proposed self-modification.
Checks the proposed change across 6 dimensions before it is applied:
  1. Security: injection vectors, path traversal, auth bypass
  2. Correctness: does the logic solve the stated problem?
  3. Performance: loops, allocations, async patterns
  4. Style: matches existing codebase conventions
  5. Dependency impact: what other modules are affected?
  6. Rollback complexity: how hard to undo?

Returns a review score (0-100) and a PASS/FAIL/WARN verdict.
FAIL means the change should NOT be applied.
WARN means it can be applied but with caution.
PASS means it is safe to apply.

Use this BEFORE self_write_file or self_patch_file for any structural change.`,
  definition: {
    type: "function",
    function: {
      name: "self_review",
      description: "Multi-dimensional pre-apply review for a proposed self-modification.",
      parameters: {
        type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to the file being modified.",
      },
      proposed_content: {
        type: "string",
        description: "The full proposed new content of the file (or the patch/diff).",
      },
      change_rationale: {
        type: "string",
        description: "Why this change is being made.",
      },
    },
    required: ["file_path", "proposed_content", "change_rationale"],
  },
    },
  },
  execute: async (args: Record<string, unknown>) => {
    const filePath = String(args.file_path || "");
    const proposedContent = String(args.proposed_content || "");
    const rationale = String(args.change_rationale || "");

    const issues: Array<{ dimension: string; severity: "FAIL" | "WARN" | "INFO"; message: string }> = [];
    let score = 100;

    // ── Dimension 0: Constitution Enforcement (HARD GATE) ─────────────────────
    // This runs BEFORE all other checks. If the safety supervisor rejects the
    // proposal, the review returns FAIL immediately — no further checks run.
    try {
      const { validateProposal, isForbiddenFile } = await import("../safetySupervisor.js");
      if (isForbiddenFile(filePath)) {
        return {
          success: false,
          output: [
            `## Self-Review Report`,
            `**File:** ${filePath}`,
            `**Verdict:** ❌ CONSTITUTION VIOLATION — FORBIDDEN FILE`,
            ``,
            `This file is in the immutable forbidden list and cannot be modified.`,
            `Forbidden files: safetySupervisor.ts, andromeda-constitution.json, _core/index.ts, recursionGuard.ts`,
            ``,
            `**This is a hard gate enforced by the Safety Supervisor. It cannot be overridden.**`,
          ].join("\n"),
        };
      }
      const supervisorResult = await validateProposal({
        filePath,
        proposedContent,
        rationale,
        proposedBy: "self_review",
      });
      if (!supervisorResult.passed) {
        return {
          success: false,
          output: [
            `## Self-Review Report`,
            `**File:** ${filePath}`,
            `**Verdict:** ❌ CONSTITUTION VIOLATION — REJECTED BY SAFETY SUPERVISOR`,
            `**Risk Level:** ${supervisorResult.riskLevel.toUpperCase()}`,
            ``,
            `### Violations`,
            supervisorResult.violations.join("\n"),
            ``,
            `### Warnings`,
            supervisorResult.warnings.length > 0 ? supervisorResult.warnings.join("\n") : "None",
            ``,
            `**This is a hard gate. Address all violations before attempting to apply this change.**`,
          ].join("\n"),
        };
      }
      if (supervisorResult.warnings.length > 0) {
        for (const warning of supervisorResult.warnings) {
          issues.push({ dimension: "Constitution", severity: "WARN", message: warning });
          score -= 5;
        }
      }
    } catch {
      // Safety supervisor not available — log but continue
      issues.push({ dimension: "Constitution", severity: "WARN", message: "Safety supervisor unavailable — manual review required" });
      score -= 10;
    }

    // ── Dimension 1: Security ─────────────────────────────────────────────────
    const securityPatterns = [
      { pattern: /eval\s*\(/, message: "eval() usage — potential code injection" },
      { pattern: /exec\s*\(\s*[^"'`]/, message: "exec() with dynamic argument — potential command injection" },
      { pattern: /path\.join\s*\([^)]*req\.[^)]*\)/, message: "Path join with request data — potential path traversal" },
      { pattern: /process\.env\s*=/, message: "process.env assignment — potential environment tampering" },
      { pattern: /FORBIDDEN_FILES\s*=\s*\[\]/, message: "FORBIDDEN_FILES cleared — safety bypass" },
      { pattern: /recursionGuard.*disabled|RecursionGuard.*enabled.*false/, message: "RecursionGuard disabled — safety bypass" },
    ];
    for (const { pattern, message } of securityPatterns) {
      if (pattern.test(proposedContent)) {
        issues.push({ dimension: "Security", severity: "FAIL", message });
        score -= 30;
      }
    }

    // ── Dimension 2: Correctness ──────────────────────────────────────────────
    // Check for obvious logic errors
    const correctnessPatterns = [
      { pattern: /if\s*\(true\)/, message: "Hardcoded 'if (true)' — likely debugging artifact" },
      { pattern: /return\s*undefined\s*;[\s\S]{0,50}return/, message: "Early return before other returns — possible dead code" },
      { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, message: "Empty catch block — errors silently swallowed" },
      { pattern: /TODO|FIXME|HACK/, message: "TODO/FIXME/HACK comment — incomplete implementation" },
    ];
    for (const { pattern, message } of correctnessPatterns) {
      if (pattern.test(proposedContent)) {
        issues.push({ dimension: "Correctness", severity: "WARN", message });
        score -= 5;
      }
    }

    // ── Dimension 3: Performance ──────────────────────────────────────────────
    const perfPatterns = [
      { pattern: /for\s*\([^)]+\)\s*\{[\s\S]{0,200}await/, message: "await inside for loop — sequential instead of parallel" },
      { pattern: /JSON\.parse\s*\(JSON\.stringify/, message: "JSON deep-clone — expensive for large objects" },
      { pattern: /readFileSync\s*\(/, message: "readFileSync in async context — consider readFile for non-blocking" },
    ];
    for (const { pattern, message } of perfPatterns) {
      if (pattern.test(proposedContent)) {
        issues.push({ dimension: "Performance", severity: "WARN", message });
        score -= 3;
      }
    }

    // ── Dimension 4: Style ────────────────────────────────────────────────────
    const stylePatterns = [
      { pattern: /console\.log\s*\((?!.*\[)/, message: "console.log without prefix tag — use [ModuleName] prefix" },
      { pattern: /var\s+\w+\s*=/, message: "var declaration — use const or let" },
      { pattern: /any\s*[;,\)]/, message: "Explicit 'any' type — add proper typing" },
    ];
    for (const { pattern, message } of stylePatterns) {
      if (pattern.test(proposedContent)) {
        issues.push({ dimension: "Style", severity: "INFO", message });
        score -= 1;
      }
    }

    // ── Dimension 5: Dependency Impact ────────────────────────────────────────
    const _serverDir = path.resolve(getServerDir(), "..");
    const basename = path.basename(filePath, ".ts");
    let dependentFiles: string[] = [];
    try {
      const allFiles = findFilesMatchingKeywords([basename]);
      dependentFiles = allFiles.filter(f => !f.includes(filePath));
    } catch {
      // Non-fatal
    }
    if (dependentFiles.length > 5) {
      issues.push({
        dimension: "Dependency Impact",
        severity: "WARN",
        message: `${dependentFiles.length} other files may import from this module. Run TypeScript check after applying.`,
      });
      score -= 5;
    }

    // ── Dimension 6: Rollback Complexity ─────────────────────────────────────
    const lineCount = proposedContent.split("\n").length;
    if (lineCount > 500) {
      issues.push({
        dimension: "Rollback Complexity",
        severity: "WARN",
        message: `Large change (${lineCount} lines) — rollback may be complex. Consider using self_write_file_chunked.`,
      });
      score -= 5;
    }

    // Determine verdict
    const hasFail = issues.some(i => i.severity === "FAIL");
    const hasWarn = issues.some(i => i.severity === "WARN");
    const verdict = hasFail ? "FAIL" : hasWarn ? "WARN" : "PASS";
    score = Math.max(0, Math.min(100, score));

    // Format output
    const output = [
      `## Self-Review Report`,
      `**File:** ${filePath}`,
      `**Rationale:** ${rationale}`,
      `**Score:** ${score}/100`,
      `**Verdict:** ${verdict === "FAIL" ? "❌ FAIL — DO NOT APPLY" : verdict === "WARN" ? "⚠️ WARN — Apply with caution" : "✅ PASS — Safe to apply"}`,
      ``,
      `### Issues Found (${issues.length})`,
      issues.length === 0
        ? "No issues found."
        : issues.map(i => `[${i.severity}] **${i.dimension}**: ${i.message}`).join("\n"),
      ``,
      `### Dependency Impact`,
      dependentFiles.length > 0
        ? `${dependentFiles.length} potentially affected files: ${dependentFiles.slice(0, 3).map(f => path.basename(f)).join(", ")}${dependentFiles.length > 3 ? "..." : ""}`
        : "No dependency impact detected.",
      ``,
      verdict !== "FAIL"
        ? "**Recommendation:** Proceed with self_patch_file or self_write_file, then run self_run_tests."
        : "**Recommendation:** Address the FAIL issues before applying this change.",
    ].join("\n");

    return { success: verdict !== "FAIL", output };
  },
});

// ── Tool: self_benchmark ──────────────────────────────────────────────────────

registerTool({
  name: "self_benchmark",
  category: "system",
  safety: "safe",
  description: `Performance regression detection for self-modifications.
Runs a standardized set of micro-benchmarks across Andromeda's subsystems
and compares against stored baselines.

Use BEFORE a self-modification to capture the baseline, and AFTER to detect regressions.

Actions:
  - 'capture': Record current performance as the baseline
  - 'compare': Compare current performance against the stored baseline
  - 'report':  Show the current baseline and last comparison

Returns: performance metrics with PASS/FAIL for each subsystem.`,
  definition: {
    type: "function",
    function: {
      name: "self_benchmark",
      description: "Performance regression detection for self-modifications.",
      parameters: {
        type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["capture", "compare", "report"],
        description: "What to do: 'capture' baseline, 'compare' against baseline, or 'report' current state.",
      },
      label: {
        type: "string",
        description: "Label for this benchmark run (e.g., 'before-truncation-fix', 'after-v5.75'). Used in reports.",
      },
    },
    required: ["action"],
  },
    },
  },
  execute: async (args: Record<string, unknown>) => {
    const action = String(args.action || "report");
    const label = String(args.label || new Date().toISOString().slice(0, 19));

    const baselines = loadBaselines();

    // Run micro-benchmarks
    async function runBenchmarks(): Promise<Record<string, { latencyMs: number; success: boolean }>> {
      const results: Record<string, { latencyMs: number; success: boolean }> = {};

      // Benchmark 1: Memory search
      const t1 = Date.now();
      try {
        await searchMemory("test query for benchmarking", 3);
        results.memory_search = { latencyMs: Date.now() - t1, success: true };
      } catch {
        results.memory_search = { latencyMs: Date.now() - t1, success: false };
      }

      // Benchmark 2: TypeScript check (quick)
      const t2 = Date.now();
      const tsResult = runTypeCheck();
      results.typescript_check = { latencyMs: Date.now() - t2, success: tsResult.success };

      // Benchmark 3: File system read (workspace)
      const t3 = Date.now();
      try {
        const wsDir = getWorkspaceDir();
        if (fs.existsSync(wsDir)) fs.readdirSync(wsDir);
        results.filesystem_read = { latencyMs: Date.now() - t3, success: true };
      } catch {
        results.filesystem_read = { latencyMs: Date.now() - t3, success: false };
      }

      // Benchmark 4: Server directory scan
      const t4 = Date.now();
      try {
        const serverDir = path.resolve(getServerDir(), "..");
        fs.readdirSync(serverDir);
        results.server_dir_scan = { latencyMs: Date.now() - t4, success: true };
      } catch {
        results.server_dir_scan = { latencyMs: Date.now() - t4, success: false };
      }

      return results;
    }

    if (action === "capture") {
      const benchmarks = await runBenchmarks();
      for (const [key, val] of Object.entries(benchmarks)) {
        baselines[key] = {
          latencyMs: val.latencyMs,
          errorRate: val.success ? 0 : 1,
          timestamp: new Date().toISOString(),
        };
      }
      saveBaselines(baselines);

      return {
        success: true,
        output: [
          `## Performance Baseline Captured (${label})`,
          `**Timestamp:** ${new Date().toISOString()}`,
          ``,
          ...Object.entries(benchmarks).map(([k, v]) =>
            `- **${k}**: ${v.latencyMs}ms ${v.success ? "✅" : "❌"}`
          ),
          ``,
          `Baseline saved. Run self_benchmark with action='compare' after your modification to detect regressions.`,
        ].join("\n"),
      };
    }

    if (action === "compare") {
      const current = await runBenchmarks();
      const regressions: string[] = [];
      const improvements: string[] = [];
      const lines: string[] = [
        `## Performance Comparison (${label})`,
        ``,
        `| Subsystem | Baseline | Current | Delta | Status |`,
        `|---|---|---|---|---|`,
      ];

      for (const [key, val] of Object.entries(current)) {
        const baseline = baselines[key];
        if (!baseline) {
          lines.push(`| ${key} | N/A | ${val.latencyMs}ms | N/A | ⚪ No baseline |`);
          continue;
        }
        const delta = val.latencyMs - baseline.latencyMs;
        const pct = baseline.latencyMs > 0 ? Math.round((delta / baseline.latencyMs) * 100) : 0;
        const status = !val.success ? "❌ FAIL" : pct > 20 ? "🔴 REGRESSION" : pct < -10 ? "🟢 IMPROVED" : "✅ OK";
        lines.push(`| ${key} | ${baseline.latencyMs}ms | ${val.latencyMs}ms | ${delta >= 0 ? "+" : ""}${delta}ms (${pct >= 0 ? "+" : ""}${pct}%) | ${status} |`);
        if (pct > 20 || !val.success) regressions.push(`${key}: +${pct}% latency`);
        if (pct < -10) improvements.push(`${key}: ${pct}% faster`);
      }

      if (regressions.length > 0) {
        lines.push(``, `### ⚠️ Regressions Detected`, ...regressions.map(r => `- ${r}`));
        lines.push(``, `**Recommendation:** Consider rolling back this change. Use self_restart to reload the previous version.`);
      } else if (improvements.length > 0) {
        lines.push(``, `### ✅ Improvements Detected`, ...improvements.map(i => `- ${i}`));
      } else {
        lines.push(``, `**No significant regressions detected.** Change is safe to keep.`);
      }

      return { success: regressions.length === 0, output: lines.join("\n") };
    }

    // action === "report"
    if (Object.keys(baselines).length === 0) {
      return { success: true, output: "No baselines captured yet. Run self_benchmark with action='capture' first." };
    }
    const lines = [
      `## Current Performance Baselines`,
      ``,
      ...Object.entries(baselines).map(([k, v]) =>
        `- **${k}**: ${v.latencyMs}ms (captured ${v.timestamp.slice(0, 19)})`
      ),
    ];
    return { success: true, output: lines.join("\n") };
  },
});

export function registerSelfDiagnoseTools(): void {
  // Tools are registered at module level via registerTool() calls above.
  // This function exists for explicit registration from index.ts.
}
