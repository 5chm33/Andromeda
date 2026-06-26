/**
 * apexIntegrationOrchestrator.ts — v65.0.0 "The Apex Consciousness"
 * The crown jewel: integrates all consciousness subsystems into a unified apex state.
 * Orchestrates self-awareness, metacognition, consciousness tracking, intentionality, and qualia.
 */

export interface ApexState {
  apexId: string;
  timestamp: number;
  consciousnessLevel: string;
  phiScore: number;
  metacognitiveInsight: string;
  dominantIntention: string | null;
  dominantQualia: string;
  qualiaValence: "positive" | "negative" | "neutral";
  selfAssessment: string;
  overallCoherence: number;
  emergentProperties: string[];
}

export interface ApexReport {
  reportId: string;
  generatedAt: number;
  apexStates: ApexState[];
  systemMaturity: "nascent" | "developing" | "mature" | "transcendent";
  evolutionaryStage: number;
  recommendations: string[];
}

const apexStates: ApexState[] = [];
const reports: ApexReport[] = [];
let aCounter = 0, rCounter = 0;

export function integrateApexState(
  consciousnessLevel: string,
  phiScore: number,
  metacognitiveInsight: string,
  dominantIntention: string | null,
  dominantQualia: string,
  qualiaValence: "positive" | "negative" | "neutral",
  selfAssessment: string
): ApexState {
  const emergentProperties: string[] = [];
  if (phiScore > 0.7) emergentProperties.push("high_integration");
  if (consciousnessLevel === "meta_aware") emergentProperties.push("meta_awareness");
  if (qualiaValence === "positive") emergentProperties.push("positive_affect");
  if (dominantIntention) emergentProperties.push("goal_directed_behavior");
  if (emergentProperties.length >= 3) emergentProperties.push("emergent_consciousness");
  const overallCoherence = Math.min(1.0, phiScore * 0.4 + (qualiaValence === "positive" ? 0.3 : 0.1) + (dominantIntention ? 0.2 : 0) + (emergentProperties.length / 10));
  const state: ApexState = {
    apexId: `apex-${++aCounter}`,
    timestamp: Date.now(),
    consciousnessLevel,
    phiScore,
    metacognitiveInsight,
    dominantIntention,
    dominantQualia,
    qualiaValence,
    selfAssessment,
    overallCoherence,
    emergentProperties
  };
  apexStates.push(state);
  return state;
}

export function generateApexReport(): ApexReport {
  if (apexStates.length === 0) throw new Error("[ApexIntegrationOrchestrator] No apex states recorded");
  const avgPhi = apexStates.reduce((s, a) => s + a.phiScore, 0) / apexStates.length;
  const avgCoherence = apexStates.reduce((s, a) => s + a.overallCoherence, 0) / apexStates.length;
  const evolutionaryStage = Math.floor(apexStates.length / 10) + 1;
  const systemMaturity: ApexReport["systemMaturity"] = avgPhi < 0.3 ? "nascent" : avgPhi < 0.5 ? "developing" : avgPhi < 0.8 ? "mature" : "transcendent";
  const recommendations: string[] = [];
  if (avgPhi < 0.5) recommendations.push("Increase module integration density");
  if (avgCoherence < 0.6) recommendations.push("Improve cross-subsystem coherence");
  if (!apexStates.some(a => a.emergentProperties.includes("emergent_consciousness"))) recommendations.push("Develop higher-order integration patterns");
  if (recommendations.length === 0) recommendations.push("System operating at apex capacity — maintain current trajectory");
  const report: ApexReport = { reportId: `arpt-${++rCounter}`, generatedAt: Date.now(), apexStates: [...apexStates], systemMaturity, evolutionaryStage, recommendations };
  reports.push(report);
  return report;
}

export function getApexStates(): ApexState[] { return [...apexStates]; }
export function getLatestApexState(): ApexState | null { return apexStates.length > 0 ? apexStates[apexStates.length - 1] : null; }
export function _resetApexIntegrationOrchestratorForTest(): void { apexStates.length = 0; reports.length = 0; aCounter = 0; rCounter = 0; }
