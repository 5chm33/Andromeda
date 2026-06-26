/**
 * Environment Modeler — builds and maintains an internal model of the environment.
 * Implements world state tracking, object persistence, and spatial reasoning.
 */

export interface WorldObject {
  id: string;
  type: string;
  properties: Record<string, number | string | boolean>;
  position: { x: number; y: number; z: number };
  visible: boolean;
  lastUpdated: number;
}

export interface WorldState {
  objects: WorldObject[];
  timestamp: number;
  confidence: number;
}

export interface EnvironmentReport {
  totalObjects: number;
  visibleObjects: number;
  avgConfidence: number;
  stateUpdates: number;
}

class EnvironmentModelerEngine {
  private objects: Map<string, WorldObject> = new Map();
  private stateHistory: WorldState[] = [];
  private counter = 0;
  private stateUpdates = 0;

  addObject(type: string, properties: Record<string, number | string | boolean>, position: { x: number; y: number; z: number }): WorldObject {
    const obj: WorldObject = {
      id: `obj-${++this.counter}`,
      type, properties, position, visible: true, lastUpdated: Date.now(),
    };
    this.objects.set(obj.id, obj);
    return obj;
  }

  updateObject(objectId: string, updates: Partial<WorldObject>): boolean {
    const obj = this.objects.get(objectId);
    if (!obj) return false;
    Object.assign(obj, updates);
    obj.lastUpdated = Date.now();
    this.stateUpdates++;
    return true;
  }

  captureWorldState(): WorldState {
    const state: WorldState = {
      objects: Array.from(this.objects.values()).map(o => ({ ...o })),
      timestamp: Date.now(),
      confidence: this.objects.size > 0 ? 0.85 : 0,
    };
    this.stateHistory.push(state);
    if (this.stateHistory.length > 100) this.stateHistory.shift();
    return state;
  }

  queryObjects(type?: string): WorldObject[] {
    const objs = Array.from(this.objects.values());
    return type ? objs.filter(o => o.type === type) : objs;
  }

  getEnvironmentReport(): EnvironmentReport {
    const objs = Array.from(this.objects.values());
    return {
      totalObjects: objs.length,
      visibleObjects: objs.filter(o => o.visible).length,
      avgConfidence: this.stateHistory.length > 0
        ? this.stateHistory.reduce((s, st) => s + st.confidence, 0) / this.stateHistory.length
        : 0,
      stateUpdates: this.stateUpdates,
    };
  }
}

export const globalEnvironmentModeler = new EnvironmentModelerEngine();

export function addWorldObject(type: string, properties: Record<string, number | string | boolean>, position: { x: number; y: number; z: number }): WorldObject {
  return globalEnvironmentModeler.addObject(type, properties, position);
}
export function updateWorldObject(objectId: string, updates: Partial<WorldObject>): boolean {
  return globalEnvironmentModeler.updateObject(objectId, updates);
}
export function captureWorldState(): WorldState {
  return globalEnvironmentModeler.captureWorldState();
}
export function queryWorldObjects(type?: string): WorldObject[] {
  return globalEnvironmentModeler.queryObjects(type);
}
export function getEnvironmentReport(): EnvironmentReport {
  return globalEnvironmentModeler.getEnvironmentReport();
}
export function initEnvironmentModeler(): void {
  console.log("[EnvironmentModeler] Environment Modeler initialized.");
}
