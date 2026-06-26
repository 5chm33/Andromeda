/**
 * rsi_benchmark.mjs — 1-hour live RSI benchmark harness v2
 *
 * Fires real RSI cycles against the running Andromeda server using
 * authenticated admin endpoints and measures actual commit success rates.
 *
 * Usage: node scripts/rsi_benchmark.mjs [durationMinutes=60]
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";
const ADMIN_KEY = process.env.ANDROMEDA_ADMIN_KEY ?? "4c7f6518277d0b2cc339d6a44dc0a890aec70b98f0afbe8b";
const DURATION_MINUTES = parseInt(process.argv[2] ?? "60", 10);
const DURATION_MS = DURATION_MINUTES * 60 * 1000;
const POLL_INTERVAL_MS = 8_000;
const RSI_TRIGGER_INTERVAL_MS = 90_000; // Trigger every 90s to allow full cycle completion

// ─── Metrics ──────────────────────────────────────────────────────────────────
const metrics = {
  startTime: Date.now(),
  rsiCyclesTriggered: 0,
  cycleHistory: [],
  proposalSnapshots: [],
  seenProposalIds: new Set(),
  proposalsGenerated: 0,
  proposalsApplied: 0,
  proposalsRejected: 0,
  proposalsPending: 0,
  commitSuccesses: 0,
  commitFailures: 0,
  healAttempts: 0,
  healSuccesses: 0,
  criticScores: [],
  madDebateImprovements: 0,
  hitlGateActivations: 0,
  conflictDetections: 0,
  invariantViolations: 0,
  dryRunFailures: 0,
  rollbacks: 0,
  mctsActivations: 0,
  rlaifBroadcasts: 0,
  snapshotsCreated: 0,
  costUsd: 0,
  apiCallCount: 0,
  errors: [],
};

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${ADMIN_KEY}`,
};

async function get(path) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    metrics.errors.push(`GET ${path}: ${e.message}`);
    return null;
  }
}

async function post(path, body = {}) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    metrics.errors.push(`POST ${path}: ${e.message}`);
    return null;
  }
}

// ─── Data collection ──────────────────────────────────────────────────────────
async function triggerRsiCycle() {
  const result = await post("/api/rsi/scheduler/trigger");
  if (result?.started) {
    metrics.rsiCyclesTriggered++;
    return true;
  }
  return false;
}

async function collectRsiStatus() {
  const status = await get("/api/rsi/status");
  if (!status) return;

  // Update cost tracking
  if (status.costStats) {
    metrics.costUsd = status.costStats.totalCostUsd ?? 0;
    metrics.apiCallCount = status.costStats.callCount ?? 0;
  }

  // Collect cycle history
  if (Array.isArray(status.recentCycles) && status.recentCycles.length > 0) {
    for (const cycle of status.recentCycles) {
      const existing = metrics.cycleHistory.find(c => c.startedAt === cycle.startedAt);
      if (!existing) {
        metrics.cycleHistory.push(cycle);
        // Extract heal stats from cycle
        if (cycle.healAttempts) metrics.healAttempts += cycle.healAttempts;
        if (cycle.healSuccesses) metrics.healSuccesses += cycle.healSuccesses;
        if (cycle.snapshotsCreated) metrics.snapshotsCreated += cycle.snapshotsCreated;
      }
    }
  }
}

async function collectProposals() {
  const data = await get("/api/self/proposals");
  if (!data?.proposals) return;

  for (const p of data.proposals) {
    if (metrics.seenProposalIds.has(p.id)) {
      // Update existing proposal status
      const snap = metrics.proposalSnapshots.find(s => s.id === p.id);
      if (snap && snap.status !== p.status) {
        snap.status = p.status;
        // Update counters when status changes
        if (p.status === "applied" || p.status === "committed") {
          metrics.commitSuccesses++;
          metrics.proposalsApplied++;
        } else if (p.status === "rejected" || p.status === "failed" || p.status === "auto-rolled-back") {
          metrics.commitFailures++;
          metrics.proposalsRejected++;
          if (p.status === "auto-rolled-back") metrics.rollbacks++;
        }
      }
      continue;
    }

    // New proposal
    metrics.seenProposalIds.add(p.id);
    metrics.proposalsGenerated++;
    metrics.proposalSnapshots.push({ id: p.id, status: p.status, file: p.targetFile ?? p.file ?? "unknown" });

    // Extract SOTA module metrics
    if (typeof p._criticScore === "number") metrics.criticScores.push(p._criticScore);
    if (typeof p._criticConfidence === "number") metrics.criticScores.push(p._criticConfidence);
    if (p._madDebateResult?.improved === true) metrics.madDebateImprovements++;
    if (p._mctsUsed === true || p._mctsResult?.activated === true) metrics.mctsActivations++;
    if (p.status === "pending_human_review") metrics.hitlGateActivations++;
    if (p._invariantResult?.violations?.length > 0) metrics.invariantViolations += p._invariantResult.violations.length;
    if (p._dryRunResult?.passed === false) metrics.dryRunFailures++;
    if (p._conflictResult?.hasConflicts === true) metrics.conflictDetections++;

    // Count initial status
    if (p.status === "applied" || p.status === "committed") {
      metrics.commitSuccesses++;
      metrics.proposalsApplied++;
    } else if (p.status === "rejected" || p.status === "failed" || p.status === "auto-rolled-back") {
      metrics.commitFailures++;
      metrics.proposalsRejected++;
      if (p.status === "auto-rolled-back") metrics.rollbacks++;
    } else {
      metrics.proposalsPending++;
    }
  }
}

async function collectRlhfStats() {
  const weights = await get("/api/rsi/model-weights");
  if (weights?.totalUpdates) {
    metrics.rlaifBroadcasts = Math.max(metrics.rlaifBroadcasts, weights.totalUpdates);
  }
}

async function collectBenchmarkTrend() {
  const trend = await get("/api/rsi/benchmark/trend?limit=100");
  return trend?.trend ?? [];
}

// ─── Report ───────────────────────────────────────────────────────────────────
function computeGrade(rate) {
  if (isNaN(rate)) return { grade: "PENDING", note: "Insufficient data — cycles still running" };
  if (rate >= 99) return { grade: "A++", note: "SOTA target achieved: 99%+ commit success rate" };
  if (rate >= 97) return { grade: "A+", note: "Near-perfect: 97%+ commit success rate" };
  if (rate >= 95) return { grade: "A+", note: "Excellent: 95%+ commit success rate" };
  if (rate >= 90) return { grade: "A",  note: "Strong: 90%+ commit success rate" };
  if (rate >= 85) return { grade: "A-", note: "Good: 85%+ commit success rate" };
  if (rate >= 80) return { grade: "B+", note: "Above average: 80%+ commit success rate" };
  return { grade: "B", note: `${rate.toFixed(1)}% commit success rate` };
}

function buildReport(elapsed) {
  const totalDecided = metrics.commitSuccesses + metrics.commitFailures;
  const commitRate = totalDecided > 0 ? metrics.commitSuccesses / totalDecided * 100 : NaN;
  const healRate = metrics.healAttempts > 0 ? metrics.healSuccesses / metrics.healAttempts * 100 : NaN;
  const avgCritic = metrics.criticScores.length > 0
    ? metrics.criticScores.reduce((a, b) => a + b, 0) / metrics.criticScores.length
    : NaN;

  return {
    meta: {
      version: "12.12.0",
      benchmarkDate: new Date().toISOString(),
      durationMinutes: elapsed.toFixed(1),
      targetDurationMinutes: DURATION_MINUTES,
    },
    rsiActivity: {
      cyclesTriggered: metrics.rsiCyclesTriggered,
      cyclesCompleted: metrics.cycleHistory.length,
      apiCallCount: metrics.apiCallCount,
      totalCostUsd: metrics.costUsd.toFixed(6),
    },
    proposalMetrics: {
      generated: metrics.proposalsGenerated,
      applied: metrics.proposalsApplied,
      rejected: metrics.proposalsRejected,
      pending: metrics.proposalsPending,
    },
    successRates: {
      commitSuccessRate: isNaN(commitRate) ? "N/A" : `${commitRate.toFixed(1)}%`,
      commitSuccessRateRaw: isNaN(commitRate) ? null : commitRate,
      commitSuccesses: metrics.commitSuccesses,
      commitFailures: metrics.commitFailures,
      healSuccessRate: isNaN(healRate) ? "N/A" : `${healRate.toFixed(1)}%`,
      healAttempts: metrics.healAttempts,
      healSuccesses: metrics.healSuccesses,
    },
    sotaModuleActivity: {
      avgCriticScore: isNaN(avgCritic) ? "N/A" : avgCritic.toFixed(3),
      criticScoresSampled: metrics.criticScores.length,
      madDebateImprovements: metrics.madDebateImprovements,
      mctsActivations: metrics.mctsActivations,
      hitlGateActivations: metrics.hitlGateActivations,
      conflictDetections: metrics.conflictDetections,
      invariantViolations: metrics.invariantViolations,
      dryRunFailures: metrics.dryRunFailures,
      rollbacks: metrics.rollbacks,
      snapshotsCreated: metrics.snapshotsCreated,
      rlaifBroadcasts: metrics.rlaifBroadcasts,
    },
    grade: computeGrade(commitRate),
    errors: metrics.errors.slice(0, 20),
  };
}

// ─── Main loop ────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(70)}`);
console.log(`  ANDROMEDA v12.12.0 — LIVE RSI BENCHMARK`);
console.log(`  Duration: ${DURATION_MINUTES} minutes`);
console.log(`  Start: ${new Date().toISOString()}`);
console.log(`  End:   ${new Date(Date.now() + DURATION_MS).toISOString()}`);
console.log(`${"=".repeat(70)}\n`);

const health = await get("/health");
if (!health?.ok) {
  console.error("❌ Server not responding at http://localhost:3000");
  process.exit(1);
}
console.log(`✅ Server healthy: v${health.version}\n`);

const startTime = Date.now();
let lastTrigger = 0;
let lastStatusPrint = 0;
const STATUS_INTERVAL = 60_000;

// Trigger first cycle immediately
await triggerRsiCycle();
lastTrigger = Date.now();
console.log(`[0.0m] First RSI cycle triggered. Monitoring...\n`);

while (Date.now() - startTime < DURATION_MS) {
  const now = Date.now();

  // Trigger new cycles at intervals
  if (now - lastTrigger >= RSI_TRIGGER_INTERVAL_MS) {
    const ok = await triggerRsiCycle();
    if (ok) console.log(`[${((now - startTime)/60000).toFixed(1)}m] RSI cycle #${metrics.rsiCyclesTriggered} triggered`);
    lastTrigger = now;
  }

  // Collect all metrics
  await collectRsiStatus();
  await collectProposals();
  await collectRlhfStats();

  // Print status every minute
  if (now - lastStatusPrint >= STATUS_INTERVAL) {
    const elapsed = (now - startTime) / 60000;
    const totalDecided = metrics.commitSuccesses + metrics.commitFailures;
    const rate = totalDecided > 0 ? (metrics.commitSuccesses / totalDecided * 100).toFixed(1) : "N/A";
    console.log(`[${elapsed.toFixed(1)}m] Generated: ${metrics.proposalsGenerated} | Applied: ${metrics.proposalsApplied} | Rejected: ${metrics.commitFailures} | Rate: ${rate}% | Cost: $${metrics.costUsd.toFixed(4)}`);
    lastStatusPrint = now;
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
}

// Final collection pass
await collectRsiStatus();
await collectProposals();
await collectRlhfStats();

const elapsed = (Date.now() - startTime) / 60000;
const report = buildReport(elapsed);
const trend = await collectBenchmarkTrend();
report.benchmarkTrend = trend;

// Save report
const reportPath = join(__dirname, "../workspace/benchmark_report_v12.12.0.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log(`\n${"=".repeat(70)}`);
console.log(`  BENCHMARK COMPLETE — ${elapsed.toFixed(1)} minutes`);
console.log(`${"=".repeat(70)}`);
console.log(`  RSI Cycles Triggered:  ${report.rsiActivity.cyclesTriggered}`);
console.log(`  RSI Cycles Completed:  ${report.rsiActivity.cyclesCompleted}`);
console.log(`  Proposals Generated:   ${report.proposalMetrics.generated}`);
console.log(`  Proposals Applied:     ${report.proposalMetrics.applied}`);
console.log(`  Proposals Rejected:    ${report.proposalMetrics.rejected}`);
console.log(`  Proposals Pending:     ${report.proposalMetrics.pending}`);
console.log(`${"─".repeat(70)}`);
console.log(`  Commit Success Rate:   ${report.successRates.commitSuccessRate}`);
console.log(`  Heal Success Rate:     ${report.successRates.healSuccessRate}`);
console.log(`  Avg Critic Score:      ${report.sotaModuleActivity.avgCriticScore}`);
console.log(`  Total API Cost:        $${report.rsiActivity.totalCostUsd}`);
console.log(`${"─".repeat(70)}`);
console.log(`  SOTA Module Activity:`);
console.log(`    MAD Debate Improvements:  ${report.sotaModuleActivity.madDebateImprovements}`);
console.log(`    MCTS Activations:         ${report.sotaModuleActivity.mctsActivations}`);
console.log(`    HITL Gate Activations:    ${report.sotaModuleActivity.hitlGateActivations}`);
console.log(`    Conflict Detections:      ${report.sotaModuleActivity.conflictDetections}`);
console.log(`    Invariant Violations:     ${report.sotaModuleActivity.invariantViolations}`);
console.log(`    Dry Run Failures:         ${report.sotaModuleActivity.dryRunFailures}`);
console.log(`    Rollbacks:                ${report.sotaModuleActivity.rollbacks}`);
console.log(`    RLAIF Broadcasts:         ${report.sotaModuleActivity.rlaifBroadcasts}`);
console.log(`${"=".repeat(70)}`);
console.log(`  FINAL GRADE: ${report.grade.grade}`);
console.log(`  ${report.grade.note}`);
console.log(`${"=".repeat(70)}`);
console.log(`\n  Report: ${reportPath}\n`);
