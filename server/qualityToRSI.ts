/**
 * qualityToRSI.ts — v9.7.1
 *
 * Bridges the code quality monitor and doc generator to the RSI proposal queue.
 */

import { createLogger } from "./logger.js";
import path from "path";

const log = createLogger("qualityToRSI");

// v9.8.2: Pre-check against the selfImprove allowlist before calling analyzeAndPropose.
// This eliminates the noisy "File X is not in the list of analyzable files" warnings
// that appear every cycle when codeQualityMonitor or docGenerator returns files that
// selfImprove.ts will immediately reject.
let _analyzableFiles: Set<string> | null = null;
async function getAnalyzableFileSet(): Promise<Set<string>> {
  if (_analyzableFiles) return _analyzableFiles;
  try {
    const module = await import("./selfImprove.js") as { getAnalyzableFiles?: () => string[] };
    if (typeof module.getAnalyzableFiles === "function") {
      _analyzableFiles = new Set(module.getAnalyzableFiles().map((f: string) => path.basename(f)));
      return _analyzableFiles;
    }
  } catch { /* fallback below */ }
  // Fallback: hardcoded list mirrors selfImprove.ts ANALYZABLE_FILES
  _analyzableFiles = new Set([
    "ai.ts", "grounding.ts", "browser.ts", "workspace.ts", "memory.ts",
    "multiAgent.ts", "biasDetector.ts", "codeIntel.ts", "streamRouter.ts",
    "selfImprove.ts", "reactEngine.ts", "llmProvider.ts", "contextManager.ts",
    "adaptiveRouter.ts", "selfConsistency.ts", "contextBus.ts", "manifest.ts",
  ]);
  return _analyzableFiles;
}

let _lastQualityFeedAt = 0;
let _lastDocFeedAt = 0;
const QUALITY_FEED_COOLDOWN_MS = 60 * 60 * 1000;
const DOC_FEED_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_QUALITY_PROPOSALS_PER_RUN = 5;
const MAX_DOC_PROPOSALS_PER_RUN = 3;

export async function feedQualityToRSI(): Promise<number> {
  const now = Date.now();
  if (now - _lastQualityFeedAt < QUALITY_FEED_COOLDOWN_MS) return 0;
  _lastQualityFeedAt = now;

  let submitted = 0;
  try {
    const { getLastQualityReport } = await import("./codeQualityMonitor.js");
    const report = getLastQualityReport();
    if (!report || typeof report !== 'object' || !Array.isArray(report.refactoringProposals) || report.refactoringProposals.length === 0) return 0;

    const sorted = [...report.refactoringProposals]
      .filter(p => p.severity === "high" || p.severity === "medium")
      .sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1))
      .slice(0, MAX_QUALITY_PROPOSALS_PER_RUN);

let _analyzeAndPropose: typeof import("./selfImprove.js").analyzeAndPropose | null = null;
async function getAnalyzeAndPropose() {
  if (_analyzeAndPropose) return _analyzeAndPropose;
  const module = await import("./selfImprove.js");
  _analyzeAndPropose = module.analyzeAndPropose;
  return _analyzeAndPropose;
}

// ... later in the code:
    const [analyzeAndPropose, allowlist] = await Promise.all([
      getAnalyzeAndPropose(),
      getAnalyzableFileSet()
    ]);
    for (const qp of sorted) {
      // Validate and normalize file paths to prevent path traversal
      if (!qp.filePath || typeof qp.filePath !== 'string') {
        log.warn(`Invalid filePath in quality proposal: ${qp.filePath}`);
        continue;
      }
      const normalizedPath = qp.filePath
        .replace(/\\/g, "/")
        .replace(/^server\//, "")
        .replace(/\.\.\//g, ""); // Remove path traversal attempts
      if (normalizedPath.startsWith("/") || normalizedPath.includes(":")) {
        log.warn(`Rejected absolute path in quality proposal: ${qp.filePath}`);
        continue;
      }
      const basename = path.basename(normalizedPath);
      // v9.8.2: Skip files not in the selfImprove allowlist to avoid noisy warnings
      if (!allowlist.has(basename)) {
        log.info(`Skipping quality proposal for ${basename} — not in RSI allowlist`);
        continue;
      }
      try {
        await analyzeAndPropose(normalizedPath);
        submitted++;
        log.info(`Quality-driven proposal: ${qp.type} in ${normalizedPath} (${qp.severity})`);
      } catch (err: any) {
        log.warn(`Failed quality proposal for ${normalizedPath}:`, err.message);
      }
    }
  } catch (err: any) {
    log.warn("feedQualityToRSI failed:", err.message);
  }
  return submitted;
}

export async function feedDocGapsToRSI(): Promise<number> {
  const now = Date.now();
  if (now - _lastDocFeedAt < DOC_FEED_COOLDOWN_MS) return 0;
  _lastDocFeedAt = now;

  let submitted = 0;
  try {
    const { getLastDocReport } = await import("./docGenerator.js");
    const report = getLastDocReport();
    if (!report || report.undocumentedExports.length === 0) return 0;

    const fileCounts = new Map<string, number>();
    for (const ue of report.undocumentedExports) {
      fileCounts.set(ue.filePath, (fileCounts.get(ue.filePath) || 0) + 1);
    }

    const topFiles = Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DOC_PROPOSALS_PER_RUN)
      .map(([filePath]) => filePath);

    const { analyzeAndPropose } = await import("./selfImprove.js");
    const allowlist = await getAnalyzableFileSet();
    for (const filePath of topFiles) {
      // Normalize Windows backslash paths and strip leading "server\" or "server/" prefix
      const normalizedPath = filePath
        .replace(/\\/g, "/")
        .replace(/^server\//, "");
      const basename = path.basename(normalizedPath);
      // v9.8.2: Skip files not in the selfImprove allowlist to avoid noisy warnings
      if (!allowlist.has(basename)) {
        log.info(`Skipping doc proposal for ${basename} — not in RSI allowlist`);
        continue;
      }
      try {
        await analyzeAndPropose(normalizedPath);
        submitted++;
        log.info(`Doc-gap proposal for: ${normalizedPath} (${fileCounts.get(filePath)} missing JSDoc)`);
      } catch (err: any) {
        log.warn(`Failed doc proposal for ${normalizedPath}:`, err.message);
      }
    }
  } catch (err: any) {
    log.warn("feedDocGapsToRSI failed:", err.message);
  }
  return submitted;
}

export async function runQualityToRSI(): Promise<{ qualityProposals: number; docProposals: number }> {
  const [qualityProposals, docProposals] = await Promise.all([
    feedQualityToRSI(),
    feedDocGapsToRSI(),
  ]);
  return { qualityProposals, docProposals };
}
