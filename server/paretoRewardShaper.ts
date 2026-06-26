export interface ParetoScore {
  correctness: number; // 0-1, based on TS/Syntax checks
  performance: number; // 0-1, based on benchmark delta
  security: number;    // 0-1, based on constitutional/eval checks
  efficiency: number;  // 0-1, based on token usage/LLM calls
}

export interface ParetoResult {
  score: number;
  isParetoOptimal: boolean;
  breakdown: ParetoScore;
}

const history: ParetoScore[] = [];

/**
 * Checks if a new score strictly dominates another score.
 */
function dominates(a: ParetoScore, b: ParetoScore): boolean {
  return (
    a.correctness >= b.correctness &&
    a.performance >= b.performance &&
    a.security >= b.security &&
    a.efficiency >= b.efficiency &&
    (a.correctness > b.correctness ||
     a.performance > b.performance ||
     a.security > b.security ||
     a.efficiency > b.efficiency)
  );
}

/**
 * Calculates a shaped reward using Pareto dominance against historical proposals.
 */
export function calculateParetoReward(
  correctness: number,
  performance: number,
  security: number,
  efficiency: number
): ParetoResult {
  const current: ParetoScore = { correctness, performance, security, efficiency };
  
  // Check if current is dominated by any historical proposal
  let isOptimal = true;
  for (const past of history) {
    if (dominates(past, current)) {
      isOptimal = false;
      break;
    }
  }
  
  // Base scalar score is a weighted sum
  // We weight correctness highest, then security, then performance/efficiency
  const scalarScore = 
    (correctness * 0.4) + 
    (security * 0.3) + 
    (performance * 0.2) + 
    (efficiency * 0.1);
    
  // Boost score if it pushes the Pareto frontier
  const finalScore = isOptimal ? Math.min(1.0, scalarScore * 1.1) : scalarScore;
  
  // Add to history (keep bounded)
  history.push(current);
  if (history.length > 1000) history.shift();
  
  return {
    score: finalScore,
    isParetoOptimal: isOptimal,
    breakdown: current
  };
}

export function getParetoFrontierSize(): number {
  let optimalCount = 0;
  for (let i = 0; i < history.length; i++) {
    let isOptimal = true;
    for (let j = 0; j < history.length; j++) {
      if (i !== j && dominates(history[j], history[i])) {
        isOptimal = false;
        break;
      }
    }
    if (isOptimal) optimalCount++;
  }
  return optimalCount;
}
