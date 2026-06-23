/**
 * initDaemons.ts — v6.04
 *
 * Extracted from _core/index.ts (v6.03 refactor).
 * Starts all background analysis and monitoring daemons after the server is listening.
 * Called from within the server.listen() callback.
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
}
