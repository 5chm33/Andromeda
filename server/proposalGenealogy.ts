/**
 * proposalGenealogy.ts — v17.0.0
 *
 * Tracks the full lineage of every proposal as a Directed Acyclic Graph (DAG).
 * Reveals systemic patterns that per-file pattern memory cannot see:
 *
 *   - "Proposals generated after a chaos test have 20% lower acceptance rate"
 *   - "Merged proposals have 15% higher acceptance rate than solo proposals"
 *   - "Proposals from the SecurityAuditor agent are rolled back 3x more than others"
 *   - "Files touched in the last 48h have 40% lower acceptance rate"
 *
 * The genealogy graph is persisted to disk and survives restarts.
 * It feeds into the epistemicBeliefModel and the proposalRanker.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProposalOutcome = "pending" | "applied" | "rejected" | "rolled_back" | "merged_into";

export interface GenealogyNode {
  /** Unique proposal ID */
  id: string;
  /** Target file */
  targetFile: string;
  /** RSI cycle that generated this proposal */
  cycleId: string;
  /** Agent persona that generated this proposal (if debate was run) */
  agentPersona?: string;
  /** IDs of proposals this was merged from (if this is a merged proposal) */
  mergedFrom: string[];
  /** ID of the proposal this was merged into (if this was consumed by a merge) */
  mergedInto?: string;
  /** ID of the rollback point created when this was applied */
  rollbackPointId?: string;
  /** Whether this was generated immediately after a chaos test */
  postChaosGeneration: boolean;
  /** Semantic safety score at generation time */
  semanticSafetyScore: number;
  /** Reward model score at generation time */
  rewardScore: number;
  /** Consensus result (reached/not reached) */
  consensusReached?: boolean;
  /** Final outcome */
  outcome: ProposalOutcome;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** ISO timestamp of outcome */
  outcomeAt?: string;
  /** Duration from generation to outcome in ms */
  lifetimeMs?: number;
  /** Reason for rejection or rollback */
  rejectionReason?: string;
}

export interface GenealogyStats {
  totalProposals: number;
  applied: number;
  rejected: number;
  rolledBack: number;
  merged: number;
  acceptanceRate: number;
  rollbackRate: number;
  /** Acceptance rate for proposals generated post-chaos */
  postChaosAcceptanceRate: number;
  /** Acceptance rate for merged proposals */
  mergedAcceptanceRate: number;
  /** Acceptance rate by agent persona */
  acceptanceByAgent: Record<string, { total: number; applied: number; rate: number }>;
  /** Files with the highest rollback rates */
  highRollbackFiles: Array<{ file: string; rollbacks: number; total: number; rate: number }>;
  /** Average lifetime from generation to outcome in ms */
  avgLifetimeMs: number;
}

