/**
 * saliencyMapper.ts — v88.0.0 "Explainability & Interpretability"
 * Generates saliency maps and attention heatmaps for model input attribution.
 */
export interface SaliencyRegion {
  regionId: string;
  label: string;
  startIndex: number;
  endIndex: number;
  saliencyScore: number;
  normalizedScore: number;
  attributionMethod: string;
}

export interface SaliencyMap {
  mapId: string;
  inputId: string;
  inputType: "text" | "image" | "tabular";
  regions: SaliencyRegion[];
  method: string;
  topRegions: SaliencyRegion[];
  computedAt: number;
}

const saliencyMaps: SaliencyMap[] = [];
let mapCounter = 0;
let regionCounter = 0;

export function generateTextSaliency(inputId: string, tokens: string[], scores: number[], method = "gradient"): SaliencyMap {
  const maxScore = Math.max(...scores, 1e-9);
  const regions: SaliencyRegion[] = tokens.map((token, i) => ({
    regionId: `reg-${++regionCounter}`,
    label: token,
    startIndex: i,
    endIndex: i + 1,
    saliencyScore: scores[i] ?? 0,
    normalizedScore: (scores[i] ?? 0) / maxScore,
    attributionMethod: method,
  }));

  const sorted = [...regions].sort((a, b) => b.saliencyScore - a.saliencyScore);
  const map: SaliencyMap = {
    mapId: `sm-${++mapCounter}`,
    inputId, inputType: "text",
    regions, method,
    topRegions: sorted.slice(0, 5),
    computedAt: Date.now(),
  };
  saliencyMaps.push(map);
  return map;
}

export function generateTabularSaliency(inputId: string, features: Record<string, number>, method = "shap"): SaliencyMap {
  const entries = Object.entries(features);
  const maxScore = Math.max(...entries.map(([, v]) => Math.abs(v)), 1e-9);
  const regions: SaliencyRegion[] = entries.map(([name, score], i) => ({
    regionId: `reg-${++regionCounter}`,
    label: name,
    startIndex: i,
    endIndex: i + 1,
    saliencyScore: Math.abs(score),
    normalizedScore: Math.abs(score) / maxScore,
    attributionMethod: method,
  }));

  const sorted = [...regions].sort((a, b) => b.saliencyScore - a.saliencyScore);
  const map: SaliencyMap = {
    mapId: `sm-${++mapCounter}`,
    inputId, inputType: "tabular",
    regions, method,
    topRegions: sorted.slice(0, 5),
    computedAt: Date.now(),
  };
  saliencyMaps.push(map);
  return map;
}

export function getSaliencyMap(mapId: string): SaliencyMap | undefined { return saliencyMaps.find(m => m.mapId === mapId); }
export function getHighSaliencyRegions(mapId: string, threshold = 0.7): SaliencyRegion[] {
  const map = getSaliencyMap(mapId);
  return map?.regions.filter(r => r.normalizedScore >= threshold) ?? [];
}
export function _resetSaliencyMapperForTest(): void { saliencyMaps.length = 0; mapCounter = 0; regionCounter = 0; }
