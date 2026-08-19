// pathfinding.ts

import { Heightmap } from '../types';

export interface PathPoint {
  x: number;
  y: number;
}

/**
 * Min-Heap Priority Queue for fast A* node expansion.
 */
class MinHeap<T> {
  private heap: { element: T; priority: number }[] = [];

  push(element: T, priority: number): void {
    this.heap.push({ element, priority });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].element;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.heap.length;
  }

  private bubbleUp(index: number): void {
    const node = this.heap[index];
    while (index > 0) {
      const parentIdx = (index - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (node.priority >= parent.priority) break;
      this.heap[index] = parent;
      index = parentIdx;
    }
    this.heap[index] = node;
  }

  private sinkDown(index: number): void {
    const length = this.heap.length;
    const node = this.heap[index];

    while (true) {
      const leftChildIdx = (index << 1) + 1;
      const rightChildIdx = leftChildIdx + 1;
      let swapIdx = -1;

      if (leftChildIdx < length) {
        if (this.heap[leftChildIdx].priority < node.priority) {
          swapIdx = leftChildIdx;
        }
      }

      if (rightChildIdx < length) {
        const rightPriority = this.heap[rightChildIdx].priority;
        const comparePriority = swapIdx === -1 ? node.priority : this.heap[leftChildIdx].priority;
        if (rightPriority < comparePriority) {
          swapIdx = rightChildIdx;
        }
      }

      if (swapIdx === -1) break;
      this.heap[index] = this.heap[swapIdx];
      index = swapIdx;
    }
    this.heap[index] = node;
  }
}

/**
 * A* Pathfinding across a 2D Heightmap.
 * Accounts for distance, elevation slope changes, and water barriers.
 */
export function astar(
  start: PathPoint,
  goal: PathPoint,
  heightmap: Heightmap,
  waterLevel: number = 0.4,
  stepSize: number = 2
): PathPoint[] {
  const { width, height, data } = heightmap;

  // Align start/goal to step grid
  const startX = Math.floor(start.x / stepSize) * stepSize;
  const startY = Math.floor(start.y / stepSize) * stepSize;
  const goalX = Math.floor(goal.x / stepSize) * stepSize;
  const goalY = Math.floor(goal.y / stepSize) * stepSize;

  const gridW = Math.ceil(width / stepSize);
  const gridH = Math.ceil(height / stepSize);

  const getIdx = (gx: number, gy: number) => gy * gridW + gx;

  const gScore = new Float32Array(gridW * gridH).fill(Infinity);
  const cameFrom = new Int32Array(gridW * gridH).fill(-1);

  const startGIdx = getIdx(startX / stepSize, startY / stepSize);
  const goalGIdx = getIdx(goalX / stepSize, goalY / stepSize);

  gScore[startGIdx] = 0;

  const openSet = new MinHeap<number>();
  openSet.push(startGIdx, 0);

  const neighbors = [
    { dx: 1, dy: 0, dist: 1 },
    { dx: -1, dy: 0, dist: 1 },
    { dx: 0, dy: 1, dist: 1 },
    { dx: 0, dy: -1, dist: 1 },
    { dx: 1, dy: 1, dist: 1.414 },
    { dx: -1, dy: 1, dist: 1.414 },
    { dx: 1, dy: -1, dist: 1.414 },
    { dx: -1, dy: -1, dist: 1.414 },
  ];

  while (openSet.size > 0) {
    const currentIdx = openSet.pop()!;

    if (currentIdx === goalGIdx) {
      return reconstructPath(cameFrom, currentIdx, gridW, stepSize, start, goal);
    }

    const cgx = currentIdx % gridW;
    const cgy = Math.floor(currentIdx / gridW);
    const cx = cgx * stepSize;
    const cy = cgy * stepSize;
    const currentElevation = data[cy * width + cx];

    for (const n of neighbors) {
      const ngx = cgx + n.dx;
      const ngy = cgy + n.dy;

      if (ngx < 0 || ngx >= gridW || ngy < 0 || ngy >= gridH) continue;

      const nx = ngx * stepSize;
      const ny = ngy * stepSize;
      const neighborIdx = getIdx(ngx, ngy);
      const nextElevation = data[ny * width + nx];

      // Cost Calculation: distance + slope steepness penalty + water penalty
      const slope = Math.abs(nextElevation - currentElevation);
      let terrainCost = n.dist * stepSize * (1 + slope * 15);

      if (nextElevation < waterLevel) {
        terrainCost += 500; // Heavy penalty to keep roads on land
      }

      const tentativeG = gScore[currentIdx] + terrainCost;

      if (tentativeG < gScore[neighborIdx]) {
        cameFrom[neighborIdx] = currentIdx;
        gScore[neighborIdx] = tentativeG;

        // Euclidean heuristic
        const hDist = Math.hypot((goalX - nx), (goalY - ny));
        openSet.push(neighborIdx, tentativeG + hDist);
      }
    }
  }

  // Fallback direct path if unreachable
  return [start, goal];
}

function reconstructPath(
  cameFrom: Int32Array,
  currentIdx: number,
  gridW: number,
  stepSize: number,
  start: PathPoint,
  goal: PathPoint
): PathPoint[] {
  const path: PathPoint[] = [goal];
  let curr = currentIdx;

  while (cameFrom[curr] !== -1) {
    const gx = curr % gridW;
    const gy = Math.floor(curr / gridW);
    path.push({ x: gx * stepSize, y: gy * stepSize });
    curr = cameFrom[curr];
  }

  path.push(start);
  return path.reverse();
}

/**
 * Ramer-Douglas-Peucker (RDP) algorithm to simplify path vectors.
 */
export function ramerDouglasPeucker(points: PathPoint[], epsilon: number = 3.0): PathPoint[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [start, end];
}

function perpendicularDistance(p: PathPoint, lineStart: PathPoint, lineEnd: PathPoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(p.x - lineStart.x, p.y - lineStart.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - lineStart.x) * dx + (p.y - lineStart.y) * dy) / lenSq));
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.hypot(p.x - projX, p.y - projY);
}

export function calculatePathDistance(path: PathPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  }
  return Math.round(total * 10) / 10;
}