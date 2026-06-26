/**
 * collectiveDecisionMaker.ts — v63.0.0 "The Collaboration Hub"
 * Implements collective decision making via weighted voting and consensus detection.
 */

export interface Vote { voterId: string; option: string; weight: number; confidence: number; }
export interface DecisionResult { decisionId: string; question: string; winner: string; votes: Vote[]; winnerScore: number; totalScore: number; consensusStrength: number; }

const decisions: DecisionResult[] = [];
let dCounter = 0;

export function makeCollectiveDecision(question: string, votes: Vote[]): DecisionResult {
  if (votes.length === 0) throw new Error("[CollectiveDecisionMaker] No votes provided");
  const scores = new Map<string, number>();
  let totalScore = 0;
  for (const vote of votes) {
    const score = vote.weight * vote.confidence;
    scores.set(vote.option, (scores.get(vote.option) ?? 0) + score);
    totalScore += score;
  }
  const winner = [...scores.entries()].reduce((a, b) => b[1] > a[1] ? b : a);
  const consensusStrength = totalScore > 0 ? winner[1] / totalScore : 0;
  const result: DecisionResult = { decisionId: `dec-${++dCounter}`, question, winner: winner[0], votes, winnerScore: winner[1], totalScore, consensusStrength };
  decisions.push(result);
  return result;
}

export function getDecisions(): DecisionResult[] { return [...decisions]; }
export function _resetCollectiveDecisionMakerForTest(): void { decisions.length = 0; dCounter = 0; }
