/**
 * fewShotLearner.ts — v90.0.0 "Adaptive Learning & Meta-Learning"
 * Few-shot learning system using prototypical networks and nearest-neighbor classification.
 */
export interface Prototype {
  classLabel: string;
  centroid: number[];
  supportCount: number;
  variance: number;
}

export interface FewShotEpisode {
  episodeId: string;
  nWay: number;
  kShot: number;
  queryCount: number;
  accuracy: number;
  prototypes: Prototype[];
  completedAt: number;
}

export interface FewShotClassifier {
  classifierId: string;
  name: string;
  embeddingDim: number;
  prototypes: Map<string, Prototype>;
  episodes: FewShotEpisode[];
  avgAccuracy: number;
}

const classifiers = new Map<string, FewShotClassifier>();
let classifierCounter = 0;
let episodeCounter = 0;

function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((s, v, i) => s + (v - (b[i] ?? 0)) ** 2, 0));
}

function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const emb of embeddings) for (let i = 0; i < dim; i++) centroid[i] += emb[i];
  return centroid.map(v => v / embeddings.length);
}

export function createFewShotClassifier(name: string, embeddingDim: number): FewShotClassifier {
  const classifier: FewShotClassifier = {
    classifierId: `fs-${++classifierCounter}`,
    name, embeddingDim,
    prototypes: new Map(),
    episodes: [],
    avgAccuracy: 0,
  };
  classifiers.set(classifier.classifierId, classifier);
  return classifier;
}

export function buildPrototypes(classifierId: string, supportSet: Array<{ label: string; embedding: number[] }>): Prototype[] {
  const classifier = classifiers.get(classifierId);
  if (!classifier) return [];

  const grouped: Record<string, number[][]> = {};
  for (const s of supportSet) {
    if (!grouped[s.label]) grouped[s.label] = [];
    grouped[s.label].push(s.embedding);
  }

  const prototypes: Prototype[] = [];
  for (const [label, embeddings] of Object.entries(grouped)) {
    const centroid = computeCentroid(embeddings);
    const variance = embeddings.length > 1 ? embeddings.reduce((s, e) => s + euclideanDistance(e, centroid) ** 2, 0) / embeddings.length : 0;
    const proto: Prototype = { classLabel: label, centroid, supportCount: embeddings.length, variance };
    classifier.prototypes.set(label, proto);
    prototypes.push(proto);
  }
  return prototypes;
}

export function classify(classifierId: string, queryEmbedding: number[]): { label: string; distance: number; confidence: number } | null {
  const classifier = classifiers.get(classifierId);
  if (!classifier || classifier.prototypes.size === 0) return null;

  let bestLabel = "";
  let bestDistance = Infinity;
  const distances: Record<string, number> = {};

  for (const [label, proto] of classifier.prototypes) {
    const dist = euclideanDistance(queryEmbedding, proto.centroid);
    distances[label] = dist;
    if (dist < bestDistance) { bestDistance = dist; bestLabel = label; }
  }

  // Softmax-like confidence
  const totalInvDist = Object.values(distances).reduce((s, d) => s + (d > 0 ? 1 / d : 1000), 0);
  const confidence = bestDistance > 0 ? (1 / bestDistance) / totalInvDist : 1;
  return { label: bestLabel, distance: bestDistance, confidence };
}

export function runEpisode(classifierId: string, supportSet: Array<{ label: string; embedding: number[] }>, querySet: Array<{ label: string; embedding: number[] }>): FewShotEpisode | null {
  const classifier = classifiers.get(classifierId);
  if (!classifier) return null;

  const prototypes = buildPrototypes(classifierId, supportSet);
  const nWay = new Set(supportSet.map(s => s.label)).size;
  const kShot = Math.floor(supportSet.length / nWay);

  let correct = 0;
  for (const q of querySet) {
    const result = classify(classifierId, q.embedding);
    if (result?.label === q.label) correct++;
  }
  const accuracy = querySet.length > 0 ? correct / querySet.length : 0;

  const episode: FewShotEpisode = {
    episodeId: `fse-${++episodeCounter}`,
    nWay, kShot, queryCount: querySet.length, accuracy, prototypes,
    completedAt: Date.now(),
  };
  classifier.episodes.push(episode);
  classifier.avgAccuracy = classifier.episodes.reduce((s, e) => s + e.accuracy, 0) / classifier.episodes.length;
  return episode;
}

export function getClassifier(classifierId: string): FewShotClassifier | undefined { return classifiers.get(classifierId); }
export function _resetFewShotLearnerForTest(): void { classifiers.clear(); classifierCounter = 0; episodeCounter = 0; }
