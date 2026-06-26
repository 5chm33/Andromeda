/**
 * agentLoadBalancer.ts — v48.0.0
 *
 * Distributes incoming tasks across available agents using multiple strategies:
 * round-robin, least-loaded, capability-weighted, and latency-aware.
 */

export type BalancingStrategy = "round-robin" | "least-loaded" | "capability-weighted" | "latency-aware";

export interface AgentNode {
  agentId: string;
  capabilities: string[];
  currentLoad: number;     // 0.0–1.0
  avgLatencyMs: number;
  weight: number;          // capability weight score
  healthy: boolean;
}

export interface BalancerStats {
  totalDispatched: number;
  strategyUsed: BalancingStrategy;
  agentCount: number;
  avgLoad: number;
}

const nodes = new Map<string, AgentNode>();
let rrIndex = 0;
let totalDispatched = 0;
let currentStrategy: BalancingStrategy = "least-loaded";

export function registerNode(node: AgentNode): void {
  nodes.set(node.agentId, { ...node });
}

export function setStrategy(strategy: BalancingStrategy): void {
  currentStrategy = strategy;
}

export function updateNodeLoad(agentId: string, load: number, latencyMs?: number): void {
  const node = nodes.get(agentId);
  if (!node) return;
  node.currentLoad = Math.max(0, Math.min(1, load));
  if (latencyMs !== undefined) node.avgLatencyMs = latencyMs;
}

export function markNodeHealth(agentId: string, healthy: boolean): void {
  const node = nodes.get(agentId);
  if (node) node.healthy = healthy;
}

export function selectAgent(requiredCapabilities: string[] = []): string | null {
  const eligible = Array.from(nodes.values()).filter(n =>
    n.healthy &&
    requiredCapabilities.every(cap => n.capabilities.includes(cap))
  );

  if (eligible.length === 0) return null;
  totalDispatched++;

  switch (currentStrategy) {
    case "round-robin": {
      const agent = eligible[rrIndex % eligible.length];
      rrIndex++;
      return agent.agentId;
    }
    case "least-loaded": {
      return eligible.reduce((best, n) => n.currentLoad < best.currentLoad ? n : best).agentId;
    }
    case "capability-weighted": {
      const totalWeight = eligible.reduce((s, n) => s + n.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const n of eligible) {
        rand -= n.weight;
        if (rand <= 0) return n.agentId;
      }
      return eligible[0].agentId;
    }
    case "latency-aware": {
      return eligible.reduce((best, n) => n.avgLatencyMs < best.avgLatencyMs ? n : best).agentId;
    }
    default:
      return eligible[0].agentId;
  }
}

export function getStats(): BalancerStats {
  const all = Array.from(nodes.values());
  const avgLoad = all.length > 0 ? all.reduce((s, n) => s + n.currentLoad, 0) / all.length : 0;
  return { totalDispatched, strategyUsed: currentStrategy, agentCount: all.length, avgLoad };
}

export function _resetLoadBalancerForTest(): void {
  nodes.clear();
  rrIndex = 0;
  totalDispatched = 0;
  currentStrategy = "least-loaded";
}
