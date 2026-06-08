/**
 * initDaemons.ts — v9.4.0
 *
 * Starts all background analysis and monitoring daemons after the server is listening.
 * Called from within the server.listen() callback.
 *
 * v9.4.0: Staggered startup — heavy analysis daemons are delayed by 2-10 minutes
 * to prevent event loop lag (previously all fired within the first 60 seconds,
 * causing sustained 2000ms+ event loop stalls detected by SelfHeal).
 *
 * Startup schedule (approximate):
 *   0s   — generateAndromedaMd, seedMemories, initPersistentContextStore, startContextCompressionDaemon
 *   2min — codebaseAnalyzer (was 5s)
 *   3min — testCoverageAnalyzer (was 15s)
 *   4min — codeQualityMonitor (was 20s)
 *   5min — dependencyAuditor (was 30s)
 *   6min — benchmarkRunner (was 60s)
 *   7min — docGenerator (was 45s)
 *   8min — selfReflectionEngine (was 5min — unchanged)
 *  15min — capabilityDiscovery (was 15min — unchanged)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { initPersistentContextStore } from "../persistentContextStore";
import { startContextCompressionDaemon } from "../contextCompressionDaemon";
import { startCodebaseAnalyzer } from "../codebaseAnalyzer";
import { startDependencyAuditor } from "../dependencyAuditor";
import { startTestCoverageAnalyzer } from "../testCoverageAnalyzer";
import { startBenchmarkRunner } from "../benchmarkRunner";
import { startCodeQualityMonitor } from "../codeQualityMonitor";
import { startDocGenerator } from "../docGenerator";
import { startSelfReflectionEngine } from "../selfReflectionEngine";
import { startMemoryForgettingCurveDaemon } from "../memoryForgettingCurve";
import { startCapabilityDiscovery } from "../capabilityDiscovery";
import { getPromptStats } from "../promptEngineer";
import { generateAndromedaMd } from "../andromedaMemoryWriter";
import { seedInitialMemoriesIfEmpty } from "../memory";
import { startKBConsolidationDaemon } from "../knowledgeBaseConsolidation";
import { startCapabilityBootstrapper } from "../capabilityBootstrapper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIN = 60_000;

/**
 * Start all background daemons. Called after server.listen() succeeds.
 * Heavy analysis daemons are staggered to avoid event loop saturation at startup.
 */
export function startDaemons(): void {
  // ── Immediate: lightweight init ──────────────────────────────────────────
  try {
    const serverDir = resolve(__dirname, "..");
    const workspaceDir = resolve(__dirname, "../../workspace");
    generateAndromedaMd(serverDir, workspaceDir);
  } catch { /* non-fatal */ }

  try { seedInitialMemoriesIfEmpty(); } catch { /* non-fatal */ }

  try {
    initPersistentContextStore();
    startContextCompressionDaemon();
    // Initialize prompt engineer stats (event-driven, no daemon needed)
    getPromptStats();
  } catch (err) {
    console.warn("[initDaemons] Lightweight init failed:", (err as Error).message);
  }

  // ── Staggered: heavy analysis daemons ────────────────────────────────────
  // Each daemon is given its own try/catch so one failure doesn't block others.

  setTimeout(() => {
    try { startCodebaseAnalyzer(); }
    catch (e) { console.warn("[initDaemons] codebaseAnalyzer failed to start:", (e as Error).message); }
  }, 2 * MIN);

  setTimeout(() => {
    try { startTestCoverageAnalyzer(); }
    catch (e) { console.warn("[initDaemons] testCoverageAnalyzer failed to start:", (e as Error).message); }
  }, 3 * MIN);

  setTimeout(() => {
    try { startCodeQualityMonitor(); }
    catch (e) { console.warn("[initDaemons] codeQualityMonitor failed to start:", (e as Error).message); }
  }, 4 * MIN);

  setTimeout(() => {
    try { startDependencyAuditor(); }
    catch (e) { console.warn("[initDaemons] dependencyAuditor failed to start:", (e as Error).message); }
  }, 5 * MIN);

  setTimeout(() => {
    try { startBenchmarkRunner(); }
    catch (e) { console.warn("[initDaemons] benchmarkRunner failed to start:", (e as Error).message); }
  }, 6 * MIN);

  setTimeout(() => {
    try { startDocGenerator(); }
    catch (e) { console.warn("[initDaemons] docGenerator failed to start:", (e as Error).message); }
  }, 7 * MIN);

  setTimeout(() => {
    try { startSelfReflectionEngine(); }
    catch (e) { console.warn("[initDaemons] selfReflectionEngine failed to start:", (e as Error).message); }
  }, 8 * MIN);

  setTimeout(() => {
    try { startMemoryForgettingCurveDaemon(); }
    catch (e) { console.warn("[initDaemons] memoryForgettingCurve failed to start:", (e as Error).message); }
  }, 10 * MIN);

  setTimeout(() => {
    try { startCapabilityDiscovery(); }
    catch (e) { console.warn("[initDaemons] capabilityDiscovery failed to start:", (e as Error).message); }
  }, 15 * MIN);

  // v9.5 Tier 3 #7: KB consolidation daemon — runs weekly, first check after 12h (see knowledgeBaseConsolidation.ts)
  setTimeout(() => {
    try { startKBConsolidationDaemon(); }
    catch (e) { console.warn("[initDaemons] kbConsolidation failed to start:", (e as Error).message); }
  }, 20 * MIN);

  // v9.5 Tier 3 #8: Capability bootstrapper — processes pending capability gaps every 2h (25min initial delay)
  setTimeout(() => {
    try { startCapabilityBootstrapper(); }
    catch (e) { console.warn("[initDaemons] capabilityBootstrapper failed to start:", (e as Error).message); }
  }, 25 * MIN);

  console.log("[v9.5] All autonomy daemons scheduled (staggered 2-20min to prevent event loop saturation)");
}
