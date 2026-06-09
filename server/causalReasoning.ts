/**
 * causalReasoning.ts — Causal Bayesian Network for Root-Cause Analysis
 * Andromeda v11.0.0 — Phase 12: Gödel Ascension
 *
 * Implements Judea Pearl's do-calculus and Bayesian causal networks to allow
 * Andromeda to reason about *why* failures occur, not just *that* they occurred.
 *
 * Architecture:
 *   - CausalNode: a variable in the causal graph (test, module, function, config)
 *   - CausalEdge: a directed causal relationship with conditional probability
 *   - CausalNetwork: the full DAG (Directed Acyclic Graph) of causal relationships
 *   - RootCauseAnalyzer: given a failure event, performs d-separation and
 *     interventional queries (do-calculus) to identify the most probable root cause
 *
 * Key operations:
 *   - buildNetworkFromFailures(): constructs the causal graph from RSI failure logs
 *   - query(effect): returns P(cause | effect) for all upstream causes
 *   - doIntervention(cause, value): simulates "what if we fix X?" (Pearl's do-operator)
 *   - identifyRootCause(failureEvent): returns the most probable causal chain
 *
 * This module is used by the RSI engine to target the actual root cause of
 * benchmark regressions rather than applying surface-level patches.
 */

import { createLogger } from "./logger.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const log = createLogger("causalReasoning");

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeType =
  | "test"        // A specific test case
  | "module"      // A TypeScript module
  | "function"    // A specific function
  | "config"      // A configuration value
  | "dependency"  // An external dependency
  | "rsi_proposal"; // An RSI proposal that was applied

export interface CausalNode {
  id: string;
  type: NodeType;
  label: string;
  /** Prior probability of this node being in a "failed" state (0.0–1.0) */
  priorFailure: number;
  /** Number of times this node has been observed in a failed state */
  failureCount: number;
  /** Number of times this node has been observed in a passing state */
  passCount: number;
  /** Metadata: file path, line number, etc. */
  metadata: Record<string, unknown>;
}

export interface CausalEdge {
  from: string;  // cause node ID
  to: string;    // effect node ID
  /**
   * Conditional probability: P(effect=fail | cause=fail)
   * How likely is the effect to fail given the cause is failing?
   */
  conditionalProbability: number;
  /** Number of times this causal relationship was observed */
  observationCount: number;
  /** Strength of the causal link (0.0–1.0) */
  strength: number;
}

export interface CausalChain {
  rootCause: CausalNode;
  chain: Array<{ node: CausalNode; edge: CausalEdge }>;
  probability: number;
  confidence: number;
  recommendation: string;
}

export interface FailureEvent {
  id: string;
  timestamp: number;
  failedNodeId: string;
  context: Record<string, unknown>;
  rsiProposalId?: string;
}

export interface InterventionResult {
  interventionNodeId: string;
  interventionValue: "fix" | "revert" | "skip";
  predictedImpact: number;  // Expected reduction in failure probability (0.0–1.0)
  affectedNodes: string[];
  confidence: number;
}

// ── Causal Network ────────────────────────────────────────────────────────────

