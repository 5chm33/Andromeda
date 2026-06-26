/**
 * Capability Synthesis Engine — synthesizes new capabilities by combining existing ones.
 * Implements "capability chemistry" — capabilities react to produce emergent higher-order capabilities.
 */

export interface CapabilityNode {
  id: string;
  name: string;
  level: number;  // 0-1
  dependencies: string[];
  emergentFrom?: string[];
}

export interface CapabilityEdge {
  from: string;
  to: string;
  weight: number;
  type: "dependency" | "synergy" | "conflict";
}

export interface CapabilityGraph {
  nodes: Map<string, CapabilityNode>;
  edges: CapabilityEdge[];
}

export interface NovelCombination {
  capabilities: string[];
  emergentCapability: string;
  synthesisScore: number;  // 0-1
  feasibility: number;
  novelty: number;
}

export interface SynthesizedCapability {
  id: string;
  name: string;
  sourceCapabilities: string[];
  level: number;
  synthesizedAt: number;
  validationScore: number;
}

class CapabilitySynthesisEngine {
  private graph: CapabilityGraph = { nodes: new Map(), edges: [] };
  private synthesized: Map<string, SynthesizedCapability> = new Map();
  private synthCounter = 0;

  mapCapabilityGraph(capabilities: CapabilityNode[]): CapabilityGraph {
    for (const cap of capabilities) {
      this.graph.nodes.set(cap.id, cap);
      for (const dep of cap.dependencies) {
        this.graph.edges.push({ from: dep, to: cap.id, weight: 1.0, type: "dependency" });
      }
    }
    console.log(`[CapSynth] Graph mapped: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
    return this.graph;
  }

  findNovelCombinations(maxCombinationSize = 3): NovelCombination[] {
    const nodes = Array.from(this.graph.nodes.values());
    const combinations: NovelCombination[] = [];

    // Generate pairs and triples
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const pair = [nodes[i], nodes[j]];
        const synergy = this._computeSynergy(pair);
        if (synergy > 0.5) {
          combinations.push({
            capabilities: pair.map(n => n.id),
            emergentCapability: `${nodes[i].name}_${nodes[j].name}_synthesis`,
            synthesisScore: synergy,
            feasibility: (nodes[i].level + nodes[j].level) / 2,
            novelty: 1 - Math.abs(nodes[i].level - nodes[j].level),
          });
        }

        // Triples
        if (maxCombinationSize >= 3) {
          for (let k = j + 1; k < Math.min(nodes.length, j + 5); k++) {
            const triple = [nodes[i], nodes[j], nodes[k]];
            const tripleSynergy = this._computeSynergy(triple);
            if (tripleSynergy > 0.6) {
              combinations.push({
                capabilities: triple.map(n => n.id),
                emergentCapability: `${nodes[i].name}_${nodes[j].name}_${nodes[k].name}_synthesis`,
                synthesisScore: tripleSynergy,
                feasibility: triple.reduce((s, n) => s + n.level, 0) / 3,
                novelty: 0.9,
              });
            }
          }
        }
      }
    }

    return combinations.sort((a, b) => b.synthesisScore - a.synthesisScore).slice(0, 20);
  }

  private _computeSynergy(caps: CapabilityNode[]): number {
    // Synergy is higher when capabilities are complementary (different domains)
    const avgLevel = caps.reduce((s, c) => s + c.level, 0) / caps.length;
    const levelVariance = caps.reduce((s, c) => s + (c.level - avgLevel) ** 2, 0) / caps.length;
    // Higher variance = more complementary = higher synergy
    return Math.min(1, avgLevel * 0.5 + Math.sqrt(levelVariance) * 2 + 0.3);
  }

  synthesizeCapability(combination: NovelCombination): SynthesizedCapability {
    const sourceNodes = combination.capabilities.map(id => this.graph.nodes.get(id)).filter(Boolean) as CapabilityNode[];
    const synthesizedLevel = Math.min(1, combination.synthesisScore * combination.feasibility * 1.1);

    const synth: SynthesizedCapability = {
      id: `synth-${++this.synthCounter}`,
      name: combination.emergentCapability,
      sourceCapabilities: combination.capabilities,
      level: synthesizedLevel,
      synthesizedAt: Date.now(),
      validationScore: combination.feasibility,
    };

    // Add to graph
    this.graph.nodes.set(synth.id, {
      id: synth.id,
      name: synth.name,
      level: synth.level,
      dependencies: combination.capabilities,
      emergentFrom: combination.capabilities,
    });

    this.synthesized.set(synth.id, synth);
    console.log(`[CapSynth] Synthesized: ${synth.name} (level: ${synth.level.toFixed(3)}) from ${combination.capabilities.join(" + ")}`);
    return synth;
  }

  validateSynthesizedCapability(synth: SynthesizedCapability): { valid: boolean; score: number; issues: string[] } {
    const issues: string[] = [];

    if (synth.level < 0.5) issues.push("Synthesized level below minimum threshold");
    if (synth.sourceCapabilities.length < 2) issues.push("Requires at least 2 source capabilities");
    if (synth.validationScore < 0.3) issues.push("Feasibility score too low");

    const score = (synth.level + synth.validationScore) / 2;
    return { valid: issues.length === 0, score, issues };
  }

  getCapabilityGraph(): CapabilityGraph {
    return this.graph;
  }

  getSynthesizedCapabilities(): SynthesizedCapability[] {
    return Array.from(this.synthesized.values());
  }
}

export const globalCapabilitySynthesis = new CapabilitySynthesisEngine();

export function mapCapabilityGraph(capabilities: CapabilityNode[]): CapabilityGraph {
  return globalCapabilitySynthesis.mapCapabilityGraph(capabilities);
}

export function findNovelCombinations(maxCombinationSize?: number): NovelCombination[] {
  return globalCapabilitySynthesis.findNovelCombinations(maxCombinationSize);
}

export function synthesizeCapability(combination: NovelCombination): SynthesizedCapability {
  return globalCapabilitySynthesis.synthesizeCapability(combination);
}

export function validateSynthesizedCapability(synth: SynthesizedCapability): { valid: boolean; score: number; issues: string[] } {
  return globalCapabilitySynthesis.validateSynthesizedCapability(synth);
}

export function initCapabilitySynthesisEngine(): void {
  console.log("[CapSynth] Capability Synthesis Engine initialized.");
  // Seed with core capabilities
  globalCapabilitySynthesis.mapCapabilityGraph([
    { id: "accuracy", name: "accuracy", level: 0.9999999, dependencies: [] },
    { id: "speed", name: "speed", level: 0.95, dependencies: [] },
    { id: "safety", name: "safety", level: 0.9999999, dependencies: [] },
    { id: "generalization", name: "generalization", level: 0.85, dependencies: ["accuracy"] },
    { id: "reasoning", name: "reasoning", level: 0.92, dependencies: ["accuracy", "generalization"] },
    { id: "coding", name: "coding", level: 0.94, dependencies: ["reasoning"] },
  ]);
}
