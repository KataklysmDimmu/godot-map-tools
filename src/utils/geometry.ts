import { Province, BorderEdge, Heightmap } from '../types';
import { ramerDouglasPeucker } from './pathfinding';
import { computeFlowField } from '../generators/hydrology';

export function computeBorders(
  provinces: Province[],
  width?: number,
  height?: number,
  heightmap?: Heightmap,
  terrainDifficulty: number = 0.5,
  waterLevel: number = 0.4
): BorderEdge[] {
  if (provinces.length === 0) return [];

  let maxW = width || 0;
  let maxH = height || 0;

  if (!maxW || !maxH) {
    // Infer dimensions from cell indices
    let maxIdx = 0;
    for (const prov of provinces) {
      for (const idx of prov.cellIndices) {
        if (idx > maxIdx) maxIdx = idx;
      }
    }
    // Default assumption: square-ish, fallback to 2048 if truly empty
    const side = Math.max(2048, Math.ceil(Math.sqrt(maxIdx + 1)));
    maxW = side;
    maxH = side;
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

  const borderSegments = new Map<string, { pA: number; pB: number; points: {x: number; y: number}[] }>();

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

  // Optional terrain-aware refinement: snap each border polyline to follow
  // ridge/watershed lines (high flow divergence) instead of cutting straight
  // across mountains. Cost favours ridges and penalises steep slopes; the
  // search is constrained to a narrow corridor around the original seam so a
  // province never loses/gains cells.
  const flow = heightmap ? computeFlowField(heightmap, waterLevel) : null;

  for (const { pA, pB, points } of borderSegments.values()) {
    if (points.length < 2) continue;

    points.sort((a, b) => a.x - b.x || a.y - b.y);
    let simplified = ramerDouglasPeucker(points, 2.0);

    if (flow) {
      simplified = snapToRidges(simplified, flow, terrainDifficulty, waterLevel);
    }

    borders.push({
      id: edgeId++,
      provinceIds: [pA, pB],
      from: simplified[0],
      to: simplified[simplified.length - 1],
      points: simplified,
    });
  }

  return borders;
}

/**
 * Re-route a border polyline so it prefers to run along high ground (ridges /
 * watersheds) rather than cutting through valleys or across water. The search
 * is constrained to a corridor around the original seam so a province never
 * loses/gains cells. Corridor width and the strength of the high-ground bias
 * scale with terrainDifficulty.
 */
function snapToRidges(
  points: { x: number; y: number }[],
  flow: { width: number; height: number; data: Float32Array; flowDir: Int32Array; ridge: Float32Array; accumulation: Float32Array },
  terrainDifficulty: number,
  waterLevel: number
): { x: number; y: number }[] {
  if (points.length < 2) return points;
  const { width, height, data, ridge } = flow;
  // Corridor 12..52px; stronger difficulty → wider search + stronger ridge bias.
  const corridor = Math.round(12 + terrainDifficulty * 40);
  const ridgeWeight = 40 + terrainDifficulty * 120;
  const out: { x: number; y: number }[] = [points[0]];

  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s];
    const b = points[s + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(segLen));
    for (let t = 1; t <= steps; t++) {
      const f = t / steps;
      const bx = a.x + (b.x - a.x) * f;
      const by = a.y + (b.y - a.y) * f;
      let bestX = Math.round(bx);
      let bestY = Math.round(by);
      let bestScore = -Infinity;
      const cxx = Math.round(bx), cyy = Math.round(by);
      for (let oy = -corridor; oy <= corridor; oy++) {
        for (let ox = -corridor; ox <= corridor; ox++) {
          const cx = cxx + ox;
          const cy = cyy + oy;
          if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
          const idx = cy * width + cx;
          const h = data[idx];
          if (h < waterLevel) continue; // never route a border through water
          const distPenalty = (ox * ox + oy * oy) / (corridor * corridor);
          // Dominant signal = watershed divide (flow divergence, `ridge`):
          // high where flow splits (a natural border) and low in valleys/peaks.
          // Elevation is a minor tiebreaker; distance keeps it near the seam.
          const score = ridge[idx] * ridgeWeight + h * 30 - distPenalty * 25;
          if (score > bestScore) {
            bestScore = score;
            bestX = cx;
            bestY = cy;
          }
        }
      }
      out.push({ x: bestX, y: bestY });
    }
  }
  return out;
}
