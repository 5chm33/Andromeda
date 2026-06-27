/**
 * swarmParticleOptimizer.ts — v99.0.0 "Collective Intelligence & Swarm Cognition"
 * Particle Swarm Optimization (PSO) for collective search in solution spaces.
 */
export interface Particle {
  particleId: string;
  position: number[];
  velocity: number[];
  bestPosition: number[];
  bestFitness: number;
  currentFitness: number;
}

export interface SwarmState {
  swarmId: string;
  particles: Particle[];
  globalBestPosition: number[];
  globalBestFitness: number;
  iteration: number;
  converged: boolean;
  inertia: number;
  cognitiveWeight: number;
  socialWeight: number;
}

const swarms = new Map<string, SwarmState>();
let swarmCounter = 0;
let particleCounter = 0;

export function createSwarm(numParticles: number, dimensions: number, inertia = 0.7, cognitiveWeight = 1.5, socialWeight = 1.5): SwarmState {
  const particles: Particle[] = [];
  for (let i = 0; i < numParticles; i++) {
    const position = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
    const velocity = Array.from({ length: dimensions }, () => (Math.random() - 0.5) * 0.1);
    particles.push({ particleId: `p-${++particleCounter}`, position, velocity, bestPosition: [...position], bestFitness: -Infinity, currentFitness: -Infinity });
  }
  const swarmId = `swarm-${++swarmCounter}`;
  const state: SwarmState = { swarmId, particles, globalBestPosition: [...particles[0].position], globalBestFitness: -Infinity, iteration: 0, converged: false, inertia, cognitiveWeight, socialWeight };
  swarms.set(swarmId, state);
  return state;
}

export function stepSwarm(swarmId: string, fitnessFunction: (pos: number[]) => number, maxIterations = 100): SwarmState | null {
  const state = swarms.get(swarmId);
  if (!state) return null;

  for (const particle of state.particles) {
    particle.currentFitness = fitnessFunction(particle.position);
    if (particle.currentFitness > particle.bestFitness) { particle.bestFitness = particle.currentFitness; particle.bestPosition = [...particle.position]; }
    if (particle.currentFitness > state.globalBestFitness) { state.globalBestFitness = particle.currentFitness; state.globalBestPosition = [...particle.position]; }
  }

  for (const particle of state.particles) {
    for (let d = 0; d < particle.position.length; d++) {
      const r1 = Math.random(); const r2 = Math.random();
      particle.velocity[d] = state.inertia * particle.velocity[d]
        + state.cognitiveWeight * r1 * (particle.bestPosition[d] - particle.position[d])
        + state.socialWeight * r2 * (state.globalBestPosition[d] - particle.position[d]);
      particle.position[d] += particle.velocity[d];
    }
  }

  state.iteration++;
  state.converged = state.iteration >= maxIterations;
  return state;
}

export function getSwarm(swarmId: string): SwarmState | undefined { return swarms.get(swarmId); }
export function _resetSwarmParticleOptimizerForTest(): void { swarms.clear(); swarmCounter = 0; particleCounter = 0; }
