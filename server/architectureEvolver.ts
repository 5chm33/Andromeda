/**
 * Architecture Evolver — evolves the system architecture using NAS-inspired techniques.
 * Proposes structural changes to module topology for improved performance.
 */

export interface ArchitectureGene {
  id: string;
  moduleId: string;
  connectionPattern: "sequential" | "parallel" | "residual" | "attention";
  layerDepth: number;
  hiddenDim: number;
  activationFn: "relu" | "gelu" | "swish" | "tanh";
  fitness: number;
}

export interface ArchitectureGenome {
  id: string;
  genes: ArchitectureGene[];
  generation: number;
  fitness: number;
  parentIds: string[];
  createdAt: number;
}

export interface EvolutionReport {
  generation: number;
  populationSize: number;
  bestFitness: number;
  avgFitness: number;
  diversityScore: number;
  convergenceRate: number;
}

class ArchitectureEvolverEngine {
  private population: ArchitectureGenome[] = [];
  private generation = 0;
  private counter = 0;
  private geneCounter = 0;

  private _randomGene(moduleId: string): ArchitectureGene {
    const patterns: ArchitectureGene["connectionPattern"][] = ["sequential", "parallel", "residual", "attention"];
    const activations: ArchitectureGene["activationFn"][] = ["relu", "gelu", "swish", "tanh"];
    return {
      id: `gene-${++this.geneCounter}`,
      moduleId,
      connectionPattern: patterns[Math.floor(Math.random() * patterns.length)]!,
      layerDepth: Math.floor(Math.random() * 8) + 1,
      hiddenDim: [64, 128, 256, 512][Math.floor(Math.random() * 4)]!,
      activationFn: activations[Math.floor(Math.random() * activations.length)]!,
      fitness: Math.random() * 0.1,
    };
  }

  initializePopulation(moduleIds: string[], populationSize = 10): ArchitectureGenome[] {
    this.population = [];
    for (let i = 0; i < populationSize; i++) {
      const genome: ArchitectureGenome = {
        id: `genome-${++this.counter}`,
        genes: moduleIds.map(id => this._randomGene(id)),
        generation: 0,
        fitness: 0,
        parentIds: [],
        createdAt: Date.now(),
      };
      genome.fitness = this._evaluateFitness(genome);
      this.population.push(genome);
    }
    return this.population;
  }

  private _evaluateFitness(genome: ArchitectureGenome): number {
    // Fitness heuristic: prefer residual/attention, gelu/swish, moderate depth
    let score = 0;
    for (const gene of genome.genes) {
      if (gene.connectionPattern === "residual" || gene.connectionPattern === "attention") score += 0.2;
      if (gene.activationFn === "gelu" || gene.activationFn === "swish") score += 0.1;
      if (gene.layerDepth >= 3 && gene.layerDepth <= 6) score += 0.1;
      if (gene.hiddenDim === 256 || gene.hiddenDim === 512) score += 0.05;
    }
    return Math.min(1.0, score / Math.max(genome.genes.length, 1));
  }

  evolveGeneration(): ArchitectureGenome[] {
    this.generation++;
    // Tournament selection + crossover + mutation
    const newPop: ArchitectureGenome[] = [];
    const sorted = [...this.population].sort((a, b) => b.fitness - a.fitness);
    // Elitism: keep top 2
    newPop.push(...sorted.slice(0, 2));

    while (newPop.length < this.population.length) {
      // Tournament selection
      const parent1 = this._tournamentSelect();
      const parent2 = this._tournamentSelect();
      const child = this._crossover(parent1, parent2);
      this._mutate(child);
      child.fitness = this._evaluateFitness(child);
      newPop.push(child);
    }
    this.population = newPop;
    return this.population;
  }

  private _tournamentSelect(k = 3): ArchitectureGenome {
    const candidates = Array.from({ length: k }, () => this.population[Math.floor(Math.random() * this.population.length)]!);
    return candidates.reduce((best, c) => c.fitness > best.fitness ? c : best);
  }

  private _crossover(p1: ArchitectureGenome, p2: ArchitectureGenome): ArchitectureGenome {
    const cutPoint = Math.floor(p1.genes.length / 2);
    const genes = [...p1.genes.slice(0, cutPoint), ...p2.genes.slice(cutPoint)];
    return {
      id: `genome-${++this.counter}`,
      genes,
      generation: this.generation,
      fitness: 0,
      parentIds: [p1.id, p2.id],
      createdAt: Date.now(),
    };
  }

  private _mutate(genome: ArchitectureGenome, rate = 0.1): void {
    for (const gene of genome.genes) {
      if (Math.random() < rate) {
        const patterns: ArchitectureGene["connectionPattern"][] = ["sequential", "parallel", "residual", "attention"];
        gene.connectionPattern = patterns[Math.floor(Math.random() * patterns.length)]!;
      }
      if (Math.random() < rate) {
        gene.layerDepth = Math.floor(Math.random() * 8) + 1;
      }
    }
  }

  getBestGenome(): ArchitectureGenome | null {
    if (this.population.length === 0) return null;
    return this.population.reduce((best, g) => g.fitness > best.fitness ? g : best);
  }

  getEvolutionReport(): EvolutionReport {
    const fitnesses = this.population.map(g => g.fitness);
    const best = Math.max(...fitnesses, 0);
    const avg = fitnesses.length > 0 ? fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length : 0;
    const diversity = fitnesses.length > 1
      ? Math.sqrt(fitnesses.reduce((s, f) => s + (f - avg) ** 2, 0) / fitnesses.length)
      : 0;
    return {
      generation: this.generation,
      populationSize: this.population.length,
      bestFitness: best,
      avgFitness: avg,
      diversityScore: diversity,
      convergenceRate: this.generation > 0 ? best / this.generation : 0,
    };
  }
}

export const globalArchitectureEvolver = new ArchitectureEvolverEngine();

export function initializeArchitecturePopulation(moduleIds: string[], populationSize?: number): ArchitectureGenome[] {
  return globalArchitectureEvolver.initializePopulation(moduleIds, populationSize);
}
export function evolveArchitectureGeneration(): ArchitectureGenome[] {
  return globalArchitectureEvolver.evolveGeneration();
}
export function getBestArchitectureGenome(): ArchitectureGenome | null {
  return globalArchitectureEvolver.getBestGenome();
}
export function getEvolutionReport(): EvolutionReport {
  return globalArchitectureEvolver.getEvolutionReport();
}
export function initArchitectureEvolver(): void {
  console.log("[ArchEvolver] Architecture Evolver initialized.");
  globalArchitectureEvolver.initializePopulation(["rsiEngine", "selfImprove", "rewardModel", "safetyGuard"], 8);
  globalArchitectureEvolver.evolveGeneration();
}
