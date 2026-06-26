/**
 * agentCapabilityRegistry.ts — v47.0.0
 *
 * Central registry of all agent capabilities with semantic versioning,
 * dependency resolution, and capability discovery.
 */

export interface CapabilitySpec {
  name: string;
  version: string;       // semver e.g. "1.2.0"
  description: string;
  dependencies: string[];  // capability names required
  tags: string[];
}

export interface AgentCapabilityEntry {
  agentId: string;
  capabilities: CapabilitySpec[];
  registeredAt: number;
  lastUpdated: number;
}

const registry = new Map<string, AgentCapabilityEntry>();
const capabilityIndex = new Map<string, Set<string>>(); // capability name → agentIds

export function registerCapabilities(agentId: string, capabilities: CapabilitySpec[]): void {
  const existing = registry.get(agentId);
  const entry: AgentCapabilityEntry = {
    agentId,
    capabilities,
    registeredAt: existing?.registeredAt ?? Date.now(),
    lastUpdated: Date.now(),
  };
  registry.set(agentId, entry);

  // Update capability index
  for (const cap of capabilities) {
    if (!capabilityIndex.has(cap.name)) capabilityIndex.set(cap.name, new Set());
    capabilityIndex.get(cap.name)!.add(agentId);
  }
}

export function findAgentsWithCapability(capabilityName: string): string[] {
  return Array.from(capabilityIndex.get(capabilityName) ?? []);
}

export function findAgentsWithAllCapabilities(capabilityNames: string[]): string[] {
  if (capabilityNames.length === 0) return [];
  const sets = capabilityNames.map(name => capabilityIndex.get(name) ?? new Set<string>());
  const [first, ...rest] = sets;
  const intersection = new Set(first);
  for (const s of rest) {
    for (const id of intersection) {
      if (!s.has(id)) intersection.delete(id);
    }
  }
  return Array.from(intersection);
}

export function resolveCapabilityDependencies(capabilityName: string): string[] {
  const all = Array.from(registry.values()).flatMap(e => e.capabilities);
  const cap = all.find(c => c.name === capabilityName);
  if (!cap) return [];

  const resolved: string[] = [];
  const visited = new Set<string>();

  function resolve(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const found = all.find(c => c.name === name);
    if (found) {
      for (const dep of found.dependencies) resolve(dep);
      resolved.push(name);
    }
  }

  resolve(capabilityName);
  return resolved;
}

export function getAgentCapabilities(agentId: string): CapabilitySpec[] {
  return registry.get(agentId)?.capabilities ?? [];
}

export function searchCapabilities(tag: string): CapabilitySpec[] {
  const results: CapabilitySpec[] = [];
  for (const entry of registry.values()) {
    for (const cap of entry.capabilities) {
      if (cap.tags.includes(tag)) results.push(cap);
    }
  }
  return results;
}

export function getRegistryStats(): { totalAgents: number; totalCapabilities: number; uniqueCapabilityTypes: number } {
  const total = Array.from(registry.values()).reduce((s, e) => s + e.capabilities.length, 0);
  return {
    totalAgents: registry.size,
    totalCapabilities: total,
    uniqueCapabilityTypes: capabilityIndex.size,
  };
}

export function _resetCapabilityRegistryForTest(): void {
  registry.clear();
  capabilityIndex.clear();
}
