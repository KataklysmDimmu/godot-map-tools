import { Heightmap, River, WorldConfig } from '../types';
import { ramerDouglasPeucker } from '../utils/pathfinding';

// 8-neighbour offsets for steepest-descent flow.
const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
];

export interface FlowField {
  width: number;
  height: number;
  // Raw elevation data (carried for callers that need it, e.g. borders).
  data: Float32Array;
  // For each pixel: index of the downstream neighbour it flows into (-1 = sink/outflow).
  flowDir: Int32Array;
  // Accumulated upstream area (number of contributing pixels).
  accumulation: Float32Array;
  // Ridge strength: how much flow *diverges* here (high = watershed divide).
  ridge: Float32Array;
}

/**
 * Build a hydrological flow field from the heightmap via steepest-descent:
 * every land cell sends its water to the lowest neighbour; accumulation counts
 * upstream contributors; ridge strength is the divergence of flow (watershed
 * divides). This is the shared foundation for both rivers and terrain-aware
 * borders (Azgaar-style: political boundaries follow watersheds, not arbitrary
 * cuts across mountains).
 */
export function computeFlowField(heightmap: Heightmap, waterLevel: number): FlowField {
  const { width, height, data } = heightmap;
  const n = width * height;
  const flowDir = new Int32Array(n).fill(-1);
  const accumulation = new Float32Array(n);
  const ridge = new Float32Array(n);

  const isWater = (i: number) => data[i] < waterLevel;

  // 1. Steepest-descent flow direction per cell (land only; water = sink).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isWater(i)) { flowDir[i] = -1; continue; }
      const h = data[i];
      let bestN = -1;
      let bestDrop = 0; // must drop to flow (no flat/local-minima loops)
      let lowestN = -1;
      let lowestH = h;
      for (const nb of NEIGHBORS) {
        const nx = x + nb.dx;
        const ny = y + nb.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (isWater(ni)) { bestN = ni; bestDrop = Math.max(bestDrop, h - data[ni]); lowestN = ni; lowestH = data[ni]; continue; }
        const nh = data[ni];
        const drop = h - nh;
        if (drop > bestDrop) { bestDrop = drop; bestN = ni; }
        if (nh < lowestH) { lowestH = nh; lowestN = ni; }
      }
      // Prefer true downhill flow; fall back to the lowest neighbour so rivers
      // can escape local minima (lakes overflow) instead of dead-ending.
      flowDir[i] = bestN >= 0 ? bestN : lowestN;
    }
  }

  // 2. Flow accumulation via in-degree (topological) propagation. Each land
  // cell flows to exactly one downstream neighbour, forming a DAG; we seed
  // sources (in-degree 0) and propagate their area downstream. O(n), no
  // re-pushing storms.
  const indegree = new Int32Array(n); // # of upstream cells flowing INTO i
  for (let i = 0; i < n; i++) {
    const down = flowDir[i];
    if (down >= 0 && !isWater(down)) indegree[down]++;
  }
  // Index-based queue (O(1) shift) to avoid Array.shift()'s O(n) cost.
  const queue = new Int32Array(n);
  let qHead = 0, qTail = 0;
  for (let i = 0; i < n; i++) {
    accumulation[i] = isWater(i) ? 0 : 1;
    if (!isWater(i) && indegree[i] === 0) queue[qTail++] = i; // sources
  }
  while (qHead < qTail) {
    const i = queue[qHead++];
    const down = flowDir[i];
    if (down < 0 || isWater(down)) continue;
    accumulation[down] += accumulation[i];
    if (--indegree[down] === 0) queue[qTail++] = down;
  }

  // 3. Ridge strength = watershed divergence. A cell where few neighbours flow
  // *into* it but it carries high upstream accumulation is a divide (flow splits
  // there) — the natural line for a political border. Valleys (many tributaries
  // join) and peaks (near source, low accumulation) both score low. Normalized
  // to 0..1 so downstream scoring is scale-independent.
  let ridgeMax = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (isWater(i)) { ridge[i] = 0; continue; }
      let incoming = 0;
      for (const nb of NEIGHBORS) {
        const nx = x + nb.dx;
        const ny = y + nb.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (!isWater(ni) && flowDir[ni] === i) incoming++;
      }
      const r = accumulation[i] * (1 / (1 + incoming));
      ridge[i] = r;
      if (r > ridgeMax) ridgeMax = r;
    }
  }
  if (ridgeMax > 0) for (let i = 0; i < n; i++) ridge[i] /= ridgeMax;

  return { width, height, data, flowDir, accumulation, ridge };
}

/**
 * Chaikin curve smoothing: rounds the sharp 45°/90° corners of a steepest-
 * descent path into a gently meandering curve. `iterations` controls roundness.
 */
