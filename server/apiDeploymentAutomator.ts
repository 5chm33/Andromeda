/**
 * apiDeploymentAutomator.ts — v54.0.0
 *
 * Automates API integration deployment: environment configuration,
 * staged rollouts, health validation, and rollback triggers.
 */

export type DeploymentStage = "staging" | "canary" | "production";
export type DeploymentStatus = "pending" | "deploying" | "healthy" | "failed" | "rolled-back";

export interface DeploymentConfig {
  deploymentId: string;
  apiId: string;
  version: string;
  stage: DeploymentStage;
  canaryPercent?: number;  // 0-100 for canary stage
  healthCheckUrl?: string;
  rollbackOnFailure: boolean;
}

export interface DeploymentRecord {
  deploymentId: string;
  apiId: string;
  version: string;
  stage: DeploymentStage;
  status: DeploymentStatus;
  startedAt: number;
  completedAt?: number;
  healthChecks: Array<{ passed: boolean; checkedAt: number }>;
  rollbackReason?: string;
}

const deployments = new Map<string, DeploymentRecord>();
let deployCounter = 0;

export function startDeployment(config: Omit<DeploymentConfig, "deploymentId">): DeploymentRecord {
  const deploymentId = `deploy-${++deployCounter}`;
  const record: DeploymentRecord = {
    deploymentId,
    apiId: config.apiId,
    version: config.version,
    stage: config.stage,
    status: "deploying",
    startedAt: Date.now(),
    healthChecks: [],
  };
  deployments.set(deploymentId, record);
  return record;
}

export function recordHealthCheck(deploymentId: string, passed: boolean): void {
  const record = deployments.get(deploymentId);
  if (!record) throw new Error(`[DeploymentAutomator] Deployment "${deploymentId}" not found`);
  record.healthChecks.push({ passed, checkedAt: Date.now() });
}

export function finalizeDeployment(deploymentId: string, success: boolean, rollbackReason?: string): DeploymentRecord {
  const record = deployments.get(deploymentId);
  if (!record) throw new Error(`[DeploymentAutomator] Deployment "${deploymentId}" not found`);

  record.status = success ? "healthy" : (rollbackReason ? "rolled-back" : "failed");
  record.completedAt = Date.now();
  if (rollbackReason) record.rollbackReason = rollbackReason;
  return record;
}

export function getDeploymentRecord(deploymentId: string): DeploymentRecord | undefined {
  return deployments.get(deploymentId);
}

export function getDeploymentsByApi(apiId: string): DeploymentRecord[] {
  return Array.from(deployments.values()).filter(d => d.apiId === apiId);
}

export function _resetDeploymentAutomatorForTest(): void {
  deployments.clear();
  deployCounter = 0;
}
