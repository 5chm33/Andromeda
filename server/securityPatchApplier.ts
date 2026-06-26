/**
 * securityPatchApplier.ts — v62.0.0 "The Security Vault"
 * Manages security patch lifecycle: discovery, staging, validation, and deployment.
 */

export type PatchStatus = "pending" | "staged" | "validated" | "applied" | "failed" | "rolled_back";
export interface SecurityPatch { patchId: string; cveId: string; severity: "low" | "medium" | "high" | "critical"; description: string; status: PatchStatus; appliedAt?: number; }
export interface PatchApplicationResult { resultId: string; patchId: string; success: boolean; previousStatus: PatchStatus; newStatus: PatchStatus; validationScore: number; }

const patches = new Map<string, SecurityPatch>();
const results: PatchApplicationResult[] = [];
let pCounter = 0, rCounter = 0;

export function registerPatch(cveId: string, severity: SecurityPatch["severity"], description: string): SecurityPatch {
  const patch: SecurityPatch = { patchId: `patch-${++pCounter}`, cveId, severity, description, status: "pending" };
  patches.set(patch.patchId, patch);
  return patch;
}

export function stagePatch(patchId: string): boolean {
  const patch = patches.get(patchId);
  if (!patch || patch.status !== "pending") return false;
  patch.status = "staged";
  return true;
}

export function applyPatch(patchId: string, validationScore = 0.95): PatchApplicationResult {
  const patch = patches.get(patchId);
  if (!patch) throw new Error(`[SecurityPatchApplier] Patch not found: ${patchId}`);
  const previousStatus = patch.status;
  const success = validationScore >= 0.8 && patch.status === "staged";
  patch.status = success ? "applied" : "failed";
  if (success) patch.appliedAt = Date.now();
  const result: PatchApplicationResult = { resultId: `res-${++rCounter}`, patchId, success, previousStatus, newStatus: patch.status, validationScore };
  results.push(result);
  return result;
}

export function rollbackPatch(patchId: string): boolean {
  const patch = patches.get(patchId);
  if (!patch || patch.status !== "applied") return false;
  patch.status = "rolled_back";
  return true;
}

export function getPatchSummary(): { total: number; applied: number; pending: number; failed: number } {
  const all = [...patches.values()];
  return { total: all.length, applied: all.filter(p => p.status === "applied").length, pending: all.filter(p => p.status === "pending").length, failed: all.filter(p => p.status === "failed").length };
}

export function _resetSecurityPatchApplierForTest(): void { patches.clear(); results.length = 0; pCounter = 0; rCounter = 0; }
