import { WorldConfig, Heightmap, Province } from '../types';
import { colorForProvince } from './colours';
import { createPRNG } from '../utils/math';

interface Point {
  x: number;
  y: number;
}

/**
 * Generates Voronoi-based provinces smoothed with Lloyd relaxation.
 */
export async function generateProvinces(
  config: WorldConfig,
  _heightmap: Heightmap
): Promise<Province[]> {
  const count = config.provinceCount || 25;
  const width = config.width;
  const height = config.height;
  const prng = createPRNG(typeof config.seed === 'number' ? config.seed + 101 : `${config.seed}-provinces`);
  const lloydIterations = 3;

  // 1. Initial Seed Generation (Jittered grid distribution for good spacing)
  let seeds: Point[] = generateInitialSeeds(width, height, count, prng);

  // 2. Lloyd Relaxation (move seeds toward cell center of mass)
  for (let iter = 0; iter < lloydIterations; iter++) {
    seeds = relaxSeeds(seeds, width, height);
  }

  // 3. Initialize Province objects
  const provinces: Province[] = seeds.map((seed, id) => ({
    id,
    color: colorForProvince(id),
    centerX: Math.round(seed.x),
    centerY: Math.round(seed.y),
    area: 0,
    cellIndices: [],
    settlements: [],
  }));

  // 4. Rasterize: Assign each heightmap pixel to nearest province centroid
  const numPixels = width * height;
  const nearestMap = new Int32Array(numPixels);

  // Acceleration grid for fast nearest-neighbor search
  const gridCellSize = Math.max(32, Math.floor(Math.sqrt((width * height) / count)));
  const gridCols = Math.ceil(width / gridCellSize);
  const gridRows = Math.ceil(height / gridCellSize);
  const spatialGrid: number[][] = Array.from({ length: gridCols * gridRows }, () => []);

  seeds.forEach((seed, id) => {
    const gx = Math.min(gridCols - 1, Math.max(0, Math.floor(seed.x / gridCellSize)));
    const gy = Math.min(gridRows - 1, Math.max(0, Math.floor(seed.y / gridCellSize)));
    spatialGrid[gy * gridCols + gx].push(id);
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nearestId = 0;
      let minDistanceSq = Infinity;

      // Search neighboring spatial buckets first
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

      // Fallback: If no seeds in adjacent buckets, search all seeds
      if (minDistanceSq === Infinity) {
        for (let i = 0; i < seeds.length; i++) {
          const distSq = (x - seeds[i].x) ** 2 + (y - seeds[i].y) ** 2;
          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            nearestId = i;
          }
        }
      }

      const pixelIdx = y * width + x;
      nearestMap[pixelIdx] = nearestId;
      provinces[nearestId].cellIndices.push(pixelIdx);
      provinces[nearestId].area++;
    }
  }

  // 5. Recalculate true centroid for each province
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
 * Distributes initial seed points using a jittered grid.
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
 * Performs a single pass of Lloyd relaxation on a sample grid.
 */
function relaxSeeds(seeds: Point[], width: number, height: number): Point[] {
  const sumX = new Float64Array(seeds.length);
  const sumY = new Float64Array(seeds.length);
  const counts = new Uint32Array(seeds.length);

  const step = 8; // Step size for fast relaxation approximation
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
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