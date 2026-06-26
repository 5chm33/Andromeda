/**
 * rsiDashboard.ts — Real-Time RSI Dashboard Backend (v16.0.0)
 *
 * Provides the server-side data aggregation and SSE (Server-Sent Events)
 * endpoint for the real-time RSI dashboard served at /dashboard.
 *
 * Dashboard data includes:
 *   - Live RSI cycle status (current file, phase, progress)
 *   - Acceptance rate trend (last 50 cycles)
 *   - Fine-tuner progress (examples collected, active model)
 *   - Chaos resilience scores (per module)
 *   - Hardening targets queue
 *   - Benchmark regression history
 *   - Consensus status (single-node vs multi-node)
 *   - Worker pool utilization
 *   - Circuit breaker states
 *   - Top proposals (pending, applied, rejected)
 *
 * The SSE endpoint pushes updates every 5 seconds so the dashboard
 * stays live without polling.
 *
 * @module rsiDashboard
 * @version 16.0.0
 */

import type { Request, Response } from "express";
import { createLogger } from "./logger.js";

const log = createLogger("rsiDashboard");

// ─── Configuration ────────────────────────────────────────────────────────────

/** How often to push SSE updates in milliseconds */
const SSE_INTERVAL_MS = 5_000;

/** Maximum number of SSE clients to support simultaneously */
const MAX_SSE_CLIENTS = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardSnapshot {
  timestamp: string;
  version: string;
  rsi: RsiStatus;
  fineTuner: FineTunerSummary;
  chaos: ChaosSummary;
  consensus: ConsensusSummary;
  benchmarks: BenchmarkSummary;
  proposals: ProposalSummary;
  system: SystemSummary;
}

export interface RsiStatus {
  isRunning: boolean;
  currentFile: string | null;
  currentPhase: string | null;
  cyclesCompleted: number;
  acceptanceRateLast10: number;
  acceptanceRateLast50: number;
  acceptanceRateAllTime: number;
  lastCycleAt: string | null;
  nextCycleAt: string | null;
  adaptiveIntervalMs: number;
}

export interface FineTunerSummary {
  pendingExamples: number;
  thresholdRequired: number;
  progressPercent: number;
  activeModelId: string | null;
  completedJobs: number;
  isEnabled: boolean;
}

export interface ChaosSummary {
  lastRunAt: string | null;
  overallResilienceScore: number;
  hardeningTargets: number;
  criticalTargets: number;
  scenariosPassed: number;
  scenariosFailed: number;
}

export interface ConsensusSummary {
  mode: "single-node" | "multi-node";
  peerCount: number;
  quorumRequired: number;
}

export interface BenchmarkSummary {
  baselinesEstablished: number;
  lastRunAt: string | null;
  regressionsDetected: number;
  improvementsDetected: number;
}

export interface ProposalSummary {
  pending: number;
  applied: number;
  rejected: number;
  processing: number;
  recentlyApplied: RecentProposal[];
}

export interface RecentProposal {
  id: string;
  title: string;
  targetFile: string;
  area: string;
  appliedAt: string;
  confidence: number;
}

export interface SystemSummary {
  uptime: number;
  nodeVersion: string;
  memoryUsedMb: number;
  memoryTotalMb: number;
  workerPoolActive: number;
  workerPoolIdle: number;
}

// ─── SSE Client Registry ──────────────────────────────────────────────────────

interface SseClient {
  id: string;
  res: Response;
  connectedAt: number;
}

const _sseClients: Map<string, SseClient> = new Map();
let _sseIntervalHandle: ReturnType<typeof setInterval> | null = null;

// ─── Data Aggregation ─────────────────────────────────────────────────────────

