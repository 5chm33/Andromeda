import { createLogger } from "./logger.js";
const log = createLogger("CanaryDeployer");
/**
 * canaryDeployer.ts — v77.0.0 "Feature Flags & Experimentation"
 * Manages canary deployments with traffic splitting, health checks, and automatic rollback triggers.
 */
export type CanaryStatus = "pending" | "active" | "promoting" | "rolled_back" | "completed";

export interface CanaryDeployment {
  deploymentId: string;
  serviceName: string;
  stableVersion: string;
  canaryVersion: string;
  canaryTrafficPercent: number;
  status: CanaryStatus;
  healthChecksPassed: number;
  healthChecksFailed: number;
  autoRollbackThreshold: number;
  createdAt: number;
  updatedAt: number;
}

const deployments = new Map<string, CanaryDeployment>();
let deploymentCounter = 0;

export function createCanaryDeployment(serviceName: string, stableVersion: string, canaryVersion: string, initialTrafficPercent = 5, autoRollbackThreshold = 3): CanaryDeployment {
  const deployment: CanaryDeployment = {
    deploymentId: `canary-${++deploymentCounter}`,
    serviceName, stableVersion, canaryVersion,
    canaryTrafficPercent: initialTrafficPercent,
    status: "pending",
    healthChecksPassed: 0, healthChecksFailed: 0,
    autoRollbackThreshold,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  deployments.set(deployment.deploymentId, deployment);
  log.info(`[CanaryDeployer] Created canary: ${serviceName} ${stableVersion} → ${canaryVersion} (${initialTrafficPercent}%)`);
  return deployment;
}

export function activateCanary(deploymentId: string): boolean {
  const d = deployments.get(deploymentId);
  if (!d || d.status !== "pending") return false;
  d.status = "active";
  d.updatedAt = Date.now();
  return true;
}

export function recordHealthCheck(deploymentId: string, passed: boolean): { rolledBack: boolean } {
  const d = deployments.get(deploymentId);
  if (!d || d.status !== "active") return { rolledBack: false };
  if (passed) { d.healthChecksPassed++; }
  else {
    d.healthChecksFailed++;
    if (d.healthChecksFailed >= d.autoRollbackThreshold) {
      d.status = "rolled_back";
      d.canaryTrafficPercent = 0;
      d.updatedAt = Date.now();
      log.info(`[CanaryDeployer] Auto-rollback triggered for ${d.serviceName} after ${d.healthChecksFailed} failures`);
      return { rolledBack: true };
    }
  }
  d.updatedAt = Date.now();
  return { rolledBack: false };
}

export function promoteCanary(deploymentId: string): boolean {
  const d = deployments.get(deploymentId);
  if (!d || d.status !== "active") return false;
  d.status = "completed";
  d.canaryTrafficPercent = 100;
  d.updatedAt = Date.now();
  log.info(`[CanaryDeployer] Promoted canary: ${d.serviceName} → ${d.canaryVersion}`);
  return true;
}

export function increaseCanaryTraffic(deploymentId: string, newPercent: number): boolean {
  const d = deployments.get(deploymentId);
  if (!d || d.status !== "active") return false;
  d.canaryTrafficPercent = Math.min(newPercent, 100);
  d.updatedAt = Date.now();
  return true;
}

export function getDeployment(deploymentId: string): CanaryDeployment | undefined { return deployments.get(deploymentId); }
export function getAllDeployments(): CanaryDeployment[] { return [...deployments.values()]; }
export function _resetCanaryDeployerForTest(): void { deployments.clear(); deploymentCounter = 0; }
