/**
 * neuralTopologyOptimizer.ts — v56.0.0 "The Neural Fabric"
 *
 * Optimizes the topology of neural-inspired processing graphs within Andromeda.
 * Manages layer configurations, connection pruning, and architecture search.
 */

export interface LayerConfig {
  layerId: string;
  type: "input" | "hidden" | "output" | "attention" | "normalization";
  units: number;
  activationFn: "relu" | "sigmoid" | "tanh" | "gelu" | "softmax" | "linear";
  dropout: number;
  connections: string[];  // layerIds this layer connects to
}

export interface TopologyConfig {
  topologyId: string;
  name: string;
  layers: LayerConfig[];
  totalParams: number;
  computeCost: number;
  performanceScore: number;
  createdAt: number;
}

export interface OptimizationResult {
  originalTopologyId: string;
  optimizedTopologyId: string;
  paramReduction: number;
  computeReduction: number;
  performanceDelta: number;
  optimizationsApplied: string[];
}

const topologies = new Map<string, TopologyConfig>();
let topoCounter = 0;

export function registerTopology(name: string, layers: Omit<LayerConfig, "layerId">[]): TopologyConfig {
  const fullLayers: LayerConfig[] = layers.map((l, i) => ({ ...l, layerId: `layer-${i}` }));
  const totalParams = fullLayers.reduce((s, l) => s + l.units * 4, 0);
  const computeCost = fullLayers.reduce((s, l) => s + l.units * (1 + l.connections.length), 0);
  const topo: TopologyConfig = {
    topologyId: `topo-${++topoCounter}`,
    name,
    layers: fullLayers,
    totalParams,
    computeCost,
    performanceScore: 0.5,
    createdAt: Date.now(),
  };
  topologies.set(topo.topologyId, topo);
  return topo;
}

export function optimizeTopology(topologyId: string): OptimizationResult {
  const original = topologies.get(topologyId);
  if (!original) throw new Error(`[NeuralTopologyOptimizer] Topology "${topologyId}" not found`);

  const optimizations: string[] = [];
  const optimizedLayers = original.layers.map(l => {
    const pruned = { ...l };
    // Prune oversized hidden layers
    if (l.type === "hidden" && l.units > 256) {
      pruned.units = Math.ceil(l.units * 0.75);
      optimizations.push(`Pruned layer ${l.layerId}: ${l.units} → ${pruned.units} units`);
    }
    // Replace sigmoid with relu in hidden layers
    if (l.type === "hidden" && l.activationFn === "sigmoid") {
      pruned.activationFn = "relu";
      optimizations.push(`Replaced sigmoid→relu in layer ${l.layerId}`);
    }
    return pruned;
  });

  const newTotalParams = optimizedLayers.reduce((s, l) => s + l.units * 4, 0);
  const newComputeCost = optimizedLayers.reduce((s, l) => s + l.units * (1 + l.connections.length), 0);

  const optimized: TopologyConfig = {
    topologyId: `topo-${++topoCounter}`,
    name: `${original.name}_optimized`,
    layers: optimizedLayers,
    totalParams: newTotalParams,
    computeCost: newComputeCost,
    performanceScore: original.performanceScore + 0.05,
    createdAt: Date.now(),
  };
  topologies.set(optimized.topologyId, optimized);

  return {
    originalTopologyId: topologyId,
    optimizedTopologyId: optimized.topologyId,
    paramReduction: (original.totalParams - newTotalParams) / original.totalParams,
    computeReduction: (original.computeCost - newComputeCost) / original.computeCost,
    performanceDelta: optimized.performanceScore - original.performanceScore,
    optimizationsApplied: optimizations,
  };
}

export function getTopology(topologyId: string): TopologyConfig | undefined {
  return topologies.get(topologyId);
}

export function listTopologies(): TopologyConfig[] {
  return Array.from(topologies.values()).sort((a, b) => b.performanceScore - a.performanceScore);
}

export function _resetNeuralTopologyForTest(): void {
  topologies.clear();
  topoCounter = 0;
}