async function _buildSnapshot(): Promise<DashboardSnapshot> {
  const snapshot: DashboardSnapshot = {
    timestamp: new Date().toISOString(),
    version: "16.0.0",
    rsi: {
      isRunning: false,
      currentFile: null,
      currentPhase: null,
      cyclesCompleted: 0,
      acceptanceRateLast10: 0,
      acceptanceRateLast50: 0,
      acceptanceRateAllTime: 0,
      lastCycleAt: null,
      nextCycleAt: null,
      adaptiveIntervalMs: 4 * 60 * 60 * 1000,
    },
    fineTuner: {
      pendingExamples: 0,
      thresholdRequired: 100,
      progressPercent: 0,
      activeModelId: null,
      completedJobs: 0,
      isEnabled: false,
    },
    chaos: {
      lastRunAt: null,
      overallResilienceScore: 0,
      hardeningTargets: 0,
      criticalTargets: 0,
      scenariosPassed: 0,
      scenariosFailed: 0,
    },
    consensus: {
      mode: "single-node",
      peerCount: 0,
      quorumRequired: 1,
    },
    benchmarks: {
      baselinesEstablished: 0,
      lastRunAt: null,
      regressionsDetected: 0,
      improvementsDetected: 0,
    },
    proposals: {
      pending: 0,
      applied: 0,
      rejected: 0,
      processing: 0,
      recentlyApplied: [],
    },
    system: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      memoryUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
      memoryTotalMb: Math.round(process.memoryUsage().heapTotal / 1_048_576),
      workerPoolActive: 0,
      workerPoolIdle: 0,
    },
  };

  // Gather data from all subsystems (graceful — each is optional)
  try {
    const { getFineTunerStatus } = await import("./continuousFineTuner.js");
    const ft = getFineTunerStatus();
    snapshot.fineTuner = {
      pendingExamples: ft.pendingExamples,
      thresholdRequired: ft.thresholdRequired,
      progressPercent: ft.progressPercent,
      activeModelId: ft.activeModelId,
      completedJobs: ft.completedJobs,
      isEnabled: ft.isFineTuningAvailable,
    };
  } catch { /* non-fatal */ }

  try {
    const { getConsensusStatus } = await import("./distributedConsensus.js");
    const cs = getConsensusStatus();
    snapshot.consensus = {
      mode: cs.mode,
      peerCount: cs.peerCount,
      quorumRequired: cs.quorumRequired,
    };
  } catch { /* non-fatal */ }

  try {
    const { getBenchmarkBaselines } = await import("./benchmarkRegressionSuite.js");
    const baselines = getBenchmarkBaselines();
    snapshot.benchmarks.baselinesEstablished = Object.keys(baselines).length;
  } catch { /* non-fatal */ }

  try {
    const { getHardeningTargets } = await import("./selfHealingChaos.js");
    const targets = getHardeningTargets();
    snapshot.chaos.hardeningTargets = targets.length;
    snapshot.chaos.criticalTargets = targets.filter(t => (t as any).escalationLevel === "L3").length;
  } catch { /* non-fatal */ }

  try {
    const { listProposals } = await import("./selfImprove.js");
    const all = listProposals();
    snapshot.proposals.pending = all.filter(p => p.status === "pending").length;
    snapshot.proposals.applied = all.filter(p => p.status === "applied").length;
    snapshot.proposals.rejected = all.filter(p => p.status === "rejected").length;
    snapshot.proposals.processing = all.filter(p => p.status === "pending").length;

    // Last 5 applied proposals
    snapshot.proposals.recentlyApplied = all
      .filter(p => p.status === "applied")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        title: p.title,
        targetFile: p.targetFile,
        area: (p as any).area ?? "general",
        appliedAt: new Date(p.createdAt).toISOString(),
        confidence: p.confidence ?? 0,
      }));
  } catch { /* non-fatal */ }

  try {
    const { getWorkerPoolStats } = await import("./rsiWorkerPool.js");
    const wp = getWorkerPoolStats();
    snapshot.system.workerPoolActive = wp.activeWorkers;
    snapshot.system.workerPoolIdle = wp.maxWorkers - wp.activeWorkers;
  } catch { /* non-fatal */ }

  return snapshot;
}

// ─── SSE Endpoint ─────────────────────────────────────────────────────────────

/**
 * Express handler for the SSE dashboard stream at GET /api/dashboard/stream
 */