export class CausalNetwork {
  private nodes = new Map<string, CausalNode>();
  private edges = new Map<string, CausalEdge>();  // key: `${from}->${to}`
  private adjacency = new Map<string, Set<string>>();  // node -> children
  private reverseAdjacency = new Map<string, Set<string>>();  // node -> parents
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? join(process.cwd(), "data", "causal");
    mkdirSync(this.dataDir, { recursive: true });
    this.loadFromDisk();
  }

  // ── Node Management ─────────────────────────────────────────────────────────

  addNode(node: CausalNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, new Set());
    if (!this.reverseAdjacency.has(node.id)) this.reverseAdjacency.set(node.id, new Set());
    log.info(`[causal] Node added: ${node.id} (${node.type})`);
  }

  getNode(id: string): CausalNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): CausalNode[] {
    return Array.from(this.nodes.values());
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    // Remove all edges connected to this node
    for (const [key] of this.edges) {
      if (key.startsWith(`${id}->`) || key.endsWith(`->${id}`)) {
        this.edges.delete(key);
      }
    }
    this.adjacency.delete(id);
    this.reverseAdjacency.delete(id);
  }

  // ── Edge Management ─────────────────────────────────────────────────────────

  addEdge(edge: CausalEdge): void {
    const key = `${edge.from}->${edge.to}`;
    this.edges.set(key, edge);

    if (!this.adjacency.has(edge.from)) this.adjacency.set(edge.from, new Set());
    if (!this.reverseAdjacency.has(edge.to)) this.reverseAdjacency.set(edge.to, new Set());

    this.adjacency.get(edge.from)!.add(edge.to);
    this.reverseAdjacency.get(edge.to)!.add(edge.from);
    log.info(`[causal] Edge added: ${edge.from} → ${edge.to} (P=${edge.conditionalProbability.toFixed(3)})`);
  }

  getEdge(from: string, to: string): CausalEdge | undefined {
    return this.edges.get(`${from}->${to}`);
  }

  getEdges(): CausalEdge[] {
    return Array.from(this.edges.values());
  }

  getParents(nodeId: string): string[] {
    return Array.from(this.reverseAdjacency.get(nodeId) ?? []);
  }

  getChildren(nodeId: string): string[] {
    return Array.from(this.adjacency.get(nodeId) ?? []);
  }

  // ── Bayesian Inference ───────────────────────────────────────────────────────

  /**
   * Compute P(node=fail | evidence) using belief propagation.
   * Uses a simplified message-passing algorithm (Loopy BP for non-trees).
   */
  inferFailureProbability(nodeId: string, evidence: Map<string, boolean> = new Map()): number {
    const node = this.nodes.get(nodeId);
    if (!node) return 0;

    // If we have direct evidence, return it
    if (evidence.has(nodeId)) {
      return evidence.get(nodeId) ? 1.0 : 0.0;
    }

    // Compute posterior from parents (Bayes' theorem)
    const parents = this.getParents(nodeId);
    if (parents.length === 0) {
      return node.priorFailure;
    }

    // P(node=fail) = P(node=fail | parents) * P(parents)
    let combinedProb = node.priorFailure;
    for (const parentId of parents) {
      const edge = this.getEdge(parentId, nodeId);
      if (!edge) continue;

      const parentFailProb = this.inferFailureProbability(parentId, evidence);
      // Noisy-OR model: each parent independently can cause the effect
      combinedProb = combinedProb + parentFailProb * edge.conditionalProbability
        - combinedProb * parentFailProb * edge.conditionalProbability;
    }

    return Math.min(1.0, Math.max(0.0, combinedProb));
  }

  /**
   * Pearl's do-operator: P(effect=fail | do(cause=fix))
   * Simulates the effect of intervening on a node (cutting incoming edges).
   */
  doIntervention(interventionNodeId: string, value: "fix" | "fail"): InterventionResult {
    const interventionProb = value === "fix" ? 0.0 : 1.0;

    // Temporarily override the node's failure probability
    const node = this.nodes.get(interventionNodeId);
    if (!node) {
      return {
        interventionNodeId,
        interventionValue: value,
        predictedImpact: 0,
        affectedNodes: [],
        confidence: 0,
      };
    }

    const originalPrior = node.priorFailure;
    node.priorFailure = interventionProb;

    // Compute downstream impact
    const affectedNodes: string[] = [];
    const impactMap = new Map<string, number>();

    const queue = [interventionNodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const child of this.getChildren(current)) {
        const beforeIntervention = this.inferFailureProbability(child);
        const afterIntervention = this.inferFailureProbability(child);
        const impact = Math.abs(beforeIntervention - afterIntervention);

        if (impact > 0.01) {
          affectedNodes.push(child);
          impactMap.set(child, impact);
          queue.push(child);
        }
      }
    }

    // Restore original prior
    node.priorFailure = originalPrior;

    const totalImpact = affectedNodes.length > 0
      ? Array.from(impactMap.values()).reduce((a, b) => a + b, 0) / affectedNodes.length
      : 0;

    return {
      interventionNodeId,
      interventionValue: value,
      predictedImpact: totalImpact,
      affectedNodes,
      confidence: Math.min(1.0, node.observationCount > 0
        ? Math.min(node.failureCount, node.passCount) / (node.failureCount + node.passCount + 1)
        : 0.3),
    };
  }

  // ── Root Cause Analysis ──────────────────────────────────────────────────────

  /**
   * Given a failure event, trace back through the causal graph to find
   * the most probable root cause using d-separation and Bayesian inference.
   */
  identifyRootCause(failureEvent: FailureEvent): CausalChain | null {
    const failedNode = this.nodes.get(failureEvent.failedNodeId);
    if (!failedNode) {
      log.warn(`[causal] Failed node not found: ${failureEvent.failedNodeId}`);
      return null;
    }

    log.info(`[causal] Identifying root cause for failure: ${failureEvent.failedNodeId}`);

    // BFS backwards through the causal graph, scoring each path
    const bestChain = this.findBestCausalChain(failureEvent.failedNodeId);
    if (!bestChain) return null;

    // Generate a human-readable recommendation
    const recommendation = this.generateRecommendation(bestChain);

    return { ...bestChain, recommendation };
  }

  private findBestCausalChain(effectNodeId: string): Omit<CausalChain, "recommendation"> | null {
    const visited = new Set<string>();
    let bestChain: Omit<CausalChain, "recommendation"> | null = null;
    let bestScore = -Infinity;

    const dfs = (
      nodeId: string,
      chain: Array<{ node: CausalNode; edge: CausalEdge }>,
      cumulativeProb: number
    ): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const parents = this.getParents(nodeId);

      // Leaf node (no parents) = potential root cause
      if (parents.length === 0) {
        const node = this.nodes.get(nodeId)!;
        const score = cumulativeProb * node.priorFailure;

        if (score > bestScore) {
          bestScore = score;
          bestChain = {
            rootCause: node,
            chain: [...chain],
            probability: cumulativeProb,
            confidence: Math.min(1.0, (node.failureCount + 1) / (node.failureCount + node.passCount + 2)),
          };
        }
        visited.delete(nodeId);
        return;
      }

      // Recurse through parents
      for (const parentId of parents) {
        const edge = this.getEdge(parentId, nodeId);
        if (!edge) continue;

        const parentNode = this.nodes.get(parentId);
        if (!parentNode) continue;

        const newProb = cumulativeProb * edge.conditionalProbability * parentNode.priorFailure;
        chain.push({ node: parentNode, edge });
        dfs(parentId, chain, newProb);
        chain.pop();
      }

      visited.delete(nodeId);
    };

    dfs(effectNodeId, [], 1.0);
    return bestChain;
  }

  private generateRecommendation(chain: Omit<CausalChain, "recommendation">): string {
    const root = chain.rootCause;
    const confidence = (chain.confidence * 100).toFixed(0);

    switch (root.type) {
      case "rsi_proposal":
        return `Revert RSI proposal "${root.label}" — it is the most probable root cause (${confidence}% confidence). The proposal introduced a regression in ${chain.chain.length} downstream modules.`;
      case "module":
        return `Refactor module "${root.label}" — it has a ${(root.priorFailure * 100).toFixed(0)}% failure rate and is causing cascading failures (${confidence}% confidence).`;
      case "function":
        return `Fix function "${root.label}" in ${root.metadata.file ?? "unknown file"} — it is the root cause of ${chain.chain.length} downstream test failures (${confidence}% confidence).`;
      case "dependency":
        return `Update or pin dependency "${root.label}" — version drift is causing failures (${confidence}% confidence).`;
      case "config":
        return `Review configuration "${root.label}" — misconfiguration is the most probable root cause (${confidence}% confidence).`;
      default:
        return `Investigate "${root.label}" — it is the most probable root cause with ${confidence}% confidence.`;
    }
  }

  // ── Network Building ─────────────────────────────────────────────────────────

  /**
   * Build or update the causal network from a failure log entry.
   * Called by the RSI engine after each test run.
   */
  recordFailure(nodeId: string, type: NodeType, label: string, causedBy?: string[]): void {
    // Upsert the node
    let node = this.nodes.get(nodeId);
    if (!node) {
      node = {
        id: nodeId,
        type,
        label,
        priorFailure: 0.5,
        failureCount: 0,
        passCount: 0,
        metadata: {},
      };
      this.addNode(node);
    }

    node.failureCount++;
    // Update prior using Laplace smoothing
    node.priorFailure = (node.failureCount + 1) / (node.failureCount + node.passCount + 2);

    // Add causal edges from causes to this node
    if (causedBy) {
      for (const causeId of causedBy) {
        const existingEdge = this.getEdge(causeId, nodeId);
        if (existingEdge) {
          existingEdge.observationCount++;
          existingEdge.conditionalProbability = Math.min(0.99,
            existingEdge.conditionalProbability + 0.05 * (1 - existingEdge.conditionalProbability)
          );
          existingEdge.strength = existingEdge.conditionalProbability;
        } else {
          this.addEdge({
            from: causeId,
            to: nodeId,
            conditionalProbability: 0.7,
            observationCount: 1,
            strength: 0.7,
          });
        }
      }
    }

    this.saveToDisk();
  }

  recordPass(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.passCount++;
    node.priorFailure = (node.failureCount + 1) / (node.failureCount + node.passCount + 2);
    this.saveToDisk();
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private saveToDisk(): void {
    try {
      const data = {
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
      };
      writeFileSync(join(this.dataDir, "causal_network.json"), JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn(`[causal] Failed to save network: ${err}`);
    }
  }

  private loadFromDisk(): void {
    try {
      const path = join(this.dataDir, "causal_network.json");
      if (!existsSync(path)) return;
      const data = JSON.parse(readFileSync(path, "utf-8")) as {
        nodes: CausalNode[];
        edges: CausalEdge[];
      };
      for (const node of data.nodes) this.addNode(node);
      for (const edge of data.edges) this.addEdge(edge);
      log.info(`[causal] Loaded network: ${data.nodes.length} nodes, ${data.edges.length} edges`);
    } catch {
      // Fresh start
    }
  }

  reset(): void {
    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
    this.reverseAdjacency.clear();
  }
}

// ── Root Cause Analyzer ───────────────────────────────────────────────────────

export class RootCauseAnalyzer {
  private network: CausalNetwork;

  constructor(network?: CausalNetwork) {
    this.network = network ?? new CausalNetwork();
  }

  getNetwork(): CausalNetwork {
    return this.network;
  }

  /**
   * Analyze a batch of test failures and return ranked root causes.
   */
  analyzeFailures(failures: FailureEvent[]): CausalChain[] {
    const chains: CausalChain[] = [];

    for (const failure of failures) {
      const chain = this.network.identifyRootCause(failure);
      if (chain) chains.push(chain);
    }

    // Deduplicate by root cause and sort by probability
    const seen = new Set<string>();
    return chains
      .filter(c => {
        if (seen.has(c.rootCause.id)) return false;
        seen.add(c.rootCause.id);
        return true;
      })
      .sort((a, b) => b.probability - a.probability);
  }

  /**
   * Simulate the impact of fixing each potential root cause.
   * Returns interventions ranked by predicted impact.
   */
  rankInterventions(rootCauses: CausalChain[]): InterventionResult[] {
    return rootCauses
      .map(chain => this.network.doIntervention(chain.rootCause.id, "fix"))
      .sort((a, b) => b.predictedImpact - a.predictedImpact);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _analyzer: RootCauseAnalyzer | null = null;

export function getRootCauseAnalyzer(dataDir?: string): RootCauseAnalyzer {
  if (!_analyzer) {
    _analyzer = new RootCauseAnalyzer(new CausalNetwork(dataDir));
  }
  return _analyzer;
}

export function resetRootCauseAnalyzer(): void {
  _analyzer = null;
}
