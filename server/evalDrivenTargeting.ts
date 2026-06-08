/**
 * evalDrivenTargeting.ts — v9.7.0
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

const CATEGORY_FILE_MAP: Record<string, string[]> = {
  tool_latency:       ["tools/webSearch.ts", "tools/selfDiagnoseTools.ts", "reactEngine.ts"],
  memory:             ["memory.ts", "contextCompression.ts", "episodicMemory.ts"],
  code_execution:     ["selfImprove.ts", "selfImproveGuard.ts", "autoRebuild.ts"],
  llm_latency:        ["llm.ts", "manifest.ts", "multiModelRouter.ts"],
  startup:            ["_core/index.ts", "_core/initModules.ts", "_core/initDaemons.ts"],
  reasoning:          ["reactEngine.ts", "aiPlanning.ts", "taskPlanner.ts"],
  coding:             ["selfImprove.ts", "selfImproveGuard.ts", "codebaseAnalyzer.ts"],
  conversation:       ["manifest.ts", "contextBus.ts", "contextCompression.ts"],
  "tool-use":         ["reactEngine.ts", "tools/webSearch.ts", "browser.ts"],
  "self-improvement": ["selfImprove.ts", "continuousImprover.ts", "benchmarkRunner.ts"],
  "memory-recall":    ["memory.ts", "episodicMemory.ts"],
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

  // 1. Benchmark degradations
  try {
    const { getLastBenchmarkReport } = await import("./benchmarkRunner.js");
    const report = getLastBenchmarkReport();
    if (report && report.degradations.length > 0) {
      for (const deg of report.degradations) {
        const category = deg.benchmark.split("_")[0] as string;
        const files = CATEGORY_FILE_MAP[category] || [];
        for (const f of files) targetFiles.add(f);
        log.info(`Benchmark degradation: ${deg.benchmark} ${deg.degradationPercent.toFixed(1)}% → targeting ${files.length} files`);
      }
    }
  } catch (err: any) {
    log.warn("Could not read benchmark report:", err.message);
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
    const { analyzeAndPropose } = await import("./selfImprove.js");
    const serverDir = path.resolve(process.cwd(), "server");

    for (const relFile of targetFiles) {
      const absFile = path.join(serverDir, relFile);
      if (!fs.existsSync(absFile)) {
        log.warn(`Target file not found: ${absFile}`);
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
