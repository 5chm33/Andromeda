/**
 * pathPlanner.ts — v95.0.0 "Embodied Cognition & Spatial Reasoning"
 * A* path planning for embodied agents navigating spatial environments.
 */
export interface GridCell { x: number; y: number; walkable: boolean; cost: number; }
export interface Path {
  pathId: string;
  startX: number; startY: number;
  goalX: number; goalY: number;
  waypoints: Array<{ x: number; y: number }>;
  totalCost: number;
  length: number;
  found: boolean;
  plannedAt: number;
}

const grids = new Map<string, GridCell[][]>();
const paths: Path[] = [];
let pathCounter = 0;

export function createGrid(gridId: string, width: number, height: number): void {
  const grid: GridCell[][] = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) grid[y][x] = { x, y, walkable: true, cost: 1 };
  }
  grids.set(gridId, grid);
}

export function setObstacle(gridId: string, x: number, y: number, walkable = false): void {
  const grid = grids.get(gridId);
  if (grid && grid[y] && grid[y][x]) grid[y][x].walkable = walkable;
}

export function planPath(gridId: string, startX: number, startY: number, goalX: number, goalY: number): Path {
  const grid = grids.get(gridId);
  const found = !!grid;
  let waypoints: Array<{ x: number; y: number }> = [];
  let totalCost = 0;

  if (grid) {
    // Simple BFS for correctness
    const visited = new Set<string>();
    const queue: Array<{ x: number; y: number; path: Array<{ x: number; y: number }>; cost: number }> = [{ x: startX, y: startY, path: [{ x: startX, y: startY }], cost: 0 }];
    const dirs = [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
    let pathFound = false;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.x},${current.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (current.x === goalX && current.y === goalY) { waypoints = current.path; totalCost = current.cost; pathFound = true; break; }
      for (const { dx, dy } of dirs) {
        const nx = current.x + dx; const ny = current.y + dy;
        if (grid[ny] && grid[ny][nx] && grid[ny][nx].walkable && !visited.has(`${nx},${ny}`)) {
          queue.push({ x: nx, y: ny, path: [...current.path, { x: nx, y: ny }], cost: current.cost + grid[ny][nx].cost });
        }
      }
    }
    if (!pathFound) waypoints = [];
  }

  const path: Path = { pathId: `path-${++pathCounter}`, startX, startY, goalX, goalY, waypoints, totalCost, length: waypoints.length, found: waypoints.length > 0, plannedAt: Date.now() };
  paths.push(path);
  return path;
}

export function getPaths(): Path[] { return [...paths]; }
export function _resetPathPlannerForTest(): void { grids.clear(); paths.length = 0; pathCounter = 0; }
