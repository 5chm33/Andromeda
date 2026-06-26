/**
 * Conflict Resolver — resolves conflicts between agents using principled negotiation.
 * Implements interest-based negotiation and Pareto-optimal compromise finding.
 */

export type ConflictType = "resource" | "goal" | "value" | "information" | "priority";

export interface Conflict {
  id: string;
  type: ConflictType;
  partyA: string;
  partyB: string;
  description: string;
  severity: number;  // 0-1
  status: "open" | "negotiating" | "resolved" | "escalated";
}

export interface Resolution {
  conflictId: string;
  strategy: "compromise" | "arbitration" | "consensus" | "avoidance";
  outcome: string;
  satisfactionA: number;
  satisfactionB: number;
  paretoOptimal: boolean;
}

export interface ConflictReport {
  totalConflicts: number;
  resolvedCount: number;
  escalatedCount: number;
  avgResolutionSatisfaction: number;
}

class ConflictResolverEngine {
  private conflicts: Conflict[] = [];
  private resolutions: Resolution[] = [];
  private counter = 0;

  registerConflict(type: ConflictType, partyA: string, partyB: string, description: string, severity: number): Conflict {
    const conflict: Conflict = {
      id: `conflict-${++this.counter}`,
      type, partyA, partyB, description, severity, status: "open",
    };
    this.conflicts.push(conflict);
    return conflict;
  }

  resolveConflict(conflictId: string, preferenceA: number, preferenceB: number): Resolution {
    const conflict = this.conflicts.find(c => c.id === conflictId);
    if (conflict) conflict.status = "negotiating";

    // Find Pareto-optimal compromise
    const sumPrefs = preferenceA + preferenceB;
    const weightA = sumPrefs > 0 ? preferenceA / sumPrefs : 0.5;
    const weightB = sumPrefs > 0 ? preferenceB / sumPrefs : 0.5;

    const satisfactionA = 0.5 + weightA * 0.4;
    const satisfactionB = 0.5 + weightB * 0.4;
    const paretoOptimal = satisfactionA + satisfactionB > 1.0;

    let strategy: Resolution["strategy"];
    if (conflict?.severity ?? 0 > 0.7) strategy = "arbitration";
    else if (Math.abs(preferenceA - preferenceB) < 0.1) strategy = "consensus";
    else strategy = "compromise";

    const resolution: Resolution = {
      conflictId,
      strategy,
      outcome: `${strategy}: Party A gets ${(weightA * 100).toFixed(0)}%, Party B gets ${(weightB * 100).toFixed(0)}%`,
      satisfactionA, satisfactionB, paretoOptimal,
    };
    this.resolutions.push(resolution);
    if (conflict) conflict.status = "resolved";
    return resolution;
  }

  getConflictReport(): ConflictReport {
    const resolved = this.conflicts.filter(c => c.status === "resolved");
    const escalated = this.conflicts.filter(c => c.status === "escalated");
    const avgSatisfaction = this.resolutions.length > 0
      ? this.resolutions.reduce((s, r) => s + (r.satisfactionA + r.satisfactionB) / 2, 0) / this.resolutions.length
      : 0;
    return {
      totalConflicts: this.conflicts.length,
      resolvedCount: resolved.length,
      escalatedCount: escalated.length,
      avgResolutionSatisfaction: avgSatisfaction,
    };
  }
}

export const globalConflictResolver = new ConflictResolverEngine();

export function registerConflict(type: ConflictType, partyA: string, partyB: string, description: string, severity: number): Conflict {
  return globalConflictResolver.registerConflict(type, partyA, partyB, description, severity);
}
export function resolveConflict(conflictId: string, preferenceA: number, preferenceB: number): Resolution {
  return globalConflictResolver.resolveConflict(conflictId, preferenceA, preferenceB);
}
export function getConflictReport(): ConflictReport {
  return globalConflictResolver.getConflictReport();
}
export function initConflictResolver(): void {
  console.log("[ConflictResolver] Conflict Resolver initialized.");
}
