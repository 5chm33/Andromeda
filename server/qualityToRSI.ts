/**
 * qualityToRSI.ts — v9.7.0
 *
 * Bridges the code quality monitor and doc generator to the RSI proposal queue.
 */

import { createLogger } from "./logger.js";

const log = createLogger("qualityToRSI");

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
    if (!report || report.refactoringProposals.length === 0) return 0;

    const sorted = [...report.refactoringProposals]
      .filter(p => p.severity === "high" || p.severity === "medium")
      .sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1))
      .slice(0, MAX_QUALITY_PROPOSALS_PER_RUN);

    const { analyzeAndPropose } = await import("./selfImprove.js");
    for (const qp of sorted) {
      try {
        await analyzeAndPropose(qp.filePath);
        submitted++;
        log.info(`Quality-driven proposal: ${qp.type} in ${qp.filePath} (${qp.severity})`);
      } catch (err: any) {
        log.warn(`Failed quality proposal for ${qp.filePath}:`, err.message);
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
    for (const filePath of topFiles) {
      try {
        await analyzeAndPropose(filePath);
        submitted++;
        log.info(`Doc-gap proposal for: ${filePath} (${fileCounts.get(filePath)} missing JSDoc)`);
      } catch (err: any) {
        log.warn(`Failed doc proposal for ${filePath}:`, err.message);
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
