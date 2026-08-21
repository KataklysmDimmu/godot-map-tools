import { WorldConfig, Heightmap, Province } from '../types';
import { colorForProvince } from './colours';
import { createPRNG } from '../utils/math';

interface Point {
  x: number;
  y: number;
}

/**
 * Generates Voronoi-based provinces smoothed with Lloyd relaxation.
 *
 * Provinces are constrained to LAND: seeds are snapped onto land, relaxation
 * only samples land cells, and rasterization skips water entirely. As a result
 * province borders follow the coastline — open water is never claimed by a
 * province, so the exported province map reveals the coast instead of drawing
 * polyglot cells straight across the ocean.
 */
export async function generateProvinces(
  config: WorldConfig,
  heightmap: Heightmap
): Promise<Province[]> {
  const count = config.provinceCount || 25;
  const width = config.width;
  const height = config.height;
  const waterLevel = config.waterLevel || 0.4;
  const prng = createPRNG(typeof config.seed === 'number' ? config.seed + 101 : `${config.seed}-provinces`);
  const lloydIterations = config.lloydIterations || 3;

  const globalDry = computeGlobalDry(heightmap);

  // 1. Initial Seed Generation (jittered grid, snapped to the nearest land)
  let seeds: Point[] = generateInitialSeeds(width, height, count, prng).map((s) =>
    snapToLand(s.x, s.y, heightmap, waterLevel, globalDry, width)
  );

  // 2. Lloyd Relaxation (move seeds toward the land-only centre of mass)
  for (let iter = 0; iter < lloydIterations; iter++) {
    seeds = relaxSeeds(seeds, width, height, heightmap, waterLevel);
  }

  // 3. Initialize Province objects from the (land-snapped) seeds
  const provinces: Province[] = seeds.map((seed, id) => ({
    id,
    color: colorForProvince(id),
    centerX: Math.round(seed.x),
    centerY: Math.round(seed.y),
    area: 0,
    cellIndices: [],
    settlements: [],
  }));

  // 4. Rasterize: assign each LAND pixel to the nearest province centroid.
  //    Water pixels are left unassigned (id -1) so no province owns the sea.
  const numPixels = width * height;
  const nearestMap = new Int32Array(numPixels).fill(-1);

  // Acceleration grid for fast nearest-neighbour search
  const gridCellSize = Math.max(32, Math.floor(Math.sqrt((width * height) / count)));
  const gridCols = Math.ceil(width / gridCellSize);
  const gridRows = Math.ceil(height / gridCellSize);
  const spatialGrid: number[][] = Array.from({ length: gridCols * gridRows }, () => []);

  seeds.forEach((seed, id) => {
    const gx = Math.min(gridCols - 1, Math.max(0, Math.floor(seed.x / gridCellSize)));
    const gy = Math.min(gridRows - 1, Math.max(0, Math.floor(seed.y / gridCellSize)));
    spatialGrid[gy * gridCols + gx].push(id);
  });

  const { data: hData } = heightmap;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (hData[pixelIdx] < waterLevel) continue; // open water — nobody owns it

      let nearestId = 0;
      let minDistanceSq = Infinity;

      // Search neighbouring spatial buckets first
      const gx = Math.floor(x / gridCellSize);
      const gy = Math.floor(y / gridCellSize);

      for (let dy = -1; dy <= 1; dy++) {
        const ny = gy + dy;
        if (ny < 0 || ny >= gridRows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = gx + dx;
          if (nx < 0 || nx >= gridCols) continue;

          const bucket = spatialGrid[ny * gridCols + nx];
          for (const seedId of bucket) {
            const seed = seeds[seedId];
            const distSq = (x - seed.x) ** 2 + (y - seed.y) ** 2;
            if (distSq < minDistanceSq) {
              minDistanceSq = distSq;
              nearestId = seedId;
            }
          }
        }
      }

      // Fallback: if no seeds in adjacent buckets, search all seeds
      if (minDistanceSq === Infinity) {
        for (let i = 0; i < seeds.length; i++) {
          const distSq = (x - seeds[i].x) ** 2 + (y - seeds[i].y) ** 2;
          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            nearestId = i;
          }
        }
      }

      nearestMap[pixelIdx] = nearestId;
      provinces[nearestId].cellIndices.push(pixelIdx);
      provinces[nearestId].area++;
    }
  }

  // 5. Recalculate the true centroid for each province from its land cells
  for (const province of provinces) {
    if (province.cellIndices.length === 0) continue;
    let sumX = 0;
    let sumY = 0;
    for (const idx of province.cellIndices) {
      sumX += idx % width;
      sumY += Math.floor(idx / width);
    }
    province.centerX = Math.round(sumX / province.cellIndices.length);
    province.centerY = Math.round(sumY / province.cellIndices.length);
  }

  return provinces;
}

