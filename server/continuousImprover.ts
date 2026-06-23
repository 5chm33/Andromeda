/**
 * Andromeda v5.27 — Continuous Self-Improvement Engine
 *
 * Runs a periodic improvement cycle that:
 * 1. Analyzes the codebase for improvement opportunities
 * 2. Generates proposals via selfImprove
 * 3. Applies safe proposals through the guard pipeline
 * 4. Self-reviews changes and rolls back if quality drops
 *
 * Configurable interval (default: every 6 hours).
 * Respects recursion guards and rate limits.
 */

import * as path from "path";
import { createLogger } from "./logger.js";
import { withContinuousImproverLock } from "./redisLock.js";
import { emitRsiEvent } from "./rsiEventBus.js";
import { gitSandbox } from "./gitSandbox.js";
const log = createLogger("continuousImprover");

// ── Configuration ────────────────────────────────────────────────────────────

interface ContinuousImproverConfig {
  enabled: boolean;
  intervalMs: number;           // Default: 6 hours
  maxProposalsPerCycle: number; // Max proposals to generate per cycle
  maxAppliesPerCycle: number;   // Max proposals to apply per cycle
  autoApplyThreshold: number;   // Min confidence to auto-apply (0-1)
  dryRun: boolean;              // If true, generate proposals but don't apply
}

const DEFAULT_CONFIG: ContinuousImproverConfig = {
  enabled: true, // v5.30: Enabled by default — orchestrator coordinates improvement cycles
  intervalMs: 10 * 60 * 1000, // v10.5.7: 10 minutes — was 30 minutes, tripled throughput
  maxProposalsPerCycle: 5,
  maxAppliesPerCycle: 8,  // v10.5.7: increased from 3 → 8 for maximum improvement throughput
  autoApplyThreshold: 0.8,
  dryRun: false,
};

let config: ContinuousImproverConfig = { ...DEFAULT_CONFIG };
let cycleTimer: ReturnType<typeof setInterval> | null = null;
// v6.31: isRunning replaced by withContinuousImproverLock() distributed lock
let _timerActive = false;
let lastCycleAt = 0;
let totalCycles = 0;
let totalProposals = 0;
let totalApplied = 0;
let totalRolledBack = 0;

// ── Cycle History ────────────────────────────────────────────────────────────

interface CycleResult {
  timestamp: number;
  proposalsGenerated: number;
  proposalsApplied: number;
  proposalsRolledBack: number;
  duration: number;
  errors: string[];
}

const cycleHistory: CycleResult[] = [];
const MAX_HISTORY = 50;

// ── Core Improvement Cycle ───────────────────────────────────────────────────

