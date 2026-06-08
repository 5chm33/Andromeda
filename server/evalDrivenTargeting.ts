/**
 * evalDrivenTargeting.ts — v9.7.1
 *
 * Connects benchmark degradation reports and adaptive eval gap analysis to the
 * RSI proposal generator. When a benchmark degrades by >15% or an eval category
 * drops below threshold, this module identifies the most likely source files and
 * submits targeted improvement proposals — making self-improvement goal-directed
 * rather than random.
 */

import path from "path";
import fs from "fs";
import { createLogger } from "./logger.js";

const log = createLogger("evalDrivenTargeting");

// ─── Category → Source File Mapping ─────────────────────────────────────────

// NOTE: Only reference files that actually exist in server/. This map is
// updated whenever the RSI engine removes or renames modules.
const CATEGORY_FILE_MAP: Record<string, string[]> = {
  tool_latency:       ["capabilityDiscovery.ts", "benchmarkRunner.ts"],
  memory:             ["knowledgeBaseConsolidation.ts", "learnedConstraints.ts"],
  code_execution:     ["selfImprove.ts", "selfImproveGuard.ts", "autoRebuild.ts"],
  llm_latency:        ["manifest.ts", "adaptiveEval.ts"],
  startup:            ["_core/initModules.ts", "_core/initDaemons.ts"],
  reasoning:          ["selfImprove.ts", "continuousImprover.ts"],
  coding:             ["selfImprove.ts", "selfImproveGuard.ts", "codebaseAnalyzer.ts"],
  conversation:       ["manifest.ts", "proposalFeedback.ts"],
  "tool-use":         ["capabilityDiscovery.ts", "capabilityBootstrapper.ts"],
  "self-improvement": ["selfImprove.ts", "continuousImprover.ts", "benchmarkRunner.ts"],
  "memory-recall":    ["knowledgeBaseConsolidation.ts", "learnedConstraints.ts"],
  "self_knowledge":   ["selfImprove.ts", "selfRollback.ts", "selfImproveGuard.ts"],
  "multi_step":       ["multiFileProposalPlanner.ts", "continuousImprover.ts"],
};

// ─── State ───────────────────────────────────────────────────────────────────

let _lastTargetingAt = 0;
const TARGETING_COOLDOWN_MS = 30 * 60 * 1000;

// ─── Core Targeting Logic ────────────────────────────────────────────────────

