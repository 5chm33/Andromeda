/**
 * initDaemons.ts — v13.0.0
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Starts all background analysis and monitoring daemons after the server is listening.
 * Called from within the server.listen() callback.
 *
 * v12.13.0: Wire initWatchdog() — module health watchdog now starts at boot.
 * v13.0.0:  Wire three new SOTA systems at boot:
 *   1. initSemanticCodebaseGraph() — AST-level symbol graph for impact radius proofs
 *   2. initMultiAgentDebate()      — upstream debate protocol with RLAIF weight persistence
 *   3. initChaosEngineer()         — fault injection + resilience scoring (smoke test at boot)
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
import { initWatchdog } from "../watchdog";
import { initSemanticCodebaseGraph } from "../semanticCodebaseGraph";
import { initMultiAgentDebate } from "../multiAgentDebate";
import { initChaosEngineer } from "../chaosEngineer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Start all background daemons. Called after server.listen() succeeds.
 */
export function startDaemons(): void {
  // v5.75: Generate ANDROMEDA.md — grounds the model in actual file structure
  try {
    const serverDir = resolve(__dirname, "..");
    const workspaceDir = resolve(process.cwd(), "workspace");
    generateAndromedaMd(serverDir, workspaceDir);
  } catch { /* non-fatal */ }

  // v5.68: Seed foundational memories on first boot
  try { seedInitialMemoriesIfEmpty(); } catch { /* non-fatal */ }

  // v7.1: Start all SOTA autonomy daemons
  try {
    initPersistentContextStore();
    startContextCompressionDaemon();
    startCodebaseAnalyzer();
    startDependencyAuditor();
    startTestCoverageAnalyzer();
    startBenchmarkRunner();
    startCodeQualityMonitor();
    startDocGenerator();
    startSelfReflectionEngine();
    startMemoryForgettingCurveDaemon();
    startCapabilityDiscovery();
    // Initialize prompt engineer stats (event-driven, no daemon needed)
    getPromptStats();
    console.log("[v7.1] All autonomy daemons started successfully");
  } catch (daemonErr) {
    console.warn("[v7.1] Some daemons failed to start:", (daemonErr as Error).message);
  }

  // v12.13.0: Start module health watchdog — monitors all critical modules for health degradation
  try {
    initWatchdog();
    console.log("[v12.13.0] Module health watchdog started");
  } catch (wdErr) {
    console.warn("[v12.13.0] Watchdog failed to start:", (wdErr as Error).message);
  }

  // v13.0.0: Semantic Codebase Graph — builds AST-level symbol graph for impact radius proofs
  // Runs asynchronously in the background (non-blocking) to avoid delaying server startup.
  try {
    const projectRoot = resolve(__dirname, "..", "..");
    initSemanticCodebaseGraph(projectRoot);
    console.log("[v13.0.0] Semantic codebase graph initializing (background)");
  } catch (scgErr) {
    console.warn("[v13.0.0] Semantic codebase graph failed to start:", (scgErr as Error).message);
  }

  // v13.0.0: Multi-Agent Debate Protocol — loads persisted RLAIF weights and initializes agents
  try {
    initMultiAgentDebate();
    console.log("[v13.0.0] Multi-agent debate protocol initialized");
  } catch (madErr) {
    console.warn("[v13.0.0] Multi-agent debate failed to start:", (madErr as Error).message);
  }

  // v13.0.0: Chaos Engineer — runs a quick smoke test at boot to verify core resilience
  // Full chaos runs are scheduled every 24 hours.
  try {
    initChaosEngineer({
      runImmediately: true,  // Quick smoke test: circuit breaker + stream + JSON tests
      intervalHours: 24,     // Full chaos run every 24 hours
    });
    console.log("[v13.0.0] Chaos engineer initialized (smoke test queued)");
  } catch (ceErr) {
    console.warn("[v13.0.0] Chaos engineer failed to start:", (ceErr as Error).message);
  }
}