function chaikinSmooth(
  pts: { x: number; y: number }[],
  iterations: number
): { x: number; y: number }[] {
  let out = pts;
  for (let it = 0; it < iterations; it++) {
    if (out.length < 3) break;
    const next: { x: number; y: number }[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * Generate rivers as a dendritic (tree-like) drainage network derived directly
 * from the flow field. Rather than tracing a few hand-picked peaks, every cell
 * that drains a sufficiently large upstream area becomes part of the river
 * network; tributaries merge naturally as flow converges downstream. We then
 * extract connected river stems that reach the coast/edge (or a lake), ordered
 * so that the main stem carries the highest accumulation (= widest river).
 *
 * Network density scales with land area × riverDensity.
 */
export function generateRivers(
  config: WorldConfig,
  heightmap: Heightmap
): River[] {
  const waterLevel = config.waterLevel ?? 0.4;
  const density = config.riverDensity ?? 0.3;
  const { width, height, data } = heightmap;
  const n = width * height;

  const flow = computeFlowField(heightmap, waterLevel);

  // Count land cells to scale the river threshold.
  let landCells = 0;
  for (let i = 0; i < n; i++) if (data[i] >= waterLevel) landCells++;
  if (landCells < 25) return [];

  // A cell becomes river if it drains more than `thresh` upstream pixels.
  // Lower density → only the biggest arteries; higher → more tributaries.
  // Tuned so density 1.0 on a ~170k-land map yields a moderately branching net.
  const thresh = Math.max(12, Math.round((landCells / 1500) * (1.6 - density)));
  if (thresh <= 0) return [];

  // isRiver[i]: which river id (or -1) this cell belongs to.
  const isRiver = new Int32Array(n).fill(-1);

  // Mark every cell that drains enough upstream area as part of the river
  // network, then split into connected components (8-neighbour flood fill).
  // Each component is one river (its tributaries are contiguous with the stem).
  for (let i = 0; i < n; i++) {
    if (data[i] >= waterLevel && flow.accumulation[i] >= thresh) isRiver[i] = 0; // mark, id assigned below
  }

  // Connected-component labelling of marked cells.
  const compId = new Int32Array(n).fill(-1);
  let ncomp = 0;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (isRiver[start] < 0 || compId[start] >= 0) continue;
    const cid = ncomp++;
    stack.length = 0; stack.push(start); compId[start] = cid;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % width, cy = Math.floor(c / width);
      for (const nb of NEIGHBORS) {
        const nx = cx + nb.dx, ny = cy + nb.dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (isRiver[ni] >= 0 && compId[ni] < 0) { compId[ni] = cid; stack.push(ni); }
      }
    }
  }

  // Group cells by river component id.
  const cellsById = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const id = compId[i];
    if (id < 0) continue;
    if (!cellsById.has(id)) cellsById.set(id, []);
    cellsById.get(id)!.push(i);
  }

  const rivers: River[] = [];
  for (const [, cells] of cellsById) {
    if (cells.length < 4) continue; // ignore tiny streams
    // Accumulation increases downstream, so the headwater (source) is the cell
    // with the LOWEST accumulation in this river group.
    let source = cells[0];
    for (const c of cells) if (flow.accumulation[c] < flow.accumulation[source]) source = c;
    // Walk downstream following flowDir until we leave the river set / hit sea/edge.
    const path: { x: number; y: number }[] = [];
    const seen = new Set<number>();
    let cur = source;
    let guard = 0;
    let reachesEdge = false;
    while (cur >= 0 && guard++ < n) {
      if (seen.has(cur)) break;
      seen.add(cur);
      path.push({ x: cur % width, y: Math.floor(cur / width) });
      if (data[cur] < waterLevel) break;
      const down = flow.flowDir[cur];
      if (down < 0) { reachesEdge = true; break; }
      // Follow the flow downstream; stop only when we reach the sea or edge.
      cur = down;
    }
    if (path.length < 4) continue;
    const mouth = path[path.length - 1];
    const mouthIdx = mouth.y * width + mouth.x;
    if (!reachesEdge && data[mouthIdx] >= waterLevel) continue; // didn't reach water
    // Smooth the staircase (steepest-descent) path into a meandering curve
    // with Chaikin iteration, then simplify for storage.
    const smoothed = chaikinSmooth(path, 3);
    const simplified = ramerDouglasPeucker(smoothed, 2.0);
    let length = 0;
    for (let k = 0; k < simplified.length - 1; k++) {
      length += Math.hypot(simplified[k + 1].x - simplified[k].x, simplified[k + 1].y - simplified[k].y);
    }
    if (length < 8) continue;
    const src0 = simplified[0];
    const mouth0 = simplified[simplified.length - 1];
    // Width per point from flow accumulation: thin headwaters → wide mouth,
    // jumping where tributaries join. sqrt scaling keeps the range sane.
    let maxAccum = 1;
    for (const p of simplified) {
      const a = flow.accumulation[p.y * width + p.x];
      if (a > maxAccum) maxAccum = a;
    }
    const widths = simplified.map((p) => {
      const ix = Math.min(width - 1, Math.max(0, Math.round(p.x)));
      const iy = Math.min(height - 1, Math.max(0, Math.round(p.y)));
      const a = flow.accumulation[iy * width + ix];
      const t = Math.sqrt(Math.max(0, a) / maxAccum); // 0..1
      return 1.2 + t * 7.8; // 1.2px headwater → 9px mouth
    });
    rivers.push({
      id: rivers.length,
      path: simplified,
      sourceX: src0.x, sourceY: src0.y,
      mouthX: mouth0.x, mouthY: mouth0.y,
      length: Math.round(length * 10) / 10,
      order: 1,
      widths,
    });
  }

  // Cap the number of rivers so high-density maps don't become a hairball:
  // keep the largest `maxRivers` stems (by cell count) and re-id them.
  const maxRivers = Math.max(4, Math.round(8 + density * 40));
  if (rivers.length > maxRivers) {
    rivers.sort((a, b) => b.length - a.length);
    rivers.length = maxRivers;
  }
  // Re-assign sequential ids after any cap.
  rivers.forEach((r, i) => { r.id = i; });

  return rivers;
}