export async function runEvalDrivenTargeting(): Promise<number> {
  const now = Date.now();
  if (now - _lastTargetingAt < TARGETING_COOLDOWN_MS) {
    log.info("Targeting cooldown active — skipping");
    return 0;
  }
  _lastTargetingAt = now;

  const targetFiles = new Set<string>();

  // 1. Benchmark degradations (with cross-session baseline persistence)
  try {
    const { getLastBenchmarkReport } = await import("./benchmarkRunner.js");
    const report = getLastBenchmarkReport();
    
    // Load persisted baselines across restarts
    const baselinePath = path.join(process.cwd(), "data", "eval_baseline.json");
    let persistedBaselines: Record<string, number> = {};
    if (fs.existsSync(baselinePath)) {
      try { persistedBaselines = JSON.parse(fs.readFileSync(baselinePath, "utf-8")); } catch { /* ignore */ }
    }
    
    if (report && report.results.length > 0) {
      let baselinesUpdated = false;
      
      for (const result of report.results) {
        if (result.durationMs < 0) continue; // skip errors
        const benchmark = result.name;
        const current = result.durationMs;
        const baseline = persistedBaselines[benchmark];
        
        if (!baseline || baseline < 5) {
          // First time seeing this benchmark, or baseline is too small to yield meaningful percentages — establish baseline
          persistedBaselines[benchmark] = Math.max(current, 5); // Minimum 5ms baseline to prevent huge % spikes
          baselinesUpdated = true;
        } else {
          // Compare against persisted baseline
          const degradationPercent = (current - baseline) / baseline;
          
          // Only trigger if degraded by >15% (5% is too noisy for small ms values)
          if (degradationPercent > 0.15) {
            const category = benchmark.split("_")[0] as string;
            const files = CATEGORY_FILE_MAP[category] || [];
            for (const f of files) targetFiles.add(f);
            log.info(`Benchmark degradation vs baseline: ${benchmark} ${Math.round(degradationPercent * 100)}% → targeting ${files.length} files`);
          }
          
          // If it improved, update the baseline to the new better score
          if (current < baseline) {
            persistedBaselines[benchmark] = current;
            baselinesUpdated = true;
          }
        }
      }
      
      if (baselinesUpdated) {
        if (!fs.existsSync(path.dirname(baselinePath))) fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
        fs.writeFileSync(baselinePath, JSON.stringify(persistedBaselines, null, 2), "utf-8");
      }
    }
  } catch (err: any) {
    log.warn("Could not process benchmark degradations:", err.message);
  }

  // 2. Adaptive eval gaps
  try {
    const adaptiveEvalMod = await import("./adaptiveEval.js") as any;
    const getGapAnalysis = adaptiveEvalMod.getGapAnalysis;
    if (typeof getGapAnalysis === "function") {
      const gaps = await getGapAnalysis();
      if (Array.isArray(gaps)) {
        for (const gap of gaps) {
          const category = (gap.category || "").toLowerCase().replace(/\s+/g, "-");
          const files = CATEGORY_FILE_MAP[category] || [];
          for (const f of files) targetFiles.add(f);
          if (files.length > 0) {
            log.info(`Eval gap: ${gap.category} → targeting ${files.length} files`);
          }
        }
      }
    }
  } catch (err: any) {
    log.warn("Could not read eval gap analysis:", err.message);
  }

  if (targetFiles.size === 0) {
    log.info("No degradations or gaps detected — no targeted proposals needed");
    return 0;
  }

  // 3. Submit targeted proposals
  let submitted = 0;
  try {
    const { analyzeAndPropose, getAnalyzableFiles } = await import("./selfImprove.js");
    const serverDir = path.resolve(process.cwd(), "server");
    // v9.8.5: Pre-check against RSI allowlist to avoid noisy "not in analyzable files" warnings
    const analyzableSet = new Set(getAnalyzableFiles().map(f => path.basename(f)));

    for (const relFile of targetFiles) {
      const absFile = path.join(serverDir, relFile);
      if (!fs.existsSync(absFile)) {
        log.warn(`Target file not found: ${absFile}`);
        continue;
      }
      // v9.8.5: Skip files not in the RSI allowlist silently
      if (!analyzableSet.has(path.basename(relFile))) {
        log.info(`Skipping eval target ${relFile} — not in RSI allowlist`);
        continue;
      }
      try {
        await analyzeAndPropose(absFile);
        submitted++;
        log.info(`Targeted proposal submitted for: ${relFile}`);
      } catch (err: any) {
        log.warn(`Failed to submit targeted proposal for ${relFile}:`, err.message);
      }
    }
  } catch (err: any) {
    log.warn("Could not import selfImprove for targeted proposals:", err.message);
  }

  log.info(`Eval-driven targeting complete: ${submitted} targeted proposals submitted for ${targetFiles.size} files`);
  return submitted;
}

export async function getTargetedFiles(): Promise<string[]> {
  const targetFiles = new Set<string>();

  try {
    const { getLastBenchmarkReport } = await import("./benchmarkRunner.js");
    const report = getLastBenchmarkReport();
    if (report && report.degradations.length > 0) {
      for (const deg of report.degradations) {
        const category = deg.benchmark.split("_")[0] as string;
        const files = CATEGORY_FILE_MAP[category] || [];
        for (const f of files) targetFiles.add(f);
      }
    }
  } catch { /* non-fatal */ }

  try {
    const adaptiveEvalMod = await import("./adaptiveEval.js") as any;
    const getGapAnalysis = adaptiveEvalMod.getGapAnalysis;
    if (typeof getGapAnalysis === "function") {
      const gaps = await getGapAnalysis();
      if (Array.isArray(gaps)) {
        for (const gap of gaps) {
          const category = (gap.category || "").toLowerCase().replace(/\s+/g, "-");
          const files = CATEGORY_FILE_MAP[category] || [];
          for (const f of files) targetFiles.add(f);
        }
      }
    }
  } catch { /* non-fatal */ }

  return Array.from(targetFiles);
}
