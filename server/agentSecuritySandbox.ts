/**
 * agentSecuritySandbox.ts — v48.0.0
 *
 * Enforces security policies for sub-agent execution: capability allowlists,
 * resource quotas, action auditing, and isolation enforcement.
 */

export interface SecurityPolicy {
  agentId: string;
  allowedCapabilities: string[];
  maxMemoryMb: number;
  maxCpuPct: number;
  networkAccess: boolean;
  fileSystemAccess: boolean;
  allowedTopics: string[];    // communication bus topics
}

export interface SecurityViolation {
  violationId: string;
  agentId: string;
  type: "capability" | "resource" | "network" | "filesystem" | "topic";
  description: string;
  timestamp: number;
  blocked: boolean;
}

const policies = new Map<string, SecurityPolicy>();
const violations: SecurityViolation[] = [];
let violationCounter = 0;

export function setPolicy(policy: SecurityPolicy): void {
  policies.set(policy.agentId, { ...policy });
}

export function checkCapability(agentId: string, capability: string): boolean {
  const policy = policies.get(agentId);
  if (!policy) return true; // no policy = unrestricted
  const allowed = policy.allowedCapabilities.includes(capability);
  if (!allowed) {
    logViolation(agentId, "capability", `Attempted to use disallowed capability: ${capability}`, true);
  }
  return allowed;
}

export function checkTopicAccess(agentId: string, topic: string): boolean {
  const policy = policies.get(agentId);
  if (!policy) return true;
  const allowed = policy.allowedTopics.length === 0 || policy.allowedTopics.includes(topic);
  if (!allowed) {
    logViolation(agentId, "topic", `Attempted to access disallowed topic: ${topic}`, true);
  }
  return allowed;
}

export function checkNetworkAccess(agentId: string): boolean {
  const policy = policies.get(agentId);
  if (!policy) return true;
  if (!policy.networkAccess) {
    logViolation(agentId, "network", "Network access denied by policy", true);
    return false;
  }
  return true;
}

export function checkResourceUsage(agentId: string, memoryMb: number, cpuPct: number): boolean {
  const policy = policies.get(agentId);
  if (!policy) return true;
  const memOk = memoryMb <= policy.maxMemoryMb;
  const cpuOk = cpuPct <= policy.maxCpuPct;
  if (!memOk || !cpuOk) {
    logViolation(agentId, "resource", `Resource limit exceeded: mem=${memoryMb}MB cpu=${cpuPct}%`, false);
    return false;
  }
  return true;
}

function logViolation(
  agentId: string,
  type: SecurityViolation["type"],
  description: string,
  blocked: boolean
): void {
  violations.push({
    violationId: `viol-${++violationCounter}`,
    agentId,
    type,
    description,
    timestamp: Date.now(),
    blocked,
  });
  console.warn(`[SecuritySandbox] ${blocked ? "BLOCKED" : "WARNED"} agent ${agentId}: ${description}`);
}

export function getViolations(agentId?: string): SecurityViolation[] {
  return agentId ? violations.filter(v => v.agentId === agentId) : [...violations];
}

export function getPolicy(agentId: string): SecurityPolicy | undefined {
  return policies.get(agentId);
}

export function _resetSecuritySandboxForTest(): void {
  policies.clear();
  violations.length = 0;
  violationCounter = 0;
}