/**
 * Locates the single driest (highest-elevation) cell in the whole heightmap.
 * Used as a guaranteed fallback for land-snapping when a seed is surrounded by
 * water with no reachable coast.
 */
function computeGlobalDry(heightmap: Heightmap): Point {
  const { width, data } = heightmap;
  let gx = 0;
  let gy = 0;
  let gElev = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > gElev) {
      gElev = data[i];
      gx = i % width;
      gy = Math.floor(i / width);
    }
  }
  return { x: gx, y: gy };
}

/**
 * Snaps a candidate point onto land. Expands a search ring until it finds a cell
 * above the water level, preferring coasts (just above water) over high peaks.
 * If no land is reachable, falls back to the global driest cell.
 */
function snapToLand(
  x: number,
  y: number,
  heightmap: Heightmap,
  waterLevel: number,
  globalDry: Point,
  width: number
): Point {
  const { height, data } = heightmap;
  const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(y)));

  const maxRadius = Math.max(8, Math.floor(Math.min(width, height) * 0.5));
  let landBest: Point | null = null;
  let landBestScore = -Infinity;

  for (let radius = 2; radius <= maxRadius; radius += 2) {
    for (let dy = -radius; dy <= radius; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue; // ring only
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const e = data[ny * width + nx] || 0;
        if (e < waterLevel) continue; // never start a province in open water
        // Prefer just-above-water (coastal) cells over high peaks.
        const score = -Math.abs(e - (waterLevel + 0.04));
        if (score > landBestScore) {
          landBestScore = score;
          landBest = { x: nx, y: ny };
        }
      }
    }
    if (landBest) break; // found land on this ring — stop expanding
  }

  return landBest ?? globalDry;
}

/**
 * Distributes initial seed points using a jittered grid for even spacing.
 * (Seeds are snapped to land by the caller.)
 */
function generateInitialSeeds(
  width: number,
  height: number,
  count: number,
  prng: () => number
): Point[] {
  const seeds: Point[] = [];
  const cols = Math.ceil(Math.sqrt(count * (width / height)));
  const rows = Math.ceil(count / cols);
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  for (let r = 0; r < rows && seeds.length < count; r++) {
    for (let c = 0; c < cols && seeds.length < count; c++) {
      const margin = 0.15;
      const x = (c + margin + prng() * (1 - 2 * margin)) * cellWidth;
      const y = (r + margin + prng() * (1 - 2 * margin)) * cellHeight;
      seeds.push({
        x: Math.max(0, Math.min(width - 1, x)),
        y: Math.max(0, Math.min(height - 1, y)),
      });
    }
  }

  return seeds;
}

/**
 * Performs a single pass of Lloyd relaxation over a sample grid, but only over
 * LAND cells so province centroids settle onto landmass interiors rather than
 * being pulled toward ocean centroids.
 */
function relaxSeeds(
  seeds: Point[],
  width: number,
  height: number,
  heightmap: Heightmap,
  waterLevel: number
): Point[] {
  const sumX = new Float64Array(seeds.length);
  const sumY = new Float64Array(seeds.length);
  const counts = new Uint32Array(seeds.length);

  const step = 8; // step size for fast relaxation approximation
  const { data } = heightmap;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[y * width + x] < waterLevel) continue; // land-only relaxation

      let nearestId = 0;
      let minDistanceSq = Infinity;

      for (let i = 0; i < seeds.length; i++) {
        const distSq = (x - seeds[i].x) ** 2 + (y - seeds[i].y) ** 2;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          nearestId = i;
        }
      }

      sumX[nearestId] += x;
      sumY[nearestId] += y;
      counts[nearestId]++;
    }
  }

  return seeds.map((seed, i) => {
    if (counts[i] === 0) return seed;
    return {
      x: sumX[i] / counts[i],
      y: sumY[i] / counts[i],
    };
  });
}