export interface SystemicPattern {
  pattern: string;
  confidence: number;
  supportingEvidence: number;
  recommendation: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

const GENEALOGY_FILE = join(process.cwd(), "workspace", "proposal_genealogy.json");
const MAX_NODES = 5000; // Keep the last 5000 proposals in the DAG

let _nodes: Map<string, GenealogyNode> = new Map();
let _initialized = false;

// ─── Persistence ──────────────────────────────────────────────────────────────

function _loadGenealogy(): void {
  if (!existsSync(GENEALOGY_FILE)) return;
  try {
    const raw = readFileSync(GENEALOGY_FILE, "utf-8");
    const data = JSON.parse(raw) as GenealogyNode[];
    _nodes = new Map(data.map(n => [n.id, n]));
    log.info(`[proposalGenealogy] Loaded ${_nodes.size} nodes from disk`);
  } catch (err) {
    log.warn("[proposalGenealogy] Failed to load genealogy from disk:", err);
  }
}

function _saveGenealogy(): void {
  try {
    const data = Array.from(_nodes.values());
    // Keep only the most recent MAX_NODES
    const trimmed = data
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, MAX_NODES);
    writeFileSync(GENEALOGY_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    log.warn("[proposalGenealogy] Failed to save genealogy to disk:", err);
  }
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Initialize the genealogy tracker.
 */
export function initProposalGenealogy(): void {
  if (_initialized) return;
  _loadGenealogy();
  _initialized = true;
  log.info("[proposalGenealogy] Initialized");
}

/**
 * Record a new proposal being generated.
 */
export function recordProposalGenerated(params: {
  id: string;
  targetFile: string;
  cycleId: string;
  agentPersona?: string;
  mergedFrom?: string[];
  postChaosGeneration?: boolean;
  semanticSafetyScore?: number;
  rewardScore?: number;
}): void {
  const node: GenealogyNode = {
    id: params.id,
    targetFile: params.targetFile,
    cycleId: params.cycleId,
    agentPersona: params.agentPersona,
    mergedFrom: params.mergedFrom ?? [],
    postChaosGeneration: params.postChaosGeneration ?? false,
    semanticSafetyScore: params.semanticSafetyScore ?? 0,
    rewardScore: params.rewardScore ?? 0,
    outcome: "pending",
    generatedAt: new Date().toISOString(),
  };

  // If this is a merged proposal, mark the source proposals
  for (const sourceId of node.mergedFrom) {
    const source = _nodes.get(sourceId);
    if (source) {
      source.mergedInto = params.id;
      source.outcome = "merged_into";
      source.outcomeAt = node.generatedAt;
    }
  }

  _nodes.set(params.id, node);
  _saveGenealogy();
}

/**
 * Record the outcome of a proposal.
 */
export function recordProposalOutcome(
  proposalId: string,
  outcome: Exclude<ProposalOutcome, "pending" | "merged_into">,
  details?: {
    rollbackPointId?: string;
    rejectionReason?: string;
    consensusReached?: boolean;
  }
): void {
  const node = _nodes.get(proposalId);
  if (!node) {
    log.warn(`[proposalGenealogy] Unknown proposal ID: ${proposalId}`);
    return;
  }

  const now = new Date().toISOString();
  node.outcome = outcome;
  node.outcomeAt = now;
  node.lifetimeMs = Date.now() - new Date(node.generatedAt).getTime();

  if (details?.rollbackPointId) node.rollbackPointId = details.rollbackPointId;
  if (details?.rejectionReason) node.rejectionReason = details.rejectionReason;
  if (details?.consensusReached !== undefined) node.consensusReached = details.consensusReached;

  _nodes.set(proposalId, node);
  _saveGenealogy();
}

/**
 * Get a single genealogy node by proposal ID.
 */
export function getGenealogyNode(proposalId: string): GenealogyNode | undefined {
  return _nodes.get(proposalId);
}

/**
 * Get the full ancestor chain for a proposal (follows mergedFrom recursively).
 */
export function getAncestors(proposalId: string): GenealogyNode[] {
  const ancestors: GenealogyNode[] = [];
  const visited = new Set<string>();

  function walk(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const node = _nodes.get(id);
    if (!node) return;
    for (const parentId of node.mergedFrom) {
      const parent = _nodes.get(parentId);
      if (parent) {
        ancestors.push(parent);
        walk(parentId);
      }
    }
  }

  walk(proposalId);
  return ancestors;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * Compute comprehensive genealogy statistics.
 */
export function getGenealogyStats(): GenealogyStats {
  const nodes = Array.from(_nodes.values());
  const resolved = nodes.filter(n => n.outcome !== "pending" && n.outcome !== "merged_into");

  const applied = resolved.filter(n => n.outcome === "applied").length;
  const rejected = resolved.filter(n => n.outcome === "rejected").length;
  const rolledBack = resolved.filter(n => n.outcome === "rolled_back").length;
  const merged = nodes.filter(n => n.outcome === "merged_into").length;

  const total = resolved.length;
  const acceptanceRate = total === 0 ? 0 : applied / total;
  const rollbackRate = applied === 0 ? 0 : rolledBack / (applied + rolledBack);

  // Post-chaos acceptance rate
  const postChaos = resolved.filter(n => n.postChaosGeneration);
  const postChaosAcceptanceRate = postChaos.length === 0 ? 0 :
    postChaos.filter(n => n.outcome === "applied").length / postChaos.length;

  // Merged proposal acceptance rate
  const mergedProposals = resolved.filter(n => n.mergedFrom.length > 0);
  const mergedAcceptanceRate = mergedProposals.length === 0 ? 0 :
    mergedProposals.filter(n => n.outcome === "applied").length / mergedProposals.length;

  // Acceptance by agent persona
  const acceptanceByAgent: Record<string, { total: number; applied: number; rate: number }> = {};
  for (const node of resolved) {
    const agent = node.agentPersona ?? "unknown";
    if (!acceptanceByAgent[agent]) {
      acceptanceByAgent[agent] = { total: 0, applied: 0, rate: 0 };
    }
    acceptanceByAgent[agent].total++;
    if (node.outcome === "applied") acceptanceByAgent[agent].applied++;
  }
  for (const agent of Object.keys(acceptanceByAgent)) {
    const s = acceptanceByAgent[agent];
    s.rate = s.total === 0 ? 0 : s.applied / s.total;
  }

  // High rollback files
  const fileRollbacks: Record<string, { rollbacks: number; total: number }> = {};
  for (const node of resolved) {
    if (!fileRollbacks[node.targetFile]) {
      fileRollbacks[node.targetFile] = { rollbacks: 0, total: 0 };
    }
    fileRollbacks[node.targetFile].total++;
    if (node.outcome === "rolled_back") fileRollbacks[node.targetFile].rollbacks++;
  }
  const highRollbackFiles = Object.entries(fileRollbacks)
    .map(([file, s]) => ({ file, ...s, rate: s.total === 0 ? 0 : s.rollbacks / s.total }))
    .filter(f => f.rollbacks > 0)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);

  // Average lifetime
  const lifetimes = resolved.filter(n => n.lifetimeMs !== undefined).map(n => n.lifetimeMs!);
  const avgLifetimeMs = lifetimes.length === 0 ? 0 :
    lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length;

  return {
    totalProposals: nodes.length,
    applied,
    rejected,
    rolledBack,
    merged,
    acceptanceRate,
    rollbackRate,
    postChaosAcceptanceRate,
    mergedAcceptanceRate,
    acceptanceByAgent,
    highRollbackFiles,
    avgLifetimeMs,
  };
}

/**
 * Detect systemic patterns from the genealogy graph.
 * Returns actionable insights for the RSI engine.
 */
export function detectSystemicPatterns(): SystemicPattern[] {
  const stats = getGenealogyStats();
  const patterns: SystemicPattern[] = [];

  // Pattern 1: Post-chaos proposals underperform
  if (stats.postChaosAcceptanceRate < stats.acceptanceRate - 0.1 && stats.totalProposals > 20) {
    patterns.push({
      pattern: "post_chaos_underperformance",
      confidence: Math.min(0.95, (stats.acceptanceRate - stats.postChaosAcceptanceRate) * 5),
      supportingEvidence: Array.from(_nodes.values()).filter(n => n.postChaosGeneration).length,
      recommendation: "Add a 30-minute cooldown after chaos tests before generating proposals",
    });
  }

  // Pattern 2: Merged proposals outperform
  if (stats.mergedAcceptanceRate > stats.acceptanceRate + 0.05 && stats.merged > 5) {
    patterns.push({
      pattern: "merge_outperformance",
      confidence: Math.min(0.9, (stats.mergedAcceptanceRate - stats.acceptanceRate) * 10),
      supportingEvidence: stats.merged,
      recommendation: "Increase parallel proposal generation to create more merge opportunities",
    });
  }

  // Pattern 3: High rollback files
  for (const file of stats.highRollbackFiles.slice(0, 3)) {
    if (file.rate > 0.3 && file.total >= 3) {
      patterns.push({
        pattern: "high_rollback_file",
        confidence: Math.min(0.9, file.rate),
        supportingEvidence: file.total,
        recommendation: `Increase semantic safety threshold for ${file.file} to 0.9+`,
      });
    }
  }

  // Pattern 4: Agent persona underperformance
  for (const [agent, s] of Object.entries(stats.acceptanceByAgent)) {
    if (s.total >= 5 && s.rate < stats.acceptanceRate - 0.15) {
      patterns.push({
        pattern: `agent_underperformance_${agent}`,
        confidence: Math.min(0.85, (stats.acceptanceRate - s.rate) * 5),
        supportingEvidence: s.total,
        recommendation: `Reduce weight of ${agent} agent in debate protocol`,
      });
    }
  }

  return patterns.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Build a context string for injection into LLM prompts.
 * Summarizes systemic patterns relevant to the target file.
 */
export function buildGenealogyContext(targetFile: string): string {
  const nodes = Array.from(_nodes.values()).filter(n => n.targetFile === targetFile);
  if (nodes.length === 0) return "";

  const resolved = nodes.filter(n => n.outcome !== "pending" && n.outcome !== "merged_into");
  if (resolved.length === 0) return "";

  const applied = resolved.filter(n => n.outcome === "applied").length;
  const rolledBack = resolved.filter(n => n.outcome === "rolled_back").length;
  const fileRate = applied / resolved.length;

  const patterns = detectSystemicPatterns()
    .filter(p => p.pattern.includes("rollback") || p.pattern.includes("file"))
    .slice(0, 2);

  let ctx = `\n[Genealogy Context for ${targetFile}]\n`;
  ctx += `- ${resolved.length} past proposals: ${applied} applied, ${resolved.length - applied} rejected, ${rolledBack} rolled back\n`;
  ctx += `- File acceptance rate: ${(fileRate * 100).toFixed(0)}%\n`;

  if (rolledBack > 0) {
    const rollbackReasons = resolved
      .filter(n => n.outcome === "rolled_back" && n.rejectionReason)
      .map(n => n.rejectionReason!)
      .slice(0, 2);
    if (rollbackReasons.length > 0) {
      ctx += `- Recent rollback reasons: ${rollbackReasons.join("; ")}\n`;
    }
  }

  for (const p of patterns) {
    ctx += `- Systemic pattern: ${p.recommendation}\n`;
  }

  return ctx;
}

/**
 * Get the full genealogy graph as a list of nodes (for dashboard display).
 */
export function getGenealogyGraph(limit = 100): GenealogyNode[] {
  return Array.from(_nodes.values())
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, limit);
}
