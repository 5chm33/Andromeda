/**
 * attentionMechanism.ts — v91.0.0 "Cognitive Architecture & Memory Systems"
 * Selective attention mechanism that focuses cognitive resources on relevant stimuli.
 */
export interface Stimulus {
  stimulusId: string;
  type: string;
  content: unknown;
  saliency: number;
  relevance: number;
  urgency: number;
  timestamp: number;
}

export interface AttentionFocus {
  focusId: string;
  agentId: string;
  topStimuli: Stimulus[];
  attentionWeights: Record<string, number>;
  focusedAt: number;
  bandwidth: number;
}

export interface AttentionController {
  controllerId: string;
  agentId: string;
  stimulusBuffer: Stimulus[];
  currentFocus: AttentionFocus | null;
  focusHistory: AttentionFocus[];
  filterThreshold: number;
  maxBufferSize: number;
}

const controllers = new Map<string, AttentionController>();
let controllerCounter = 0;
let stimulusCounter = 0;
let focusCounter = 0;

export function createAttentionController(agentId: string, filterThreshold = 0.3, maxBufferSize = 50): AttentionController {
  const controller: AttentionController = { controllerId: `ac-${++controllerCounter}`, agentId, stimulusBuffer: [], currentFocus: null, focusHistory: [], filterThreshold, maxBufferSize };
  controllers.set(controller.controllerId, controller);
  return controller;
}

export function addStimulus(controllerId: string, type: string, content: unknown, saliency: number, relevance: number, urgency: number): Stimulus | null {
  const controller = controllers.get(controllerId);
  if (!controller) return null;
  const stimulus: Stimulus = { stimulusId: `stim-${++stimulusCounter}`, type, content, saliency, relevance, urgency, timestamp: Date.now() };
  if (saliency >= controller.filterThreshold || urgency > 0.8) {
    controller.stimulusBuffer.push(stimulus);
    if (controller.stimulusBuffer.length > controller.maxBufferSize) controller.stimulusBuffer.shift();
  }
  return stimulus;
}

export function computeAttention(controllerId: string, bandwidth = 3): AttentionFocus | null {
  const controller = controllers.get(controllerId);
  if (!controller || controller.stimulusBuffer.length === 0) return null;

  // Score each stimulus: combined saliency, relevance, urgency
  const scored = controller.stimulusBuffer.map(s => ({ stimulus: s, score: 0.3 * s.saliency + 0.4 * s.relevance + 0.3 * s.urgency }));
  scored.sort((a, b) => b.score - a.score);
  const topStimuli = scored.slice(0, bandwidth).map(s => s.stimulus);

  // Compute softmax weights
  const scores = scored.slice(0, bandwidth).map(s => s.score);
  const expScores = scores.map(s => Math.exp(s));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const attentionWeights: Record<string, number> = {};
  topStimuli.forEach((s, i) => { attentionWeights[s.stimulusId] = expScores[i] / sumExp; });

  const focus: AttentionFocus = { focusId: `focus-${++focusCounter}`, agentId: controller.agentId, topStimuli, attentionWeights, focusedAt: Date.now(), bandwidth };
  controller.currentFocus = focus;
  controller.focusHistory.push(focus);
  return focus;
}

export function getController(controllerId: string): AttentionController | undefined { return controllers.get(controllerId); }
export function clearBuffer(controllerId: string): void { const c = controllers.get(controllerId); if (c) c.stimulusBuffer = []; }
export function _resetAttentionMechanismForTest(): void { controllers.clear(); controllerCounter = 0; stimulusCounter = 0; focusCounter = 0; }
