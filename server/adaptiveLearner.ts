/**
 * adaptiveLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Adapts model behavior based on feedback signals and performance metrics.
 */
export interface FeedbackSignal {
  signalId: string;
  agentId: string;
  taskId: string;
  action: string;
  outcome: "success" | "failure" | "partial";
  reward: number;
  context: Record<string, unknown>;
  timestamp: number;
}

export interface AdaptationRule {
  ruleId: string;
  condition: string;
  adjustment: string;
  magnitude: number;
  triggerCount: number;
  lastTriggered: number | null;
}

export interface AdaptiveLearnerState {
  learnerId: string;
  agentId: string;
  performanceHistory: number[];
  currentPerformance: number;
  adaptationRules: AdaptationRule[];
  feedbackBuffer: FeedbackSignal[];
  adaptationCount: number;
  lastAdaptedAt: number | null;
}

const learners = new Map<string, AdaptiveLearnerState>();
let learnerCounter = 0;
let signalCounter = 0;
let ruleCounter = 0;

export function createAdaptiveLearner(agentId: string): AdaptiveLearnerState {
  const learner: AdaptiveLearnerState = {
    learnerId: `al-${++learnerCounter}`,
    agentId, performanceHistory: [],
    currentPerformance: 0.5,
    adaptationRules: [], feedbackBuffer: [],
    adaptationCount: 0, lastAdaptedAt: null,
  };
  learners.set(learner.learnerId, learner);
  return learner;
}

export function addAdaptationRule(learnerId: string, condition: string, adjustment: string, magnitude: number): AdaptationRule | null {
  const learner = learners.get(learnerId);
  if (!learner) return null;
  const rule: AdaptationRule = { ruleId: `rule-${++ruleCounter}`, condition, adjustment, magnitude, triggerCount: 0, lastTriggered: null };
  learner.adaptationRules.push(rule);
  return rule;
}

export function processFeedback(learnerId: string, taskId: string, action: string, outcome: FeedbackSignal["outcome"], reward: number, context: Record<string, unknown> = {}): FeedbackSignal | null {
  const learner = learners.get(learnerId);
  if (!learner) return null;

  const signal: FeedbackSignal = {
    signalId: `sig-${++signalCounter}`,
    agentId: learner.agentId, taskId, action, outcome, reward, context,
    timestamp: Date.now(),
  };
  learner.feedbackBuffer.push(signal);
  if (learner.feedbackBuffer.length > 100) learner.feedbackBuffer.shift();

  // Update performance (exponential moving average)
  const rewardNorm = Math.max(-1, Math.min(1, reward));
  learner.currentPerformance = 0.9 * learner.currentPerformance + 0.1 * ((rewardNorm + 1) / 2);
  learner.performanceHistory.push(learner.currentPerformance);

  // Trigger adaptation rules
  for (const rule of learner.adaptationRules) {
    let triggered = false;
    if (rule.condition === "low_performance" && learner.currentPerformance < 0.3) triggered = true;
    if (rule.condition === "high_failure_rate" && outcome === "failure") triggered = true;
    if (rule.condition === "reward_positive" && reward > 0) triggered = true;
    if (triggered) { rule.triggerCount++; rule.lastTriggered = Date.now(); learner.adaptationCount++; learner.lastAdaptedAt = Date.now(); }
  }
  return signal;
}

export function getPerformanceTrend(learnerId: string, windowSize = 10): "improving" | "declining" | "stable" {
  const learner = learners.get(learnerId);
  if (!learner || learner.performanceHistory.length < 2) return "stable";
  const history = learner.performanceHistory.slice(-windowSize);
  if (history.length < 2) return "stable";
  const first = history.slice(0, Math.floor(history.length / 2)).reduce((s, v) => s + v, 0) / Math.floor(history.length / 2);
  const last = history.slice(Math.floor(history.length / 2)).reduce((s, v) => s + v, 0) / Math.ceil(history.length / 2);
  if (last - first > 0.05) return "improving";
  if (first - last > 0.05) return "declining";
  return "stable";
}

export function getLearner(learnerId: string): AdaptiveLearnerState | undefined { return learners.get(learnerId); }
export function _resetAdaptiveLearnerForTest(): void { learners.clear(); learnerCounter = 0; signalCounter = 0; ruleCounter = 0; }
