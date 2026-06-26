/**
 * dialecticalDebateEngine.ts — v57.0.0 "The Reasoning Engine"
 * Implements Hegelian thesis-antithesis-synthesis dialectical reasoning.
 */

export interface Argument { id: string; claim: string; strength: number; evidence: string[]; }
export interface DebateRound {
  roundId: string;
  thesis: Argument;
  antithesis: Argument;
  synthesis: string;
  synthesisStrength: number;
  winner: "thesis" | "antithesis" | "synthesis";
}

const rounds: DebateRound[] = [];
let roundCounter = 0;

export function conductDebate(thesis: Argument, antithesis: Argument): DebateRound {
  const synthesisStrength = (thesis.strength + antithesis.strength) / 2;
  const synthesis = `Synthesis: ${thesis.claim} is partially true, but ${antithesis.claim} adds nuance — both perspectives are valid in different contexts`;
  let winner: "thesis" | "antithesis" | "synthesis";
  if (Math.abs(thesis.strength - antithesis.strength) < 0.1) {
    winner = "synthesis";
  } else {
    winner = thesis.strength > antithesis.strength ? "thesis" : "antithesis";
  }
  const round: DebateRound = {
    roundId: `round-${++roundCounter}`,
    thesis, antithesis, synthesis, synthesisStrength, winner,
  };
  rounds.push(round);
  return round;
}

export function getDebateHistory(): DebateRound[] { return [...rounds]; }
export function _resetDialecticalDebateEngineForTest(): void { rounds.length = 0; roundCounter = 0; }
