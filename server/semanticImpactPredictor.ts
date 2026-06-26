/**
 * semanticImpactPredictor.ts — v12.11.0
 *
 * Semantic Graph Impact Prediction for RSI Proposals.
 *
 * Before the LLM generates a proposal, this module uses the existing
 * ASTKnowledgeGraph and dependencyGraph to:
 *
 *   1. Find all downstream consumers of the target file/function
 *   2. Extract their usage patterns (how they call the target API)
 *   3. Inject this "consumer context" into the LLM prompt so the model
 *      understands the full contract it must preserve
 *   4. Compute a risk score (0-100) based on the impact radius
 *   5. Flag high-risk proposals for extra scrutiny
 *
 * This prevents the most common class of RSI failures: proposals that
 * fix the target file but break its callers.
 */
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { createLogger } from "./logger.js";

const log = createLogger("semanticImpactPredictor");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsumerUsage {
  file: string;
  callerFunction: string;
  callSite: string;        // The actual call expression text
  line: number;
}

export interface ImpactPrediction {
  targetFile: string;
  riskScore: number;        // 0–100: 0 = no impact, 100 = touches everything
  impactRadius: number;     // Number of directly affected files
  transitiveRadius: number; // Number of transitively affected files
  consumers: ConsumerUsage[];
  consumerContextSnippet: string; // Ready-to-inject LLM context string
  highRisk: boolean;        // true if riskScore >= 70
  skipped: boolean;
  skippedReason?: string;
}

// ─── Consumer Extraction ──────────────────────────────────────────────────────

/**
 * Extract all call sites of functions exported from `targetFile` within `consumerFile`.
 */
