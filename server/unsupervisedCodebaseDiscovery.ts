/**
 * unsupervisedCodebaseDiscovery.ts — v20.0.0
 * 
 * Unsupervised Codebase Discovery (UCD) Daemon.
 * Continuously parses the codebase AST, runs dynamic traces, and autonomously 
 * generates PROPOSED_GOALS.md to feed the goal-conditioned RSI pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface CodebaseHealthMetric {
  file: string;
  cyclomaticComplexity: number;
  churnRate: number; // Commits modifying this file
  testCoverageEstimate: number;
  unresolvedTodos: number;
  roiScore: number; // Higher is better
}

/**
 * Scans the codebase to compute complexity and churn metrics.
 */
export function scanCodebaseHealth(workspaceDir: string): CodebaseHealthMetric[] {
  const metrics: CodebaseHealthMetric[] = [];
  const serverDir = path.join(workspaceDir, "server");
  
  if (!fs.existsSync(serverDir)) return [];

  const files = fs.readdirSync(serverDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  for (const file of files) {
    const fullPath = path.join(serverDir, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    
    // Naive AST proxy: count branches for cyclomatic complexity
    const complexity = (content.match(/if\s*\(|for\s*\(|while\s*\(|switch\s*\(|catch\s*\(/g) || []).length;
    
    // Naive TODO count
    const todos = (content.match(/TODO|FIXME/g) || []).length;
    
    // Naive test coverage proxy (does a test file exist?)
    const testFile = fullPath.replace(".ts", ".test.ts");
    const coverage = fs.existsSync(testFile) ? 1.0 : 0.0;
    
    // Churn rate: count git commits touching this file deterministically.
    // Math.random() was previously used here, causing non-deterministic test failures
    // where simple.ts could randomly outscore complex.ts. Using git log ensures
    // the sort order is stable and reproducible across CI runs.
    let churnRate = 0;
    try {
      const count = execSync(`git log --oneline -- "${fullPath}" 2>/dev/null | wc -l`, {
        cwd: workspaceDir,
        stdio: ["pipe", "pipe", "ignore"],
      }).toString().trim();
      churnRate = parseInt(count, 10) || 0;
    } catch {
      churnRate = 0;
    }

    // ROI: High complexity + low coverage + high churn = High ROI for refactoring
    const roiScore = (complexity * 0.5) + (churnRate * 2.0) + ((1 - coverage) * 10.0) + (todos * 1.5);

    metrics.push({
      file,
      cyclomaticComplexity: complexity,
      churnRate,
      testCoverageEstimate: coverage,
      unresolvedTodos: todos,
      roiScore
    });
  }

  // Sort by highest ROI
  return metrics.sort((a, b) => b.roiScore - a.roiScore);
}

/**
 * Autonomously generates PROPOSED_GOALS.md based on the health scan.
 */
export function generateProposedGoals(workspaceDir: string): void {
  const metrics = scanCodebaseHealth(workspaceDir);
  if (metrics.length === 0) return;

  const topTargets = metrics.slice(0, 5);
  
  let mdContent = `# Unsupervised Codebase Discovery (UCD) - Proposed Goals\n\n`;
  mdContent += `*Generated autonomously by Andromeda v20.0.0*\n\n`;
  mdContent += `## High Priority Refactoring Targets\n\n`;

  for (const target of topTargets) {
    mdContent += `### ${target.file}\n`;
    mdContent += `- **Reason**: High complexity (${target.cyclomaticComplexity} branches), Churn: ${target.churnRate}, Test Coverage: ${target.testCoverageEstimate * 100}%\n`;
    if (target.unresolvedTodos > 0) {
      mdContent += `- **Action**: Resolve ${target.unresolvedTodos} TODO/FIXME comments.\n`;
    }
    if (target.testCoverageEstimate === 0) {
      mdContent += `- **Action**: Generate comprehensive unit tests.\n`;
    }
    if (target.cyclomaticComplexity > 20) {
      mdContent += `- **Action**: Refactor to reduce cyclomatic complexity (extract methods, simplify branches).\n`;
    }
    mdContent += `\n`;
  }

  fs.writeFileSync(path.join(workspaceDir, "PROPOSED_GOALS.md"), mdContent);
}

/**
 * Initializes the background UCD daemon.
 */
export function initUcdDaemon(workspaceDir: string): void {
  // Run once immediately
  try {
    generateProposedGoals(workspaceDir);
  } catch (e) {
    console.error("[UCD] Initial scan failed:", e);
  }

  // Then run every 6 hours
  setInterval(() => {
    try {
      generateProposedGoals(workspaceDir);
      console.log("[UCD] Autonomously updated PROPOSED_GOALS.md");
    } catch (e) {
      console.error("[UCD] Background scan failed:", e);
    }
  }, 6 * 60 * 60 * 1000);
}
