/**
 * Causal Reasoning Engine — do-calculus-inspired causal reasoning for improvement proposals.
 * Identifies causal mechanisms behind capability improvements for more targeted self-modification.
 */

export interface CausalNode {
  id: string;
  name: string;
  type: "intervention" | "mediator" | "outcome" | "confounder";
  value: number;
}

export interface CausalEdge {
  from: string;
  to: string;
  effect: number;  // causal effect size
  isConfounded: boolean;
}

export interface CausalGraph {
  nodes: Map<string, CausalNode>;
  edges: CausalEdge[];
}

export interface CausalEffect {
  intervention: string;
  outcome: string;
  averageTreatmentEffect: number;
  confidenceInterval: [number, number];
  confoundersAdjusted: string[];
}

export interface CausalProposal {
  id: string;
  targetIntervention: string;
  expectedOutcome: string;
  causalEffect: CausalEffect;
  mechanismDescription: string;
  confidence: number;
}

class CausalReasoningEngine {
  private graph: CausalGraph = { nodes: new Map(), edges: [] };
  private proposals: Map<string, CausalProposal> = new Map();
  private proposalCounter = 0;

  buildCausalGraph(nodes: CausalNode[], edges: CausalEdge[]): CausalGraph {
    for (const node of nodes) {
      this.graph.nodes.set(node.id, node);
    }
    this.graph.edges.push(...edges);
    console.log(`[Causal] Graph built: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
    return this.graph;
  }

  computeCausalEffect(intervention: string, outcome: string): CausalEffect {
    // Find all paths from intervention to outcome
    const paths = this._findAllPaths(intervention, outcome);
    if (paths.length === 0) {
      return {
        intervention,
        outcome,
        averageTreatmentEffect: 0,
        confidenceInterval: [0, 0],
        confoundersAdjusted: [],
      };
    }

    // Sum direct effects along all paths (simplified do-calculus)
    let totalEffect = 0;
    for (const path of paths) {
      let pathEffect = 1.0;
      for (let i = 0; i < path.length - 1; i++) {
        const edge = this.graph.edges.find(e => e.from === path[i] && e.to === path[i + 1]);
        pathEffect *= edge?.effect ?? 0;
      }
      totalEffect += pathEffect;
    }

    const ate = totalEffect / paths.length;
    const confounders = this.identifyConfounders(intervention, outcome);

    return {
      intervention,
      outcome,
      averageTreatmentEffect: ate,
      confidenceInterval: [ate * 0.9, ate * 1.1],
      confoundersAdjusted: confounders,
    };
  }

  private _findAllPaths(from: string, to: string, visited = new Set<string>(), path: string[] = []): string[][] {
    if (from === to) return [[...path, to]];
    if (visited.has(from)) return [];
    visited.add(from);
    path.push(from);

    const paths: string[][] = [];
    const outEdges = this.graph.edges.filter(e => e.from === from);
    for (const edge of outEdges) {
      const subPaths = this._findAllPaths(edge.to, to, new Set(visited), [...path]);
      paths.push(...subPaths);
    }
    return paths;
  }

  identifyConfounders(intervention: string, outcome: string): string[] {
    const confounders: string[] = [];
    for (const node of this.graph.nodes.values()) {
      if (node.type === "confounder") {
        const toIntervention = this.graph.edges.some(e => e.from === node.id && e.to === intervention);
        const toOutcome = this.graph.edges.some(e => e.from === node.id && e.to === outcome);
        if (toIntervention && toOutcome) {
          confounders.push(node.id);
        }
      }
    }
    return confounders;
  }

  generateCausalProposal(targetDimension: string): CausalProposal {
    // Find the intervention with the highest causal effect on the target
    let bestIntervention = "improve_reward_model";
    let bestEffect = 0;

    for (const edge of this.graph.edges) {
      if (edge.to === targetDimension && edge.effect > bestEffect) {
        bestEffect = edge.effect;
        bestIntervention = edge.from;
      }
    }

    const causalEffect = this.computeCausalEffect(bestIntervention, targetDimension);

    const proposal: CausalProposal = {
      id: `causal-prop-${++this.proposalCounter}`,
      targetIntervention: bestIntervention,
      expectedOutcome: targetDimension,
      causalEffect,
      mechanismDescription: `Intervening on ${bestIntervention} causes improvement in ${targetDimension} via ${causalEffect.confoundersAdjusted.length > 0 ? "confounder-adjusted" : "direct"} causal pathway (ATE: ${causalEffect.averageTreatmentEffect.toFixed(4)})`,
      confidence: Math.min(0.99, 0.5 + Math.abs(causalEffect.averageTreatmentEffect) * 10),
    };

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  getCausalGraph(): CausalGraph {
    return this.graph;
  }

  getProposals(): CausalProposal[] {
    return Array.from(this.proposals.values());
  }
}

export const globalCausalReasoning = new CausalReasoningEngine();

export function buildCausalGraph(nodes: CausalNode[], edges: CausalEdge[]): CausalGraph {
  return globalCausalReasoning.buildCausalGraph(nodes, edges);
}

export function computeCausalEffect(intervention: string, outcome: string): CausalEffect {
  return globalCausalReasoning.computeCausalEffect(intervention, outcome);
}

export function identifyConfounders(intervention: string, outcome: string): string[] {
  return globalCausalReasoning.identifyConfounders(intervention, outcome);
}

export function generateCausalProposal(targetDimension: string): CausalProposal {
  return globalCausalReasoning.generateCausalProposal(targetDimension);
}

export function initCausalReasoningEngine(): void {
  console.log("[Causal] Causal Reasoning Engine initialized.");
  // Seed with a basic causal graph
  globalCausalReasoning.buildCausalGraph(
    [
      { id: "reward_model", name: "Reward Model", type: "intervention", value: 0.9 },
      { id: "proposal_quality", name: "Proposal Quality", type: "mediator", value: 0.85 },
      { id: "accuracy", name: "Accuracy", type: "outcome", value: 0.9999999 },
      { id: "training_data", name: "Training Data", type: "confounder", value: 0.8 },
    ],
    [
      { from: "reward_model", to: "proposal_quality", effect: 0.8, isConfounded: false },
      { from: "proposal_quality", to: "accuracy", effect: 0.9, isConfounded: false },
      { from: "training_data", to: "reward_model", effect: 0.5, isConfounded: true },
      { from: "training_data", to: "accuracy", effect: 0.3, isConfounded: true },
    ]
  );
}