function extractCallSites(
  consumerFile: string,
  targetBasename: string,
  projectRoot: string
): ConsumerUsage[] {
  const usages: ConsumerUsage[] = [];
  try {
    const absPath = path.isAbsolute(consumerFile)
      ? consumerFile
      : path.join(projectRoot, consumerFile);
    if (!fs.existsSync(absPath)) return usages;

    const content = fs.readFileSync(absPath, "utf-8");

    // Quick check: does this file import from the target?
    const targetBase = path.basename(targetBasename, ".ts");
    if (!content.includes(targetBase)) return usages;

    // Parse the file and find call expressions
    const sourceFile = ts.createSourceFile(
      consumerFile,
      content,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS
    );

    // Find the enclosing function name for a node
    function getEnclosingFunctionName(node: ts.Node): string {
      let parent = node.parent;
      while (parent) {
        if (ts.isFunctionDeclaration(parent) && parent.name) {
          return parent.name.getText(sourceFile);
        }
        if (ts.isMethodDeclaration(parent) && parent.name) {
          return parent.name.getText(sourceFile);
        }
        if (ts.isArrowFunction(parent)) {
          // Try to get the variable name
          const varDecl = parent.parent;
          if (varDecl && ts.isVariableDeclaration(varDecl) && ts.isIdentifier(varDecl.name)) {
            return varDecl.name.getText(sourceFile);
          }
        }
        parent = parent.parent;
      }
      return "<module level>";
    }

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callText = node.expression.getText(sourceFile);
        // Only capture calls that look like they're from the target module
        // (heuristic: single identifier or short chain that matches exported names)
        if (callText.length > 0 && callText.length < 80) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          const enclosingFn = getEnclosingFunctionName(node);
          // Get a compact call site representation (function name + first arg types)
          const callSite = node.getText(sourceFile).slice(0, 120);
          usages.push({
            file: consumerFile,
            callerFunction: enclosingFn,
            callSite,
            line: line + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    // Limit to first 50 call sites to keep context manageable
    visit(sourceFile);
    return usages.slice(0, 50);
  } catch {
    return usages;
  }
}

// ─── Main Prediction Function ─────────────────────────────────────────────────

/**
 * Predict the impact of modifying `targetFile` and generate consumer context
 * for injection into the LLM proposal prompt.
 */
export async function predictImpact(opts: {
  targetFile: string;
  projectRoot: string;
  maxConsumerFiles?: number;
}): Promise<ImpactPrediction> {
  const { targetFile, projectRoot } = opts;
  const maxConsumerFiles = opts.maxConsumerFiles ?? 8;

  // Skip for test files, config files
  if (targetFile.includes(".test.") || targetFile.includes(".spec.") ||
      targetFile.endsWith(".json") || targetFile.endsWith(".md") ||
      targetFile.endsWith(".css") || targetFile.endsWith(".tsx")) {
    return {
      targetFile, riskScore: 0, impactRadius: 0, transitiveRadius: 0,
      consumers: [], consumerContextSnippet: "", highRisk: false,
      skipped: true, skippedReason: "non-logic file type",
    };
  }

  try {
    // Use the existing dependencyGraph to find direct dependents
    const { analyzeImpact } = await import("./dependencyGraph.js");
    const impact = analyzeImpact(targetFile);

    const directDependents: string[] = impact.directDependents ?? [];
    const transitiveDependents: string[] = impact.transitiveDependents ?? [];

    const impactRadius = directDependents.length;
    const transitiveRadius = transitiveDependents.length;

    // Risk score: log-scaled, capped at 100
    // 0 dependents = 0, 1-3 = low, 4-10 = medium, 10+ = high
    const rawRisk = Math.min(100, Math.round(
      (impactRadius * 8) + (transitiveRadius * 2)
    ));
    const riskScore = rawRisk;
    const highRisk = riskScore >= 70;

    // Extract consumer call sites from the top N direct dependents
    const topConsumers = directDependents.slice(0, maxConsumerFiles);
    const targetBasename = path.basename(targetFile, ".ts");
    const allUsages: ConsumerUsage[] = [];
    for (const dep of topConsumers) {
      const usages = extractCallSites(dep, targetBasename, projectRoot);
      allUsages.push(...usages.slice(0, 6)); // max 6 call sites per file
    }

    // Build the consumer context snippet for LLM injection
    let consumerContextSnippet = "";
    if (allUsages.length > 0) {
      const lines: string[] = [
        `## Downstream Consumer Context (${impactRadius} direct dependents, ${transitiveRadius} transitive)`,
        `## IMPORTANT: Your change must preserve the following call contracts:`,
        "",
      ];
      // Group by file
      const byFile = new Map<string, ConsumerUsage[]>();
      for (const u of allUsages) {
        if (!byFile.has(u.file)) byFile.set(u.file, []);
        byFile.get(u.file)!.push(u);
      }
      for (const [file, usages] of byFile) {
        lines.push(`### ${path.basename(file)}`);
        for (const u of usages.slice(0, 4)) {
          lines.push(`  [Line ${u.line}, in ${u.callerFunction}]: ${u.callSite.slice(0, 100)}`);
        }
        lines.push("");
      }
      if (highRisk) {
        lines.push(`⚠️  HIGH RISK: This file has ${impactRadius} direct dependents. Be conservative.`);
      }
      consumerContextSnippet = lines.join("\n");
    }

    log.info(`[ImpactPredictor] ${targetFile}: riskScore=${riskScore}, impact=${impactRadius} direct, ${transitiveRadius} transitive`);

    return {
      targetFile,
      riskScore,
      impactRadius,
      transitiveRadius,
      consumers: allUsages,
      consumerContextSnippet,
      highRisk,
      skipped: false,
    };
  } catch (err) {
    log.warn(`[ImpactPredictor] Failed for ${targetFile}: ${(err as Error).message?.slice(0, 100)}`);
    return {
      targetFile, riskScore: 0, impactRadius: 0, transitiveRadius: 0,
      consumers: [], consumerContextSnippet: "", highRisk: false,
      skipped: true, skippedReason: `error: ${(err as Error).message?.slice(0, 80)}`,
    };
  }
}
