/**
 * fitnessLandscapeMapper.ts — v96.0.0 "Quantum-Inspired Optimization"
 * Maps and analyzes fitness landscapes to guide optimization strategies.
 */
export interface LandscapePoint {
  pointId: string;
  coordinates: number[];
  fitness: number;
  isLocalOptimum: boolean;
  isGlobalOptimum: boolean;
  exploredAt: number;
}

export interface LandscapeAnalysis {
  analysisId: string;
  totalPoints: number;
  globalOptimum: LandscapePoint | null;
  localOptima: LandscapePoint[];
  averageFitness: number;
  fitnessVariance: number;
  roughnessScore: number;
  modality: "unimodal" | "bimodal" | "multimodal";
}

const points: LandscapePoint[] = [];
const analyses: LandscapeAnalysis[] = [];
let pointCounter = 0;
let analysisCounter = 0;

export function addPoint(coordinates: number[], fitness: number): LandscapePoint {
  const point: LandscapePoint = { pointId: `lp-${++pointCounter}`, coordinates, fitness, isLocalOptimum: false, isGlobalOptimum: false, exploredAt: Date.now() };
  points.push(point);
  return point;
}

export function analyzeLandscape(): LandscapeAnalysis {
  if (points.length === 0) {
    const empty: LandscapeAnalysis = { analysisId: `la-${++analysisCounter}`, totalPoints: 0, globalOptimum: null, localOptima: [], averageFitness: 0, fitnessVariance: 0, roughnessScore: 0, modality: "unimodal" };
    analyses.push(empty);
    return empty;
  }

  const avgFitness = points.reduce((s, p) => s + p.fitness, 0) / points.length;
  const variance = points.reduce((s, p) => s + (p.fitness - avgFitness) ** 2, 0) / points.length;

  // Find global optimum
  const globalOpt = points.reduce((best, p) => p.fitness > best.fitness ? p : best, points[0]);
  globalOpt.isGlobalOptimum = true;

  // Find local optima (simple: points significantly above average)
  const threshold = avgFitness + Math.sqrt(variance) * 0.5;
  const localOptima = points.filter(p => p.fitness >= threshold && p !== globalOpt);
  localOptima.forEach(p => { p.isLocalOptimum = true; });

  // Roughness: coefficient of variation
  const roughnessScore = avgFitness > 0 ? Math.sqrt(variance) / avgFitness : 0;

  let modality: LandscapeAnalysis["modality"];
  if (localOptima.length === 0) modality = "unimodal";
  else if (localOptima.length === 1) modality = "bimodal";
  else modality = "multimodal";

  const analysis: LandscapeAnalysis = { analysisId: `la-${++analysisCounter}`, totalPoints: points.length, globalOptimum: globalOpt, localOptima, averageFitness: avgFitness, fitnessVariance: variance, roughnessScore, modality };
  analyses.push(analysis);
  return analysis;
}

export function getPoints(): LandscapePoint[] { return [...points]; }
export function getLatestAnalysis(): LandscapeAnalysis | null { return analyses.length > 0 ? analyses[analyses.length - 1] : null; }
export function _resetFitnessLandscapeMapperForTest(): void { points.length = 0; analyses.length = 0; pointCounter = 0; analysisCounter = 0; }
