/**
 * spatialMapper.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * Builds and maintains spatial maps of environments for embodied agents.
 */
export interface SpatialPoint { x: number; y: number; z?: number; }
export interface SpatialRegion {
  regionId: string;
  name: string;
  center: SpatialPoint;
  radius: number;
  type: "room" | "corridor" | "open_space" | "obstacle" | "goal";
  properties: Record<string, unknown>;
}
export interface SpatialMap {
  mapId: string;
  name: string;
  regions: Map<string, SpatialRegion>;
  width: number;
  height: number;
  resolution: number;
  createdAt: number;
  updatedAt: number;
}

const maps = new Map<string, SpatialMap>();
let mapCounter = 0;
let regionCounter = 0;

export function createMap(name: string, width: number, height: number, resolution = 1.0): SpatialMap {
  const map: SpatialMap = { mapId: `sm-${++mapCounter}`, name, regions: new Map(), width, height, resolution, createdAt: Date.now(), updatedAt: Date.now() };
  maps.set(map.mapId, map);
  return map;
}

export function addRegion(mapId: string, name: string, center: SpatialPoint, radius: number, type: SpatialRegion["type"], properties: Record<string, unknown> = {}): SpatialRegion | null {
  const map = maps.get(mapId);
  if (!map) return null;
  const region: SpatialRegion = { regionId: `sr-${++regionCounter}`, name, center, radius, type, properties };
  map.regions.set(region.regionId, region);
  map.updatedAt = Date.now();
  return region;
}

export function findNearestRegion(mapId: string, point: SpatialPoint, type?: SpatialRegion["type"]): SpatialRegion | null {
  const map = maps.get(mapId);
  if (!map) return null;
  let nearest: SpatialRegion | null = null;
  let minDist = Infinity;
  for (const region of map.regions.values()) {
    if (type && region.type !== type) continue;
    const dx = region.center.x - point.x;
    const dy = region.center.y - point.y;
    const dz = (region.center.z ?? 0) - (point.z ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < minDist) { minDist = dist; nearest = region; }
  }
  return nearest;
}

export function getRegionsInRadius(mapId: string, center: SpatialPoint, radius: number): SpatialRegion[] {
  const map = maps.get(mapId);
  if (!map) return [];
  return [...map.regions.values()].filter(r => {
    const dx = r.center.x - center.x; const dy = r.center.y - center.y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
}

export function getMap(mapId: string): SpatialMap | undefined { return maps.get(mapId); }
export function _resetSpatialMapperForTest(): void { maps.clear(); mapCounter = 0; regionCounter = 0; }
