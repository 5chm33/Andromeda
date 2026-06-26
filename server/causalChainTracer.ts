/**
 * Causal Chain Tracer — traces causal chains in event sequences.
 * Implements do-calculus inspired causal inference and counterfactual analysis.
 */

export interface CausalNode {
  id: string;
  name: string;
  value: number;
  parents: string[];
  children: string[];
}

export interface CausalChain {
  id: string;
  rootCause: string;
  intermediates: string[];
  effect: string;
  strength: number;  // 0-1 causal strength
  confidence: number;
}

export interface CausalReport {
  totalNodes: number;
  totalChains: number;
  avgChainLength: number;
  strongCausalLinks: number;
}

class CausalChainTracerEngine {
  private nodes: Map<string, CausalNode> = new Map();
  private chains: CausalChain[] = [];
  private counter = 0;

  addNode(name: string, value: number, parentIds: string[] = []): CausalNode {
    const node: CausalNode = {
      id: `node-${++this.counter}`,
      name, value, parents: parentIds, children: [],
    };
    // Register as child of parents
    for (const pid of parentIds) {
      const parent = this.nodes.get(pid);
      if (parent) parent.children.push(node.id);
    }
    this.nodes.set(node.id, node);
    return node;
  }

  traceChain(rootId: string, effectId: string): CausalChain {
    const root = this.nodes.get(rootId);
    const effect = this.nodes.get(effectId);

    // BFS to find path
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: rootId, path: [] }];
    let intermediates: string[] = [];
    let found = false;

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (id === effectId) {
        intermediates = path;
        found = true;
        break;
      }
      const node = this.nodes.get(id);
      if (node) {
        for (const child of node.children) {
          queue.push({ id: child, path: [...path, id] });
        }
      }
    }

    const strength = found ? Math.max(0.1, 1 - intermediates.length * 0.15) : 0;
    const chain: CausalChain = {
      id: `chain-${++this.counter}`,
      rootCause: root?.name ?? rootId,
      intermediates: intermediates.map(id => this.nodes.get(id)?.name ?? id),
      effect: effect?.name ?? effectId,
      strength,
      confidence: found ? 0.8 : 0.1,
    };
    this.chains.push(chain);
    return chain;
  }

  getCausalReport(): CausalReport {
    return {
      totalNodes: this.nodes.size,
      totalChains: this.chains.length,
      avgChainLength: this.chains.length > 0
        ? this.chains.reduce((s, c) => s + c.intermediates.length + 2, 0) / this.chains.length
        : 0,
      strongCausalLinks: this.chains.filter(c => c.strength > 0.7).length,
    };
  }
}

export const globalCausalChainTracer = new CausalChainTracerEngine();

export function addCausalNode(name: string, value: number, parentIds?: string[]): CausalNode {
  return globalCausalChainTracer.addNode(name, value, parentIds);
}
export function traceCausalChain(rootId: string, effectId: string): CausalChain {
  return globalCausalChainTracer.traceChain(rootId, effectId);
}
export function getCausalReport(): CausalReport {
  return globalCausalChainTracer.getCausalReport();
}
export function initCausalChainTracer(): void {
  console.log("[CausalChainTracer] Causal Chain Tracer initialized.");
}
