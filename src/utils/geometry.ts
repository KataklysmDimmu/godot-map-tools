import { Province, BorderEdge } from '../types';
import { ramerDouglasPeucker } from './pathfinding';

export interface Point {
  x: number;
  y: number;
}

export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computeBorders(
  provinces: Province[],
  width?: number,
  height?: number
): BorderEdge[] {
  if (provinces.length === 0) return [];

  let maxW = width || 0;
  let maxH = height || 0;

  if (!maxW || !maxH) {
    for (const prov of provinces) {
      for (const idx of prov.cellIndices) {
        maxW = Math.max(maxW, (idx % 2048) + 1);
        maxH = Math.max(maxH, Math.floor(idx / 2048) + 1);
      }
    }
  }

  const w = maxW || 2048;
  const h = maxH || 2048;

  const provinceGrid = new Int32Array(w * h).fill(-1);
  for (const prov of provinces) {
    for (const idx of prov.cellIndices) {
      if (idx < provinceGrid.length) {
        provinceGrid[idx] = prov.id;
      }
    }
  }

  const borderSegments = new Map<string, { pA: number; pB: number; points: Point[] }>();

  function addBorderPoint(x: number, y: number, idA: number, idB: number) {
    if (idA === idB || idA === -1 || idB === -1) return;

    const minId = Math.min(idA, idB);
    const maxId = Math.max(idA, idB);
    const key = `${minId}-${maxId}`;

    if (!borderSegments.has(key)) {
      borderSegments.set(key, { pA: minId, pB: maxId, points: [] });
    }

    borderSegments.get(key)!.points.push({ x, y });
  }

  const step = 2;
  for (let y = 0; y < h - step; y += step) {
    for (let x = 0; x < w - step; x += step) {
      const current = provinceGrid[y * w + x];
      const right = provinceGrid[y * w + (x + step)];
      const down = provinceGrid[(y + step) * w + x];

      if (right !== current) {
        addBorderPoint(x + Math.floor(step / 2), y, current, right);
      }
      if (down !== current) {
        addBorderPoint(x, y + Math.floor(step / 2), current, down);
      }
    }
  }

  const borders: BorderEdge[] = [];
  let edgeId = 0;

  for (const { pA, pB, points } of borderSegments.values()) {
    if (points.length < 2) continue;

    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const simplified = ramerDouglasPeucker(points, 2.0);

    borders.push({
      id: edgeId++,
      provinceIds: [pA, pB],
      from: simplified[0],
      to: simplified[simplified.length - 1],
      points: simplified,
    } as unknown as BorderEdge);
  }

  return borders;
}