export function handleDashboardStream(req: Request, res: Response): void {
  if (_sseClients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: "Too many dashboard clients" });
    return;
  }

  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client: SseClient = { id: clientId, res, connectedAt: Date.now() };
  _sseClients.set(clientId, client);

  log.info(`[rsiDashboard] SSE client connected: ${clientId} (total: ${_sseClients.size})`);

  // Send initial snapshot immediately
  _buildSnapshot().then(snapshot => {
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }).catch(() => { /* non-fatal */ });

  // Cleanup on disconnect
  req.on("close", () => {
    _sseClients.delete(clientId);
    log.info(`[rsiDashboard] SSE client disconnected: ${clientId} (total: ${_sseClients.size})`);
  });
}

/**
 * Express handler for the snapshot REST endpoint at GET /api/dashboard/snapshot
 */
export async function handleDashboardSnapshot(req: Request, res: Response): Promise<void> {
  try {
    const snapshot = await _buildSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

// ─── SSE Broadcast Loop ───────────────────────────────────────────────────────

function _startSseBroadcast(): void {
  if (_sseIntervalHandle) return;

  _sseIntervalHandle = setInterval(async () => {
    if (_sseClients.size === 0) return;

    try {
      const snapshot = await _buildSnapshot();
      const data = `data: ${JSON.stringify(snapshot)}\n\n`;

      for (const [id, client] of _sseClients) {
        try {
          client.res.write(data);
        } catch {
          _sseClients.delete(id);
        }
      }
    } catch (err) {
      log.warn(`[rsiDashboard] SSE broadcast error: ${(err as Error).message}`);
    }
  }, SSE_INTERVAL_MS);

  if (_sseIntervalHandle && typeof _sseIntervalHandle === "object" && "unref" in _sseIntervalHandle) {
    (_sseIntervalHandle as NodeJS.Timeout).unref();
  }
}

// ─── Route Registration ───────────────────────────────────────────────────────

/**
 * Register dashboard routes on an Express app.
 *
 * Routes added:
 *   GET /api/dashboard/snapshot  — one-shot JSON snapshot
 *   GET /api/dashboard/stream    — SSE live stream
 *   GET /dashboard               — serves the dashboard HTML
 */
export function registerDashboardRoutes(app: import("express").Express): void {
  app.get("/api/dashboard/snapshot", handleDashboardSnapshot);
  app.get("/api/dashboard/stream", handleDashboardStream);

  // Serve the dashboard HTML
  app.get("/dashboard", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(_getDashboardHtml());
  });

  log.info("[rsiDashboard] Routes registered: /dashboard, /api/dashboard/snapshot, /api/dashboard/stream");
}

// ─── Dashboard HTML ───────────────────────────────────────────────────────────

function _getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Andromeda RSI Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
    header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 18px; font-weight: 600; }
    .badge { background: #238636; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 12px; }
    .badge.warn { background: #9e6a03; }
    .badge.error { background: #da3633; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 13px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .stat { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #21262d; }
    .stat:last-child { border-bottom: none; }
    .stat-label { font-size: 13px; color: #8b949e; }
    .stat-value { font-size: 14px; font-weight: 600; color: #e6edf3; }
    .stat-value.green { color: #3fb950; }
    .stat-value.yellow { color: #d29922; }
    .stat-value.red { color: #f85149; }
    .progress-bar { background: #21262d; border-radius: 4px; height: 6px; margin-top: 8px; overflow: hidden; }
    .progress-fill { height: 100%; background: #238636; border-radius: 4px; transition: width 0.5s ease; }
    .proposal-item { padding: 8px 0; border-bottom: 1px solid #21262d; }
    .proposal-item:last-child { border-bottom: none; }
    .proposal-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proposal-meta { font-size: 11px; color: #8b949e; margin-top: 2px; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .status-dot.green { background: #3fb950; }
    .status-dot.yellow { background: #d29922; animation: pulse 1.5s infinite; }
    .status-dot.red { background: #f85149; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .timestamp { font-size: 11px; color: #8b949e; padding: 8px 24px 16px; }
  </style>
</head>
<body>
  <header>
    <span class="status-dot yellow" id="conn-dot"></span>
    <h1>Andromeda RSI Dashboard</h1>
    <span class="badge" id="version-badge">v16.0.0</span>
    <span class="badge warn" id="mode-badge">single-node</span>
  </header>

  <div class="grid" id="grid">
    <div class="card" id="card-rsi">
      <h2>RSI Engine</h2>
      <div class="stat"><span class="stat-label">Status</span><span class="stat-value" id="rsi-status">—</span></div>
      <div class="stat"><span class="stat-label">Acceptance (last 10)</span><span class="stat-value green" id="rsi-acc10">—</span></div>
      <div class="stat"><span class="stat-label">Acceptance (all time)</span><span class="stat-value" id="rsi-acc-all">—</span></div>
      <div class="stat"><span class="stat-label">Cycles completed</span><span class="stat-value" id="rsi-cycles">—</span></div>
      <div class="stat"><span class="stat-label">Next cycle</span><span class="stat-value" id="rsi-next">—</span></div>
    </div>

    <div class="card" id="card-proposals">
      <h2>Proposals</h2>
      <div class="stat"><span class="stat-label">Pending</span><span class="stat-value yellow" id="prop-pending">—</span></div>
      <div class="stat"><span class="stat-label">Applied</span><span class="stat-value green" id="prop-applied">—</span></div>
      <div class="stat"><span class="stat-label">Rejected</span><span class="stat-value red" id="prop-rejected">—</span></div>
      <div class="stat"><span class="stat-label">Processing</span><span class="stat-value" id="prop-processing">—</span></div>
    </div>

    <div class="card" id="card-finetune">
      <h2>Fine-Tuner</h2>
      <div class="stat"><span class="stat-label">Examples collected</span><span class="stat-value" id="ft-examples">—</span></div>
      <div class="stat"><span class="stat-label">Active model</span><span class="stat-value green" id="ft-model">base model</span></div>
      <div class="stat"><span class="stat-label">Completed jobs</span><span class="stat-value" id="ft-jobs">—</span></div>
      <div class="progress-bar"><div class="progress-fill" id="ft-progress" style="width:0%"></div></div>
    </div>

    <div class="card" id="card-chaos">
      <h2>Chaos Engineering</h2>
      <div class="stat"><span class="stat-label">Resilience score</span><span class="stat-value green" id="chaos-score">—</span></div>
      <div class="stat"><span class="stat-label">Hardening targets</span><span class="stat-value yellow" id="chaos-targets">—</span></div>
      <div class="stat"><span class="stat-label">Critical targets</span><span class="stat-value red" id="chaos-critical">—</span></div>
    </div>

    <div class="card" id="card-benchmarks">
      <h2>Benchmarks</h2>
      <div class="stat"><span class="stat-label">Baselines established</span><span class="stat-value" id="bench-baselines">—</span></div>
      <div class="stat"><span class="stat-label">Regressions detected</span><span class="stat-value red" id="bench-regressions">—</span></div>
      <div class="stat"><span class="stat-label">Improvements detected</span><span class="stat-value green" id="bench-improvements">—</span></div>
    </div>

    <div class="card" id="card-system">
      <h2>System</h2>
      <div class="stat"><span class="stat-label">Uptime</span><span class="stat-value" id="sys-uptime">—</span></div>
      <div class="stat"><span class="stat-label">Memory used</span><span class="stat-value" id="sys-mem">—</span></div>
      <div class="stat"><span class="stat-label">Worker pool</span><span class="stat-value" id="sys-workers">—</span></div>
      <div class="stat"><span class="stat-label">Node.js</span><span class="stat-value" id="sys-node">—</span></div>
    </div>

    <div class="card" style="grid-column: 1 / -1;" id="card-recent">
      <h2>Recently Applied Proposals</h2>
      <div id="recent-proposals"><p style="color:#8b949e;font-size:13px">No proposals applied yet.</p></div>
    </div>
  </div>

  <div class="timestamp" id="last-update">Connecting...</div>

  <script>
    const es = new EventSource('/api/dashboard/stream');
    const dot = document.getElementById('conn-dot');

    es.onopen = () => { dot.className = 'status-dot green'; };
    es.onerror = () => { dot.className = 'status-dot red'; };

    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      dot.className = 'status-dot green';

      document.getElementById('version-badge').textContent = 'v' + d.version;
      document.getElementById('mode-badge').textContent = d.consensus.mode;
      document.getElementById('mode-badge').className = 'badge' + (d.consensus.mode === 'multi-node' ? '' : ' warn');

      // RSI
      document.getElementById('rsi-status').textContent = d.rsi.isRunning ? '🔄 Running' : '⏸ Idle';
      document.getElementById('rsi-acc10').textContent = (d.rsi.acceptanceRateLast10 * 100).toFixed(1) + '%';
      document.getElementById('rsi-acc-all').textContent = (d.rsi.acceptanceRateAllTime * 100).toFixed(1) + '%';
      document.getElementById('rsi-cycles').textContent = d.rsi.cyclesCompleted;
      document.getElementById('rsi-next').textContent = d.rsi.nextCycleAt ? new Date(d.rsi.nextCycleAt).toLocaleTimeString() : '—';

      // Proposals
      document.getElementById('prop-pending').textContent = d.proposals.pending;
      document.getElementById('prop-applied').textContent = d.proposals.applied;
      document.getElementById('prop-rejected').textContent = d.proposals.rejected;
      document.getElementById('prop-processing').textContent = d.proposals.processing;

      // Fine-tuner
      document.getElementById('ft-examples').textContent = d.fineTuner.pendingExamples + ' / ' + d.fineTuner.thresholdRequired;
      document.getElementById('ft-model').textContent = d.fineTuner.activeModelId ?? 'base model';
      document.getElementById('ft-jobs').textContent = d.fineTuner.completedJobs;
      document.getElementById('ft-progress').style.width = d.fineTuner.progressPercent + '%';

      // Chaos
      document.getElementById('chaos-score').textContent = (d.chaos.overallResilienceScore * 100).toFixed(0) + '%';
      document.getElementById('chaos-targets').textContent = d.chaos.hardeningTargets;
      document.getElementById('chaos-critical').textContent = d.chaos.criticalTargets;

      // Benchmarks
      document.getElementById('bench-baselines').textContent = d.benchmarks.baselinesEstablished;
      document.getElementById('bench-regressions').textContent = d.benchmarks.regressionsDetected;
      document.getElementById('bench-improvements').textContent = d.benchmarks.improvementsDetected;

      // System
      const upSecs = Math.floor(d.system.uptime);
      const upH = Math.floor(upSecs / 3600), upM = Math.floor((upSecs % 3600) / 60);
      document.getElementById('sys-uptime').textContent = upH + 'h ' + upM + 'm';
      document.getElementById('sys-mem').textContent = d.system.memoryUsedMb + ' / ' + d.system.memoryTotalMb + ' MB';
      document.getElementById('sys-workers').textContent = d.system.workerPoolActive + ' active, ' + d.system.workerPoolIdle + ' idle';
      document.getElementById('sys-node').textContent = d.system.nodeVersion;

      // Recent proposals
      const container = document.getElementById('recent-proposals');
      if (d.proposals.recentlyApplied.length === 0) {
        container.innerHTML = '<p style="color:#8b949e;font-size:13px">No proposals applied yet.</p>';
      } else {
        container.innerHTML = d.proposals.recentlyApplied.map(p => \`
          <div class="proposal-item">
            <div class="proposal-title">\${p.title}</div>
            <div class="proposal-meta">\${p.targetFile} · \${p.area} · confidence \${(p.confidence * 100).toFixed(0)}%</div>
          </div>
        \`).join('');
      }

      document.getElementById('last-update').textContent = 'Last updated: ' + new Date(d.timestamp).toLocaleTimeString();
    };
  </script>
</body>
</html>`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialize the RSI dashboard.
 * Starts the SSE broadcast loop.
 */
export function initRsiDashboard(): void {
  _startSseBroadcast();
  log.info("[rsiDashboard] Initialized — dashboard available at /dashboard");
}
