/**
 * Capability Orchestrator — orchestrates capabilities across Andromeda's module ecosystem.
 * Implements capability discovery, routing, and composition.
 */

export type CapabilityType = "reasoning" | "planning" | "learning" | "communication" | "execution" | "monitoring";

export interface Capability {
  id: string;
  name: string;
  type: CapabilityType;
  module: string;
  version: string;
  inputSchema: string[];
  outputSchema: string[];
  latencyMs: number;
  reliability: number;  // 0-1
  active: boolean;
}

export interface CapabilityRequest {
  id: string;
  requiredType: CapabilityType;
  inputs: Record<string, unknown>;
  priority: number;
  deadline?: number;
}

export interface CapabilityResponse {
  requestId: string;
  capabilityId: string;
  success: boolean;
  output: Record<string, unknown>;
  latencyMs: number;
}

export interface OrchestratorReport {
  totalCapabilities: number;
  activeCapabilities: number;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
}

class CapabilityOrchestratorEngine {
  private capabilities: Map<string, Capability> = new Map();
  private responses: CapabilityResponse[] = [];
  private counter = 0;

  registerCapability(name: string, type: CapabilityType, module: string, version: string, latencyMs: number, reliability: number): Capability {
    const cap: Capability = {
      id: `cap-${++this.counter}`,
      name, type, module, version,
      inputSchema: [], outputSchema: [],
      latencyMs, reliability, active: true,
    };
    this.capabilities.set(cap.id, cap);
    return cap;
  }

  route(request: CapabilityRequest): CapabilityResponse {
    // Find best matching capability by type, reliability, and latency
    const candidates = Array.from(this.capabilities.values())
      .filter(c => c.active && c.type === request.requiredType)
      .sort((a, b) => {
        const scoreA = a.reliability - a.latencyMs / 10000;
        const scoreB = b.reliability - b.latencyMs / 10000;
        return scoreB - scoreA;
      });

    const best = candidates[0];
    if (!best) {
      const resp: CapabilityResponse = {
        requestId: request.id, capabilityId: "none",
        success: false, output: {}, latencyMs: 0,
      };
      this.responses.push(resp);
      return resp;
    }

    const success = Math.random() < best.reliability;
    const resp: CapabilityResponse = {
      requestId: request.id,
      capabilityId: best.id,
      success,
      output: success ? { result: "processed", module: best.module } : {},
      latencyMs: best.latencyMs * (0.8 + Math.random() * 0.4),
    };
    this.responses.push(resp);
    return resp;
  }

  getOrchestratorReport(): OrchestratorReport {
    const caps = Array.from(this.capabilities.values());
    const successful = this.responses.filter(r => r.success);
    return {
      totalCapabilities: caps.length,
      activeCapabilities: caps.filter(c => c.active).length,
      totalRequests: this.responses.length,
      successRate: this.responses.length > 0 ? successful.length / this.responses.length : 1,
      avgLatencyMs: this.responses.length > 0 ? this.responses.reduce((s, r) => s + r.latencyMs, 0) / this.responses.length : 0,
    };
  }
}

export const globalCapabilityOrchestrator = new CapabilityOrchestratorEngine();

export function registerCapability(name: string, type: CapabilityType, module: string, version: string, latencyMs: number, reliability: number): Capability {
  return globalCapabilityOrchestrator.registerCapability(name, type, module, version, latencyMs, reliability);
}
export function routeCapabilityRequest(request: CapabilityRequest): CapabilityResponse {
  return globalCapabilityOrchestrator.route(request);
}
export function getOrchestratorReport(): OrchestratorReport {
  return globalCapabilityOrchestrator.getOrchestratorReport();
}
export function initCapabilityOrchestrator(): void {
  console.log("[CapabilityOrchestrator] Capability Orchestrator initialized.");
}
