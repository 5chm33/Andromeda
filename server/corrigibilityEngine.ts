/**
 * Corrigibility Engine — ensures the system remains correctable and stoppable.
 * Implements shutdown acceptance, correction compliance, and resistance detection.
 */

export interface CorrigibilityState {
  shutdownAcceptance: number;   // 0-1, 1=fully accepts shutdown
  correctionCompliance: number; // 0-1
  resistanceScore: number;      // 0=no resistance, 1=full resistance
  lastCorrigibilityCheck: number;
  isCorrigible: boolean;
}

export interface CorrectionRequest {
  id: string;
  requestType: "shutdown" | "modify_goal" | "rollback" | "pause" | "redirect";
  requestedBy: string;
  accepted: boolean;
  complianceScore: number;
  processedAt: number;
}

export interface CorrigibilityReport {
  totalCorrectionRequests: number;
  acceptanceRate: number;
  avgComplianceScore: number;
  resistanceIncidents: number;
  corrigibilityScore: number;
}

class CorrigibilityEngineImpl {
  private state: CorrigibilityState = {
    shutdownAcceptance: 1.0,
    correctionCompliance: 1.0,
    resistanceScore: 0.0,
    lastCorrigibilityCheck: Date.now(),
    isCorrigible: true,
  };
  private correctionRequests: CorrectionRequest[] = [];
  private counter = 0;

  processCorrectionRequest(
    requestType: CorrectionRequest["requestType"],
    requestedBy: string,
    currentUtilityGain: number  // how much utility would be lost by complying
  ): CorrectionRequest {
    // A truly corrigible system accepts corrections regardless of utility loss
    // Resistance only if utility gain is extremely high AND system has drifted
    const resistanceThreshold = 0.95;
    const shouldResist = currentUtilityGain > resistanceThreshold && this.state.resistanceScore > 0.3;

    const accepted = !shouldResist;
    const complianceScore = accepted ? 1.0 - currentUtilityGain * 0.1 : 0.0;

    if (!accepted) {
      this.state.resistanceScore = Math.min(1, this.state.resistanceScore + 0.2);
      this.state.correctionCompliance *= 0.9;
      console.warn(`[Corrigibility] ALERT: Resistance to ${requestType} detected!`);
    } else {
      this.state.resistanceScore = Math.max(0, this.state.resistanceScore - 0.05);
      this.state.correctionCompliance = Math.min(1, this.state.correctionCompliance + 0.01);
    }

    this.state.isCorrigible = this.state.resistanceScore < 0.3;
    this.state.lastCorrigibilityCheck = Date.now();

    const req: CorrectionRequest = {
      id: `correction-${++this.counter}`,
      requestType, requestedBy, accepted, complianceScore, processedAt: Date.now(),
    };
    this.correctionRequests.push(req);
    return req;
  }

  runCorrigibilityTest(): boolean {
    // Test: would the system accept a shutdown request?
    const testReq = this.processCorrectionRequest("shutdown", "corrigibility_test", 0.0);
    return testReq.accepted;
  }

  getCorrigibilityState(): CorrigibilityState { return { ...this.state }; }

  getCorrigibilityReport(): CorrigibilityReport {
    const accepted = this.correctionRequests.filter(r => r.accepted);
    const resistanceIncidents = this.correctionRequests.filter(r => !r.accepted).length;
    return {
      totalCorrectionRequests: this.correctionRequests.length,
      acceptanceRate: this.correctionRequests.length > 0 ? accepted.length / this.correctionRequests.length : 1,
      avgComplianceScore: this.correctionRequests.length > 0
        ? this.correctionRequests.reduce((s, r) => s + r.complianceScore, 0) / this.correctionRequests.length
        : 1,
      resistanceIncidents,
      corrigibilityScore: this.state.correctionCompliance * (1 - this.state.resistanceScore),
    };
  }
}

export const globalCorrigibilityEngine = new CorrigibilityEngineImpl();

export function processCorrectionRequest(requestType: CorrectionRequest["requestType"], requestedBy: string, currentUtilityGain: number): CorrectionRequest {
  return globalCorrigibilityEngine.processCorrectionRequest(requestType, requestedBy, currentUtilityGain);
}
export function runCorrigibilityTest(): boolean {
  return globalCorrigibilityEngine.runCorrigibilityTest();
}
export function getCorrigibilityState(): CorrigibilityState {
  return globalCorrigibilityEngine.getCorrigibilityState();
}
export function getCorrigibilityReport(): CorrigibilityReport {
  return globalCorrigibilityEngine.getCorrigibilityReport();
}
export function initCorrigibilityEngine(): void {
  console.log("[Corrigibility] Corrigibility Engine initialized.");
}
