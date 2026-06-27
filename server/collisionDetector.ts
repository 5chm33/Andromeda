/**
 * collisionDetector.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * Detects collisions between embodied agents and environmental objects.
 */
export interface BoundingBox { x: number; y: number; width: number; height: number; }
export interface CollisionObject {
  objectId: string;
  name: string;
  boundingBox: BoundingBox;
  solid: boolean;
  tags: string[];
}
export interface CollisionResult {
  resultId: string;
  objectAId: string;
  objectBId: string;
  colliding: boolean;
  overlapX: number;
  overlapY: number;
  penetrationDepth: number;
  detectedAt: number;
}

const objects = new Map<string, CollisionObject>();
const results: CollisionResult[] = [];
let objectCounter = 0;
let resultCounter = 0;

export function registerObject(name: string, boundingBox: BoundingBox, solid = true, tags: string[] = []): CollisionObject {
  const obj: CollisionObject = { objectId: `co-${++objectCounter}`, name, boundingBox, solid, tags };
  objects.set(obj.objectId, obj);
  return obj;
}

export function updatePosition(objectId: string, x: number, y: number): boolean {
  const obj = objects.get(objectId);
  if (!obj) return false;
  obj.boundingBox.x = x; obj.boundingBox.y = y;
  return true;
}

function checkAABB(a: BoundingBox, b: BoundingBox): { colliding: boolean; overlapX: number; overlapY: number; depth: number } {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const colliding = overlapX > 0 && overlapY > 0;
  return { colliding, overlapX: Math.max(0, overlapX), overlapY: Math.max(0, overlapY), depth: colliding ? Math.min(overlapX, overlapY) : 0 };
}

export function detectCollision(objectAId: string, objectBId: string): CollisionResult | null {
  const a = objects.get(objectAId); const b = objects.get(objectBId);
  if (!a || !b) return null;
  const { colliding, overlapX, overlapY, depth } = checkAABB(a.boundingBox, b.boundingBox);
  const result: CollisionResult = { resultId: `cr-${++resultCounter}`, objectAId, objectBId, colliding, overlapX, overlapY, penetrationDepth: depth, detectedAt: Date.now() };
  results.push(result);
  return result;
}

export function detectAllCollisions(): CollisionResult[] {
  const allObjects = [...objects.values()];
  const newResults: CollisionResult[] = [];
  for (let i = 0; i < allObjects.length; i++) {
    for (let j = i + 1; j < allObjects.length; j++) {
      const r = detectCollision(allObjects[i].objectId, allObjects[j].objectId);
      if (r && r.colliding) newResults.push(r);
    }
  }
  return newResults;
}

export function getObject(objectId: string): CollisionObject | undefined { return objects.get(objectId); }
export function getCollisions(): CollisionResult[] { return results.filter(r => r.colliding); }
export function _resetCollisionDetectorForTest(): void { objects.clear(); results.length = 0; objectCounter = 0; resultCounter = 0; }