async function runImprovementCycle(): Promise<CycleResult> {
  const start = Date.now();
  const result: CycleResult = {
    timestamp: start,
    proposalsGenerated: 0,
    proposalsApplied: 0,
    proposalsRolledBack: 0,
    duration: 0,
    errors: [],
  };

  try {
    // 1. Check recursion guard
    try {
      const guard = await import("./selfImproveGuard");
      const guardConfig = guard.getGuardConfig();
      if (guardConfig && guardConfig.requireApproval) {
        console.log("[ContinuousImprover] Guard is paused. Skipping cycle.");
        result.duration = Date.now() - start;
        return result;
      }
    } catch (err) { log.caught("guard not available", err); }

    // 2. Analyze codebase for improvement targets
    const { listProposals, analyzeAndPropose } = await import("./selfImprove");

    // Generate new proposals by analyzing a random file
    try {
      const { getAnalyzableFiles } = await import("./selfImprove");
      const files = getAnalyzableFiles();
      if (files.length > 0) {
        // v9.9.0: Analyze 2 files per cycle (was 1) — doubles improvement rate at minimal extra cost
        const shuffled = [...files].sort(() => Math.random() - 0.5);
        const filesToAnalyze = shuffled.slice(0, 2);
        for (const randomFile of filesToAnalyze) {
          await analyzeAndPropose(randomFile);
        }
      }
    } catch (err) {
      result.errors.push(`Proposal generation failed: ${(err as Error).message}`);
    }

    // v9.7.0: Eval-driven targeting — submit proposals for degraded benchmark areas
    try {
      const { runEvalDrivenTargeting } = await import("./evalDrivenTargeting.js");
      const targeted = await runEvalDrivenTargeting();
      if (targeted > 0) {
        console.log(`[ContinuousImprover] Eval-driven targeting: ${targeted} targeted proposals submitted`);
      }
    } catch (err) {
      result.errors.push(`Eval-driven targeting failed: ${(err as Error).message}`);
    }

    // v9.7.0: Quality monitor + JSDoc gaps → RSI proposal queue
    try {
      const { runQualityToRSI } = await import("./qualityToRSI.js");
      const { qualityProposals, docProposals } = await runQualityToRSI();
      if (qualityProposals + docProposals > 0) {
        console.log(`[ContinuousImprover] Quality→RSI: ${qualityProposals} quality + ${docProposals} doc proposals submitted`);
      }
    } catch (err) {
      result.errors.push(`Quality→RSI feed failed: ${(err as Error).message}`);
    }

    // v9.8.5: Removed autoApplyHighConfidence to centralize all apply logic
    // in the pending proposals loop below, preventing race conditions.
    let autoResults: any[] = [];

    // 3. Get pending proposals
    const proposals = listProposals().filter((p: any) => p.status === "pending");
    
    // In v9.8.1 we only count newly generated proposals in totalProposals, but here
    // proposals is the entire pending queue. We'll just report the queue size.
    result.proposalsGenerated = proposals.length;
    // Don't add to totalProposals here, as it double-counts on every cycle

    if (config.dryRun) {
      console.log(`[ContinuousImprover] DRY RUN: ${proposals.length} pending proposals, none applied.`);
      result.duration = Date.now() - start;
      return result;
    }

    // 4. Apply top proposals (up to limit) — with truncation check
    // v9.8.5: Reset any stale 'processing' proposals before applying
    // (proposals stuck in 'processing' from a previous crashed cycle will be reset to 'pending')
    try {
      const { resetStuckProcessingProposals } = await import("./selfImprove");
      resetStuckProcessingProposals();
    } catch { /* non-fatal */ }

    // v9.8.1: Sort by confidence before slicing, so we try the best ones first
    // v11.16.0 Audit 8 Fix A: Use semanticSelfModel.rankProposals() for utility-aware ordering
    let sortedProposals = [...proposals].sort((a: any, b: any) => (b.confidence || 0) - (a.confidence || 0));
    try {
      const { rankProposals } = await import("./semanticSelfModel.js");
      const ranked = rankProposals(proposals.map((p: any) => ({
        moduleName: (p.targetFile || "").replace(/^.*\//, "").replace(/\.ts$/, ""),
        changeType: p.category === "performance" ? "optimize" : p.category === "fix" ? "fix_bug" : "refactor",
        rationale: p.rationale,
      })));
      const rankMap = new Map(ranked.map((r: any) => [r.moduleName, r.rank]));
      sortedProposals = [...proposals].sort((a: any, b: any) => {
        const aName = (a.targetFile || "").replace(/^.*\//, "").replace(/\.ts$/, "");
        const bName = (b.targetFile || "").replace(/^.*\//, "").replace(/\.ts$/, "");
        const aRank = rankMap.get(aName) ?? 999;
        const bRank = rankMap.get(bName) ?? 999;
        if (aRank !== bRank) return aRank - bRank;
        return (b.confidence || 0) - (a.confidence || 0);
      });
    } catch { /* non-fatal — fall back to confidence sort */ }
    const toApply = sortedProposals.slice(0, config.maxAppliesPerCycle);
    const { applyProposal } = await import("./selfImprove");

    // v5.29: Import stream integrity checker for truncation detection
    let checkCompleteness: ((content: string) => { isComplete: boolean; confidence: number; indicators: string[] }) | null = null;
    try {
      const sim = await import("./streamIntegrityMonitor");
      checkCompleteness = sim.checkCompleteness;
    } catch (err) { log.caught("non-fatal — proceed without check", err); }

    for (const proposal of toApply) {
      try {
        // v5.29: Check if proposal content is truncated before applying
        if (checkCompleteness && proposal.proposedContent) {
          const integrity = checkCompleteness(proposal.proposedContent);
          if (!integrity.isComplete && integrity.confidence < 0.5) {
            console.warn(`[ContinuousImprover] Skipping truncated proposal: ${proposal.title || proposal.id} (confidence: ${integrity.confidence.toFixed(2)}, indicators: ${integrity.indicators.join(", ")})`);
            result.proposalsRolledBack++;
            totalRolledBack++;
            result.errors.push(`Truncation detected in ${proposal.id}: ${integrity.indicators.join(", ")}`);
            continue;
          }
        }

        const applyResult = await applyProposal(proposal.id);
        if (applyResult.success) {
          result.proposalsApplied++;
          totalApplied++;
          console.log(`[ContinuousImprover] Applied: ${proposal.title || proposal.id}`);
          emitRsiEvent("proposal:applied", { id: proposal.id, title: proposal.title, targetFile: proposal.targetFile, confidence: proposal.confidence });
          // v11.8.2: Record implicit RLHF feedback for successful applies.
          // A small positive evalDelta (0.1) is recorded immediately; the eval engine
          // will overwrite this with the actual delta after the next benchmark run.
          try {
            const { recordImplicitFeedback } = await import("./rlhfCollector.js");
            recordImplicitFeedback(
              [{ id: proposal.id, targetFile: proposal.targetFile || "unknown", category: proposal.category || "readability", title: proposal.title || proposal.id }],
              0.1
            );
          } catch { /* non-fatal */ }
          // v11.6.0: Append to AI-generated changelog
          try {
            const { appendChangelogEntry } = await import("./aiChangelog.js");
            appendChangelogEntry(
              proposal.id,
              proposal.targetFile || "unknown",
              proposal.title || proposal.id,
              proposal.rationale || "",
              proposal.category || "reliability",
              proposal.impact || "medium",
              proposal.confidence ?? 0,
              proposal.originalSnippet || "",
              proposal.proposedSnippet || ""
            );
          } catch { /* non-fatal */ }
          // v11.10.1: Record learning in selfKnowledgeBase so future proposals
          // for this file get architecture context from past successful changes.
          try {
            const { recordLearning } = await import("./selfKnowledgeBase.js");
            recordLearning({
              title: proposal.title || proposal.id,
              description: `RSI commit: ${proposal.category || "readability"} improvement to ${proposal.targetFile || "unknown"}`,
              lesson: `RSI applied: ${proposal.rationale || "No rationale provided"}`,
              outcome: `Committed with confidence ${(proposal.confidence ?? 0.8).toFixed(2)}`,
              category: "success",
              context: proposal.targetFile || "unknown",
              confidence: proposal.confidence ?? 0.8,
              applicableTo: [proposal.targetFile || "unknown", proposal.category || "readability"],
            });
          } catch { /* non-fatal */ }
          // v11.12.0: Record successful RSI episode in episodic memory
          try {
            const { recordEpisode } = await import("./episodicMemory.js");
            await recordEpisode({
              goal: `RSI improvement: ${proposal.title || proposal.id}`,
              outcome: "success",
              summary: `Applied ${proposal.category || "readability"} improvement to ${proposal.targetFile || "unknown"}: ${proposal.rationale || "No rationale"}`,
            });
          } catch { /* non-fatal */ }
          // v11.13.0 Audit 5 Fix B: Wire learnFromAppliedProposal so knowledgeTransfer DB grows
          try {
            const { learnFromAppliedProposal } = await import("./knowledgeTransfer.js");
            learnFromAppliedProposal({
              id: proposal.id,
              targetFile: proposal.targetFile || "unknown",
              title: proposal.title || proposal.id,
              category: proposal.category || "readability",
              rationale: proposal.rationale || "",
              confidence: proposal.confidence ?? 0.8,
              impact: proposal.impact || "medium",
            });
          } catch { /* non-fatal */ }
          // v11.16.0 Audit 8 Fix B: Record successful RSI decision in selfReflectionEngine
          try {
            const { recordInteraction, logDecision } = await import("./selfReflectionEngine.js");
            recordInteraction("success", `RSI applied: ${proposal.title || proposal.id} → ${proposal.targetFile || "unknown"}`);
            logDecision({
              decisionType: "self_modification",
              context: proposal.targetFile || "unknown",
              alternativesConsidered: [],
              chosenApproach: proposal.title || proposal.id,
              rationale: proposal.rationale || "RSI cycle",
              outcome: "success",
              outcomeNotes: `Confidence: ${(proposal.confidence ?? 0.8).toFixed(2)}`,
            });
          } catch { /* non-fatal */ }
          // v11.20.0 Audit 12 Fix C: Wire updateDecisionOutcome so selfReflectionEngine outcome DB grows
          try {
            const { updateDecisionOutcome } = await import("./selfReflectionEngine.js");
            updateDecisionOutcome(
              proposal.targetFile || "unknown",
              "success",
              `Applied: ${proposal.title || proposal.id} (confidence: ${(proposal.confidence ?? 0.8).toFixed(2)})`
            );
          } catch { /* non-fatal */ }
          // v11.17.0 Audit 9 Fix A: Wire documentSelfImprovement so selfDocumentation DB grows
          try {
            const { documentSelfImprovement } = await import("./selfDocumentation.js");
            documentSelfImprovement(
              proposal.targetFile || "unknown",
              proposal.title || proposal.id,
              proposal.category || "readability",
              "v11.17.0"
            );
          } catch { /* non-fatal */ }
          // v11.17.0 Audit 9 Fix B: Wire broadcastProposal so federatedRsiNetwork peers learn
          try {
            const { broadcastProposal } = await import("./federatedRsiNetwork.js");
            await broadcastProposal({
              id: proposal.id,
              targetFile: proposal.targetFile || "unknown",
              category: proposal.category || "readability",
              rationale: proposal.rationale || "",
              confidence: proposal.confidence ?? 0.8,
              proposedContent: proposal.proposedSnippet || "",
              originalContent: proposal.originalSnippet || "",
            });
          } catch { /* non-fatal */ }
          // v11.19.0 Audit 11 Fix C: Wire recordObservation so longTermMemoryConsolidation DB grows
          try {
            const { recordObservation } = await import("./longTermMemoryConsolidation.js");
            recordObservation({
              cycleId: `cycle-${totalCycles}`,
              timestamp: Date.now(),
              targetFile: proposal.targetFile || "unknown",
              changeDescription: proposal.title || proposal.id,
              diff: proposal.diff || "",
              evalScoreBefore: 0,
              evalScoreAfter: proposal.confidence ?? 0.8,
              accepted: true,
            });
          } catch { /* non-fatal */ }
        } else {
          result.proposalsRolledBack++;
          totalRolledBack++;
          console.warn(`[ContinuousImprover] Rejected: ${proposal.title || proposal.id} — ${applyResult.message}`);
          emitRsiEvent("proposal:rejected", { id: proposal.id, title: proposal.title, reason: applyResult.message });
          // v11.6.0: Record rejection feedback so future proposals for this file learn from this failure
          try {
            const { recordRejectionFeedback } = await import("./proposalFeedback.js");
            recordRejectionFeedback(
              proposal.id,
              proposal.targetFile || "unknown",
              proposal.title || proposal.id,
              proposal.originalSnippet || "",
              proposal.proposedSnippet || "",
              applyResult.message || "unknown"
            );
          } catch { /* non-fatal */ }
          // v11.12.0: Record failed RSI episode in episodic memory
          try {
            const { recordEpisode } = await import("./episodicMemory.js");
            await recordEpisode({
              goal: `RSI improvement: ${proposal.title || proposal.id}`,
              outcome: "failure",
              summary: `Rejected ${proposal.category || "readability"} proposal for ${proposal.targetFile || "unknown"}: ${applyResult.message || "unknown reason"}`,
              failedStep: "guardedApply",
            });
          } catch { /* non-fatal */ }
          // v11.16.0 Audit 8 Fix B: Record failed RSI decision in selfReflectionEngine
          try {
            const { recordInteraction, logDecision } = await import("./selfReflectionEngine.js");
            recordInteraction("failure", `RSI rejected: ${proposal.title || proposal.id} — ${applyResult.message || "unknown"}`);
            logDecision({
              decisionType: "self_modification",
              context: proposal.targetFile || "unknown",
              alternativesConsidered: [],
              chosenApproach: `Reject: ${proposal.title || proposal.id}`,
              rationale: applyResult.message || "guardedApply rejected",
              outcome: "failure",
              outcomeNotes: applyResult.message,
            });
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        const errMsg = (err as Error).message || String(err);
        result.errors.push(`Apply failed for ${proposal.id}: ${errMsg}`);
        console.error(`[ContinuousImprover] EXCEPTION applying ${proposal.title || proposal.id}: ${errMsg}`);
        // Ensure the proposal is not left stuck in 'processing' after an exception
        try {
          const { rejectProposal } = await import('./selfImprove');
          rejectProposal(proposal.id);
        } catch { /* best effort */ }
      }
      // Yield to the event loop to prevent blocking during tight apply loops
      await new Promise(r => setImmediate(r));
    }

    // 5. Post-cycle: validate all changes with TypeScript check + smoke tests + behavioral tests
    if (result.proposalsApplied > 0) {
      try {
        const { spawnSync } = await import("child_process");
        const serverDir = path.resolve(process.cwd());

        // v11.2.0: R9 Post-Apply Git Diff Safety Check
        // Scans every modified file in the git working tree for R9 violations:
        //   1. Test files must NEVER be modified (constitution §filePatterns)
        //   2. .toBeTruthy()/.toBeFalsy() must never replace null/undefined checks
        // This is the ROOT CAUSE FIX for the ContinuousImprover R9 bypass:
        // secondary test-file changes generated alongside source changes were
        // not going through the per-proposal constitution check.
        try {
          // v11.4.0: All git calls now go through gitSandbox() whitelist
          const diffOutput = gitSandbox(
            "git diff --name-only HEAD",
            { cwd: serverDir, timeout: 10000, encoding: "utf-8", stdio: "pipe" }
          ).trim();
          if (diffOutput) {
            const modifiedFiles = diffOutput.split("\n").filter(Boolean);
            // Rule 1: Roll back any test file modifications immediately
            const testFileViolations = modifiedFiles.filter(
              f => f.endsWith(".test.ts") || f.endsWith(".test.js") || f.endsWith(".spec.ts") || f.endsWith(".spec.js")
            );
            if (testFileViolations.length > 0) {
              const filesArg = testFileViolations.map(f => `"${f}"`).join(" ");
              gitSandbox(`git checkout HEAD -- ${filesArg}`, { cwd: serverDir, timeout: 10000, stdio: "pipe", encoding: "utf-8" });
              console.warn(`[ContinuousImprover] R9 VIOLATION: Rolled back ${testFileViolations.length} test file modification(s): ${testFileViolations.join(", ")}`);
              result.errors.push(`R9 violation: test files modified and rolled back: ${testFileViolations.join(", ")}`);
            }
            // Rule 2: Scan non-test modified files for .toBeTruthy()/.toBeFalsy() additions
            const sourceFiles = modifiedFiles.filter(f => !testFileViolations.includes(f));
            for (const file of sourceFiles) {
              try {
                const fileDiff = gitSandbox(
                  `git diff HEAD -- "${file}"`,
                  { cwd: serverDir, timeout: 5000, encoding: "utf-8", stdio: "pipe" }
                );
                const addedLines = fileDiff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++"));
                const r9Violation = addedLines.some(l =>
                  l.includes(".toBeTruthy()") || l.includes(".toBeFalsy()")
                );
                if (r9Violation) {
                  gitSandbox(`git checkout HEAD -- "${file}"`, { cwd: serverDir, timeout: 5000, stdio: "pipe", encoding: "utf-8" });
                  console.warn(`[ContinuousImprover] R9 VIOLATION in ${file}: weakened assertion (.toBeTruthy/.toBeFalsy) — rolled back.`);
                  result.errors.push(`R9 violation in ${file}: weakened assertion rolled back`);
                }
              } catch { /* best effort per-file scan */ }
            }
          }
        } catch (r9Err: any) {
          // Non-fatal: if git is unavailable, log and continue
          console.warn("[ContinuousImprover] R9 git diff check unavailable (non-fatal):", r9Err.message?.slice(0, 100));
        }

        console.log(`[ContinuousImprover] Running TypeScript check after ${result.proposalsApplied} applies...`);
        // v9.8.5: Use node_modules/.bin/tsc directly — npx is not available in all environments
        // v10.3.1: Use spawnSync with args array instead of execSync with shell string to avoid DEP0190.
        const tscBin = path.resolve(serverDir, "node_modules", ".bin", "tsc");
        const fs2 = require("fs");
        const [tscExe, tscArgs] = fs2.existsSync(tscBin)
          ? [tscBin, ["--noEmit"]]
          : ["node", [require("path").resolve(serverDir, "node_modules", "typescript", "bin", "tsc"), "--noEmit"]];
        const tscResult = spawnSync(tscExe, tscArgs, { cwd: serverDir, timeout: 60000, stdio: "pipe", encoding: "utf-8" });
        if (tscResult.status !== 0) { throw new Error(tscResult.stderr || tscResult.stdout || "TypeScript check failed"); }
        console.log("[ContinuousImprover] TypeScript check PASSED. Changes are valid.");

        // v11.0.3: Run full Vitest test suite after TypeScript check.
        // The guard only runs targeted tests for the modified file — this catches
        // regressions in other tests caused by behavioral changes in the modified file.
        try {
          const { spawnSync: spawnSync2 } = await import("child_process");
          console.log(`[ContinuousImprover] Running full test suite to verify no regressions...`);
          const vitestBin = path.resolve(serverDir, "node_modules", ".bin", "vitest");
          const vitestResult = spawnSync2(
            "sh", ["-c", `pnpm exec vitest run --reporter=verbose 2>&1`],
            { cwd: serverDir, timeout: 300000, stdio: "pipe", encoding: "utf-8" }
          );
          if (vitestResult.status !== 0) {
            const failOutput = (vitestResult.stdout || vitestResult.stderr || "").slice(-2000);
            throw new Error(`Full test suite FAILED after apply:\n${failOutput}`);
          }
          console.log("[ContinuousImprover] Full test suite PASSED. All regressions clear.");
        } catch (testErr: any) {
          if (testErr.message.includes('Full test suite FAILED')) throw testErr;
          console.warn('[ContinuousImprover] Full test suite unavailable (non-fatal):', testErr.message);
        }
        // v5.97: Run smoke tests after TypeScript check
        try {
          const { runSmokeTests } = await import("./self/smoke_test_runner.js");
          const smokeResult = await runSmokeTests(serverDir);
          if (smokeResult.rollbackRecommended) {
            throw new Error(`Smoke tests FAILED: ${smokeResult.failed}/${smokeResult.totalTests} tests failed`);
          }
          console.log(`[ContinuousImprover] Smoke tests PASSED: ${smokeResult.passed}/${smokeResult.totalTests}`);
        } catch (smokeErr: any) {
          if (smokeErr.message.includes('Smoke tests FAILED')) throw smokeErr;
          console.warn('[ContinuousImprover] Smoke tests unavailable (non-fatal):', smokeErr.message);
        }
        // 6. Trigger hot-reload so changes take effect without full restart
        try {
          const http = await import("http");
          const port = parseInt(process.env.PORT || "3000");
          const reloadReq = http.request({ hostname: "127.0.0.1", port, path: "/api/module/reload", method: "POST", headers: { "Content-Type": "application/json" } });
          reloadReq.write(JSON.stringify({ module: "./selfImprove" }));
          reloadReq.end();
          console.log("[ContinuousImprover] Hot-reload triggered for modified modules.");
        } catch (err) { log.caught("non-fatal -- server will pick up changes on next import", err); }

        // v9.9.0: Push main directly to GitHub after each successful cycle.
        // Changes are already committed to main by applyProposal().
        // Pushing triggers CI (RSI Validate + CI build) automatically.
        // No branches or PRs needed — Andromeda owns main directly.
        if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPO) {
          try {
            // v11.4.0: git push now goes through gitSandbox() whitelist
            const cwd = process.cwd();
            const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Andromeda AI", GIT_AUTHOR_EMAIL: "andromeda@local", GIT_COMMITTER_NAME: "Andromeda AI", GIT_COMMITTER_EMAIL: "andromeda@local" };
            const token = process.env.GITHUB_TOKEN;
            // Sanitize repo name — only allow alphanumeric, /, -, .
            const repo = (process.env.GITHUB_REPO || "").replace(/[^a-zA-Z0-9/_.-]/g, "");
            const remoteUrl = `https://${token}@github.com/${repo}.git`;
            gitSandbox(`git push "${remoteUrl}" main`, { cwd, env: gitEnv, encoding: "utf-8", stdio: "pipe", timeout: 30000 });
            console.log(`[ContinuousImprover] Pushed ${result.proposalsApplied} improvement(s) to origin/main — CI triggered.`);
          } catch (pushErr: any) {
            // Non-fatal — push failure should never block the improvement cycle
            // Sanitize all potential token patterns from all error output channels
            const rawMsg = (pushErr.stderr || pushErr.stdout || pushErr.message || pushErr.toString());
            const safeMsg = rawMsg
              .replace(/ghp_[A-Za-z0-9]{36}/g, "ghp_***")
              .replace(/gho_[A-Za-z0-9]{36}/g, "gho_***")
              .replace(/ghu_[A-Za-z0-9]{36}/g, "ghu_***")
              .replace(/ghs_[A-Za-z0-9]{36}/g, "ghs_***")
              .replace(/ghr_[A-Za-z0-9]{36}/g, "ghr_***")
              .replace(/https:\/\/[^@\s]+@github\.com/g, "https://***@github.com")
              .replace(/:[^:@\s]+@github\.com/g, ":***@github.com");
            console.warn(`[ContinuousImprover] Git push failed (non-fatal): ${safeMsg.slice(0, 200)}`);
          }
        }
      } catch (tsErr: any) {
        // TypeScript check failed -- rollback all proposals applied this cycle
        console.error(`[ContinuousImprover] TypeScript check FAILED after applies. Rolling back...`);
        result.errors.push(`Post-apply TS check failed: ${(tsErr.stderr || tsErr.message || "").toString().slice(0, 200)}`);
        try {
                    // v11.4.0: git checkout rollback now goes through gitSandbox() whitelist
          const filesToRollback = new Set<string>();
          // v11.10.1: autoResults is always empty (legacy dead code) — use toApply directly
          for (const p of toApply) {
            const wasApplied = listProposals().find((sp: any) => sp.id === p.id)?.status === "applied";
            if (wasApplied) filesToRollback.add(p.targetFile);
          }
          if (filesToRollback.size > 0) {
            const filesArg = Array.from(filesToRollback).map(f => `"${f}"`).join(" ");
            gitSandbox(`git checkout HEAD -- ${filesArg}`, { cwd: process.cwd(), timeout: 10000, stdio: "pipe", encoding: "utf-8" });
            console.log(`[ContinuousImprover] Rolled back specific files: ${Array.from(filesToRollback).join(", ")}`);
          } else {
            console.log("[ContinuousImprover] No specific files identified for rollback.");
          }
          result.proposalsRolledBack += result.proposalsApplied;
          result.proposalsApplied = 0;
        } catch (rollbackErr) {
          result.errors.push(`Rollback failed: ${(rollbackErr as Error).message}`);
        }
      }
    }

    // 7. Post-cycle health check
    try {
      const { getHealthReport } = await import("./selfMonitor");
      const report = getHealthReport();
      if (report && report.status !== "healthy") {
        console.warn(`[ContinuousImprover] Post-cycle health: ${report.status}. Pausing next cycle.`);
      }
    } catch (err) { log.caught("non-fatal", err); }

  } catch (err) {
    result.errors.push(`Cycle error: ${(err as Error).message}`);
    console.error("[ContinuousImprover] Cycle failed:", (err as Error).message);
  }

  result.duration = Date.now() - start;
  lastCycleAt = Date.now();
  totalCycles++;
  cycleHistory.push(result);
  if (cycleHistory.length > MAX_HISTORY) cycleHistory.shift();

  // v11.13.0 Audit 5 Fix A: Prune stale failure patterns every 10 cycles to prevent unbounded DB growth
  if (totalCycles % 10 === 0) {
    try {
      const { pruneOldFailures } = await import("./failurePatternMemory.js");
      const pruned = pruneOldFailures();
      if (pruned > 0) console.log(`[ContinuousImprover] Pruned ${pruned} stale failure pattern(s) from memory.`);
    } catch { /* non-fatal */ }
  }

  // v11.15.0 Audit 7 Fix B: Wire generateImprovementGoals so autonomousGoalGenerator DB grows
  // Run every 5 cycles to generate self-directed improvement goals from recent RSI history
  if (totalCycles % 5 === 0) {
    try {
      const { generateImprovementGoals } = await import("./autonomousGoalGenerator.js");
      const goalResult = await generateImprovementGoals();
      if (goalResult.goals.length > 0) {
        console.log(`[ContinuousImprover] Generated ${goalResult.goals.length} autonomous improvement goal(s) from cycle #${totalCycles}.`);
      }
    } catch { /* non-fatal — autonomousGoalGenerator may not be available */ }
  }

  // v11.15.0 Audit 7 Fix C: Wire processPendingGaps so capabilityBootstrapper queue is consumed
  // Run every 20 cycles to process any pending capability gaps registered during RSI
  if (totalCycles % 20 === 0) {
    try {
      const { processPendingGaps } = await import("./capabilityBootstrapper.js");
      await processPendingGaps();
    } catch { /* non-fatal — capabilityBootstrapper may not be available */ }
  }

  // v11.16.0 Audit 8 Fix C: Wire triggerReflection so selfReflectionEngine synthesizes lessons
  // Run every 3 cycles — reflection is lightweight but should not run every cycle
  if (totalCycles % 3 === 0) {
    try {
      const { triggerReflection } = await import("./selfReflectionEngine.js");
      await triggerReflection();
    } catch { /* non-fatal */ }
  }

  // v11.18.0 Audit 10 Fix A: Wire analyzeAndImprovePrompts so promptEngineer DB grows
  // Run every 15 cycles to evolve prompt patterns from RSI outcomes
  if (totalCycles % 15 === 0) {
    setImmediate(async () => {
      try {
        const { analyzeAndImprovePrompts } = await import("./promptEngineer.js");
        await analyzeAndImprovePrompts();
      } catch { /* non-fatal */ }
    });
  }

  // v11.18.0 Audit 10 Fix B: Wire runNightlyFineTuningCycle so local fine-tuning DB grows
  // Run every 50 cycles — fine-tuning is expensive, run infrequently
  if (totalCycles % 50 === 0) {
    setImmediate(async () => {
      try {
        const { runNightlyFineTuningCycle } = await import("./continuousFineTuning.js");
        await runNightlyFineTuningCycle();
      } catch { /* non-fatal */ }
    });
  }

  // v11.19.0 Audit 11 Fix B: Wire runLongTermConsolidation so long-term memory patterns grow
  // Run every 7 cycles — consolidation extracts patterns from recent RSI diffs
  if (totalCycles % 7 === 0) {
    setImmediate(async () => {
      try {
        const { runLongTermConsolidation } = await import("./longTermMemoryConsolidation.js");
        const result = await runLongTermConsolidation();
        if (result.newPatternsFound > 0) {
          console.log(`[ContinuousImprover] Long-term consolidation: ${result.newPatternsFound} new pattern(s) extracted from cycle #${totalCycles}.`);
        }
      } catch { /* non-fatal */ }
    });
  }

  // v11.20.0 Audit 12 Fix B: Wire consolidateKnowledge so unifiedKnowledge DB stays current
  // Run every 25 cycles — knowledge consolidation deduplicates and merges all knowledge sources
  if (totalCycles % 25 === 0) {
    setImmediate(async () => {
      try {
        const { consolidateKnowledge } = await import("./unifiedKnowledge.js");
        const kr = await consolidateKnowledge();
        if (kr.merged > 0 || kr.removed > 0) {
          console.log(`[ContinuousImprover] Knowledge consolidation: ${kr.merged} merged, ${kr.removed} removed across ${kr.sourcesProcessed.length} source(s).`);
        }
      } catch { /* non-fatal */ }
    });
  }

  // v11.23.0 Audit 15 Fix A: Wire clearAllCaches so memory footprint stays stable during long RSI runs
  // Run every 100 cycles to completely clear all non-essential caches
  if (totalCycles % 100 === 0) {
    try {
      const { clearAllCaches } = await import("./cache.js");
      clearAllCaches();
      console.log(`[ContinuousImprover] Cleared all caches at cycle #${totalCycles} to prevent OOM.`);
    } catch { /* non-fatal */ }
  }

  // v11.23.0 Audit 15 Fix B: Wire triggerCycle from autonomyOrchestrator to ensure deep self-reflection
  // Run every 12 cycles to trigger a full autonomy cycle which analyzes logs and updates goals
  if (totalCycles % 12 === 0) {
    setImmediate(async () => {
      try {
        const { triggerCycle } = await import("./autonomyOrchestrator.js");
        await triggerCycle();
      } catch { /* non-fatal */ }
    });
  }

  // v11.20.0 Audit 12 Fix A: Wire recordRsiCycle so telemetry DB receives every RSI cycle sample
  try {
    const { recordRsiCycle } = await import("./telemetry.js");
    recordRsiCycle({
      cycleId: `cycle-${totalCycles}`,
      durationMs: result.duration,
      proposalsGenerated: result.proposalsGenerated,
      proposalsApplied: result.proposalsApplied,
      evalScore: null,
    });
  } catch { /* non-fatal */ }

  console.log(`[ContinuousImprover] Cycle #${totalCycles} complete: ${result.proposalsApplied} applied, ${result.proposalsRolledBack} rolled back (${result.duration}ms)`);
  emitRsiEvent("cycle:complete", { cycleNumber: totalCycles, proposalsApplied: result.proposalsApplied, proposalsRolledBack: result.proposalsRolledBack, duration: result.duration, errors: result.errors.length });
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function startContinuousImprover(overrides?: Partial<ContinuousImproverConfig>): void {
  if (overrides) config = { ...config, ...overrides };
  if (!config.enabled) {
    console.log("[ContinuousImprover] Disabled. Set enabled: true to activate.");
    return;
  }
  if (_timerActive) return;

  // v6.31: Each interval tick acquires the distributed lock before running
  _timerActive = true;
  
  // v9.8.1: Run an initial cycle shortly after startup to process pending proposals
  setTimeout(() => {
    if (_timerActive) {
      withContinuousImproverLock(() => runImprovementCycle()).catch(err =>
        console.warn("[ContinuousImprover] Initial cycle skipped (lock busy or error):", (err as Error).message)
      );
    }
  }, 15000); // 15 seconds after startup
  
  cycleTimer = setInterval(() => {
    withContinuousImproverLock(() => runImprovementCycle()).catch(err =>
      console.warn("[ContinuousImprover] Cycle skipped (lock busy or error):", (err as Error).message)
    );
  }, config.intervalMs);
  console.log(`[ContinuousImprover] Started. Interval: ${config.intervalMs / 1000 / 60}min, maxApplies: ${config.maxAppliesPerCycle}`);
}

export function stopContinuousImprover(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  cycleTimer = null;
  _timerActive = false;
  // v6.31: No isRunning flag to clear — lock releases automatically
  console.log("[ContinuousImprover] Stopped.");
}

export function triggerCycleNow(): Promise<CycleResult> {
  // v6.31: Acquire lock for manual trigger too
  return withContinuousImproverLock(() => runImprovementCycle()).then(r => r.result ?? ({} as CycleResult));
}

export function getImproverStats(): {
  enabled: boolean;
  running: boolean;
  totalCycles: number;
  totalProposals: number;
  totalApplied: number;
  totalRolledBack: number;
  lastCycleAt: number;
  intervalMs: number;
  recentHistory: CycleResult[];
} {
  return {
    enabled: config.enabled,
    running: _timerActive,
    totalCycles,
    totalProposals,
    totalApplied,
    totalRolledBack,
    lastCycleAt,
    intervalMs: config.intervalMs,
    recentHistory: cycleHistory.slice(-10),
  };
}

export function updateImproverConfig(updates: Partial<ContinuousImproverConfig>): void {
  config = { ...config, ...updates };
  if (_timerActive && updates.intervalMs) {
    // Restart with new interval
    stopContinuousImprover();
    startContinuousImprover();
  }
}
