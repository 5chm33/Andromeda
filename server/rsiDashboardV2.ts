/**
 * rsiDashboardV2.ts — v19.0.0
 *
 * Calibration, genealogy, and consensus panels.
 *
 * This module extends the RSI dashboard to expose the new v18 and v19 systems.
 * It provides JSON endpoints that a frontend (e.g., React or plain HTML/JS)
 * can poll to render live charts and graphs.
 */

import { getCalibrationStats } from "./rewardCalibrator.js";
import { getGenealogyGraph } from "./proposalGenealogy.js";
import { getConsensusTopology, getLivePeers } from "./consensusConfig.js";
import { getRefinementStats } from "./genealogyGuidedGeneration.js";

export interface DashboardV2State {
  version: string;
  timestamp: number;
  
  // Reward Calibration (v18)
  calibration: {
    enabled: boolean;
    ece: number; // Expected Calibration Error
    plattA: number;
    plattB: number;
    samples: number;
    overconfidenceRate: number;
  };

  // Genealogy Guided Generation (v18)
  genealogy: {
    enabled: boolean;
    totalNodes: number;
    refinementContextsGenerated: number;
    avgRefinementImpact: number; // Acceptance rate when refinement was used
    graphSnapshot: any; // Serialized DAG for D3.js
  };

  // Consensus & Peer Health (v18)
  consensus: {
    mode: "single-node" | "distributed" | "degraded";
    activePeers: number;
    quorumRequired: number;
    peers: Array<{
      id: string;
      url: string;
      lastHeartbeat: number;
      latencyMs: number;
      isHealthy: boolean;
    }>;
  };
}

/**
 * Aggregates all v18/v19 subsystem states into a single dashboard payload.
 */
export function getDashboardV2State(): DashboardV2State {
  const calStats = getCalibrationStats();
  const refStats = getRefinementStats();
  const topology = getConsensusTopology();
  const peers = getLivePeers();
  const graph = getGenealogyGraph(); // Note: in a real huge repo, this might need pagination

  // Calculate some derived metrics
  const overconf = calStats.sampleCount > 0 
    ? (calStats.overconfidenceRate * calStats.sampleCount) / calStats.sampleCount 
    : 0;

  const avgImpact = refStats.totalRefinementsGenerated > 0 
    ? refStats.totalRefinementsAccepted / refStats.totalRefinementsGenerated 
    : 0;

  return {
    version: "19.0.0",
    timestamp: Date.now(),
    
    calibration: {
      enabled: true,
      ece: calStats.expectedCalibrationError,
      plattA: calStats.plattA,
      plattB: calStats.plattB,
      samples: calStats.sampleCount,
      overconfidenceRate: overconf
    },

    genealogy: {
      enabled: true,
      totalNodes: graph.length,
      refinementContextsGenerated: refStats.totalRefinementsGenerated,
      avgRefinementImpact: avgImpact,
      // For the dashboard, we only send the last 50 nodes to avoid massive payloads
      graphSnapshot: graph.slice(-50)
    },

    consensus: {
      mode: topology.healthyNodes >= topology.quorumSize ? 'distributed' : 'degraded',
      activePeers: topology.healthyNodes,
      quorumRequired: topology.quorumSize,
      peers: peers.map(p => ({
        id: p.url,
        url: p.url,
        lastHeartbeat: p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0,
        latencyMs: 0,
        isHealthy: p.healthy
      }))
    }
  };
}

/**
 * Helper to generate a simple HTML dashboard view for the new metrics.
 * This can be served directly by an Express route.
 */
export function renderDashboardV2Html(): string {
  const state = getDashboardV2State();
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Andromeda v19 RSI Dashboard</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-bottom: 2rem; }
    h2 { color: #94a3b8; font-size: 1.1rem; margin-top: 0; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
    .metric { font-size: 2rem; font-weight: bold; color: #f8fafc; margin: 0.5rem 0; }
    .sub-metric { color: #64748b; font-size: 0.9rem; }
    .status-healthy { color: #4ade80; }
    .status-degraded { color: #fbbf24; }
    .status-offline { color: #f87171; }
  </style>
</head>
<body>
  <h1>Andromeda v19.0.0 Dashboard</h1>
  
  <div class="grid">
    <!-- Calibration Card -->
    <div class="card">
      <h2>Reward Calibration (Platt)</h2>
      <div class="metric">${(state.calibration.ece * 100).toFixed(2)}% ECE</div>
      <div class="sub-metric">Expected Calibration Error over ${state.calibration.samples} samples</div>
      <div style="margin-top: 1rem; font-family: monospace; color: #94a3b8;">
        A: ${state.calibration.plattA.toFixed(4)}<br>
        B: ${state.calibration.plattB.toFixed(4)}<br>
        Overconfidence: ${(state.calibration.overconfidenceRate * 100).toFixed(1)}%
      </div>
    </div>

    <!-- Genealogy Card -->
    <div class="card">
      <h2>Genealogy Guidance</h2>
      <div class="metric">${(state.genealogy.avgRefinementImpact * 100).toFixed(1)}% Win Rate</div>
      <div class="sub-metric">When refinement brief is injected</div>
      <div style="margin-top: 1rem; color: #94a3b8;">
        Total Nodes: ${state.genealogy.totalNodes}<br>
        Briefs Generated: ${state.genealogy.refinementContextsGenerated}
      </div>
    </div>

    <!-- Consensus Card -->
    <div class="card">
      <h2>Consensus Topology</h2>
      <div class="metric ${state.consensus.mode === 'distributed' ? 'status-healthy' : 'status-degraded'}">
        ${state.consensus.mode.toUpperCase()}
      </div>
      <div class="sub-metric">${state.consensus.activePeers} active peers (Quorum: ${state.consensus.quorumRequired})</div>
      <div style="margin-top: 1rem; font-size: 0.9rem;">
        ${state.consensus.peers.map(p => 
          `<div>
            <span class="${p.isHealthy ? 'status-healthy' : 'status-offline'}">●</span> 
            ${p.url} (${0}ms)
          </div>`
        ).join('')}
      </div>
    </div>
  </div>
  
  <script>
    // Auto-refresh every 30s
    setTimeout(() => window.location.reload(), 30000);
  </script>
</body>
</html>
  `;
}
